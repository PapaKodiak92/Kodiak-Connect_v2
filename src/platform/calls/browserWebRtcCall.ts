import { isKodiakMicrophoneSecureContext, requestKodiakUserMedia } from '../../features/calls/callPermissions';
import type { MatrixCallKind } from '../../features/matrix/matrixRestClient';
import type { KodiakVoiceCallPeerOptions } from '../../features/calls/kodiakCallPeer';


type KodiakRtcPeerConnectionConstructor = new (configuration?: RTCConfiguration) => RTCPeerConnection;

type KodiakRtcGlobal = typeof globalThis & {
  RTCPeerConnection?: KodiakRtcPeerConnectionConstructor;
  webkitRTCPeerConnection?: KodiakRtcPeerConnectionConstructor;
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

function getKodiakRtcPeerConnectionConstructor() {
  const rtcGlobal = globalThis as KodiakRtcGlobal;
  const rtcWindow = window as typeof window & {
    webkitRTCPeerConnection?: KodiakRtcPeerConnectionConstructor;
  };
  const rtcConstructor =
    rtcGlobal.RTCPeerConnection ??
    rtcGlobal.webkitRTCPeerConnection ??
    rtcWindow.RTCPeerConnection ??
    rtcWindow.webkitRTCPeerConnection;

  if (!rtcConstructor) {
    throw new Error(
      getKodiakWebRtcUnsupportedMessage(),
    );
  }

  return rtcConstructor;
}

export function isKodiakWebRtcSupported() {
  const rtcGlobal = globalThis as KodiakRtcGlobal;
  const rtcWindow = window as typeof window & {
    webkitRTCPeerConnection?: KodiakRtcPeerConnectionConstructor;
  };

  return Boolean(
    rtcGlobal.RTCPeerConnection ??
      rtcGlobal.webkitRTCPeerConnection ??
      rtcWindow.RTCPeerConnection ??
      rtcWindow.webkitRTCPeerConnection,
  );
}

export function getKodiakWebRtcDiagnostics() {
  const rtcGlobal = globalThis as KodiakRtcGlobal & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  const rtcWindow = window as typeof window & {
    webkitRTCPeerConnection?: KodiakRtcPeerConnectionConstructor;
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return [
    `protocol=${window.location.protocol}`,
    `host=${window.location.hostname}`,
    `secure=${String(window.isSecureContext)}`,
    `global.RTCPeerConnection=${typeof rtcGlobal.RTCPeerConnection}`,
    `global.webkitRTCPeerConnection=${typeof rtcGlobal.webkitRTCPeerConnection}`,
    `window.RTCPeerConnection=${typeof rtcWindow.RTCPeerConnection}`,
    `window.webkitRTCPeerConnection=${typeof rtcWindow.webkitRTCPeerConnection}`,
    `mediaDevices=${typeof navigator.mediaDevices}`,
    `getUserMedia=${typeof navigator.mediaDevices?.getUserMedia}`,
    `tauri=${String(Boolean(rtcGlobal.__TAURI__ || rtcGlobal.__TAURI_INTERNALS__ || rtcWindow.__TAURI__ || rtcWindow.__TAURI_INTERNALS__))}`,
    `ua=${navigator.userAgent}`,
  ].join(' | ');
}

export function getKodiakWebRtcUnsupportedMessage() {
  return 'Linux app WebRTC runtime is missing RTCPeerConnection. ' + getKodiakWebRtcDiagnostics();
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
};

export class KodiakVoiceCallPeer {
  private readonly peerConnection: RTCPeerConnection;
  private readonly pendingIceCandidates: RTCIceCandidateInit[] = [];
  private localStream: MediaStream | null = null;
  private remoteFallbackStream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;

  constructor(private readonly options: KodiakVoiceCallPeerOptions) {
    const RtcPeerConnection = getKodiakRtcPeerConnectionConstructor();
    this.peerConnection = new RtcPeerConnection(KODIAK_RTC_CONFIGURATION);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.options.onIceCandidate?.(event.candidate.toJSON());
      }
    };

    this.peerConnection.ontrack = (event) => {
      const [stream] = event.streams;

      if (stream) {
        this.options.onRemoteStream?.(stream);
        return;
      }

      if (!this.remoteFallbackStream) {
        this.remoteFallbackStream = new MediaStream();
      }

      if (!this.remoteFallbackStream.getTracks().some((track) => track.id === event.track.id)) {
        this.remoteFallbackStream.addTrack(event.track);
      }

      this.options.onRemoteStream?.(this.remoteFallbackStream);
    };

    this.peerConnection.onconnectionstatechange = () => {
      this.options.onConnectionStateChange?.(this.peerConnection.connectionState);
    };
  }

  async createOffer() {
    await this.attachLocalAudioMedia();

    if (this.options.callKind === 'video') {
      await this.enableCameraTrackOnly();
    }

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await this.peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error('WebRTC offer did not include SDP.');
    }

    return offer.sdp;
  }

  async createAnswer(offerSdp: string) {
    await this.attachLocalAudioMedia();
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
    this.remoteFallbackStream = null;
    this.videoSender = null;
    this.localVideoTrack = null;
    this.pendingIceCandidates.length = 0;
    this.peerConnection.close();
  }

  private async createRenegotiationOffer() {
    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await this.peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error('WebRTC renegotiation offer did not include SDP.');
    }

    return offer.sdp;
  }

  private async enableCamera() {
    if (this.hasCameraEnabled()) {
      return null;
    }

    await this.enableCameraTrackOnly();
    return await this.createRenegotiationOffer();
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

    return await this.createRenegotiationOffer();
  }

  private async attachLocalAudioMedia() {
    const hasLiveAudioTrack = this.localStream
      ?.getAudioTracks()
      .some((track) => track.readyState === 'live');

    if (hasLiveAudioTrack) {
      return;
    }

    if (!isKodiakMicrophoneSecureContext()) {
      throw new Error('Media access requires HTTPS, localhost, or the installed Kodiak Connect app.');
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

    if (!this.localStream) {
      this.localStream = new MediaStream();
    }

    for (const track of audioStream.getAudioTracks()) {
      this.localStream.addTrack(track);
      this.peerConnection.addTrack(track, this.localStream);
    }

    this.options.onLocalStream?.(this.localStream);
  }

  private async enableCameraTrackOnly() {
    if (this.hasCameraEnabled()) {
      return;
    }

    if (!isKodiakMicrophoneSecureContext()) {
      throw new Error('Camera access requires HTTPS, localhost, or the installed Kodiak Connect app.');
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

    this.localStream.addTrack(videoTrack);
    this.localVideoTrack = videoTrack;
    this.videoSender = this.peerConnection.addTrack(videoTrack, this.localStream);
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