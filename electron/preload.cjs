const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kodiakElectron', {
  runtime: 'electron-desktop',
  updater: {
    check: () => ipcRenderer.invoke('kodiak-updater-check'),
    install: () => ipcRenderer.invoke('kodiak-updater-install'),
  },
});
