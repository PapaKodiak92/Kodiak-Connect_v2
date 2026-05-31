import type { ReactNode } from 'react';
import type { LocalPreviewUser } from '../../features/auth/authTypes';

interface AppFrameProps {
  user: LocalPreviewUser;
  onExit: () => void;
  children: ReactNode;
}

export function AppFrame({ user, onExit, children }: AppFrameProps) {
  return (
    <div className="app-frame">
      <header className="app-frame__header">
        <div>
          <p className="eyebrow">Kodiak Connect</p>
          <h2>Foundation workspace</h2>
        </div>

        <div className="app-frame__user">
          <span>{user.displayName}</span>
          <button type="button" onClick={onExit}>
            Exit preview
          </button>
        </div>
      </header>

      <div className="app-frame__body">{children}</div>
    </div>
  );
}
