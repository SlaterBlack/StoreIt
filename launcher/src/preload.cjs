const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getInitialState: () => ipcRenderer.invoke('launcher:get-initial-state'),
  start: (settings) => ipcRenderer.invoke('launcher:start', settings),
  stop: () => ipcRenderer.invoke('launcher:stop'),
  openApp: () => ipcRenderer.invoke('launcher:open-app'),
  hideWindow: () => ipcRenderer.send('launcher:hide'),
  onStateChange: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('launcher:state', handler);
    return () => ipcRenderer.removeListener('launcher:state', handler);
  },
});
