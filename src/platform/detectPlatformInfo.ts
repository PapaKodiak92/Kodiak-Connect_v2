import type { KodiakDesktopOs, KodiakPlatformInfo } from './platformTypes';

type KodiakWindowRuntime = typeof window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  Capacitor?: {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
  };
};

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

function hasTauriRuntime(runtimeWindow: KodiakWindowRuntime) {
  return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI_IPC__ || runtimeWindow.__TAURI__);
}

function hasAndroidRuntime(runtimeWindow: KodiakWindowRuntime, normalizedUserAgent: string) {
  const capacitorPlatform = runtimeWindow.Capacitor?.getPlatform?.();

  return capacitorPlatform === 'android' || normalizedUserAgent.includes('android');
}

export function detectPlatformInfo(): KodiakPlatformInfo {
  const runtimeWindow = window as KodiakWindowRuntime;
  const userAgent = navigator.userAgent;
  const normalizedUserAgent = userAgent.toLowerCase();

  if (hasTauriRuntime(runtimeWindow)) {
    return {
      kind: 'desktop',
      runtime: 'tauri-desktop',
      isNativeShell: true,
      desktopOs: detectDesktopOs(userAgent),
    };
  }

  if (hasAndroidRuntime(runtimeWindow, normalizedUserAgent)) {
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
