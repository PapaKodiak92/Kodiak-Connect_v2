const DEFAULT_MATRIX_BASE_URL = 'https://matrix-v2.kodiak-connect.com';
const DEFAULT_MATRIX_SERVER_NAME = 'v2.kodiak-connect.com';

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function optionalEnv(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export const kodiakEnv = {
  matrixBaseUrl: normalizeBaseUrl(optionalEnv(import.meta.env.VITE_MATRIX_BASE_URL) ?? DEFAULT_MATRIX_BASE_URL),
  matrixServerName: optionalEnv(import.meta.env.VITE_MATRIX_SERVER_NAME) ?? DEFAULT_MATRIX_SERVER_NAME,
  turnstileSiteKey: optionalEnv(import.meta.env.VITE_TURNSTILE_SITE_KEY),
};
