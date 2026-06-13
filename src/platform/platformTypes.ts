export type KodiakPlatformKind = 'web' | 'android' | 'desktop';

export type KodiakDesktopOs = 'windows' | 'linux' | 'macos' | 'unknown';

export type KodiakRuntime = 'browser' | 'capacitor-android' | 'tauri-desktop' | 'electron-desktop';

export type KodiakBuildTarget = 'web' | 'android' | 'desktop-windows' | 'desktop-linux' | 'desktop-linux-electron' | 'desktop-macos' | 'desktop-unknown' | 'auto';

export interface KodiakPlatformInfo {
  kind: KodiakPlatformKind;
  runtime: KodiakRuntime;
  isNativeShell: boolean;
  buildTarget?: KodiakBuildTarget;
  desktopOs?: KodiakDesktopOs;
}
