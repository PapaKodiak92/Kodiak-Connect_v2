const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function normalizeReleaseNotes(releaseNotes) {
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((note) => {
        if (typeof note === 'string') return note;
        if (note && typeof note === 'object') return note.note ?? note.version ?? '';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof releaseNotes === 'string') {
    return releaseNotes;
  }

  return undefined;
}

function toKodiakUpdateInfo(updateInfo) {
  if (!updateInfo || !updateInfo.version || updateInfo.version === app.getVersion()) {
    return null;
  }

  return {
    version: updateInfo.version,
    currentVersion: app.getVersion(),
    body: normalizeReleaseNotes(updateInfo.releaseNotes),
    date: updateInfo.releaseDate,
  };
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#080b10',
    title: 'Kodiak Connect',
    icon: path.join(__dirname, 'icon.png'),
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

  void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('kodiak-updater-check', async () => {
  if (!app.isPackaged || process.platform !== 'linux') {
    return null;
  }

  const result = await autoUpdater.checkForUpdates();
  return toKodiakUpdateInfo(result?.updateInfo);
});

ipcMain.handle('kodiak-updater-install', async () => {
  if (!app.isPackaged || process.platform !== 'linux') {
    throw new Error('Electron updater is only available in packaged Linux builds.');
  }

  await autoUpdater.downloadUpdate();
  autoUpdater.quitAndInstall(false, true);
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'camera' || permission === 'microphone');
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
