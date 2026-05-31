import { kodiakEnv } from '../../config/env';

interface MatrixLoginResponse {
  access_token?: string;
  device_id?: string;
  user_id?: string;
}

interface MatrixErrorResponse {
  errcode?: string;
  error?: string;
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
