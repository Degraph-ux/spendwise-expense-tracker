const test = require('node:test');
const assert = require('node:assert/strict');
const { SupabaseRelationalStorage, getSupabaseConfig } = require('./supabase');

const userId = 'c59090e8-55f7-453d-9332-b4ad1f3a7619';
const categoryId = '6b15dd0c-79d9-4c34-9b4a-57659914a605';

class MockQuery {
  constructor(table, records, operations) {
    this.table = table;
    this.records = records[table] || [];
    this.operations = operations;
    this.filters = [];
    this.action = 'select';
  }

  select() { return this; }
  order() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  is(column, value) { this.filters.push((row) => row[column] === value); return this; }
  maybeSingle() {
    return Promise.resolve({ data: this.filtered()[0] || null, error: null });
  }
  upsert(rows) {
    this.action = 'upsert';
    this.rows = rows;
    return this;
  }
  delete() {
    this.action = 'delete';
    return this;
  }
  in(column, values) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  filtered() {
    return this.records.filter((row) => this.filters.every((filter) => filter(row)));
  }
  then(resolve, reject) {
    const result = this.action === 'upsert'
      ? { data: (this.operations.push({ table: this.table, rows: this.rows }), this.rows), error: null }
      : { data: this.filtered(), error: null };
    return Promise.resolve(result).then(resolve, reject);
  }
}

function mockClient(records, operations) {
  return {
    from(table) {
      return new MockQuery(table, records, operations);
    }
  };
}

test('Supabase configuration accepts anon and publishable keys, not service-role-only config', () => {
  assert.deepEqual(getSupabaseConfig({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon'
  }), {
    url: 'https://project.supabase.co',
    anonKey: 'anon'
  });
  assert.deepEqual(getSupabaseConfig({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable'
  }).anonKey, 'publishable');
  assert.throws(() => getSupabaseConfig({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role'
  }), /SUPABASE_ANON_KEY/);
});

test('relational storage scopes requests to a user token and maps profile settings', async () => {
  const records = {
    profiles: [{
      id: userId,
      full_name: 'SpendWise User',
      monthly_budget: '1250.45',
      currency: 'EUR'
    }]
  };
  const tokens = [];
  const storage = new SupabaseRelationalStorage({
    config: { url: 'https://project.supabase.co', anonKey: 'anon' },
    clientFactory: (config, token) => {
      tokens.push(token);
      return mockClient(records, []);
    }
  });

  const settings = await storage.runWithUser('user-jwt', userId, () =>
    storage.read(`users/${userId}/settings.json`, {})
  );
  assert.deepEqual(settings, {
    displayName: 'SpendWise User',
    monthlyBudget: 1250.45,
    currency: 'EUR'
  });
  assert.deepEqual(tokens, ['user-jwt']);
  await assert.rejects(
    storage.runWithUser('user-jwt', userId, () =>
      storage.read('users/another-user/expenses.json', [])
    ),
    /does not match the authenticated user/
  );
});

test('relational storage writes expense rows with owned category references', async () => {
  const records = {
    expenses: [],
    categories: [{ id: categoryId, name: 'Food', user_id: null }]
  };
  const operations = [];
  const storage = new SupabaseRelationalStorage({
    config: { url: 'https://project.supabase.co', anonKey: 'anon' },
    clientFactory: () => mockClient(records, operations)
  });
  const expense = {
    id: '36a6bd6d-28a5-4e31-beb6-cc301e4bd4a8',
    name: 'Lunch',
    amount: 12.34,
    category: 'Food',
    date: '2026-11-13',
    description: 'Work'
  };

  await storage.runWithUser('user-jwt', userId, async () => {
    const expenses = await storage.read(`users/${userId}/expenses.json`, []);
    expenses.push(expense);
    await storage.write(`users/${userId}/expenses.json`, expenses);
  });

  assert.deepEqual(operations, [{
    table: 'expenses',
    rows: [{
      id: expense.id,
      user_id: userId,
      title: 'Lunch',
      amount: 12.34,
      category_id: categoryId,
      description: 'Work',
      payment_method: null,
      expense_date: '2026-11-13',
      recurring_id: null,
      recurring_date: null
    }]
  }]);
});
