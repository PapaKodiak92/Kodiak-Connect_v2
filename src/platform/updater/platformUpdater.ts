import { kodiakPlatform } from '../currentPlatform';
import type {
  DesktopUpdateInfo,
  DesktopUpdateProgress,
  DesktopUpdaterStatus,
} from '../desktop/desktopUpdaterService';

export type { DesktopUpdateInfo, DesktopUpdateProgress, DesktopUpdaterStatus };

export function checkKodiakPlatformUpdate(): Promise<DesktopUpdateInfo | null> {
  return kodiakPlatform.updater.check();
}

export function installKodiakPlatformUpdate(onProgress?: (progress: DesktopUpdateProgress) => void): Promise<void> {
  return kodiakPlatform.updater.install(onProgress);
}