import { kodiakPublicConfig } from './kodiakPublicConfig';

const DEFAULT_AUTH_API_BASE_URL = 'https://auth.kodiak-connect.com';
const DEFAULT_KODIAK_API_BASE_URL = 'https://api.kodiak-connect.com';
const DEFAULT_MATRIX_BASE_URL = 'https://matrix.kodiak-connect.com';
const DEFAULT_MATRIX_SERVER_NAME = 'kodiak-connect.com';

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function optionalEnv(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

const apiBaseUrl = normalizeBaseUrl(optionalEnv(import.meta.env.VITE_KODIAK_API_BASE_URL) ?? DEFAULT_KODIAK_API_BASE_URL);

export const kodiakEnv = {
  apiBaseUrl,
  authApiBaseUrl: normalizeBaseUrl(optionalEnv(import.meta.env.VITE_KODIAK_AUTH_API_BASE_URL) ?? DEFAULT_AUTH_API_BASE_URL),
  callsApiBaseUrl: normalizeBaseUrl(optionalEnv(import.meta.env.VITE_KODIAK_CALLS_API_BASE_URL) ?? apiBaseUrl),
  giphyApiKey: optionalEnv(import.meta.env.VITE_GIPHY_API_KEY) ?? kodiakPublicConfig.giphyApiKey,
  matrixBaseUrl: normalizeBaseUrl(optionalEnv(import.meta.env.VITE_MATRIX_BASE_URL) ?? DEFAULT_MATRIX_BASE_URL),
  matrixServerName: optionalEnv(import.meta.env.VITE_MATRIX_SERVER_NAME) ?? DEFAULT_MATRIX_SERVER_NAME,
  mediaApiBaseUrl: normalizeBaseUrl(optionalEnv(import.meta.env.VITE_KODIAK_MEDIA_API_BASE_URL) ?? apiBaseUrl),
  turnstileSiteKey: optionalEnv(import.meta.env.VITE_TURNSTILE_SITE_KEY) ?? kodiakPublicConfig.turnstileSiteKey,
};
