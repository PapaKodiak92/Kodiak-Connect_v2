const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('lupercusElectron', {
  runtime: 'electron-desktop',
});
