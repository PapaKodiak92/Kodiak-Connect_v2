import { readKodiakBuildTarget } from './buildTarget';
import type { KodiakDesktopOs, KodiakPlatformInfo } from './platformTypes';

type KodiakWindowRuntime = typeof window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  kodiakElectron?: {
    runtime?: string;
  };
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

function desktopOsForBuildTarget(buildTarget: string, userAgent: string): KodiakDesktopOs {
  if (buildTarget === 'desktop-windows') {
    return 'windows';
  }

  if (buildTarget === 'desktop-linux') {
    return 'linux';
  }

  if (buildTarget === 'desktop-macos') {
    return 'macos';
  }

  return detectDesktopOs(userAgent);
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
  const buildTarget = readKodiakBuildTarget();

  if (buildTarget === 'web') {
    return {
      kind: 'web',
      runtime: 'browser',
      isNativeShell: false,
      buildTarget,
    };
  }

  if (buildTarget === 'android') {
    return {
      kind: 'android',
      runtime: 'capacitor-android',
      isNativeShell: true,
      buildTarget,
    };
  }

  if (buildTarget === 'desktop-linux-electron') {
    return {
      kind: 'desktop',
      runtime: 'electron-desktop',
      isNativeShell: true,
      buildTarget,
      desktopOs: 'linux',
    };
  }

  if (buildTarget.startsWith('desktop-')) {
    return {
      kind: 'desktop',
      runtime: 'tauri-desktop',
      isNativeShell: true,
      buildTarget,
      desktopOs: desktopOsForBuildTarget(buildTarget, userAgent),
    };
  }

  if (runtimeWindow.kodiakElectron?.runtime === 'electron-desktop') {
    return {
      kind: 'desktop',
      runtime: 'electron-desktop',
      isNativeShell: true,
      buildTarget,
      desktopOs: detectDesktopOs(userAgent),
    };
  }

  if (hasTauriRuntime(runtimeWindow)) {
    return {
      kind: 'desktop',
      runtime: 'tauri-desktop',
      isNativeShell: true,
      buildTarget,
      desktopOs: detectDesktopOs(userAgent),
    };
  }

  if (hasAndroidRuntime(runtimeWindow, normalizedUserAgent)) {
    return {
      kind: 'android',
      runtime: 'capacitor-android',
      isNativeShell: true,
      buildTarget,
    };
  }

  return {
    kind: 'web',
    runtime: 'browser',
    isNativeShell: false,
    buildTarget,
  };
}
