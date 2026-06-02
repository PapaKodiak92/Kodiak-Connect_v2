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

export function unlockKodiakSounds() {
  // Kept for compatibility with existing imports/calls.
}

export function playKodiakSound(soundName: KodiakSoundName, volume = 0.65) {
  const source = SOUND_PATHS[soundName];

  console.info('[Kodiak Connect] playing sound', { soundName, source, volume });

  try {
    const audio = new Audio(source);
    audio.volume = Math.min(Math.max(volume, 0), 1);

    void audio.play().then(() => {
      console.info('[Kodiak Connect] sound played', soundName);
    }).catch((error) => {
      console.warn('[Kodiak Connect] sound failed', soundName, error);
    });
  } catch (error) {
    console.warn('[Kodiak Connect] sound setup failed', soundName, error);
  }
}
