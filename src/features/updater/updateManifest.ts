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
  currentVersion: '0.1.9',
  channel: 'dev',
  generatedAt: '2026-05-30T00:00:00.000Z',
  targets: [],
};
