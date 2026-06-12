export type KodiakMicrophonePermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable'
  | 'dismissed';

const MICROPHONE_PERMISSION_STORAGE_KEY = 'KC_CALL_MICROPHONE_PERMISSION';
const CAMERA_PERMISSION_STORAGE_KEY = 'KC_CALL_CAMERA_PERMISSION';

export interface KodiakMicrophonePermissionState {
  checkedAt?: number;
  message?: string;
  status: KodiakMicrophonePermissionStatus;
}

function isLocalhostHost(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '[::1]' ||
    normalizedHostname === '::1'
  );
}

function isKodiakInstalledAppRuntime() {
  const kodiakGlobal = globalThis as typeof globalThis & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return Boolean(kodiakGlobal.__TAURI__ || kodiakGlobal.__TAURI_INTERNALS__);
}

function isKodiakTrustedAppProtocol(protocol: string) {
  return protocol === 'tauri:' || protocol === 'asset:' || protocol === 'app:';
}

function getKodiakMicrophonePermissionMessage(error: unknown) {
  const errorName = error instanceof DOMException ? error.name : '';

  if (errorName === 'NotAllowedError') {
    return 'Microphone permission was denied. Enable it in site/app settings to use voice calls.';
  }

  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return 'No usable microphone was found. Check your system input device, app permissions, browser microphone settings, or plug in a mic.';
  }

  return error instanceof Error ? error.message : 'Microphone permission failed.';
}

export function isKodiakMicrophoneSecureContext() {
  return (
    window.isSecureContext ||
    isKodiakTrustedAppProtocol(window.location.protocol) ||
    isLocalhostHost(window.location.hostname) ||
    isKodiakInstalledAppRuntime()
  );
}

export function isKodiakRtcAvailable() {
  const rtcGlobal = globalThis as typeof globalThis & {
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
  };

  return Boolean(rtcGlobal.RTCPeerConnection ?? rtcGlobal.webkitRTCPeerConnection);
}

export function readKodiakMicrophonePermission(): KodiakMicrophonePermissionState {
  try {
    const storedValue = window.localStorage.getItem(MICROPHONE_PERMISSION_STORAGE_KEY);

    if (!storedValue) {
      return { status: 'unknown' };
    }

    return JSON.parse(storedValue) as KodiakMicrophonePermissionState;
  } catch {
    return { status: 'unknown' };
  }
}

export function saveKodiakMicrophonePermission(state: KodiakMicrophonePermissionState) {
  window.localStorage.setItem(
    MICROPHONE_PERMISSION_STORAGE_KEY,
    JSON.stringify({
      ...state,
      checkedAt: Date.now(),
    }),
  );
}

export function dismissKodiakMicrophonePermissionPrompt() {
  saveKodiakMicrophonePermission({
    message: 'Microphone setup skipped. You can enable it later before starting calls.',
    status: 'dismissed',
  });
}

export async function requestKodiakMicrophonePermission(): Promise<KodiakMicrophonePermissionState> {
  if (!isKodiakMicrophoneSecureContext()) {
    const state: KodiakMicrophonePermissionState = {
      message: 'Microphone access requires HTTPS, localhost, or the installed Kodiak Connect app.',
      status: 'blocked',
    };

    saveKodiakMicrophonePermission(state);
    return state;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    const state: KodiakMicrophonePermissionState = {
      message: 'Microphone access is not available in this browser or app container.',
      status: 'unavailable',
    };

    saveKodiakMicrophonePermission(state);
    return state;
  }

  if (!isKodiakRtcAvailable()) {
    const state: KodiakMicrophonePermissionState = {
      message: 'Voice calls are not available in this browser or app container. Update Kodiak Connect or use a modern browser.',
      status: 'unavailable',
    };

    saveKodiakMicrophonePermission(state);
    return state;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });

    for (const track of stream.getTracks()) {
      track.stop();
    }

    const state: KodiakMicrophonePermissionState = {
      message: 'Microphone is ready for voice calls.',
      status: 'granted',
    };

    saveKodiakMicrophonePermission(state);
    return state;
  } catch (error) {
    const errorName = error instanceof DOMException ? error.name : '';

    const state: KodiakMicrophonePermissionState = {
      message: getKodiakMicrophonePermissionMessage(error),
      status: errorName === 'NotAllowedError' ? 'denied' : 'unavailable',
    };

    saveKodiakMicrophonePermission(state);
    return state;
  }
}


export function readKodiakCameraPermission(): KodiakMicrophonePermissionState {
  try {
    const storedValue = window.localStorage.getItem(CAMERA_PERMISSION_STORAGE_KEY);

    if (!storedValue) {
      return { status: 'unknown' };
    }

    return JSON.parse(storedValue) as KodiakMicrophonePermissionState;
  } catch {
    return { status: 'unknown' };
  }
}

export function saveKodiakCameraPermission(state: KodiakMicrophonePermissionState) {
  window.localStorage.setItem(
    CAMERA_PERMISSION_STORAGE_KEY,
    JSON.stringify({
      ...state,
      checkedAt: Date.now(),
    }),
  );
}

export async function requestKodiakCameraPermission(): Promise<KodiakMicrophonePermissionState> {
  if (!isKodiakMicrophoneSecureContext()) {
    const state: KodiakMicrophonePermissionState = {
      message: 'Camera access requires HTTPS, localhost, or the installed Kodiak Connect app.',
      status: 'blocked',
    };

    saveKodiakCameraPermission(state);
    return state;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    const state: KodiakMicrophonePermissionState = {
      message: 'Camera access is not available in this browser or app container.',
      status: 'unavailable',
    };

    saveKodiakCameraPermission(state);
    return state;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        height: { ideal: 720 },
        width: { ideal: 1280 },
      },
    });

    for (const track of stream.getTracks()) {
      track.stop();
    }

    const state: KodiakMicrophonePermissionState = {
      message: 'Camera is ready for video calls.',
      status: 'granted',
    };

    saveKodiakCameraPermission(state);
    return state;
  } catch (error) {
    const errorName = error instanceof DOMException ? error.name : '';

    const state: KodiakMicrophonePermissionState = {
      message:
        errorName === 'NotAllowedError'
          ? 'Camera permission was denied. Enable it in site/app settings to use video calls.'
          : errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError'
            ? 'No usable camera was found. Plug in or enable a camera, then try again.'
            : error instanceof Error
              ? error.message
              : 'Camera permission failed.',
      status: errorName === 'NotAllowedError' ? 'denied' : 'unavailable',
    };

    saveKodiakCameraPermission(state);
    return state;
  }
}
