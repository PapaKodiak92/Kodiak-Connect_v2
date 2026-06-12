export interface KodiakUpdateTarget {
  platform: 'windows' | 'linux-deb' | 'linux-appimage' | 'android' | 'web';
  version: string;
  url: string;
  signature?: string;
  notesUrl?: string;
}

export interface KodiakUpdateManifest {
  appId: string;
  currentVersion: string;
  channel: 'dev' | 'stable';
  generatedAt: string;
  targets: KodiakUpdateTarget[];
}

export const updateManifest: KodiakUpdateManifest = {
  appId: 'com.kodiakholdings.kodiakconnect',
  currentVersion: '1.13.10',
  channel: 'dev',
  generatedAt: '2026-06-02T19:45:49.315Z',
  targets: [],
};

