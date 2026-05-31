import type { ReactNode } from 'react';
import type { LocalPreviewUser } from '../../features/auth/authTypes';

interface AppFrameProps {
  user: LocalPreviewUser;
  children: ReactNode;
}

export function AppFrame({ user, children }: AppFrameProps) {
  return (
    <div className="app-frame">
      <header className="app-frame__header">
        <div>
          <p className="eyebrow eyebrow--ember">Kodiak Connect</p>
          <h2>Foundation workspace</h2>
        </div>

        <div className="app-frame__user">
          <span>{user.displayName}</span>
        </div>
      </header>

      <div className="app-frame__body">{children}</div>
    </div>
  );
}
