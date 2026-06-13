import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { KodiakCallPeer } from './kodiakCallPeer';
import type { KodiakVoiceCallPeerOptions } from './kodiakWebRtcCall';

interface LinuxRtcIceCandidatePayload {
  call_id: string;
  candidate: string;
  sdp_m_line_index: number;
}

function createEmptyCallStream() {
  return new MediaStream();
}

export class KodiakNativeLinuxRtcCallPeer implements KodiakCallPeer {
  private readonly callId = crypto.randomUUID();
  private readonly ready: Promise<void>;
  private unlistenIceCandidate?: UnlistenFn;
  private isClosed = false;
  private isMuted = false;

  constructor(private readonly options: KodiakVoiceCallPeerOptions) {
    this.ready = this.listenForNativeIceCandidates();
    this.options.onConnectionStateChange?.('connecting');
    this.options.onLocalStream?.(createEmptyCallStream());
  }

  async createOffer() {
    await this.ready;

    return await invoke<string>('kodiak_linux_rtc_create_offer', {
      callId: this.callId,
      callKind: this.options.callKind,
    });
  }

  async createAnswer(offerSdp: string) {
    await this.ready;

    return await invoke<string>('kodiak_linux_rtc_create_answer', {
      callId: this.callId,
      callKind: this.options.callKind,
      offerSdp,
    });
  }

  async applyAnswer(answerSdp: string) {
    if (this.isClosed) {
      return;
    }

    await invoke('kodiak_linux_rtc_apply_answer', {
      callId: this.callId,
      answerSdp,
    });

    this.options.onConnectionStateChange?.('connected');
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.isClosed || !candidate.candidate) {
      return;
    }

    await invoke('kodiak_linux_rtc_add_ice_candidate', {
      callId: this.callId,
      candidate: {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
      },
    });
  }

  async setCameraEnabled(_isEnabled: boolean) {
    return null;
  }

  hasCameraEnabled() {
    return false;
  }

  setMuted(isMuted: boolean) {
    this.isMuted = isMuted;

    void invoke('kodiak_linux_rtc_set_muted', {
      callId: this.callId,
      isMuted,
    }).catch((error) => {
      console.warn('[Kodiak Connect] Linux native mute failed', error);
    });
  }

  close() {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
    this.unlistenIceCandidate?.();

    void invoke('kodiak_linux_rtc_close', {
      callId: this.callId,
    }).catch((error) => {
      console.warn('[Kodiak Connect] Linux native RTC close failed', error);
    });

    this.options.onConnectionStateChange?.('closed');
  }

  private async listenForNativeIceCandidates() {
    this.unlistenIceCandidate = await listen<LinuxRtcIceCandidatePayload>('kodiak-linux-rtc-ice', (event) => {
      if (event.payload.call_id !== this.callId || this.isClosed) {
        return;
      }

      this.options.onIceCandidate?.({
        candidate: event.payload.candidate,
        sdpMLineIndex: event.payload.sdp_m_line_index,
      });
    });
  }
}
