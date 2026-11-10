const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class JsonFileStorage {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  async read(key, fallback) {
    const filePath = path.join(this.dataDir, ...key.split('/'));
    if (!fs.existsSync(filePath)) return fallback;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content) return fallback;
    try {
      const parsed = JSON.parse(content);
      if (parsed === null) return fallback;
      if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
      if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) &&
          (Array.isArray(parsed) || typeof parsed !== 'object')) return fallback;
      return parsed;
    } catch (error) {
      return fallback;
    }
  }

  async write(key, value) {
    const filePath = path.join(this.dataDir, ...key.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  }
}

class SupabaseDocumentStorage {
  constructor({ url, serviceRoleKey, fetchImplementation = fetch }) {
    this.url = new URL(url);
    this.serviceRoleKey = serviceRoleKey;
    this.fetch = fetchImplementation;
  }

  async request(options) {
    const url = new URL('/rest/v1/app_documents', this.url);
    url.searchParams.set('on_conflict', 'key');

    const response = await this.fetch(url, {
      ...options,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Supabase storage request failed (${response.status}): ${details}`);
    }
    return response;
  }

  async read(key, fallback) {
    const url = new URL('/rest/v1/app_documents', this.url);
    url.searchParams.set('key', `eq.${key}`);
    url.searchParams.set('select', 'data');
    const response = await this.fetch(url, {
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`
      }
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Supabase storage request failed (${response.status}): ${details}`);
    }
    const [document] = await response.json();
    if (!document || document.data === null) return fallback;
    const data = document.data;
    if (Array.isArray(fallback) && !Array.isArray(data)) return fallback;
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback) &&
        (Array.isArray(data) || typeof data !== 'object')) return fallback;
    return data;
  }

  async write(key, value) {
    await this.request({
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, data: value })
    });
  }
}

function createStorage(options = {}) {
  if (options.storage) return options.storage;
  const dataDir = options.dataDir || process.env.SPENDWISE_DATA_DIR || path.join(__dirname, 'data');
  const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const explicitlySupabase = options.storageMode === 'supabase' || process.env.SPENDWISE_STORAGE === 'supabase';

  if (explicitlySupabase && !hasSupabaseConfig) {
    throw new Error('Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (options.dataDir) {
    return new JsonFileStorage(dataDir);
  }
  if (options.storageMode === 'file' || process.env.SPENDWISE_STORAGE === 'file') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('File storage is disabled in production. Configure Supabase storage instead.');
    }
    return new JsonFileStorage(dataDir);
  }
  if (hasSupabaseConfig) {
    return new SupabaseDocumentStorage({
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    });
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Production requires Supabase storage. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return new JsonFileStorage(dataDir);
}

module.exports = { createStorage, JsonFileStorage, SupabaseDocumentStorage };
