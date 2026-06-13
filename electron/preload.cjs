const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('kodiakElectron', {
  runtime: 'electron-desktop',
});