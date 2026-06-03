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

const SOUND_COOLDOWNS_MS: Partial<Record<KodiakSoundName, number>> = {
  messageReceived: 1400,
  notify: 2400,
  messageSent: 180,
};

const lastPlayedAtBySound = new Map<KodiakSoundName, number>();
const audioPool = new Map<KodiakSoundName, HTMLAudioElement>();

function getAudio(soundName: KodiakSoundName) {
  const existingAudio = audioPool.get(soundName);

  if (existingAudio) {
    return existingAudio;
  }

  const audio = new Audio(SOUND_PATHS[soundName]);
  audio.preload = 'auto';
  audioPool.set(soundName, audio);
  return audio;
}

export function unlockKodiakSounds() {
  for (const soundName of Object.keys(SOUND_PATHS) as KodiakSoundName[]) {
    try {
      getAudio(soundName).load();
    } catch (error) {
      console.warn('[Kodiak Connect] sound preload failed', soundName, error);
    }
  }
}

export async function playKodiakSound(soundName: KodiakSoundName, volume = 0.65, options?: { force?: boolean }) {
  const now = Date.now();
  const cooldownMs = SOUND_COOLDOWNS_MS[soundName] ?? 0;
  const lastPlayedAt = lastPlayedAtBySound.get(soundName) ?? 0;

  if (!options?.force && cooldownMs && now - lastPlayedAt < cooldownMs) {
    return false;
  }

  lastPlayedAtBySound.set(soundName, now);

  try {
    const audio = getAudio(soundName);
    audio.pause();
    audio.currentTime = 0;
    audio.volume = Math.min(Math.max(volume, 0), 1);

    await audio.play();
    return true;
  } catch (error) {
    console.warn('[Kodiak Connect] sound failed', soundName, error);
    return false;
  }
}
