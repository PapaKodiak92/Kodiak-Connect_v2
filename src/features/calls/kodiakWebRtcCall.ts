import { isKodiakMicrophoneSecureContext } from './callPermissions';
import type { MatrixCallKind } from '../matrix/matrixRestClient';

export interface KodiakVoiceCallPeerOptions {
  callKind: MatrixCallKind;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
}

function getKodiakMediaErrorMessage(error: unknown, callKind: MatrixCallKind) {
  const errorName = error instanceof DOMException ? error.name : '';

  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return callKind === 'video'
      ? 'No usable camera or microphone was found. Check Windows Sound/Input and Camera settings.'
      : 'No usable microphone was found. Check Windows Sound > Input, browser microphone settings, or plug in a mic.';
  }

  if (errorName === 'NotAllowedError') {
    return callKind === 'video'
      ? 'Camera or microphone permission was denied. Enable it in site/app settings to use video calls.'
      : 'Microphone permission was denied. Enable it in site/app settings to use voice calls.';
  }

  return error instanceof Error ? error.message : 'Media access failed.';
}

function getKodiakRtcIceServers(): RTCIceServer[] {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  const turnUrls = import.meta.env.VITE_KODIAK_TURN_URLS
    ?.split(',')
    .map((url: string) => url.trim())
    .filter(Boolean);

  const turnUsername = import.meta.env.VITE_KODIAK_TURN_USERNAME?.trim();
  const turnCredential = import.meta.env.VITE_KODIAK_TURN_CREDENTIAL?.trim();

  if (turnUrls?.length && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return iceServers;
}

const KODIAK_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: getKodiakRtcIceServers(),
  iceTransportPolicy: 'relay',
};

export class KodiakVoiceCallPeer {
  private readonly peerConnection: RTCPeerConnection;
  private readonly pendingIceCandidates: RTCIceCandidateInit[] = [];
  private localStream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;

  constructor(private readonly options: KodiakVoiceCallPeerOptions) {
    this.peerConnection = new RTCPeerConnection(KODIAK_RTC_CONFIGURATION);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.options.onIceCandidate?.(event.candidate.toJSON());
      }
    };

    this.peerConnection.ontrack = (event) => {
      const [stream] = event.streams;

      if (stream) {
        this.options.onRemoteStream?.(stream);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      this.options.onConnectionStateChange?.(this.peerConnection.connectionState);
    };
  }

  async createOffer() {
    await this.attachLocalMedia();

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.options.callKind === 'video',
    });

    await this.peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error('WebRTC offer did not include SDP.');
    }

    return offer.sdp;
  }

  async createAnswer(offerSdp: string) {
    await this.attachLocalMedia();
    await this.peerConnection.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await this.flushPendingIceCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    if (!answer.sdp) {
      throw new Error('WebRTC answer did not include SDP.');
    }

    return answer.sdp;
  }

  async applyAnswer(answerSdp: string) {
    if (this.peerConnection.signalingState === 'closed') {
      return;
    }

    await this.peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    await this.flushPendingIceCandidates();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.peerConnection.signalingState === 'closed') {
      return;
    }

    if (!this.peerConnection.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }

    await this.peerConnection.addIceCandidate(candidate);
  }

  async setCameraEnabled(isEnabled: boolean) {
    return isEnabled ? await this.enableCamera() : await this.disableCamera();
  }

  hasCameraEnabled() {
    return Boolean(this.localVideoTrack && this.localVideoTrack.readyState === 'live' && this.localVideoTrack.enabled);
  }

  private async enableCamera() {
    if (this.hasCameraEnabled()) {
      return null;
    }

    if (!isKodiakMicrophoneSecureContext()) {
      throw new Error('Camera access requires HTTPS, localhost, or the installed Kodiak Connect app.');
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is not available in this browser or app container.');
    }

    let cameraStream: MediaStream;

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
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

    this.localStream.addTrack(videoTrack);
    this.localVideoTrack = videoTrack;
    this.videoSender = this.peerConnection.addTrack(videoTrack, this.localStream);
    this.options.onLocalStream?.(this.localStream);

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await this.peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error('WebRTC camera offer did not include SDP.');
    }

    return offer.sdp;
  }

  private async disableCamera() {
    if (!this.localVideoTrack && !this.videoSender) {
      return null;
    }

    if (this.videoSender) {
      this.peerConnection.removeTrack(this.videoSender);
    }

    if (this.localVideoTrack) {
      this.localVideoTrack.stop();
      this.localStream?.removeTrack(this.localVideoTrack);
    }

    this.videoSender = null;
    this.localVideoTrack = null;
    this.options.onLocalStream?.(this.localStream ?? new MediaStream());

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await this.peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error('WebRTC camera-off offer did not include SDP.');
    }

    return offer.sdp;
  }

  setMuted(isMuted: boolean) {
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !isMuted;
    }
  }

  close() {
    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop();
    }

    this.localStream = null;
    this.videoSender = null;
    this.localVideoTrack = null;
    this.pendingIceCandidates.length = 0;
    this.peerConnection.close();
  }

  private async attachLocalMedia() {
    if (this.localStream) {
      return;
    }

    if (!isKodiakMicrophoneSecureContext()) {
      throw new Error('Media access requires HTTPS, localhost, or the installed Kodiak Connect app.');
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media access is not available in this browser or app container.');
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video:
          this.options.callKind === 'video'
            ? {
                facingMode: 'user',
                height: { ideal: 720 },
                width: { ideal: 1280 },
              }
            : false,
      });
    } catch (error) {
      throw new Error(getKodiakMediaErrorMessage(error, this.options.callKind));
    }

    for (const track of this.localStream.getTracks()) {
      const sender = this.peerConnection.addTrack(track, this.localStream);

      if (track.kind === 'video') {
        this.videoSender = sender;
        this.localVideoTrack = track;
      }
    }

    this.options.onLocalStream?.(this.localStream);
  }

  private async flushPendingIceCandidates() {
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift();

      if (candidate) {
        await this.peerConnection.addIceCandidate(candidate);
      }
    }
  }
}




