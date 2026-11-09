const { spawnSync } = require('node:child_process');
const { cp, mkdir, rm } = require('node:fs/promises');
const path = require('node:path');

const launcherRoot = path.resolve(__dirname, '..');
const backendRoot = path.resolve(launcherRoot, '../backend');
const runtimeRoot = path.join(launcherRoot, 'runtime');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`);
  }
}

function runNpm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    run(process.execPath, [npmCli, ...args], cwd);
    return;
  }

  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw new Error(`Could not run npm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm exited with status ${result.status ?? 'unknown'}.`);
  }
}

async function buildBackend() {
  runNpm(['run', 'build'], backendRoot);
  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(runtimeRoot, { recursive: true });
  await Promise.all([
    cp(path.join(backendRoot, 'package.json'), path.join(runtimeRoot, 'package.json')),
    cp(path.join(backendRoot, 'package-lock.json'), path.join(runtimeRoot, 'package-lock.json')),
    cp(path.join(backendRoot, 'dist'), path.join(runtimeRoot, 'dist'), { recursive: true }),
  ]);
  runNpm(['ci', '--omit=dev', '--ignore-scripts'], runtimeRoot);
}

buildBackend().catch((error) => {
  console.error(`StoreIt backend packaging failed: ${error.message}`);
  process.exitCode = 1;
});
