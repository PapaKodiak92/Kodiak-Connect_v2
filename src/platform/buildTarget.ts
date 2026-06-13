import type { KodiakBuildTarget } from './platformTypes';

const allowedBuildTargets = new Set<KodiakBuildTarget>([
  'web',
  'android',
  'desktop-windows',
  'desktop-linux',
  'desktop-macos',
  'desktop-unknown',
  'auto',
]);

export function readKodiakBuildTarget(): KodiakBuildTarget {
  const rawBuildTarget = import.meta.env.VITE_KODIAK_BUILD_TARGET;

  if (!rawBuildTarget || !allowedBuildTargets.has(rawBuildTarget as KodiakBuildTarget)) {
    return 'auto';
  }

  return rawBuildTarget as KodiakBuildTarget;
}

export function isDesktopBuildTarget(buildTarget: KodiakBuildTarget) {
  return buildTarget.startsWith('desktop-');
}
