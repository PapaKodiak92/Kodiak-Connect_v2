import { invokeTauri } from '../tauri/tauriCore';
import { listenTauriEvent, type TauriUnlistenFn } from '../tauri/tauriEvents';
import type { KodiakCallPeer, KodiakVoiceCallPeerOptions } from '../../features/calls/kodiakCallPeer';

interface LinuxRtcIceCandidatePayload {
  call_id: string;
  candidate: string;
  sdp_m_line_index: number;
}
interface LinuxRtcDiagnostics {
  available: boolean;
  reason?: string | null;
  missingPlugins: string[];
}

async function ensureLinuxNativeRtcAvailable() {
  const diagnostics = await invokeTauri<LinuxRtcDiagnostics>('kodiak_linux_rtc_diagnostics');

  if (diagnostics.available) {
    return;
  }

  const missingPlugins = diagnostics.missingPlugins.length > 0
    ? ` Missing plugins: ${diagnostics.missingPlugins.join(', ')}.`
    : '';

  throw new Error(`${diagnostics.reason ?? 'Linux native RTC is not available.'}${missingPlugins}`);
}

function createEmptyCallStream() {
  return new MediaStream();
}

export class KodiakNativeLinuxRtcCallPeer implements KodiakCallPeer {
  private readonly callId = crypto.randomUUID();
  private readonly ready: Promise<void>;
  private readonly pendingIceCandidates: RTCIceCandidateInit[] = [];
  private unlistenIceCandidate?: TauriUnlistenFn;
  private isClosed = false;
  private isMuted = false;
  private isNativeSessionReady = false;

  constructor(private readonly options: KodiakVoiceCallPeerOptions) {
    this.ready = this.listenForNativeIceCandidates();
    this.options.onConnectionStateChange?.('connecting');
    this.options.onLocalStream?.(createEmptyCallStream());
  }

  async createOffer() {
    await this.ready;
    await ensureLinuxNativeRtcAvailable();

    const offerSdp = await invokeTauri<string>('kodiak_linux_rtc_create_offer', {
      callId: this.callId,
      callKind: this.options.callKind,
    });

    this.isNativeSessionReady = true;
    await this.flushPendingIceCandidates();

    if (this.isMuted) {
      this.setMuted(true);
    }

    return offerSdp;
  }

  async createAnswer(offerSdp: string) {
    await this.ready;
    await ensureLinuxNativeRtcAvailable();

    const answerSdp = await invokeTauri<string>('kodiak_linux_rtc_create_answer', {
      callId: this.callId,
      callKind: this.options.callKind,
      offerSdp,
    });

    this.isNativeSessionReady = true;
    await this.flushPendingIceCandidates();

    if (this.isMuted) {
      this.setMuted(true);
    }

    return answerSdp;
  }

  async applyAnswer(answerSdp: string) {
    if (this.isClosed) {
      return;
    }

    await invokeTauri('kodiak_linux_rtc_apply_answer', {
      callId: this.callId,
      answerSdp,
    });

    this.options.onConnectionStateChange?.('connected');
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.isClosed || !candidate.candidate) {
      return;
    }

    if (!this.isNativeSessionReady) {
      this.pendingIceCandidates.push(candidate);
      return;
    }

    await this.sendNativeIceCandidate(candidate);
  }

  async setCameraEnabled(_isEnabled: boolean) {
    return null;
  }

  hasCameraEnabled() {
    return false;
  }

  setMuted(isMuted: boolean) {
    this.isMuted = isMuted;

    if (!this.isNativeSessionReady) {
      return;
    }

    void invokeTauri('kodiak_linux_rtc_set_muted', {
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
    this.pendingIceCandidates.length = 0;
    this.unlistenIceCandidate?.();

    void invokeTauri('kodiak_linux_rtc_close', {
      callId: this.callId,
    }).catch((error) => {
      console.warn('[Kodiak Connect] Linux native RTC close failed', error);
    });

    this.options.onConnectionStateChange?.('closed');
  }

  private async listenForNativeIceCandidates() {
    this.unlistenIceCandidate = await listenTauriEvent<LinuxRtcIceCandidatePayload>('kodiak-linux-rtc-ice', (event) => {
      if (event.payload.call_id !== this.callId || this.isClosed) {
        return;
      }

      this.options.onIceCandidate?.({
        candidate: event.payload.candidate,
        sdpMLineIndex: event.payload.sdp_m_line_index,
      });
    });
  }

  private async sendNativeIceCandidate(candidate: RTCIceCandidateInit) {
    await invokeTauri('kodiak_linux_rtc_add_ice_candidate', {
      callId: this.callId,
      candidate: {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
      },
    });
  }

  private async flushPendingIceCandidates() {
    const queuedCandidates = this.pendingIceCandidates.splice(0);

    for (const candidate of queuedCandidates) {
      if (this.isClosed) {
        return;
      }

      await this.sendNativeIceCandidate(candidate);
    }
  }
}
