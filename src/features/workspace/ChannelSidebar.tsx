import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

interface ChannelSidebarProps {
  activeChannelId: string;
  activeSpace: WorkspaceSpace;
  onSelectChannel: (channel: WorkspaceChannel) => void;
  onLogout: () => void;
}

function getChannelPrefix(kind: WorkspaceChannel['kind']) {
  if (kind === 'announcement') return '!';
  if (kind === 'safety') return '◆';
  if (kind === 'family') return '⌂';
  if (kind === 'business') return '◈';
  return '#';
}

export function ChannelSidebar({ activeChannelId, activeSpace, onSelectChannel, onLogout }: ChannelSidebarProps) {
  return (
    <aside className="channel-sidebar" aria-label={`${activeSpace.name} channels`}>
      <div className="channel-sidebar__header">
        <div>
          <strong>{activeSpace.name}</strong>
          <p>{activeSpace.description}</p>
        </div>
      </div>

      <nav className="channel-sidebar__sections" aria-label="Channel list">
        {activeSpace.sections.map((section) => (
          <section key={section.id} className="channel-section">
            <h2>{section.title}</h2>

            <div className="channel-section__list">
              {section.channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={`channel-button ${channel.id === activeChannelId ? 'channel-button--active' : ''}`}
                  disabled={channel.disabled}
                  onClick={() => onSelectChannel(channel)}
                >
                  <span aria-hidden="true">{getChannelPrefix(channel.kind)}</span>
                  <span>{channel.name}</span>
                  {channel.disabled ? <small>soon</small> : null}
                </button>
              ))}
            </div>
          </section>
        ))}
      </nav>

      <div className="channel-sidebar__footer">
        <button type="button" disabled>
          Owner Tools Soon
        </button>
        <button type="button" onClick={onLogout}>
          Log Out
        </button>
      </div>
    </aside>
  );
}
