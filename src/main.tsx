import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/global.css';
import './styles/brand.css';
import './styles/launcher.css';
import './styles/acknowledgement.css';
import './styles/matrix-chat.css';
import './styles/workspace-polish.css';
import './styles/typing-indicator.css';
import './styles/safety-center.css';
import './styles/workspace-surfaces.css';
import './styles/attachment-bridge.css';
import './styles/layout-repair.css';
import './styles/client-hotfix.css';
import './styles/mobile-workspace-overhaul.css';
import './styles/composer-tools-redesign.css';
import './styles/call-permission-prompt.css';
import './styles/call-panel-polish.css';
import './styles/music-lounge.css';
import './styles/message-formatting.css';
import './styles/mobile-member-panel-slide.css';

const DEFAULT_KODIAK_WEB_APP_URL = 'https://kodiak-connect.com';
const KODIAK_LINUX_WEBRTC_ORIGIN_KEY = 'KC_LINUX_WEBRTC_ORIGIN';

type KodiakLinuxRtcGlobal = typeof globalThis & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  RTCPeerConnection?: typeof RTCPeerConnection;
  webkitRTCPeerConnection?: typeof RTCPeerConnection;
};

type KodiakLinuxRtcWindow = Window &
  typeof globalThis & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
  };

function isKodiakLinuxTauriRuntimeMissingPeerConnection() {
  const rtcGlobal = globalThis as KodiakLinuxRtcGlobal;
  const rtcWindow = window as KodiakLinuxRtcWindow;

  const isTauriRuntime = Boolean(
    rtcGlobal.__TAURI__ ||
      rtcGlobal.__TAURI_INTERNALS__ ||
      rtcWindow.__TAURI__ ||
      rtcWindow.__TAURI_INTERNALS__,
  );

  const hasPeerConnection = Boolean(
    rtcGlobal.RTCPeerConnection ??
      rtcGlobal.webkitRTCPeerConnection ??
      rtcWindow.RTCPeerConnection ??
      rtcWindow.webkitRTCPeerConnection,
  );

  return (
    isTauriRuntime &&
    /Linux/i.test(navigator.userAgent) &&
    window.location.protocol === 'tauri:' &&
    !hasPeerConnection
  );
}

function getKodiakLinuxWebRtcOrigin() {
  const savedOrigin = window.localStorage.getItem(KODIAK_LINUX_WEBRTC_ORIGIN_KEY)?.trim();
  const envOrigin = import.meta.env.VITE_KODIAK_WEB_APP_URL?.trim();

  return savedOrigin || envOrigin || DEFAULT_KODIAK_WEB_APP_URL;
}

function redirectLinuxTauriToHttpsRtcOrigin() {
  if (!isKodiakLinuxTauriRuntimeMissingPeerConnection()) {
    return false;
  }

  const targetUrl = new URL(getKodiakLinuxWebRtcOrigin());
  targetUrl.searchParams.set('kcLinuxTauriRtc', '1');

  window.location.replace(targetUrl.toString());
  return true;
}
function clearStaleAvatarObjectUrls() {
  const cacheKey = 'KC_BACKEND_PROFILE_CACHE';

  try {
    const rawCache = window.localStorage.getItem(cacheKey);

    if (!rawCache) {
      return;
    }

    const cache = JSON.parse(rawCache) as {
      avatars?: Record<string, string>;
      bios?: Record<string, string>;
      displayNames?: Record<string, string>;
    };

    const avatars = Object.fromEntries(
      Object.entries(cache.avatars ?? {}).filter(([, avatarUrl]) => {
        return typeof avatarUrl === 'string' && avatarUrl.trim() && !avatarUrl.startsWith('blob:');
      }),
    );

    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        ...cache,
        avatars,
      }),
    );
  } catch {
    window.localStorage.removeItem(cacheKey);
  }
}

if (!redirectLinuxTauriToHttpsRtcOrigin()) {
  clearStaleAvatarObjectUrls();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}



import './styles/collapsible-layout.css';
import './styles/mobile-final-shell.css';

