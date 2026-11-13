const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { createStoreItIconBuffer } = require('./icon.cjs');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  utilityProcess,
} = require('electron');
const {
  DEFAULTS,
  apiHealthUrl,
  databaseDirectoryFor,
  publicSettings,
  readSettingsFile,
  serializeSettings,
  settingsFileFor,
  validateSettings,
} = require('./settings.cjs');

const appName = 'StoreIt';
const userDataDirectory = path.join(app.getPath('appData'), 'StoreIt Launcher');
app.setPath('userData', userDataDirectory);
const settingsPath = settingsFileFor(userDataDirectory);
const databaseDirectory = databaseDirectoryFor(userDataDirectory);
const runtimeDirectory = app.isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : path.resolve(__dirname, '../runtime');

let mainWindow;
let tray;
let postgres;
let backendProcess;
let currentConfig;
let currentError = null;
let isQuitting = false;
let apiExited = true;
let apiExitPromise;

function createIcon() {
  return nativeImage.createFromBuffer(createStoreItIconBuffer());
}

function stateSnapshot() {
  return {
    appName,
    appKind: 'storeit',
    iconDataUrl: createIcon().toDataURL(),
    running: Boolean(backendProcess),
    databaseRunning: Boolean(postgres),
    error: currentError,
    settings: publicSettings(currentConfig ?? { ...DEFAULTS }),
    apiUrl: currentConfig ? apiHealthUrl(currentConfig) : apiHealthUrl(DEFAULTS),
    settingsPath,
  };
}

function publishState() {
  const state = stateSnapshot();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:state', state);
  }
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const state = stateSnapshot();
  tray.setToolTip(`${appName} — ${state.running ? 'Running' : 'Stopped'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open API status', enabled: state.running, click: () => openApp() },
    {
      label: state.running || state.databaseRunning ? 'Stop services' : 'Start services',
      click: () => (state.running || state.databaseRunning ? stopServices() : startServices(currentConfig)),
    },
    { type: 'separator' },
    { label: 'Settings', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => quitApplication() },
  ]));
}

function createTray() {
  const icon = createIcon();
  if (icon.isEmpty()) throw new Error(`Could not load the ${appName} tray icon.`);
  tray = new Tray(icon);
  tray.on('click', () => showWindow());
  tray.on('double-click', () => openApp());
  updateTrayMenu();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640,
    height: 800,
    minWidth: 580,
    minHeight: 580,
    title: 'StoreIt Service Launcher',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f9f6f0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('launcher:state', stateSnapshot());
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function loadConfig() {
  await mkdir(userDataDirectory, { recursive: true });
  currentConfig = readSettingsFile(settingsPath);
  await writeSettings(currentConfig);
  return currentConfig;
}

async function writeSettings(config) {
  await mkdir(userDataDirectory, { recursive: true });
  await writeFile(settingsPath, serializeSettings(config), { encoding: 'utf8', mode: 0o600 });
}

function backendEnvironment(config) {
  const inherited = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (process.env[key]) inherited[key] = process.env[key];
  }
  return {
    ...inherited,
    NODE_ENV: 'production',
    API_HOST: DEFAULTS.apiHost,
    PORT: String(config.apiPort),
    CLIENT_ORIGINS: 'http://localhost:2400,http://localhost:2401,http://localhost:2402,http://127.0.0.1:2400,http://127.0.0.1:2401,http://127.0.0.1:2402',
    DB_HOST: DEFAULTS.databaseHost,
    DB_PORT: String(config.databasePort),
    DB_NAME: DEFAULTS.databaseName,
    DB_USER: DEFAULTS.databaseUser,
    DB_PASSWORD: config.databasePassword,
    DB_LOGGING: 'false',
    CLOCKIT_PUBLIC_URL: config.clockItPublicUrl,
    MANAGEIT_PUBLIC_URL: config.manageItPublicUrl,
    SPLATIT_PUBLIC_URL: config.splatItPublicUrl,
    JWT_SECRET: config.jwtSecret,
    JWT_EXPIRES_IN: '1d',
    BCRYPT_SALT_ROUNDS: '10',
  };
}

function runBackendScript(scriptName, config) {
  const entryPoint = path.join(runtimeDirectory, 'dist', scriptName);
  return new Promise((resolve, reject) => {
    let diagnostics = '';
    const worker = utilityProcess.fork(entryPoint, [], {
      serviceName: `StoreIt ${path.basename(scriptName)}`,
      cwd: userDataDirectory,
      env: backendEnvironment(config),
      stdio: 'pipe',
    });
    worker.stdout?.on('data', (chunk) => console.log(`[StoreIt] ${chunk.toString().trimEnd()}`));
    worker.stderr?.on('data', (chunk) => {
      diagnostics = `${diagnostics}${chunk.toString()}`.slice(-8000);
      console.error(`[StoreIt] ${chunk.toString().trimEnd()}`);
    });
    worker.once('exit', (code) => {
      if (code === 0) resolve();
      else {
        const detail = diagnostics.trim();
        reject(new Error(
          `${path.basename(scriptName)} exited with code ${code}.${detail ? ` ${detail}` : ''}`,
        ));
      }
    });
  });
}

function launchApi(config) {
  const entryPoint = path.join(runtimeDirectory, 'dist', 'server.js');
  let diagnostics = '';
  backendProcess = utilityProcess.fork(entryPoint, [], {
    serviceName: 'StoreIt API',
    cwd: userDataDirectory,
    env: backendEnvironment(config),
    stdio: 'pipe',
  });
  apiExited = false;
  apiExitPromise = new Promise((resolve) => {
    backendProcess.once('exit', (code) => {
      apiExited = true;
      backendProcess = undefined;
      if (!isQuitting && !currentError) {
        currentError = code === 0 ? 'StoreIt API stopped unexpectedly.' : `StoreIt API exited with code ${code}.`;
      }
      publishState();
      resolve();
    });
  });
  backendProcess.stdout?.on('data', (chunk) => console.log(`[StoreIt API] ${chunk.toString().trimEnd()}`));
  backendProcess.stderr?.on('data', (chunk) => {
    diagnostics = `${diagnostics}${chunk.toString()}`.slice(-8000);
    console.error(`[StoreIt API] ${chunk.toString().trimEnd()}`);
  });
  backendProcess.once('exit', () => {
    if (diagnostics.trim()) currentError = diagnostics.trim();
  });
}

async function waitForApi(config) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (apiExited) {
      throw new Error('StoreIt API stopped before becoming ready. Check the launcher log.');
    }
    try {
      const response = await fetch(apiHealthUrl(config), { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = new Error(`API health check returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const diagnostics = currentError ? ` ${currentError}` : '';
  throw new Error(`StoreIt API did not become ready: ${lastError?.message ?? 'startup timed out'}.${diagnostics}`);
}

async function createDatabase(config) {
  const embeddedPostgresModule = require('embedded-postgres');
  const EmbeddedPostgres = embeddedPostgresModule.default ?? embeddedPostgresModule;
  const database = new EmbeddedPostgres({
    databaseDir: databaseDirectory,
    user: DEFAULTS.databaseUser,
    password: config.databasePassword,
    port: config.databasePort,
    persistent: true,
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: (message) => console.log(`[StoreIt PostgreSQL] ${message.trimEnd()}`),
    onError: (error) => console.error(`[StoreIt PostgreSQL] ${error instanceof Error ? error.message : error}`),
  });
  postgres = database;

  let initialized = true;
  try {
    await readFile(path.join(databaseDirectory, 'PG_VERSION'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    initialized = false;
    await database.initialise();
  }
  await database.start();
  if (!initialized) await database.createDatabase(DEFAULTS.databaseName);
}

async function startServices(input = currentConfig) {
  const settings = validateSettings(input ?? DEFAULTS);
  const config = {
    ...readSettingsFile(settingsPath),
    ...settings,
  };
  if (backendProcess || postgres) await stopServices();

  currentError = null;
  await writeSettings(config);
  currentConfig = config;

  try {
    await createDatabase(config);
    await runBackendScript('scripts/migrateSchema.js', config);
    launchApi(config);
    await waitForApi(config);
    publishState();
    return stateSnapshot();
  } catch (error) {
    try {
      await stopServices();
    } catch (stopError) {
      console.error(`StoreIt cleanup failed: ${stopError.message}`);
    }
    throw new Error(`Could not start StoreIt: ${error.message}`);
  }
}

async function stopApi() {
  if (!backendProcess) return;
  const child = backendProcess;
  backendProcess = undefined;
  if (!apiExited) {
    child.kill();
    await Promise.race([
      apiExitPromise,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
}

async function stopServices() {
  await stopApi();
  if (postgres) {
    const database = postgres;
    postgres = undefined;
    await database.stop();
  }
  if (!isQuitting) currentError = null;
  publishState();
  return stateSnapshot();
}

async function openApp() {
  if (!backendProcess || !currentConfig) {
    return { ok: false, error: 'StoreIt API is not running.' };
  }
  try {
    await shell.openExternal(apiHealthUrl(currentConfig));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Could not open the API status page: ${error.message}` };
  }
}

async function quitApplication() {
  isQuitting = true;
  try {
    await stopServices();
  } catch (error) {
    console.error(`Could not stop StoreIt cleanly: ${error.message}`);
  }
  if (tray) tray.destroy();
  app.quit();
}

ipcMain.handle('launcher:get-initial-state', async () => {
  try {
    await loadConfig();
  } catch (error) {
    currentError = error.message;
  }
  return stateSnapshot();
});

ipcMain.handle('launcher:start', async (_event, input) => {
  try {
    const state = await startServices(input);
    return { ok: true, state };
  } catch (error) {
    currentError = error.message;
    publishState();
    return { ok: false, error: currentError, state: stateSnapshot() };
  }
});

ipcMain.handle('launcher:stop', async () => {
  try {
    return { ok: true, state: await stopServices() };
  } catch (error) {
    currentError = error.message;
    publishState();
    return { ok: false, error: currentError, state: stateSnapshot() };
  }
});

ipcMain.handle('launcher:open-app', openApp);
ipcMain.on('launcher:hide', () => mainWindow?.hide());

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(async () => {
    createWindow();
    createTray();
    showWindow();
    try {
      await loadConfig();
      await startServices(currentConfig);
    } catch (error) {
      currentError = error.message;
      publishState();
    }
  }).catch((error) => {
    console.error(`Failed to initialize StoreIt launcher: ${error.message}`);
    app.quit();
  });
}

app.on('before-quit', (event) => {
  if (!isQuitting && (backendProcess || postgres)) {
    event.preventDefault();
    void quitApplication();
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
