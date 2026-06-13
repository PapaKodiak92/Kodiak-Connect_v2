import type { KodiakDesktopOs, KodiakPlatformInfo } from './platformTypes';

function detectDesktopOs(userAgent: string): KodiakDesktopOs {
  const normalizedUserAgent = userAgent.toLowerCase();

  if (normalizedUserAgent.includes('windows')) {
    return 'windows';
  }

  if (normalizedUserAgent.includes('linux') || normalizedUserAgent.includes('x11') || normalizedUserAgent.includes('wayland')) {
    return 'linux';
  }

  if (normalizedUserAgent.includes('mac os') || normalizedUserAgent.includes('macintosh')) {
    return 'macos';
  }

  return 'unknown';
}

export function detectPlatformInfo(): KodiakPlatformInfo {
  const userAgent = navigator.userAgent;
  const normalizedUserAgent = userAgent.toLowerCase();
  const isAndroid = normalizedUserAgent.includes('android');
  const isTauri = '__TAURI_INTERNALS__' in window;

  if (isTauri) {
    return {
      kind: 'desktop',
      runtime: 'tauri-desktop',
      isNativeShell: true,
      desktopOs: detectDesktopOs(userAgent),
    };
  }

  if (isAndroid) {
    return {
      kind: 'android',
      runtime: 'capacitor-android',
      isNativeShell: true,
    };
  }

  return {
    kind: 'web',
    runtime: 'browser',
    isNativeShell: false,
  };
}
