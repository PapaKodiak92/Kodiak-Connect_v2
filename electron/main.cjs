const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

let mainWindow = null;
let tray = null;
let isQuitting = false;

function isLinux() {
  return process.platform === 'linux';
}

function shouldStartHiddenOnLaunch() {
  return isLinux() && !process.argv.includes('--show-window');
}

function getIconPath() {
  return path.join(__dirname, 'icon.png');
}

function getTrayImage() {
  const image = nativeImage.createFromPath(getIconPath());

  if (image.isEmpty()) {
    return getIconPath();
  }

  return image.resize({
    width: 22,
    height: 22,
  });
}

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

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  const isVisible = Boolean(mainWindow?.isVisible());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Kodiak Connect',
      enabled: !isVisible,
      click: () => showMainWindow(),
    },
    {
      label: 'Hide to tray',
      enabled: isVisible,
      click: () => hideMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit Kodiak Connect',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Kodiak Connect');
  tray.setContextMenu(contextMenu);
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow(false);
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  refreshTrayMenu();
}

function hideMainWindow() {
  if (!mainWindow) {
    return;
  }

  mainWindow.hide();
  refreshTrayMenu();
}

function createTray() {
  if (tray || !isLinux()) {
    return;
  }

  tray = new Tray(getTrayImage());

  tray.on('click', () => {
    if (!mainWindow || !mainWindow.isVisible()) {
      showMainWindow();
      return;
    }

    hideMainWindow();
  });

  refreshTrayMenu();
}

function createMainWindow(startHidden = shouldStartHiddenOnLaunch()) {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#080b10',
    title: 'Kodiak Connect',
    icon: getIconPath(),
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

  mainWindow.on('minimize', (event) => {
    if (!isLinux()) {
      return;
    }

    event.preventDefault();
    hideMainWindow();
  });

  mainWindow.on('close', (event) => {
    if (!isLinux() || isQuitting) {
      return;
    }

    event.preventDefault();
    hideMainWindow();
  });

  mainWindow.on('show', refreshTrayMenu);
  mainWindow.on('hide', refreshTrayMenu);
  mainWindow.on('closed', () => {
    mainWindow = null;
    refreshTrayMenu();
  });

  mainWindow.once('ready-to-show', () => {
    if (startHidden) {
      hideMainWindow();
      return;
    }

    showMainWindow();
  });

  void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  return mainWindow;
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

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media' || permission === 'camera' || permission === 'microphone');
    });

    createTray();
    createMainWindow();

    app.on('activate', () => {
      showMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isLinux() && process.platform !== 'darwin') {
      app.quit();
    }
  });
}
