const fs = require('node:fs');
const path = require('node:path');
const { SupabaseDocumentStorage } = require('../storage');

async function importJsonFiles(dataDir, storage) {
  const files = [];
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(entryPath);
    }
  }
  collect(dataDir);

  for (const filePath of files) {
    const key = path.relative(dataDir, filePath).split(path.sep).join('/');
    const content = fs.readFileSync(filePath, 'utf8');
    let data;
    try {
      data = JSON.parse(content);
    } catch (error) {
      throw new Error(`Cannot import invalid JSON file: ${key}`, { cause: error });
    }
    await storage.write(key, data);
    console.info(`Imported ${key}`);
  }
  return files.length;
}

async function main() {
  const dataDir = path.resolve(process.env.SPENDWISE_DATA_DIR || path.join(__dirname, '..', 'data'));
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing.');
  }
  const storage = new SupabaseDocumentStorage({
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  });
  const count = await importJsonFiles(dataDir, storage);
  console.info(`Imported ${count} JSON document(s) from ${dataDir}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Supabase JSON import failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { importJsonFiles };
