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

function isKodiakLinuxTauriRuntime() {
  const kodiakGlobal = globalThis as typeof globalThis & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  const kodiakWindow = window as typeof window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return Boolean(
    /Linux/i.test(navigator.userAgent) &&
      (kodiakGlobal.__TAURI__ ||
        kodiakGlobal.__TAURI_INTERNALS__ ||
        kodiakWindow.__TAURI__ ||
        kodiakWindow.__TAURI_INTERNALS__),
  );
}

function isKodiakTrustedAppProtocol(protocol: string) {
  return protocol === 'tauri:' || protocol === 'asset:' || protocol === 'app:';
}

type KodiakLegacyMediaNavigator = Navigator & {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
    successCallback: (stream: MediaStream) => void,
    errorCallback: (error: DOMException) => void,
  ) => void;
  mozGetUserMedia?: (
    constraints: MediaStreamConstraints,
    successCallback: (stream: MediaStream) => void,
    errorCallback: (error: DOMException) => void,
  ) => void;
  webkitGetUserMedia?: (
    constraints: MediaStreamConstraints,
    successCallback: (stream: MediaStream) => void,
    errorCallback: (error: DOMException) => void,
  ) => void;
};

function getKodiakLegacyMediaNavigator() {
  return navigator as KodiakLegacyMediaNavigator;
}

export function hasKodiakUserMedia() {
  const legacyNavigator = getKodiakLegacyMediaNavigator();

  return Boolean(
    navigator.mediaDevices?.getUserMedia ||
      legacyNavigator.getUserMedia ||
      legacyNavigator.webkitGetUserMedia ||
      legacyNavigator.mozGetUserMedia,
  );
}

export function requestKodiakUserMedia(constraints: MediaStreamConstraints) {
  const modernGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);

  if (modernGetUserMedia) {
    return modernGetUserMedia(constraints);
  }

  const legacyNavigator = getKodiakLegacyMediaNavigator();
  const legacyGetUserMedia =
    legacyNavigator.getUserMedia ?? legacyNavigator.webkitGetUserMedia ?? legacyNavigator.mozGetUserMedia;

  if (!legacyGetUserMedia) {
    return Promise.reject(new Error('Media access is not available in this browser or app container.'));
  }

  return new Promise<MediaStream>((resolve, reject) => {
    legacyGetUserMedia.call(legacyNavigator, constraints, resolve, reject);
  });
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

function isKodiakBrowserRtcAvailable() {
  const rtcGlobal = globalThis as typeof globalThis & {
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
  };
  const rtcWindow = window as typeof window & {
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
  };

  return Boolean(
    rtcGlobal.RTCPeerConnection ??
      rtcGlobal.webkitRTCPeerConnection ??
      rtcWindow.RTCPeerConnection ??
      rtcWindow.webkitRTCPeerConnection,
  );
}

export function isKodiakRtcAvailable() {
  return isKodiakBrowserRtcAvailable() || isKodiakLinuxTauriRuntime();
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

  if (!hasKodiakUserMedia()) {
    if (isKodiakLinuxTauriRuntime()) {
      const state: KodiakMicrophonePermissionState = {
        message: 'Linux desktop voice calls use Kodiak Connect native audio. No browser microphone permission is required.',
        status: 'granted',
      };

      saveKodiakMicrophonePermission(state);
      return state;
    }

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
    const stream = await requestKodiakUserMedia({
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

  if (!hasKodiakUserMedia()) {
    if (isKodiakLinuxTauriRuntime()) {
      const state: KodiakMicrophonePermissionState = {
        message: 'Linux desktop native calling is voice-only right now. Camera support is not enabled in this Linux WebView.',
        status: 'unavailable',
      };

      saveKodiakCameraPermission(state);
      return state;
    }

    const state: KodiakMicrophonePermissionState = {
      message: 'Camera access is not available in this browser or app container.',
      status: 'unavailable',
    };

    saveKodiakCameraPermission(state);
    return state;
  }

  try {
    const stream = await requestKodiakUserMedia({
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
