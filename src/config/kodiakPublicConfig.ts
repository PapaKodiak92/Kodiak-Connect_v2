export const kodiakPublicConfig = Object.freeze({
  giphyApiKey: 'vJ90ilExdKKuut5GiX99WiyafW8za8O0',
  turnstileSiteKey: '0x4AAAAAADc9V1UVCTmq3KZP',
});

export function getKodiakGiphyApiKey() {
  return kodiakPublicConfig.giphyApiKey;
}

export function getKodiakTurnstileSiteKey() {
  return kodiakPublicConfig.turnstileSiteKey;
}
