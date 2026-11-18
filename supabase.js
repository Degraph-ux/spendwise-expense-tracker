const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const userContext = new AsyncLocalStorage();

function getSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase requires SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).');
  }
  return { url, anonKey };
}

function createSupabaseClient(config = getSupabaseConfig(), accessToken) {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  return createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
      experimental: { recoveryCodes: true }
    },
    global: { headers }
  });
}

function throwOnError(result) {
  if (result.error) {
    const error = new Error(result.error.message || 'Supabase request failed.');
    error.code = result.error.code;
    error.status = result.status;
    throw error;
  }
  return result.data;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function currentMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

class SupabaseRelationalStorage {
  constructor({ config = getSupabaseConfig(), clientFactory = createSupabaseClient } = {}) {
    this.config = config;
    this.clientFactory = clientFactory;
  }

  runWithUser(accessToken, userId, callback) {
    const context = {
      client: this.clientFactory(this.config, accessToken),
      userId,
      snapshots: new Map()
    };
    return userContext.run(context, callback);
  }

  getContext(key) {
    const context = userContext.getStore();
    if (!context?.client || !context.userId) {
      throw new Error(`Supabase storage access for ${key} requires an authenticated user context.`);
    }
    return context;
  }

  parseUserKey(key) {
    const match = /^users\/([^/]+)\/(settings|expenses|categories|recurring|income|recurring-income|budgets|goals|reminders)\.json$/.exec(key);
    if (!match) throw new Error(`Unsupported Supabase document key: ${key}`);
    const context = this.getContext(key);
    if (match[1] !== context.userId) throw new Error('Supabase document user does not match the authenticated user.');
    return { userId: match[1], name: match[2], context };
  }

  async read(key, fallback) {
    const { userId, name, context } = this.parseUserKey(key);
    const client = context.client;
    let data;

    if (name === 'settings') {
      const result = await client.from('profiles')
        .select('full_name,monthly_budget,currency,avatar_url')
        .eq('id', userId)
        .maybeSingle();
      const profile = throwOnError(result);
      data = profile ? {
        displayName: profile.full_name,
        monthlyBudget: Number(profile.monthly_budget),
        currency: profile.currency,
        ...(profile.avatar_url ? { avatarUrl: profile.avatar_url } : {})
      } : fallback;
    } else {
      data = await this.readCollection(client, userId, name, fallback);
    }

    context.snapshots.set(key, clone(data));
    return clone(data);
  }

  async readCollection(client, userId, name, fallback) {
    const queries = {
      expenses: () => client.from('expenses')
        .select('id,title,amount,description,expense_date,payment_method,recurring_id,recurring_date,category:categories(name)')
        .eq('user_id', userId)
        .order('expense_date', { ascending: false }),
      categories: () => client.from('categories')
        .select('id,name,label,description,icon,color')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      recurring: () => client.from('recurring_expenses')
        .select('id,name,amount,description,day,active,next_run_date,category:categories(name)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      income: () => client.from('income_entries')
        .select('id,name,amount,income_date,description,recurring_id,recurring_date')
        .eq('user_id', userId)
        .order('income_date', { ascending: false }),
      'recurring-income': () => client.from('recurring_income')
        .select('id,name,amount,description,day,active,next_run_date')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      budgets: () => {
        const { month, year } = currentMonth();
        return client.from('budgets')
          .select('id,amount,period,category:categories(name)')
          .eq('user_id', userId)
          .eq('month', month)
          .eq('year', year)
          .order('created_at', { ascending: true });
      },
      goals: () => client.from('savings_goals')
        .select('id,title,target_amount,current_amount,deadline,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      reminders: () => client.from('reminders')
        .select('id,title,reminder_date,description,type,amount,completed')
        .eq('user_id', userId)
        .order('reminder_date', { ascending: true })
    };
    const query = queries[name];
    if (!query) throw new Error(`Unsupported Supabase collection: ${name}`);
    const rows = throwOnError(await query()) || [];
    return rows.map((row) => this.toDocument(name, row));
  }

  toDocument(name, row) {
    if (name === 'expenses') {
      return {
        id: row.id,
        name: row.title,
        amount: Number(row.amount),
        category: row.category?.name || 'Other',
        date: row.expense_date,
        description: row.description || '',
        ...(row.payment_method ? { paymentMethod: row.payment_method } : {}),
        ...(row.recurring_id ? { recurringId: row.recurring_id, recurringDate: row.recurring_date } : {})
      };
    }
    if (name === 'categories') {
      return {
        id: row.id,
        name: row.name,
        label: row.label,
        description: row.description,
        icon: row.icon,
        color: row.color,
        builtIn: false
      };
    }
    if (name === 'recurring') {
      return {
        id: row.id,
        name: row.name,
        amount: Number(row.amount),
        category: row.category?.name || 'Other',
        description: row.description || '',
        day: row.day,
        active: row.active,
        nextRunDate: row.next_run_date
      };
    }
    if (name === 'income') {
      return {
        id: row.id,
        name: row.name,
        amount: Number(row.amount),
        date: row.income_date,
        description: row.description || '',
        ...(row.recurring_id ? { recurringId: row.recurring_id, recurringDate: row.recurring_date } : {})
      };
    }
    if (name === 'recurring-income') {
      return {
        id: row.id,
        name: row.name,
        amount: Number(row.amount),
        description: row.description || '',
        day: row.day,
        active: row.active,
        nextRunDate: row.next_run_date
      };
    }
    if (name === 'budgets') {
      return {
        id: row.id,
        amount: Number(row.amount),
        period: row.period,
        category: row.category?.name || 'all'
      };
    }
    if (name === 'goals') {
      return {
        id: row.id,
        name: row.title,
        targetAmount: Number(row.target_amount),
        currentAmount: Number(row.current_amount),
        targetDate: row.deadline || '',
        createdAt: row.created_at
      };
    }
    return {
      id: row.id,
      title: row.title,
      date: row.reminder_date,
      description: row.description || '',
      type: row.type,
      amount: row.amount === null ? null : Number(row.amount),
      completed: row.completed
    };
  }

  async write(key, value) {
    const { userId, name, context } = this.parseUserKey(key);
    if (name === 'settings') return this.writeSettings(context.client, userId, value);

    const previous = context.snapshots.has(key)
      ? context.snapshots.get(key)
      : await this.read(key, []);
    const before = Array.isArray(previous) ? previous : [];
    const after = Array.isArray(value) ? value : [];
    const table = {
      expenses: 'expenses',
      categories: 'categories',
      recurring: 'recurring_expenses',
      income: 'income_entries',
      'recurring-income': 'recurring_income',
      budgets: 'budgets',
      goals: 'savings_goals',
      reminders: 'reminders'
    }[name];
    const client = context.client;
    const keyOf = (item) => name === 'categories' ? item.id || item.name : item.id;
    const beforeByKey = new Map(before.map((item) => [keyOf(item), item]));
    const afterByKey = new Map();
    for (const item of after) {
      if (!isUuid(item.id)) item.id = crypto.randomUUID();
      afterByKey.set(keyOf(item), item);
    }

    const changed = await Promise.all([...afterByKey.entries()]
      .filter(([id, item]) => !beforeByKey.has(id) || JSON.stringify(beforeByKey.get(id)) !== JSON.stringify(item))
      .map(([, item]) => this.toRow(client, userId, name, item)));
    if (changed.length) {
      throwOnError(await client.from(table).upsert(changed, { onConflict: 'id' }));
    }

    const removed = [...beforeByKey.keys()].filter((id) => !afterByKey.has(id) && isUuid(id));
    if (removed.length) {
      throwOnError(await client.from(table).delete().eq('user_id', userId).in('id', removed));
    }
    context.snapshots.set(key, clone(after));
  }

  async toRow(client, userId, name, item) {
    const base = { id: item.id, user_id: userId };
    if (name === 'categories') {
      return {
        ...base,
        name: item.name,
        label: item.label || item.name,
        description: item.description || '',
        icon: item.icon || 'tag',
        color: item.color || '#83AF3B'
      };
    }
    if (name === 'expenses' || name === 'recurring') {
      const categoryId = await this.findCategoryId(client, userId, item.category);
      if (name === 'expenses') {
        return {
          ...base,
          title: item.name,
          amount: item.amount,
          category_id: categoryId,
          description: item.description || '',
          payment_method: item.paymentMethod || null,
          expense_date: item.date,
          recurring_id: item.recurringId || null,
          recurring_date: item.recurringDate || null
        };
      }
      return {
        ...base,
        name: item.name,
        amount: item.amount,
        category_id: categoryId,
        description: item.description || '',
        day: item.day,
        active: item.active !== false,
        next_run_date: item.nextRunDate
      };
    }
    if (name === 'income') {
      return {
        ...base,
        name: item.name,
        amount: item.amount,
        income_date: item.date,
        description: item.description || '',
        recurring_id: item.recurringId || null,
        recurring_date: item.recurringDate || null
      };
    }
    if (name === 'recurring-income') {
      return {
        ...base,
        name: item.name,
        amount: item.amount,
        description: item.description || '',
        day: item.day,
        active: item.active !== false,
        next_run_date: item.nextRunDate
      };
    }
    if (name === 'budgets') {
      const categoryId = item.category === 'all' ? null : await this.findCategoryId(client, userId, item.category);
      const { month, year } = currentMonth();
      return {
        ...base,
        amount: item.amount,
        period: item.period,
        category_id: categoryId,
        month,
        year
      };
    }
    if (name === 'goals') {
      return {
        ...base,
        title: item.name,
        target_amount: item.targetAmount,
        current_amount: item.currentAmount || 0,
        deadline: item.targetDate || null
      };
    }
    return {
      ...base,
      title: item.title,
      reminder_date: item.date,
      description: item.description || '',
      type: item.type || 'custom',
      amount: item.amount ?? null,
      completed: Boolean(item.completed)
    };
  }

  async findCategoryId(client, userId, name) {
    const owned = throwOnError(await client.from('categories')
      .select('id')
      .eq('user_id', userId)
      .eq('name', name)
      .maybeSingle());
    if (owned) return owned.id;

    const system = throwOnError(await client.from('categories')
      .select('id')
      .is('user_id', null)
      .eq('name', name)
      .maybeSingle());
    if (!system) throw new Error('Choose a valid expense category.');
    return system.id;
  }

  async writeSettings(client, userId, value) {
    const updated = throwOnError(await client.from('profiles').update({
      full_name: value.displayName,
      monthly_budget: value.monthlyBudget,
      currency: value.currency
    }).eq('id', userId).select('id').maybeSingle());
    if (!updated) throw new Error('The authenticated profile could not be found.');
  }
}

module.exports = {
  SupabaseRelationalStorage,
  createSupabaseClient,
  getSupabaseConfig
};
