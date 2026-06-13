import { kodiakPlatform } from './currentPlatform';

function openBrowserFallback(url: string) {
  if (url.startsWith('mailto:')) {
    window.location.href = url;
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openKodiakExternalUrl(url: string) {
  try {
    await kodiakPlatform.openExternalUrl(url);
  } catch (error) {
    console.error('[Kodiak Connect] Failed to open external URL', error);
    openBrowserFallback(url);
  }
}