const { app, BrowserWindow, shell, session } = require('electron');
const path = require('node:path');

let mainWindow = null;

function getIconPath() {
  return path.join(__dirname, '..', 'electron-assets-lupercus', 'icon.png');
}

function createMainWindow() {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#050504',
    title: 'Lupercus Library Sync',
    icon: getIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadFile(path.join(__dirname, '..', 'dist-lupercus-sync', 'index.html'));

  return mainWindow;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      createMainWindow();
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media');
    });

    createMainWindow();

    app.on('activate', () => {
      if (!mainWindow) {
        createMainWindow();
        return;
      }

      mainWindow.show();
      mainWindow.focus();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
