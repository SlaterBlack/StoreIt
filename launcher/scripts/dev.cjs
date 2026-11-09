const { spawnSync } = require('node:child_process');
const path = require('node:path');

const electronPath = require('electron');
const result = spawnSync(electronPath, ['.'], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not start the Electron launcher: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
