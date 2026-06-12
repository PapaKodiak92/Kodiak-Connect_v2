import type { WorkspaceSpace } from './workspaceTypes';

interface ServerRailProps {
  spaces: WorkspaceSpace[];
  activeSpaceId: string;
  isChannelSidebarOpen: boolean;
  onSelectSpace: (spaceId: string) => void;
  onToggleChannelSidebar: () => void;
}

export function ServerRail({ spaces, activeSpaceId, isChannelSidebarOpen, onToggleChannelSidebar }: ServerRailProps) {
  return (
    <aside className="server-rail" aria-label="Servers and spaces">
      {spaces.map((space) => (
        <button
          key={space.id}
          type="button"
          className={`server-rail__item ${space.id === activeSpaceId ? 'server-rail__item--active' : ''}`}
          aria-label={isChannelSidebarOpen ? 'Collapse channel panel' : 'Open channel panel'}
          aria-pressed={isChannelSidebarOpen}
          title={isChannelSidebarOpen ? 'Collapse channel panel' : 'Open channel panel'}
          onClick={onToggleChannelSidebar}
        >
          <img src={space.iconSrc} alt="" />
        </button>
      ))}

      <button type="button" className="server-rail__item server-rail__item--add" disabled title="Create space coming soon" aria-label="Create space coming soon">
        +
      </button>
    </aside>
  );
}
