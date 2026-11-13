const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULTS,
  apiHealthUrl,
  databaseDirectoryFor,
  publicSettings,
  readSettingsFile,
  serializeSettings,
  settingsFileFor,
  validateSettings,
} = require('../src/settings.cjs');

test('uses StoreIt service defaults and user-data paths', () => {
  assert.deepEqual(validateSettings(DEFAULTS), {
    apiPort: 4002,
    databasePort: 5432,
    clockItPublicUrl: 'https://clockit.ai3d.com.au:2400/',
    manageItPublicUrl: 'https://manageit.ai3d.com.au/',
    splatItPublicUrl: 'https://splatit.ai3d.com.au/',
  });
  assert.equal(apiHealthUrl({ apiPort: 4002 }), 'http://127.0.0.1:4002/api/health');
  assert.equal(settingsFileFor('/data/storeit'), path.join('/data/storeit', '.env'));
  assert.equal(databaseDirectoryFor('/data/storeit'), path.join('/data/storeit', 'postgres-data'));
});

test('rejects invalid or conflicting service ports', () => {
  assert.throws(() => validateSettings({ apiPort: 0, databasePort: 5432 }), /API port/);
  assert.throws(() => validateSettings({ apiPort: 4002, databasePort: 65536 }), /PostgreSQL port/);
  assert.throws(() => validateSettings({ apiPort: 5432, databasePort: 5432 }), /must be different/);
  assert.throws(
    () => validateSettings({ ...DEFAULTS, clockItPublicUrl: 'javascript:alert(1)' }),
    /ClockIt public URL/,
  );
  assert.throws(
    () => validateSettings({ ...DEFAULTS, manageItPublicUrl: 'https://user:pass@example.com' }),
    /ManageIt public URL/,
  );
});

test('generates persistent private secrets and exposes ports only', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'storeit-launcher-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = settingsFileFor(directory);

  const first = readSettingsFile(envPath);
  assert.equal(first.apiPort, 4002);
  assert.equal(first.databasePort, 5432);
  assert.ok(first.databasePassword.length >= 40);
  assert.ok(first.jwtSecret.length >= 60);
  assert.deepEqual(publicSettings(first), {
    apiPort: 4002,
    databasePort: 5432,
    clockItPublicUrl: 'https://clockit.ai3d.com.au:2400/',
    manageItPublicUrl: 'https://manageit.ai3d.com.au/',
    splatItPublicUrl: 'https://splatit.ai3d.com.au/',
  });

  await writeFile(envPath, serializeSettings(first));
  const second = readSettingsFile(envPath);
  assert.equal(second.databasePassword, first.databasePassword);
  assert.equal(second.jwtSecret, first.jwtSecret);

  const content = await readFile(envPath, 'utf8');
  assert.match(content, /PORT=4002/);
  assert.match(content, /DB_PORT=5432/);
  assert.match(content, /CLOCKIT_PUBLIC_URL="https:\/\/clockit\.ai3d\.com\.au:2400\/"/);
  assert.match(content, /MANAGEIT_PUBLIC_URL="https:\/\/manageit\.ai3d\.com\.au\/"/);
  assert.match(content, /SPLATIT_PUBLIC_URL="https:\/\/splatit\.ai3d\.com\.au\/"/);
  assert.doesNotMatch(content, /SMTP_(?:USER|PASSWORD)|ADMIN_(?:EMAIL|PASSWORD)/);
});

test('preserves public URLs from existing launcher settings', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'storeit-launcher-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = settingsFileFor(directory);
  await writeFile(
    envPath,
    [
      'PORT=4002',
      'DB_PORT=5432',
      'CLOCKIT_PUBLIC_URL=http://localhost:2400/',
      'MANAGEIT_PUBLIC_URL=https://manage.example.test/',
      'SPLATIT_PUBLIC_URL=https://splat.example.test/',
    ].join('\n'),
  );

  const settings = readSettingsFile(envPath);
  assert.equal(settings.clockItPublicUrl, 'http://localhost:2400/');
  assert.equal(settings.manageItPublicUrl, 'https://manage.example.test/');
  assert.equal(settings.splatItPublicUrl, 'https://splat.example.test/');
});
