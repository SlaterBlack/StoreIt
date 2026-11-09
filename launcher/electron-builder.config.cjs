const path = require('node:path');

const runtimeDirectory = path.resolve(__dirname, 'runtime');
const iconPath = path.resolve(__dirname, 'assets/storeit.png');

module.exports = {
  appId: 'com.ai3d.storeit.launcher',
  productName: 'StoreIt',
  executableName: 'storeit',
  extraMetadata: { launcherApp: 'storeit', desktopName: 'StoreIt' },
  directories: {
    output: 'release',
  },
  files: ['src/**/*', 'package.json'],
  extraResources: [
    {
      from: runtimeDirectory,
      to: 'backend',
    },
  ],
  linux: {
    target: ['AppImage'],
    category: 'Utility',
    icon: iconPath,
    syncDesktopName: true,
  },
  asar: true,
  asarUnpack: [
    'node_modules/@embedded-postgres/**',
    'node_modules/embedded-postgres/**',
  ],
  win: {
    target: ['portable'],
    icon: iconPath,
  },
};
