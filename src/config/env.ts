const DEFAULT_AUTH_API_BASE_URL = 'https://auth.kodiak-connect.com';
const DEFAULT_MATRIX_BASE_URL = 'https://matrix.kodiak-connect.com';
const DEFAULT_MATRIX_SERVER_NAME = 'kodiak-connect.com';

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function optionalEnv(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export const kodiakEnv = {
  authApiBaseUrl: normalizeBaseUrl(optionalEnv(import.meta.env.VITE_KODIAK_AUTH_API_BASE_URL) ?? DEFAULT_AUTH_API_BASE_URL),
  giphyApiKey: optionalEnv(import.meta.env.VITE_GIPHY_API_KEY),
  matrixBaseUrl: normalizeBaseUrl(optionalEnv(import.meta.env.VITE_MATRIX_BASE_URL) ?? DEFAULT_MATRIX_BASE_URL),
  matrixServerName: optionalEnv(import.meta.env.VITE_MATRIX_SERVER_NAME) ?? DEFAULT_MATRIX_SERVER_NAME,
  turnstileSiteKey: optionalEnv(import.meta.env.VITE_TURNSTILE_SITE_KEY),
};
