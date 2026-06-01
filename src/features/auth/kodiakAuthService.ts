import { kodiakEnv } from '../../config/env';

interface SignupStartResponse {
  devVerificationCode?: string;
  emailSent?: boolean;
  expiresAt?: number;
  signupId: string;
}

interface SignupVerifyResponse {
  ok: boolean;
  userId: string;
  username: string;
}

async function postAuth<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${kodiakEnv.authApiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage = 'Kodiak auth request failed.';

    try {
      const errorBody = (await response.json()) as { error?: string };
      errorMessage = errorBody.error || errorMessage;
    } catch {
      // Keep fallback.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

export async function startKodiakEmailSignup(input: {
  email: string;
  password: string;
  turnstileToken?: string;
  username: string;
}) {
  return postAuth<SignupStartResponse>('/api/auth/signup/start', input);
}

export async function verifyKodiakEmailSignup(input: {
  code: string;
  signupId: string;
}) {
  return postAuth<SignupVerifyResponse>('/api/auth/signup/verify', input);
}

export async function resendKodiakEmailSignupCode(signupId: string) {
  return postAuth<Omit<SignupStartResponse, 'signupId'>>('/api/auth/signup/resend', { signupId });
}
