import { kodiakPlatform } from '../currentPlatform';
import type { KodiakCallPeer, KodiakVoiceCallPeerOptions } from '../../features/calls/kodiakCallPeer';
import { isKodiakWebRtcSupported, KodiakVoiceCallPeer } from './browserWebRtcCall';
import { KodiakNativeLinuxRtcCallPeer } from './kodiakNativeLinuxRtcCall';

export function shouldUsePlatformNativeCallPeer() {
  return (
    kodiakPlatform.info.runtime === 'tauri-desktop' &&
    kodiakPlatform.info.desktopOs === 'linux' &&
    !isKodiakWebRtcSupported()
  );
}

export function createPlatformCallPeer(options: KodiakVoiceCallPeerOptions): KodiakCallPeer {
  if (options.callKind === 'voice' && shouldUsePlatformNativeCallPeer()) {
    return new KodiakNativeLinuxRtcCallPeer(options);
  }

  if (!isKodiakWebRtcSupported()) {
    throw new Error('Kodiak Connect WebRTC is not available in this app runtime.');
  }

  return new KodiakVoiceCallPeer(options);
}