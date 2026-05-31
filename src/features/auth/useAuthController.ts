import { useMemo, useState } from 'react';
import type { AuthControllerState, AuthMode, LocalPreviewUser } from './authTypes';

const previewUser: LocalPreviewUser = {
  id: 'local-preview-user',
  displayName: 'Kodiak Preview',
};

export function useAuthController(): AuthControllerState {
  const [mode, setMode] = useState<AuthMode>('local-preview');

  return useMemo(
    () => ({
      mode,
      user: mode === 'local-preview' ? previewUser : null,
      enterLocalPreview: () => setMode('local-preview'),
      signOut: () => setMode('local-preview'),
    }),
    [mode],
  );
}
