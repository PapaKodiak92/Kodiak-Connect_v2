import { useRef, useState, type MouseEvent, type TouchEvent } from 'react';
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
  onStartDirectMessage?: () => void;
  onCloseDirectMessage?: (channelId: string) => void;
  onLogout: () => void;
}

function getChannelPrefix(kind: WorkspaceChannel['kind']) {
  if (kind === 'announcement') return '!';
  if (kind === 'safety') return '◆';
  if (kind === 'family') return '⌂';
  if (kind === 'business') return '◈';
  if (kind === 'dm') return '●';
  return '#';
}

export function ChannelSidebar({
  activeChannelId,
  activeSpace,
  channelActivity,
  onSelectChannel,
  onStartDirectMessage,
  onCloseDirectMessage,
  onLogout,
}: ChannelSidebarProps) {
  const [openChannelMenu, setOpenChannelMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);

  function getSafeMenuPosition(clientX: number, clientY: number) {
    const menuWidth = 210;
    const menuHeight = 145;
    const padding = 14;

    return {
      x: Math.min(Math.max(clientX, padding), window.innerWidth - menuWidth - padding),
      y: Math.min(Math.max(clientY, padding), window.innerHeight - menuHeight - padding),
    };
  }

  function clearLongPressTimer() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function openDirectMessageMenu(channel: WorkspaceChannel, clientX: number, clientY: number) {
    if (channel.kind !== 'dm' || !onCloseDirectMessage) {
      return;
    }

    const position = getSafeMenuPosition(clientX, clientY);

    setOpenChannelMenu({
      channelId: channel.id,
      x: position.x,
      y: position.y,
    });
  }

  function handleChannelContextMenu(event: MouseEvent<HTMLButtonElement>, channel: WorkspaceChannel) {
    if (channel.kind !== 'dm') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    openDirectMessageMenu(channel, event.clientX, event.clientY);
  }

  function handleChannelTouchStart(event: TouchEvent<HTMLButtonElement>, channel: WorkspaceChannel) {
    if (channel.kind !== 'dm') {
      return;
    }

    const touch = event.touches[0];

    if (!touch) {
      return;
    }

    clearLongPressTimer();

    longPressTimer.current = window.setTimeout(() => {
      openDirectMessageMenu(channel, touch.clientX, touch.clientY);
    }, 520);
  }

  function closeChannelMenu() {
    clearLongPressTimer();
    setOpenChannelMenu(null);
  }

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
            <div className="channel-section__heading">
              <h2>{section.title}</h2>
              {section.id === 'direct-messages' && onStartDirectMessage ? (
                <button type="button" className="channel-section__start-dm" onClick={onStartDirectMessage}>
                  + Start DM
                </button>
              ) : null}
            </div>

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
                    onContextMenu={(event) => handleChannelContextMenu(event, channel)}
                    onTouchStart={(event) => handleChannelTouchStart(event, channel)}
                    onTouchEnd={clearLongPressTimer}
                    onTouchMove={clearLongPressTimer}
                    onTouchCancel={clearLongPressTimer}
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

      {openChannelMenu ? (
        <>
          <div
            className="channel-sidebar-menu-backdrop"
            role="presentation"
            onClick={closeChannelMenu}
            onMouseDown={(event) => {
              if (event.button === 2) {
                event.preventDefault();
                event.stopPropagation();
                closeChannelMenu();
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeChannelMenu();
            }}
          />
          <div
            className="channel-sidebar-context-menu"
            style={{ left: openChannelMenu.x, top: openChannelMenu.y }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={() => {
                onCloseDirectMessage?.(openChannelMenu.channelId);
                closeChannelMenu();
              }}
            >
              Close chat
            </button>
            <button type="button" disabled>
              Add people soon
            </button>
            <button type="button" className="channel-sidebar-context-menu__danger" disabled>
              Destroy chat soon
            </button>
          </div>
        </>
      ) : null}

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
