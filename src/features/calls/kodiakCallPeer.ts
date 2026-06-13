import type { MatrixCallKind } from '../matrix/matrixRestClient';
import {
  isKodiakWebRtcSupported,
  KodiakVoiceCallPeer,
  type KodiakVoiceCallPeerOptions,
} from './kodiakWebRtcCall';
import { KodiakNativeLinuxRtcCallPeer } from './kodiakNativeLinuxRtcCall';

export interface KodiakCallPeer {
  createOffer(): Promise<string>;
  createAnswer(offerSdp: string): Promise<string>;
  applyAnswer(answerSdp: string): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  setCameraEnabled(isEnabled: boolean): Promise<string | null>;
  hasCameraEnabled(): boolean;
  setMuted(isMuted: boolean): void;
  close(): void;
}

type KodiakRuntimeGlobal = typeof globalThis & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  RTCPeerConnection?: typeof RTCPeerConnection;
  webkitRTCPeerConnection?: typeof RTCPeerConnection;
};

function isLinuxTauriRuntime() {
  const runtimeGlobal = globalThis as KodiakRuntimeGlobal;
  const runtimeWindow = window as Window &
    typeof globalThis & {
      __TAURI__?: unknown;
      __TAURI_INTERNALS__?: unknown;
      webkitRTCPeerConnection?: typeof RTCPeerConnection;
    };

  return Boolean(
    /Linux/i.test(navigator.userAgent) &&
      (runtimeGlobal.__TAURI__ ||
        runtimeGlobal.__TAURI_INTERNALS__ ||
        runtimeWindow.__TAURI__ ||
        runtimeWindow.__TAURI_INTERNALS__),
  );
}

export function shouldUseKodiakNativeLinuxRtcPeer() {
  return isLinuxTauriRuntime() && !isKodiakWebRtcSupported();
}

export function createKodiakCallPeer(options: KodiakVoiceCallPeerOptions): KodiakCallPeer {
  if (shouldUseKodiakNativeLinuxRtcPeer()) {
    return new KodiakNativeLinuxRtcCallPeer(options);
  }

  return new KodiakVoiceCallPeer(options);
}

export type { MatrixCallKind };
