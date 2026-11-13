const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { loadEnvFile } = require('../server');

const systemCategoryNames = ['Food', 'Transport', 'Housing', 'Entertainment', 'Savings', 'Utilities', 'Other'];

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deterministicUuid(seed) {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function legacyUuid(accountId, kind, value, index) {
  if (typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return value;
  }
  return deterministicUuid(`${accountId}:${kind}:${value ?? index}`);
}

function money(value, label) {
  const amount = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 1_000_000_000) {
    throw new Error(`${label} must be a positive amount with no more than two decimal places.`);
  }
  return amount;
}

function makeRows(account, authUserId, documents, systemCategories) {
  const accountId = String(account.id);
  const settings = documents['settings.json'] || {};
  const categoryIds = new Map(systemCategories.map((category) => [category.name, category.id]));
  const customCategories = (documents['categories.json'] || []).filter((category) =>
    category.name && !category.builtIn
  ).map((category, index) => {
    const id = legacyUuid(accountId, 'categories', category.id || category.name, index);
    categoryIds.set(category.name, id);
    return {
      id,
      user_id: authUserId,
      name: category.name,
      label: category.label || category.name,
      description: category.description || '',
      icon: category.icon || 'tag',
      color: category.color || '#83AF3B'
    };
  });
  for (const name of systemCategoryNames) {
    if (!categoryIds.has(name)) throw new Error(`System category "${name}" is missing. Run the SQL migration first.`);
  }

  const recurring = (documents['recurring.json'] || []).map((item, index) => ({
    id: legacyUuid(accountId, 'recurring_expenses', item.id, index),
    user_id: authUserId,
    name: item.name,
    amount: money(item.amount, `Recurring expense "${item.name}"`),
    category_id: categoryIds.get(item.category) || categoryIds.get('Other'),
    description: item.description || '',
    day: item.day,
    active: item.active !== false,
    next_run_date: item.nextRunDate
  }));
  const recurringIncome = (documents['recurring-income.json'] || []).map((item, index) => ({
    id: legacyUuid(accountId, 'recurring_income', item.id, index),
    user_id: authUserId,
    name: item.name,
    amount: money(item.amount, `Recurring income "${item.name}"`),
    description: item.description || '',
    day: item.day,
    active: item.active !== false,
    next_run_date: item.nextRunDate
  }));
  const expenses = (documents['expenses.json'] || []).map((item, index) => ({
    id: legacyUuid(accountId, 'expenses', item.id, index),
    user_id: authUserId,
    title: item.name,
    amount: money(item.amount, `Expense "${item.name}"`),
    category_id: categoryIds.get(item.category) || categoryIds.get('Other'),
    description: item.description || '',
    payment_method: item.paymentMethod || null,
    expense_date: item.date,
    recurring_id: item.recurringId
      ? legacyUuid(accountId, 'recurring_expenses', item.recurringId, index)
      : null,
    recurring_date: item.recurringId ? item.recurringDate : null
  }));
  const incomes = (documents['income.json'] || []).map((item, index) => ({
    id: legacyUuid(accountId, 'income_entries', item.id, index),
    user_id: authUserId,
    name: item.name,
    amount: money(item.amount, `Income "${item.name}"`),
    income_date: item.date,
    description: item.description || '',
    recurring_id: item.recurringId
      ? legacyUuid(accountId, 'recurring_income', item.recurringId, index)
      : null,
    recurring_date: item.recurringId ? item.recurringDate : null
  }));
  const { month, year } = (() => {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  })();
  const budgets = (documents['budgets.json'] || []).map((item, index) => ({
    id: legacyUuid(accountId, 'budgets', item.id, index),
    user_id: authUserId,
    category_id: item.category === 'all' ? null : categoryIds.get(item.category) || categoryIds.get('Other'),
    amount: money(item.amount, `Budget "${item.category || 'all'}"`),
    period: item.period === 'weekly' ? 'weekly' : 'monthly',
    month,
    year
  }));
  const goals = (documents['goals.json'] || []).map((item, index) => ({
    id: legacyUuid(accountId, 'savings_goals', item.id, index),
    user_id: authUserId,
    title: item.name,
    target_amount: money(item.targetAmount, `Savings goal "${item.name}" target`),
    current_amount: item.currentAmount === 0 || item.currentAmount === undefined
      ? '0'
      : String(item.currentAmount),
    deadline: item.targetDate || null
  }));
  const reminders = (documents['reminders.json'] || []).map((item, index) => ({
    id: legacyUuid(accountId, 'reminders', item.id, index),
    user_id: authUserId,
    title: item.title,
    reminder_date: item.date,
    description: item.description || '',
    type: ['bill', 'savings', 'custom'].includes(item.type) ? item.type : 'custom',
    amount: item.amount === null || item.amount === undefined
      ? null
      : money(item.amount, `Reminder "${item.title}"`),
    completed: Boolean(item.completed)
  }));

  return {
    profile: {
      id: authUserId,
      full_name: settings.displayName || account.email,
      email: account.email,
      monthly_budget: settings.monthlyBudget ? money(settings.monthlyBudget, 'Monthly budget') : '1000',
      currency: settings.currency || 'USD'
    },
    categories: customCategories,
    recurring_expenses: recurring,
    expenses,
    recurring_income: recurringIncome,
    income_entries: incomes,
    budgets,
    savings_goals: goals,
    reminders
  };
}

async function listAuthUsers(client) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function upsertRows(client, table, rows) {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await client.from(table).upsert(rows.slice(offset, offset + 500), { onConflict: 'id' });
    if (error) throw new Error(`Could not import ${table}: ${error.message}`, { cause: error });
  }
}

async function migrateJsonData({ dataDir, client, apply = false, log = console.info }) {
  const usersFile = path.join(dataDir, 'users.json');
  const accounts = readJson(usersFile, []);
  if (!Array.isArray(accounts)) throw new Error('The legacy users.json file must contain an array.');
  const { data: systemRows, error: categoryError } = await client.from('categories')
    .select('id,name')
    .is('user_id', null);
  if (categoryError) throw categoryError;
  const systemCategories = new Map((systemRows || []).map((item) => [item.name, item]));
  const authUsers = await listAuthUsers(client);
  const authUsersByEmail = new Map(authUsers.map((user) => [user.email.toLowerCase(), user]));
  const summary = [];

  for (const account of accounts) {
    if (!account?.id || !account.email) {
      throw new Error('Every legacy account must have an id and email address.');
    }
    const folder = path.join(dataDir, 'users', String(account.id));
    const documents = {};
    for (const file of [
      'settings.json', 'categories.json', 'expenses.json', 'recurring.json',
      'income.json', 'recurring-income.json', 'budgets.json', 'goals.json', 'reminders.json'
    ]) {
      documents[file] = readJson(path.join(folder, file), file === 'settings.json' ? {} : []);
    }
    let authUser = authUsersByEmail.get(account.email.toLowerCase());
    if (!authUser && apply) {
      const { data, error } = await client.auth.admin.createUser({
        email: account.email,
        password: crypto.randomBytes(36).toString('base64url'),
        email_confirm: true,
        user_metadata: { full_name: documents['settings.json'].displayName || account.email }
      });
      if (error) throw new Error(`Could not create Supabase Auth account for ${account.email}: ${error.message}`, { cause: error });
      authUser = data.user;
      authUsersByEmail.set(account.email.toLowerCase(), authUser);
    }
    const importedUserId = authUser?.id || account.id;
    const rows = makeRows(account, importedUserId, documents, [...systemCategories.values()]);
    const counts = Object.fromEntries(Object.entries(rows)
      .filter(([table]) => table !== 'profile')
      .map(([table, tableRows]) => [table, tableRows.length]));
    summary.push({ legacyUserId: account.id, email: account.email, counts, accountCreated: !authUser && !apply });
    if (!apply) {
      log(`Would import ${account.email}: ${Object.entries(counts).map(([table, count]) => `${table}=${count}`).join(', ')}`);
      continue;
    }

    const { data: prior, error: priorError } = await client.from('legacy_account_migrations')
      .select('legacy_user_id')
      .eq('legacy_user_id', String(account.id))
      .maybeSingle();
    if (priorError) throw priorError;
    if (prior) {
      log(`Skipping ${account.email}; legacy data was already imported.`);
      continue;
    }

    const { error: profileError } = await client.from('profiles').upsert(rows.profile, { onConflict: 'id' });
    if (profileError) throw new Error(`Could not import profile for ${account.email}: ${profileError.message}`, { cause: profileError });
    for (const table of [
      'categories', 'recurring_expenses', 'recurring_income', 'expenses',
      'income_entries', 'budgets', 'savings_goals', 'reminders'
    ]) {
      await upsertRows(client, table, rows[table]);
    }
    const { error: markerError } = await client.from('legacy_account_migrations').insert({
      legacy_user_id: String(account.id),
      auth_user_id: authUser.id
    });
    if (markerError) throw new Error(`Could not mark ${account.email} as imported: ${markerError.message}`, { cause: markerError });
    log(`Imported ${account.email}; the user must set a new password with the password-reset form.`);
  }
  return summary;
}

async function main() {
  loadEnvFile(path.join(__dirname, '..', '.env'));
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the local environment for this one-time migration.');
  }
  const dataDir = path.resolve(process.env.SPENDWISE_DATA_DIR || path.join(__dirname, '..', 'data'));
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const apply = process.argv.includes('--apply');
  if (!apply) console.info('Dry run only. Add --apply to import legacy accounts and financial records.');
  const summary = await migrateJsonData({ dataDir, client, apply });
  console.info(`${apply ? 'Processed' : 'Previewed'} ${summary.length} legacy account(s).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Supabase relational import failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { deterministicUuid, makeRows, migrateJsonData };
