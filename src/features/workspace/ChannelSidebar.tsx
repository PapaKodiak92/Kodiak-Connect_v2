import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

export interface ChannelActivity {
  hasMention: boolean;
  latestTs: number;
  unreadCount: number;
}

export type ChannelActivityById = Record<string, ChannelActivity>;

interface ChannelSidebarProps {
  activeChannelId: string;
  activeSpace: WorkspaceSpace;
  channelActivity: ChannelActivityById;
  onSelectChannel: (channel: WorkspaceChannel) => void;
  onLogout: () => void;
}

function getChannelPrefix(kind: WorkspaceChannel['kind']) {
  if (kind === 'announcement') return '!';
  if (kind === 'safety') return '◆';
  if (kind === 'family') return '⌂';
  if (kind === 'business') return '◈';
  if (kind === 'dm') return '@';
  return '#';
}

export function ChannelSidebar({ activeChannelId, activeSpace, channelActivity, onSelectChannel, onLogout }: ChannelSidebarProps) {
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
              {section.channels.map((channel) => {
                const activity = channelActivity[channel.id];
                const hasUnread = Boolean(activity?.unreadCount);
                const hasMention = Boolean(activity?.hasMention);
                const isActive = channel.id === activeChannelId;

                return (
                  <button
                    key={channel.id}
                    type="button"
                    className={`channel-button ${isActive ? 'channel-button--active' : ''} ${hasUnread ? 'channel-button--unread' : ''} ${
                      hasMention ? 'channel-button--mention' : ''
                    }`}
                    disabled={channel.disabled}
                    onClick={() => onSelectChannel(channel)}
                  >
                    <span aria-hidden="true">{getChannelPrefix(channel.kind)}</span>
                    <span className="channel-button__name">{channel.name}</span>
                    {channel.disabled ? <small>soon</small> : null}
                    {!channel.disabled && hasUnread ? (
                      <strong className="channel-button__badge" aria-label={hasMention ? 'Unread mention' : `${activity?.unreadCount} unread messages`}>
                        {hasMention ? '@' : activity?.unreadCount}
                      </strong>
                    ) : null}
                  </button>
                );
              })}
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
