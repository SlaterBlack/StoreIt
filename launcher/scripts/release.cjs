const { spawnSync } = require('node:child_process');
const path = require('node:path');

const target = process.argv[2];
const targetBuilds = {
  windows: [{ label: 'Windows', args: ['--win', 'portable', '--x64'], postgresPackage: true }],
  linux: [{ label: 'Linux', args: ['--linux', 'AppImage', '--x64'] }],
  all: [
    { label: 'Linux', args: ['--linux', 'AppImage', '--x64'] },
    { label: 'Windows', args: ['--win', 'portable', '--x64'], postgresPackage: true },
  ],
}[target];

if (!targetBuilds) {
  console.error('Usage: node scripts/release.cjs <windows|linux|all>');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    run(process.execPath, [npmCli, ...args]);
    return;
  }

  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`Could not start npm: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, [path.join(__dirname, 'build-backend.cjs')]);
run(process.execPath, [path.join(__dirname, 'generate-icon.cjs')]);
for (const build of targetBuilds) {
  console.log(`\nPackaging StoreIt for ${build.label}...`);
  if (build.postgresPackage) {
    runNpm([
      'install',
      '--force',
      '--no-save',
      '--ignore-scripts',
      '@embedded-postgres/windows-x64@17.11.0-beta.19',
    ]);
    run(process.execPath, [
      path.join(root, 'node_modules/@embedded-postgres/windows-x64/scripts/hydrate-symlinks.js'),
    ]);
  }
  runNpm([
    'exec',
    '--',
    'electron-builder',
    '--config',
    'electron-builder.config.cjs',
    ...build.args,
  ]);
}
