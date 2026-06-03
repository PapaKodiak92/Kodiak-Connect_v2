import type { MouseEvent, ReactNode } from 'react';
import {
  beginWindowMove,
  beginWindowResize,
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
  type KodiakResizeDirection,
} from '../../platform/desktop/windowControls';
import type { KodiakPlatformKind } from '../../platform/usePlatformInfo';

interface WindowTitleBarProps {
  platformKind: KodiakPlatformKind;
}

interface WindowButtonProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  onClick: () => void;
  title: string;
}

const resizeHandles: Array<{ className: string; direction: KodiakResizeDirection }> = [
  { className: 'north', direction: 'North' },
  { className: 'east', direction: 'East' },
  { className: 'south', direction: 'South' },
  { className: 'west', direction: 'West' },
  { className: 'north-east', direction: 'NorthEast' },
  { className: 'north-west', direction: 'NorthWest' },
  { className: 'south-east', direction: 'SouthEast' },
  { className: 'south-west', direction: 'SouthWest' },
];

function WindowButton({ ariaLabel, children, className = '', onClick, title }: WindowButtonProps) {
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      title={title}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function ResizeHandle({ className, direction }: { className: string; direction: KodiakResizeDirection }) {
  return (
    <span
      className={`window-resize-handle window-resize-handle--${className}`}
      aria-hidden="true"
      onMouseDown={(event) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void beginWindowResize(direction);
      }}
    />
  );
}

function MinimizeIcon() {
  return (
    <svg className="window-titlebar__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8h10" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg className="window-titlebar__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="8" height="8" rx="1.2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="window-titlebar__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
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
    <>
      <header className="window-titlebar" onMouseDown={handleTitleBarMouseDown} onDoubleClick={() => void toggleMaximizeWindow()}>
        <div className="window-titlebar__brand">
          <img src="/kodiak-connect-icon.png" alt="" />
          <span>Kodiak Connect</span>
        </div>

        <div className="window-titlebar__controls" onMouseDown={(event) => event.stopPropagation()}>
          <WindowButton ariaLabel="Minimize window" title="Minimize" onClick={() => void minimizeWindow()}>
            <MinimizeIcon />
          </WindowButton>
          <WindowButton ariaLabel="Maximize window" title="Maximize" onClick={() => void toggleMaximizeWindow()}>
            <MaximizeIcon />
          </WindowButton>
          <WindowButton ariaLabel="Close window" title="Close" className="window-titlebar__close" onClick={() => void closeWindow()}>
            <CloseIcon />
          </WindowButton>
        </div>
      </header>

      {resizeHandles.map((handle) => (
        <ResizeHandle key={handle.className} className={handle.className} direction={handle.direction} />
      ))}
    </>
  );
}