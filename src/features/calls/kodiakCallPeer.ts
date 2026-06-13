import type { MatrixCallKind } from '../matrix/matrixRestClient';
import {
  createPlatformCallPeer,
  shouldUsePlatformNativeCallPeer,
} from '../../platform/calls/platformCallAdapter';

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
export interface KodiakCallMediaToken {
  roomName: string;
  token: string;
  wsUrl: string;
}

export interface KodiakVoiceCallPeerOptions {
  callId?: string;
  callKind: MatrixCallKind;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  requestMediaToken?: (request: {
    callId: string;
    callKind: MatrixCallKind;
    targetUserId: string;
  }) => Promise<KodiakCallMediaToken>;
  targetUserId?: string;
}

export function shouldUseKodiakNativeLinuxRtcPeer() {
  return shouldUsePlatformNativeCallPeer();
}

export function createKodiakCallPeer(options: KodiakVoiceCallPeerOptions): KodiakCallPeer {
  return createPlatformCallPeer(options);
}

export type { MatrixCallKind };
