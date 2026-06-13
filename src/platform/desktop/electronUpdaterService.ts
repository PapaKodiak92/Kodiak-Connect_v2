import type { DesktopUpdateInfo, DesktopUpdateProgress } from './desktopUpdaterService';

interface KodiakElectronUpdaterBridge {
  check: () => Promise<DesktopUpdateInfo | null>;
  install: () => Promise<void>;
}

interface KodiakElectronBridge {
  runtime?: string;
  updater?: KodiakElectronUpdaterBridge;
}

function getElectronUpdater() {
  const bridge = (window as Window & { kodiakElectron?: KodiakElectronBridge }).kodiakElectron;
  return bridge?.updater ?? null;
}

export async function checkForElectronUpdate(): Promise<DesktopUpdateInfo | null> {
  const updater = getElectronUpdater();

  if (!updater) {
    return null;
  }

  return updater.check();
}

export async function installElectronUpdate(
  onProgress?: (progress: DesktopUpdateProgress) => void,
): Promise<void> {
  const updater = getElectronUpdater();

  if (!updater) {
    throw new Error('Electron updater bridge is not available.');
  }

  onProgress?.({
    event: 'Started',
    downloadedBytes: 0,
  });

  await updater.install();

  onProgress?.({
    event: 'Finished',
    downloadedBytes: 0,
  });
}
