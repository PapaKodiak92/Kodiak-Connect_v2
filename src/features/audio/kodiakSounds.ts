export type KodiakSoundName =
  | 'messageSent'
  | 'messageReceived'
  | 'notify'
  | 'ringingSendCall'
  | 'ringingReceiveCall';

const SOUND_PATHS: Record<KodiakSoundName, string> = {
  messageSent: '/sounds/message_sent.mp3',
  messageReceived: '/sounds/message_received.mp3',
  notify: '/sounds/notify.mp3',
  ringingSendCall: '/sounds/ringing_send_call.mp3',
  ringingReceiveCall: '/sounds/ringing_receive_call.mp3',
};

const audioCache = new Map<KodiakSoundName, HTMLAudioElement>();

function getAudio(soundName: KodiakSoundName) {
  const cachedAudio = audioCache.get(soundName);

  if (cachedAudio) {
    return cachedAudio;
  }

  const audio = new Audio(SOUND_PATHS[soundName]);
  audio.preload = 'auto';
  audio.volume = 0.65;
  audioCache.set(soundName, audio);
  return audio;
}

export function playKodiakSound(soundName: KodiakSoundName, volume = 0.65) {
  try {
    const audio = getAudio(soundName);
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;

    void audio.play().catch(() => {
      // Browsers can block sound until the user has interacted with the page.
      // Do not break chat if that happens.
    });
  } catch {
    // Missing audio files should never break chat.
  }
}
