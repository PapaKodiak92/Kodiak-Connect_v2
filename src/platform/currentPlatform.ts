import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  type DesktopUpdateInfo,
  type DesktopUpdateProgress,
} from './desktop/desktopUpdaterService';
import { detectPlatformInfo } from './detectPlatformInfo';
import type { KodiakPlatformInfo } from './platformTypes';

interface KodiakUpdaterAdapter {
  check: () => Promise<DesktopUpdateInfo | null>;
  install: (onProgress?: (progress: DesktopUpdateProgress) => void) => Promise<void>;
}

export interface KodiakPlatformAdapter {
  info: KodiakPlatformInfo;
  openExternalUrl: (url: string) => Promise<void>;
  updater: KodiakUpdaterAdapter;
}

async function openExternalUrl(url: string, platformInfo: KodiakPlatformInfo) {
  if (platformInfo.runtime === 'tauri-desktop') {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch (error) {
      console.error('[Kodiak Connect] Native openUrl failed. Falling back to browser open.', error);
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

async function unsupportedUpdaterCheck(): Promise<DesktopUpdateInfo | null> {
  return null;
}

async function unsupportedUpdaterInstall(): Promise<void> {
  throw new Error('Updater is not supported on this platform adapter.');
}

function createUpdaterAdapter(platformInfo: KodiakPlatformInfo): KodiakUpdaterAdapter {
  if (platformInfo.runtime === 'tauri-desktop') {
    return {
      check: checkForDesktopUpdate,
      install: installDesktopUpdate,
    };
  }

  return {
    check: unsupportedUpdaterCheck,
    install: unsupportedUpdaterInstall,
  };
}

export function createKodiakPlatformAdapter(platformInfo = detectPlatformInfo()): KodiakPlatformAdapter {
  return {
    info: platformInfo,
    openExternalUrl: (url) => openExternalUrl(url, platformInfo),
    updater: createUpdaterAdapter(platformInfo),
  };
}

export const kodiakPlatform = createKodiakPlatformAdapter();
