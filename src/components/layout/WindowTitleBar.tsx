import type { MouseEvent } from 'react';
import { beginWindowMove, closeWindow, minimizeWindow, toggleMaximizeWindow } from '../../platform/desktop/windowControls';
import type { KodiakPlatformKind } from '../../platform/usePlatformInfo';

interface WindowTitleBarProps {
  platformKind: KodiakPlatformKind;
}

export function WindowTitleBar({ platformKind }: WindowTitleBarProps) {
  if (platformKind !== 'desktop') {
    return null;
  }

  function handleTitleBarMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    void beginWindowMove();
  }

  return (
    <header className="window-titlebar" onMouseDown={handleTitleBarMouseDown}>
      <div className="window-titlebar__brand">
        <img src="/kodiak-connect-icon.png" alt="" />
        <span>Kodiak Connect</span>
      </div>

      <div className="window-titlebar__controls" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Minimize window" onClick={() => void minimizeWindow()}>
          _
        </button>
        <button type="button" aria-label="Maximize window" onClick={() => void toggleMaximizeWindow()}>
          []
        </button>
        <button type="button" className="window-titlebar__close" aria-label="Close window" onClick={() => void closeWindow()}>
          X
        </button>
      </div>
    </header>
  );
}
