const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { createStoreItIconBuffer } = require('../src/icon.cjs');

const iconDirectory = path.resolve(__dirname, '../assets');

mkdir(iconDirectory, { recursive: true })
  .then(() => writeFile(path.join(iconDirectory, 'storeit.png'), createStoreItIconBuffer(256)))
  .catch((error) => {
    console.error(`Could not generate StoreIt application icon: ${error.message}`);
    process.exitCode = 1;
  });
