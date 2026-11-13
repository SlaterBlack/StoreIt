const elements = {
  form: document.getElementById('settings-form'),
  appIcon: document.getElementById('brand-icon'),
  statusBadge: document.getElementById('status-badge'),
  databaseStatus: document.getElementById('database-status'),
  databasePort: document.getElementById('database-port'),
  apiPort: document.getElementById('api-port'),
  clockItPublicUrl: document.getElementById('clockit-public-url'),
  manageItPublicUrl: document.getElementById('manageit-public-url'),
  splatItPublicUrl: document.getElementById('splatit-public-url'),
  apiUrl: document.getElementById('api-url'),
  error: document.getElementById('error-message'),
  startButton: document.getElementById('start-button'),
  stopButton: document.getElementById('stop-button'),
  openButton: document.getElementById('open-button'),
};

function showError(message) {
  elements.error.textContent = message ?? '';
  elements.error.hidden = !message;
}

function renderState(state) {
  document.documentElement.dataset.brand = 'storeit';
  elements.appIcon.src = state.iconDataUrl;
  elements.statusBadge.textContent = state.running ? 'API running' : 'API stopped';
  elements.statusBadge.classList.toggle('is-running', state.running);
  elements.databaseStatus.textContent = state.databaseRunning ? 'Running' : 'Stopped';
  elements.databaseStatus.classList.toggle('is-running', state.databaseRunning);
  elements.startButton.textContent = state.running ? 'Save & Restart' : 'Save & Start';
  elements.stopButton.disabled = !state.running && !state.databaseRunning;
  elements.openButton.disabled = !state.running;

  if (state.settings) {
    elements.databasePort.value = state.settings.databasePort;
    elements.apiPort.value = state.settings.apiPort;
    elements.clockItPublicUrl.value = state.settings.clockItPublicUrl;
    elements.manageItPublicUrl.value = state.settings.manageItPublicUrl;
    elements.splatItPublicUrl.value = state.settings.splatItPublicUrl;
  }
  elements.apiUrl.textContent = `API health: ${state.apiUrl}`;
  elements.apiUrl.hidden = !state.running;
  showError(state.error);
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(null);
  elements.startButton.disabled = true;
  elements.startButton.textContent = 'Starting services…';

  const result = await window.launcher.start({
    apiPort: elements.apiPort.value,
    databasePort: elements.databasePort.value,
    clockItPublicUrl: elements.clockItPublicUrl.value,
    manageItPublicUrl: elements.manageItPublicUrl.value,
    splatItPublicUrl: elements.splatItPublicUrl.value,
  });
  elements.startButton.disabled = false;
  if (!result.ok) showError(result.error);
  if (result.state) renderState(result.state);
});

elements.stopButton.addEventListener('click', async () => {
  showError(null);
  const result = await window.launcher.stop();
  if (!result.ok) showError(result.error);
  if (result.state) renderState(result.state);
});

elements.openButton.addEventListener('click', async () => {
  const result = await window.launcher.openApp();
  if (!result.ok) showError(result.error);
});

window.launcher.onStateChange(renderState);
window.launcher.getInitialState().then(renderState).catch((error) => {
  showError(`Could not load launcher settings: ${error.message}`);
});
