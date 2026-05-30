export type AuthMode = 'signed-out' | 'local-preview';

export interface LocalPreviewUser {
  id: string;
  displayName: string;
}

export interface AuthControllerState {
  mode: AuthMode;
  user: LocalPreviewUser | null;
  enterLocalPreview: () => void;
  signOut: () => void;
}
