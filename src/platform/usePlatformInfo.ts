import { detectPlatformInfo } from './detectPlatformInfo';
export type { KodiakDesktopOs, KodiakPlatformInfo, KodiakPlatformKind, KodiakRuntime } from './platformTypes';

export function usePlatformInfo() {
  return detectPlatformInfo();
}
