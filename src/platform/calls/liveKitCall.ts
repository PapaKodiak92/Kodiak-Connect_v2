import { Room, RoomEvent } from 'livekit-client';
import { isKodiakMicrophoneSecureContext, requestKodiakUserMedia } from '../../features/calls/callPermissions';
import type { MatrixCallKind } from '../../features/matrix/matrixRestClient';
import type { KodiakVoiceCallPeerOptions } from '../../features/calls/kodiakCallPeer';

const LIVEKIT_SDP_MARKER = 'kodiak-livekit-v1';

type KodiakLiveKitTrack = {
  kind?: string;
  mediaStreamTrack?: MediaStreamTrack;
};

function getKodiakMediaErrorMessage(error: unknown, callKind: MatrixCallKind) {
  const errorName = error instanceof DOMException ? error.name : '';

  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return callKind === 'video'
      ? 'No usable camera or microphone was found. Check your system camera, microphone, and app permissions.'
      : 'No usable microphone was found. Check your system input device, app permissions, browser microphone settings, or plug in a mic.';
  }

  if (errorName === 'NotAllowedError') {
    return callKind === 'video'
      ? 'Camera or microphone permission was denied. Enable it in site/app settings to use video calls.'
      : 'Microphone permission was denied. Enable it in site/app settings to use voice calls.';
  }

  return error instanceof Error ? error.message : 'Media access failed.';
}

function mapLiveKitConnectionState(state: string): RTCPeerConnectionState {
  if (state === 'connected') return 'connected';
  if (state === 'disconnected' || state === 'reconnecting') return 'disconnected';
  if (state === 'closed') return 'closed';
  return 'connecting';
}

export class KodiakLiveKitCallPeer {
  private readonly room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });

  private isConnected = false;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private localAudioTrack: MediaStreamTrack | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;

  constructor(private readonly options: KodiakVoiceCallPeerOptions) {
    this.room.on(RoomEvent.ConnectionStateChanged, (state) => {
      this.options.onConnectionStateChange?.(mapLiveKitConnectionState(String(state)));
    });

    this.room.on(RoomEvent.TrackSubscribed, (track: KodiakLiveKitTrack) => {
      this.attachRemoteTrack(track);
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track: KodiakLiveKitTrack) => {
      this.detachRemoteTrack(track);
    });

    this.room.on(RoomEvent.Disconnected, () => {
      this.options.onConnectionStateChange?.('closed');
    });
  }

  async createOffer() {
    await this.connectAndPublish();
    return LIVEKIT_SDP_MARKER;
  }

  async createAnswer(_offerSdp: string) {
    await this.connectAndPublish();
    return LIVEKIT_SDP_MARKER;
  }

  async applyAnswer(_answerSdp: string) {
    await this.connectAndPublish();
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit) {
    // Calls v2 uses LiveKit SFU media transport. App-level ICE exchange is not needed.
  }

  async setCameraEnabled(isEnabled: boolean) {
    if (isEnabled) {
      await this.enableCamera();
    } else {
      await this.disableCamera();
    }

    return null;
  }

  hasCameraEnabled() {
    return Boolean(this.localVideoTrack && this.localVideoTrack.readyState === 'live' && this.localVideoTrack.enabled);
  }

  setMuted(isMuted: boolean) {
    if (this.localAudioTrack) {
      this.localAudioTrack.enabled = !isMuted;
    }
  }

  close() {
    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop();
    }

    this.localStream = null;
    this.remoteStream = null;
    this.localAudioTrack = null;
    this.localVideoTrack = null;
    this.isConnected = false;
    this.room.disconnect();
  }

  private async connectAndPublish() {
    if (!this.options.callId || !this.options.targetUserId || !this.options.requestMediaToken) {
      throw new Error('Calls v2 media token request is not available.');
    }

    if (!isKodiakMicrophoneSecureContext()) {
      throw new Error('Media access requires HTTPS, localhost, or the installed Kodiak Connect app.');
    }

    if (!this.isConnected) {
      const mediaToken = await this.options.requestMediaToken({
        callId: this.options.callId,
        callKind: this.options.callKind,
        targetUserId: this.options.targetUserId,
      });

      await this.room.connect(mediaToken.wsUrl, mediaToken.token);
      this.isConnected = true;
    }

    await this.attachLocalAudioMedia();

    if (this.options.callKind === 'video') {
      await this.enableCamera();
    }
  }

  private async attachLocalAudioMedia() {
    if (this.localAudioTrack?.readyState === 'live') {
      return;
    }

    let audioStream: MediaStream;

    try {
      audioStream = await requestKodiakUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
    } catch (error) {
      throw new Error(getKodiakMediaErrorMessage(error, 'voice'));
    }

    const [audioTrack] = audioStream.getAudioTracks();

    if (!audioTrack) {
      throw new Error('No microphone audio track was returned.');
    }

    if (!this.localStream) {
      this.localStream = new MediaStream();
    }

    this.localAudioTrack = audioTrack;
    this.localStream.addTrack(audioTrack);

    await this.room.localParticipant.publishTrack(audioTrack);
    this.options.onLocalStream?.(this.localStream);
  }

  private async enableCamera() {
    if (this.hasCameraEnabled()) {
      return;
    }

    let cameraStream: MediaStream;

    try {
      cameraStream = await requestKodiakUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          height: { ideal: 720 },
          width: { ideal: 1280 },
        },
      });
    } catch (error) {
      throw new Error(getKodiakMediaErrorMessage(error, 'video'));
    }

    const [videoTrack] = cameraStream.getVideoTracks();

    if (!videoTrack) {
      throw new Error('No camera video track was returned.');
    }

    if (!this.localStream) {
      this.localStream = new MediaStream();
    }

    this.localVideoTrack = videoTrack;
    this.localStream.addTrack(videoTrack);

    await this.room.localParticipant.publishTrack(videoTrack);
    this.options.onLocalStream?.(this.localStream);
  }

  private async disableCamera() {
    if (!this.localVideoTrack) {
      return;
    }

    this.room.localParticipant.unpublishTrack(this.localVideoTrack);
    this.localVideoTrack.stop();
    this.localStream?.removeTrack(this.localVideoTrack);
    this.localVideoTrack = null;

    this.options.onLocalStream?.(this.localStream ?? new MediaStream());
  }

  private attachRemoteTrack(track: KodiakLiveKitTrack) {
    const mediaStreamTrack = track.mediaStreamTrack;

    if (!mediaStreamTrack) {
      return;
    }

    if (!this.remoteStream) {
      this.remoteStream = new MediaStream();
    }

    if (!this.remoteStream.getTracks().some((currentTrack) => currentTrack.id === mediaStreamTrack.id)) {
      this.remoteStream.addTrack(mediaStreamTrack);
    }

    this.options.onRemoteStream?.(this.remoteStream);
  }

  private detachRemoteTrack(track: KodiakLiveKitTrack) {
    const mediaStreamTrack = track.mediaStreamTrack;

    if (!mediaStreamTrack || !this.remoteStream) {
      return;
    }

    this.remoteStream.removeTrack(mediaStreamTrack);
    this.options.onRemoteStream?.(this.remoteStream);
  }
}