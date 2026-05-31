export type AuthMode = 'signed-out' | 'local-preview' | 'matrix-session';

export interface LocalPreviewUser {
  id: string;
  displayName: string;
}

export interface MatrixSession {
  accessToken: string;
  baseUrl: string;
  deviceId: string;
  serverName: string;
  userId: string;
}

export interface SignInRequest {
  loginId: string;
  password: string;
}

export interface SignInResult {
  session: MatrixSession;
}

export interface AuthControllerState {
  mode: AuthMode;
  user: LocalPreviewUser | null;
  enterLocalPreview: () => void;
  signOut: () => void;
}
