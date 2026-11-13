const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./server');
const { SupabaseRelationalStorage } = require('./supabase');

const userId = 'c59090e8-55f7-453d-9332-b4ad1f3a7619';
const session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  user: { id: userId, email: 'user@example.test' }
};

class MockQuery {
  constructor(table, tokens) {
    this.table = table;
    this.tokens = tokens;
  }
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  maybeSingle() {
    return Promise.resolve({
      data: this.table === 'profiles'
        ? { full_name: 'SpendWise User', monthly_budget: '1000.00', currency: 'USD' }
        : null,
      error: null
    });
  }
  then(resolve, reject) {
    this.tokens.push({ table: this.table });
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  }
}

function makeClientFactory(requests, realtime = {}, mfaEnabled = true) {
  return (_config, accessToken) => {
    if (accessToken) requests.push({ accessToken });
    let activeSession = session;
    return {
      realtime: {
        setAuth(token) {
          realtime.authToken = token;
        }
      },
      channel(name) {
        realtime.channelName = name;
        return {
          on(_type, _filter, callback) {
            realtime.handlers ||= [];
            realtime.handlers.push(callback);
            return this;
          },
          subscribe(callback) {
            callback('SUBSCRIBED');
            return this;
          }
        };
      },
      removeChannel: async () => {
        realtime.closed = true;
      },
      auth: {
        signInWithOAuth: async (options) => {
          realtime.oauthOptions ||= [];
          realtime.oauthOptions.push(options);
          return {
            data: { url: `https://project.supabase.co/auth/v1/authorize?provider=${options.provider}` },
            error: null
          };
        },
        signInWithPassword: async () => ({ data: { user: session.user, session }, error: null }),
        setSession: async (tokens) => {
          activeSession = { ...session, ...tokens };
          return { data: { session: activeSession }, error: null };
        },
        getSession: async () => ({ data: { session: activeSession }, error: null }),
        getUser: async () => ({ data: { user: session.user }, error: null }),
        signOut: async () => ({ error: null }),
        mfa: {
          listFactors: async () => ({
            data: {
              all: mfaEnabled ? [{ id: 'totp-factor', status: 'verified' }] : [],
              totp: mfaEnabled ? [{ id: 'totp-factor', status: 'verified' }] : []
            },
            error: null
          }),
          getAuthenticatorAssuranceLevel: async () => ({
            data: { currentLevel: 'aal2', nextLevel: 'aal2' },
            error: null
          })
        }
      },
      from(table) {
        return new MockQuery(table, requests);
      }
    };
  };
}

test('Supabase login stores HttpOnly credentials and scopes protected data requests by user JWT', async (t) => {
  const requests = [];
  const clientFactory = makeClientFactory(requests);
  const storage = new SupabaseRelationalStorage({
    config: { url: 'https://project.supabase.co', anonKey: 'anon' },
    clientFactory
  });
  const server = createApp({
    storage,
    supabaseClientFactory: clientFactory,
    appUrl: 'http://localhost:3000'
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.test', password: 'a secure password' })
  });
  assert.equal(loginResponse.status, 200);
  assert.deepEqual(await loginResponse.json(), {
    mfaRequired: true,
    setupRequired: false
  });
  const cookies = loginResponse.headers.get('set-cookie');
  assert.match(cookies, /spendwise_session=test-access-token/);
  assert.match(cookies, /spendwise_refresh=test-refresh-token/);
  assert.match(cookies, /HttpOnly/i);

  const cookie = 'spendwise_session=test-access-token; spendwise_refresh=test-refresh-token';
  const accountResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(accountResponse.status, 200);
  assert.deepEqual(await accountResponse.json(), {
    user: session.user,
    avatarEnabled: true,
    realtimeEnabled: true
  });

  const expensesResponse = await fetch(`${baseUrl}/api/expenses`, { headers: { Cookie: cookie } });
  assert.equal(expensesResponse.status, 200);
  assert.deepEqual(await expensesResponse.json(), []);
  assert.ok(requests.some((entry) => entry.accessToken === session.access_token));
});

test('Supabase login allows accounts without an enrolled MFA factor to continue', async (t) => {
  const requests = [];
  const clientFactory = makeClientFactory(requests, {}, false);
  const storage = new SupabaseRelationalStorage({
    config: { url: 'https://project.supabase.co', anonKey: 'anon' },
    clientFactory
  });
  const server = createApp({
    storage,
    supabaseClientFactory: clientFactory,
    appUrl: 'http://localhost:3000'
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const loginResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.test', password: 'a secure password' })
  });
  assert.equal(loginResponse.status, 200);
  assert.deepEqual(await loginResponse.json(), { mfaOptional: true });
  assert.match(loginResponse.headers.get('set-cookie'), /spendwise_session=test-access-token/);
});

test('OAuth sign-in returns configured Supabase authorization URLs for Google and Microsoft', async (t) => {
  const requests = [];
  const oauth = {};
  const clientFactory = makeClientFactory(requests, oauth);
  const storage = new SupabaseRelationalStorage({
    config: { url: 'https://project.supabase.co', anonKey: 'anon' },
    clientFactory
  });
  const server = createApp({
    storage,
    supabaseClientFactory: clientFactory,
    appUrl: 'http://localhost:3000'
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [provider, expectedProvider] of [['google', 'google'], ['microsoft', 'azure']]) {
    const response = await fetch(`${baseUrl}/api/auth/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).url, `https://project.supabase.co/auth/v1/authorize?provider=${expectedProvider}`);
  }
  assert.deepEqual(oauth.oauthOptions, [
    {
      provider: 'google',
      options: { redirectTo: 'http://localhost:3000/', skipBrowserRedirect: true }
    },
    {
      provider: 'azure',
      options: { redirectTo: 'http://localhost:3000/', skipBrowserRedirect: true, scopes: 'email' }
    }
  ]);

  const invalidResponse = await fetch(`${baseUrl}/api/auth/oauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'unknown' })
  });
  assert.equal(invalidResponse.status, 400);
});

test('Supabase Realtime streams user changes and closes its subscription on disconnect', async (t) => {
  const requests = [];
  const realtime = {};
  const clientFactory = makeClientFactory(requests, realtime);
  const storage = new SupabaseRelationalStorage({
    config: { url: 'https://project.supabase.co', anonKey: 'anon' },
    clientFactory
  });
  const server = createApp({
    storage,
    supabaseClientFactory: clientFactory,
    appUrl: 'http://localhost:3000'
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/realtime`, {
    headers: { Cookie: 'spendwise_session=test-access-token; spendwise_refresh=test-refresh-token' },
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /connected/);
  const updateRead = reader.read();
  realtime.handlers[0]();
  assert.match(decoder.decode((await updateRead).value), /"table":"expenses"/);
  assert.equal(realtime.authToken, session.access_token);
  assert.equal(realtime.channelName, `spendwise-${userId}`);

  controller.abort();
  for (let attempt = 0; attempt < 20 && !realtime.closed; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(realtime.closed, true);
});
