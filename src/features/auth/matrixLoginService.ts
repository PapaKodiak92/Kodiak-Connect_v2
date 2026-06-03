import { kodiakEnv } from '../../config/env';

interface MatrixLoginResponse {
  access_token?: string;
  device_id?: string;
  user_id?: string;
}

interface MatrixWhoAmIResponse {
  device_id?: string;
  user_id?: string;
}

interface MatrixErrorResponse {
  errcode?: string;
  error?: string;
  retry_after_ms?: number;
}

type MatrixLoginIdentifier =
  | {
      type: 'm.id.user';
      user: string;
    }
  | {
      type: 'm.id.thirdparty';
      medium: 'email';
      address: string;
    };

export interface MatrixLoginIdentity {
  accessToken: string;
  baseUrl: string;
  deviceId: string;
  serverName: string;
  userId: string;
}

export class MatrixLoginError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly errcode?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'MatrixLoginError';
  }
}

function isEmailLoginId(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function getMatrixLoginIdentifier(value: string): MatrixLoginIdentifier {
  const trimmed = value.trim();

  if (isEmailLoginId(trimmed)) {
    return {
      type: 'm.id.thirdparty',
      medium: 'email',
      address: trimmed.toLowerCase(),
    };
  }

  if (trimmed.startsWith('@')) {
    return {
      type: 'm.id.user',
      user: trimmed,
    };
  }

  return {
    type: 'm.id.user',
    user: trimmed.toLowerCase(),
  };
}

async function readMatrixError(response: Response) {
  try {
    return (await response.json()) as MatrixErrorResponse;
  } catch {
    return {};
  }
}

const MATRIX_SESSION_STORAGE_KEY = 'KC_MATRIX_LOGIN_IDENTITY';

function isMatrixLoginIdentity(value: unknown): value is MatrixLoginIdentity {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<MatrixLoginIdentity>;

  return (
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.baseUrl === 'string' &&
    candidate.baseUrl.length > 0 &&
    typeof candidate.deviceId === 'string' &&
    candidate.deviceId.length > 0 &&
    typeof candidate.serverName === 'string' &&
    candidate.serverName.length > 0 &&
    typeof candidate.userId === 'string' &&
    candidate.userId.length > 0
  );
}

export function readStoredMatrixLoginIdentity() {
  try {
    const rawIdentity = window.localStorage.getItem(MATRIX_SESSION_STORAGE_KEY);

    if (!rawIdentity) {
      return null;
    }

    const parsedIdentity = JSON.parse(rawIdentity) as unknown;
    return isMatrixLoginIdentity(parsedIdentity) ? parsedIdentity : null;
  } catch {
    return null;
  }
}

export function storeMatrixLoginIdentity(identity: MatrixLoginIdentity) {
  window.localStorage.setItem(MATRIX_SESSION_STORAGE_KEY, JSON.stringify(identity));
}

export function clearStoredMatrixLoginIdentity() {
  window.localStorage.removeItem(MATRIX_SESSION_STORAGE_KEY);
}

export async function validateMatrixLoginIdentity(identity: MatrixLoginIdentity): Promise<MatrixLoginIdentity> {
  const response = await fetch(`${identity.baseUrl}/_matrix/client/v3/account/whoami`, {
    headers: {
      Authorization: `Bearer ${identity.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new MatrixLoginError('Saved session expired. Sign in again.', response.status);
  }

  const data = (await response.json()) as MatrixWhoAmIResponse;

  if (data.user_id && data.user_id !== identity.userId) {
    throw new MatrixLoginError('Saved session belongs to a different Matrix user.');
  }

  return {
    ...identity,
    deviceId: data.device_id || identity.deviceId,
    userId: data.user_id || identity.userId,
  };
}

export async function verifyMatrixLogin(loginId: string, password: string): Promise<MatrixLoginIdentity> {
  const response = await fetch(`${kodiakEnv.matrixBaseUrl}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: getMatrixLoginIdentifier(loginId),
      password,
      initial_device_display_name: 'Kodiak Connect v2 login check',
    }),
  });

  if (!response.ok) {
    const matrixError = await readMatrixError(response);

    throw new MatrixLoginError(
      matrixError.error || 'Unable to sign in. Check your username, email, and password.',
      response.status,
      matrixError.errcode,
      matrixError.retry_after_ms,
    );
  }

  const data = (await response.json()) as MatrixLoginResponse;

  if (!data.access_token || !data.device_id || !data.user_id) {
    throw new MatrixLoginError('Matrix sign-in returned an incomplete response.');
  }

  return {
    accessToken: data.access_token,
    baseUrl: kodiakEnv.matrixBaseUrl,
    deviceId: data.device_id,
    serverName: kodiakEnv.matrixServerName,
    userId: data.user_id,
  };
}
