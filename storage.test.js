const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SupabaseDocumentStorage, createStorage, JsonFileStorage } = require('./storage');
const { importJsonFiles } = require('./scripts/import-json-to-supabase');

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

test('JSON import preserves root and per-account document keys', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spendwise-import-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const accountDirectory = path.join(dataDir, 'users', 'account-1');
  fs.mkdirSync(accountDirectory, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([{ id: 'account-1' }]));
  fs.writeFileSync(path.join(accountDirectory, 'expenses.json'), JSON.stringify([{ id: 'expense-1' }]));
  fs.writeFileSync(path.join(dataDir, '.mfa-encryption-key'), 'not imported');

  const importedDocuments = [];
  const count = await importJsonFiles(dataDir, {
    write: async (key, data) => importedDocuments.push({ key, data })
  });

  assert.equal(count, 2);
  assert.deepEqual(importedDocuments.map(({ key }) => key).sort(), [
    'users.json',
    'users/account-1/expenses.json'
  ]);
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
