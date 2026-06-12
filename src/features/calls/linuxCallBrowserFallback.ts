const DEFAULT_KODIAK_WEB_APP_URL = 'https://kodiak-connect.com';

type KodiakFallbackRtcGlobal = typeof globalThis & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  RTCPeerConnection?: typeof RTCPeerConnection;
  webkitRTCPeerConnection?: typeof RTCPeerConnection;
};

type KodiakFallbackRtcWindow = Window &
  typeof globalThis & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
  };

function isKodiakInstalledAppRuntime() {
  const rtcGlobal = globalThis as KodiakFallbackRtcGlobal;
  const rtcWindow = window as KodiakFallbackRtcWindow;

  return Boolean(
    rtcGlobal.__TAURI__ ||
      rtcGlobal.__TAURI_INTERNALS__ ||
      rtcWindow.__TAURI__ ||
      rtcWindow.__TAURI_INTERNALS__,
  );
}

function hasKodiakPeerConnectionConstructor() {
  const rtcGlobal = globalThis as KodiakFallbackRtcGlobal;
  const rtcWindow = window as KodiakFallbackRtcWindow;

  return Boolean(
    rtcGlobal.RTCPeerConnection ??
      rtcGlobal.webkitRTCPeerConnection ??
      rtcWindow.RTCPeerConnection ??
      rtcWindow.webkitRTCPeerConnection,
  );
}

function getKodiakWebAppUrl() {
  const savedUrl = window.localStorage.getItem('KC_WEB_CALL_FALLBACK_URL')?.trim();
  const envUrl = import.meta.env.VITE_KODIAK_WEB_APP_URL?.trim();

  return savedUrl || envUrl || DEFAULT_KODIAK_WEB_APP_URL;
}

export function shouldUseKodiakBrowserCallFallback() {
  return isKodiakInstalledAppRuntime() && /Linux/i.test(navigator.userAgent) && !hasKodiakPeerConnectionConstructor();
}

export async function openKodiakCallInSystemBrowser() {
  const targetUrl = new URL(getKodiakWebAppUrl());
  targetUrl.searchParams.set('kcCallFallback', 'linux-tauri');

  const { openUrl } = await import('@tauri-apps/plugin-opener');

  await openUrl(targetUrl.toString());
}
