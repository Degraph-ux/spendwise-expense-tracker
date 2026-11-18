const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { SupabaseDocumentStorage, createStorage, JsonFileStorage } = require('./storage');
const { makeRows } = require('./scripts/import-json-to-supabase');

test('Supabase storage reads JSON documents with the service-role credential', async () => {
  let requestUrl;
  let requestOptions;
  const storage = new SupabaseDocumentStorage({
    url: 'https://project.supabase.co',
    serviceRoleKey: 'service-role-test-key',
    fetchImplementation: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return { ok: true, json: async () => [{ data: [{ id: 'expense-1' }] }] };
    }
  });

  const expenses = await storage.read('users/account-1/expenses.json', []);

  assert.deepEqual(expenses, [{ id: 'expense-1' }]);
  assert.equal(requestUrl.searchParams.get('key'), 'eq.users/account-1/expenses.json');
  assert.equal(requestUrl.searchParams.get('select'), 'data');
  assert.equal(requestOptions.headers.apikey, 'service-role-test-key');
  assert.equal(requestOptions.headers.Authorization, 'Bearer service-role-test-key');
});

test('Supabase storage upserts documents and surfaces database failures', async () => {
  let requestUrl;
  let requestOptions;
  const storage = new SupabaseDocumentStorage({
    url: 'https://project.supabase.co',
    serviceRoleKey: 'service-role-test-key',
    fetchImplementation: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return { ok: true, text: async () => '' };
    }
  });

  await storage.write('settings.json', { currency: 'USD' });

  assert.equal(requestOptions.method, 'POST');
  assert.equal(requestUrl.searchParams.get('on_conflict'), 'key');
  assert.equal(requestOptions.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.deepEqual(JSON.parse(requestOptions.body), {
    key: 'settings.json',
    data: { currency: 'USD' }
  });

  const failedStorage = new SupabaseDocumentStorage({
    url: 'https://project.supabase.co',
    serviceRoleKey: 'service-role-test-key',
    fetchImplementation: async () => ({
      ok: false,
      status: 503,
      text: async () => 'database unavailable'
    })
  });
  await assert.rejects(failedStorage.read('settings.json', {}), /Supabase storage request failed \(503\)/);
});

test('legacy migration maps expenses to relational rows and keeps monetary values decimal', () => {
  const account = { id: 'c59090e8-55f7-453d-9332-b4ad1f3a7619', email: 'legacy@example.test' };
  const systemCategories = ['Food', 'Transport', 'Housing', 'Entertainment', 'Savings', 'Utilities', 'Other']
    .map((name, index) => ({ id: `${index + 1}b15dd0c-79d9-4c34-9b4a-57659914a605`, name }));
  const rows = makeRows(account, 'c59090e8-55f7-453d-9332-b4ad1f3a7619', {
    'settings.json': { displayName: 'Legacy', monthlyBudget: 900, currency: 'EUR' },
    'categories.json': [],
    'expenses.json': [{
      id: '36a6bd6d-28a5-4e31-beb6-cc301e4bd4a8',
      name: 'Lunch',
      amount: 12.34,
      category: 'Food',
      date: '2026-11-13'
    }]
  }, systemCategories);

  assert.equal(rows.profile.monthly_budget, '900');
  assert.equal(rows.profile.currency, 'EUR');
  assert.equal(rows.expenses[0].title, 'Lunch');
  assert.equal(rows.expenses[0].amount, '12.34');
  assert.equal(rows.expenses[0].category_id, systemCategories[0].id);
  assert.equal(rows.expenses[0].user_id, account.id);
});

test('storage selection requires Supabase in production', () => {
  const originalEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    storage: process.env.SPENDWISE_STORAGE,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.SPENDWISE_STORAGE = 'file';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(() => createStorage(), /File storage is disabled in production/);
    assert.throws(() => createStorage({ storageMode: 'supabase' }), /requires SUPABASE_URL/);
  } finally {
    for (const [name, value] of [
      ['NODE_ENV', originalEnvironment.nodeEnv],
      ['SPENDWISE_STORAGE', originalEnvironment.storage],
      ['SUPABASE_URL', originalEnvironment.url],
      ['SUPABASE_SERVICE_ROLE_KEY', originalEnvironment.key]
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.ok(createStorage({ dataDir: os.tmpdir() }) instanceof JsonFileStorage);
});
