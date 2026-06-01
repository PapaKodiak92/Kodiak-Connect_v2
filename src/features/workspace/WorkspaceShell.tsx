import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import { joinRoomByAlias, loadProfileDisplayName, loadRecentMessages, resolveDirectMessageRoom, saveDirectMessageRoom } from '../matrix/matrixRestClient';
import { OfficialSpaceAcknowledgementModal } from '../policy/OfficialSpaceAcknowledgementModal';
import {
  hasCurrentOfficialSpaceAcknowledgement,
  saveOfficialSpaceAcknowledgement,
} from '../policy/policyAcknowledgementStorage';
import { ChannelSidebar, type ChannelActivityById } from './ChannelSidebar';
import { ChatPlaceholder } from './ChatPlaceholder';
import { MatrixChannelPanel } from './MatrixChannelPanel';
import { ServerRail } from './ServerRail';
import { officialSpace } from './workspaceData';
import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

interface WorkspaceShellProps {
  identity: MatrixLoginIdentity;
  onLogout: () => void;
}

const ACTIVITY_POLL_INTERVAL_MS = 12_000;
const MATRIX_SERVER_NAME = 'v2.kodiak-connect.com';
const STAGING_USER_LOCALPARTS = ['papakodiak', 'kodiaktest'];
const spaces: WorkspaceSpace[] = [officialSpace];

function findInitialChannel(space: WorkspaceSpace) {
  return space.sections.flatMap((section) => section.channels).find((channel) => !channel.disabled) ?? space.sections[0]?.channels[0];
}

function getChannels(space: WorkspaceSpace) {
  return space.sections.flatMap((section) => section.channels);
}

function getSeenStorageKey(userId: string) {
  return `KC_CHANNEL_LAST_SEEN:${userId}`;
}

function readLastSeenByChannel(userId: string) {
  try {
    const storedValue = window.localStorage.getItem(getSeenStorageKey(userId));

    if (!storedValue) {
      return {};
    }

    return JSON.parse(storedValue) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeLastSeenByChannel(userId: string, lastSeenByChannel: Record<string, number>) {
  window.localStorage.setItem(getSeenStorageKey(userId), JSON.stringify(lastSeenByChannel));
}

function getUserLocalpart(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0]?.toLowerCase() ?? userId.toLowerCase();
}

function getDisplayNameFromUserId(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
}

function getStoredDirectMessagesKey(userId: string) {
  return `KC_DYNAMIC_DMS:${userId}`;
}

function getDirectMessageChannelId(userId: string) {
  return `dm-${getUserLocalpart(userId)}`;
}

function getMatrixUserIdFromLocalpart(localpart: string) {
  return `@${localpart}:${MATRIX_SERVER_NAME}`;
}

function normalizeDmSearchQuery(query: string) {
  return query
    .trim()
    .replace(/^@/, '')
    .split(':')[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9._-]/g, '') ?? '';
}

function createDirectMessageChannel(userId: string, displayName = getDisplayNameFromUserId(userId)): WorkspaceChannel {
  return {
    id: getDirectMessageChannelId(userId),
    name: displayName,
    kind: 'dm',
    description: `Private direct message with ${displayName}.`,
    matrixDmUserId: userId,
    dmDisplayName: displayName,
  };
}

function readStoredDirectMessageChannels(userId: string) {
  try {
    const storedValue = window.localStorage.getItem(getStoredDirectMessagesKey(userId));

    if (!storedValue) {
      return [];
    }

    return JSON.parse(storedValue) as WorkspaceChannel[];
  } catch {
    return [];
  }
}

function writeStoredDirectMessageChannels(userId: string, channels: WorkspaceChannel[]) {
  window.localStorage.setItem(getStoredDirectMessagesKey(userId), JSON.stringify(channels));
}

function mergeDirectMessagesIntoSpace(space: WorkspaceSpace, directMessageChannels: WorkspaceChannel[]): WorkspaceSpace {
  const existingDmChannels = space.sections.find((section) => section.id === 'direct-messages')?.channels ?? [];
  const channelsById = new Map<string, WorkspaceChannel>();

  for (const channel of [...existingDmChannels, ...directMessageChannels]) {
    channelsById.set(channel.id, channel);
  }

  const mergedDmChannels = [...channelsById.values()];
  const hasDirectMessageSection = space.sections.some((section) => section.id === 'direct-messages');

  return {
    ...space,
    sections: hasDirectMessageSection
      ? space.sections.map((section) =>
          section.id === 'direct-messages'
            ? {
                ...section,
                channels: mergedDmChannels,
              }
            : section,
        )
      : [
          ...space.sections.slice(0, 1),
          {
            id: 'direct-messages',
            title: 'Direct Messages',
            channels: mergedDmChannels,
          },
          ...space.sections.slice(1),
        ],
  };
}

function getDmRoomCacheKey(currentUserId: string, targetUserId: string) {
  return `KC_DM_ROOM:${[currentUserId, targetUserId].sort().join('|')}`;
}

function getDirectMessageTargetUserId(channel: WorkspaceChannel, currentUserId: string) {
  if (!channel.matrixDmUserId) {
    return null;
  }

  if (channel.matrixDmUserId !== currentUserId) {
    return channel.matrixDmUserId;
  }

  if (currentUserId.toLowerCase().startsWith('@kodiaktest:')) {
    return '@papakodiak:v2.kodiak-connect.com';
  }

  return channel.matrixDmUserId;
}

export function WorkspaceShell({ identity, onLogout }: WorkspaceShellProps) {
  const [activeSpaceId, setActiveSpaceId] = useState(officialSpace.id);
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [directMessageChannels, setDirectMessageChannels] = useState<WorkspaceChannel[]>(() =>
    readStoredDirectMessageChannels(identity.userId),
  );
  const [isStartDmOpen, setIsStartDmOpen] = useState(false);
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const [dmDisplayNamesByUserId, setDmDisplayNamesByUserId] = useState<Record<string, string>>({});
  const [channelActivity, setChannelActivity] = useState<ChannelActivityById>({});
  const [lastSeenByChannel, setLastSeenByChannel] = useState<Record<string, number>>(() => readLastSeenByChannel(identity.userId));
  const [hasAcknowledgedOfficialSpace, setHasAcknowledgedOfficialSpace] = useState(() =>
    hasCurrentOfficialSpaceAcknowledgement(identity.userId),
  );

  const activeSpace = useMemo(() => {
    const selectedSpace = spaces.find((space) => space.id === activeSpaceId) ?? officialSpace;
    return mergeDirectMessagesIntoSpace(selectedSpace, directMessageChannels);
  }, [activeSpaceId, directMessageChannels]);
  const activeChannel = useMemo(() => {
    return activeSpace.sections.flatMap((section) => section.channels).find((channel) => channel.id === activeChannelId) ?? findInitialChannel(activeSpace);
  }, [activeChannelId, activeSpace]);

  const activeChannelLatestTs = activeChannel ? channelActivity[activeChannel.id]?.latestTs ?? 0 : 0;
  const normalizedDmSearchQuery = normalizeDmSearchQuery(dmSearchQuery);
  const directMessageSearchResults = useMemo(() => {
    const usersById = new Map<string, { displayName: string; localpart: string; userId: string }>();

    for (const localpart of STAGING_USER_LOCALPARTS) {
      const userId = getMatrixUserIdFromLocalpart(localpart);

      if (userId !== identity.userId) {
        usersById.set(userId, {
          displayName: dmDisplayNamesByUserId[userId] || getDisplayNameFromUserId(userId),
          localpart,
          userId,
        });
      }
    }

    for (const channel of directMessageChannels) {
      if (!channel.matrixDmUserId || channel.matrixDmUserId === identity.userId) {
        continue;
      }

      usersById.set(channel.matrixDmUserId, {
        displayName: dmDisplayNamesByUserId[channel.matrixDmUserId] || channel.dmDisplayName || channel.name || getDisplayNameFromUserId(channel.matrixDmUserId),
        localpart: getUserLocalpart(channel.matrixDmUserId),
        userId: channel.matrixDmUserId,
      });
    }

    const users = [...usersById.values()];

    if (!normalizedDmSearchQuery) {
      return users.slice(0, 8);
    }

    return users
      .filter((user) => {
        return user.localpart.includes(normalizedDmSearchQuery) || user.displayName.toLowerCase().includes(normalizedDmSearchQuery);
      })
      .slice(0, 8);
  }, [directMessageChannels, dmDisplayNamesByUserId, identity.userId, normalizedDmSearchQuery]);

  const manualDirectMessageUserId =
    normalizedDmSearchQuery && !directMessageSearchResults.some((user) => user.localpart === normalizedDmSearchQuery)
      ? getMatrixUserIdFromLocalpart(normalizedDmSearchQuery)
      : null;

  useEffect(() => {
    const userIdsToLoad = new Set<string>();

    for (const localpart of STAGING_USER_LOCALPARTS) {
      const userId = getMatrixUserIdFromLocalpart(localpart);

      if (userId !== identity.userId) {
        userIdsToLoad.add(userId);
      }
    }

    for (const channel of directMessageChannels) {
      if (channel.matrixDmUserId && channel.matrixDmUserId !== identity.userId) {
        userIdsToLoad.add(channel.matrixDmUserId);
      }
    }

    const missingUserIds = [...userIdsToLoad].filter((userId) => !dmDisplayNamesByUserId[userId]);

    if (!missingUserIds.length) {
      return;
    }

    let isActive = true;

    void Promise.all(
      missingUserIds.map(async (userId) => {
        try {
          const displayName = await loadProfileDisplayName(identity, userId);
          return [userId, displayName || getDisplayNameFromUserId(userId)] as const;
        } catch {
          return [userId, getDisplayNameFromUserId(userId)] as const;
        }
      }),
    ).then((entries) => {
      if (!isActive) {
        return;
      }

      setDmDisplayNamesByUserId((currentNames) => ({
        ...currentNames,
        ...Object.fromEntries(entries),
      }));
    });

    return () => {
      isActive = false;
    };
  }, [directMessageChannels, dmDisplayNamesByUserId, identity]);

  const markChannelSeen = useCallback(
    (channelId: string, latestTs: number) => {
      if (!latestTs) {
        return;
      }

      setLastSeenByChannel((currentLastSeen) => {
        if ((currentLastSeen[channelId] ?? 0) >= latestTs) {
          return currentLastSeen;
        }

        const nextLastSeen = {
          ...currentLastSeen,
          [channelId]: latestTs,
        };

        writeLastSeenByChannel(identity.userId, nextLastSeen);
        return nextLastSeen;
      });

      setChannelActivity((currentActivity) => ({
        ...currentActivity,
        [channelId]: {
          ...(currentActivity[channelId] ?? { latestTs }),
          hasMention: false,
          latestTs,
          unreadCount: 0,
        },
      }));
    },
    [identity.userId],
  );

  const refreshChannelActivity = useCallback(async () => {
    const currentUserMention = `@${getUserLocalpart(identity.userId)}`;
    const channels = getChannels(activeSpace).filter(
      (channel) => !channel.disabled && (channel.matrixAlias || channel.matrixDmUserId),
    );

    const activityEntries = await Promise.all(
      channels.map(async (channel) => {
        try {
          let roomId = '';
          const directMessageTargetUserId = getDirectMessageTargetUserId(channel, identity.userId);

          if (directMessageTargetUserId) {
            const dmCacheKey = getDmRoomCacheKey(identity.userId, directMessageTargetUserId);
            const cachedDmRoomId = window.localStorage.getItem(dmCacheKey);
            const resolvedDmRoomId = await resolveDirectMessageRoom(identity, directMessageTargetUserId, cachedDmRoomId);

            if (!resolvedDmRoomId) {
              return [channel.id, channelActivity[channel.id] ?? { hasMention: false, latestTs: 0, unreadCount: 0 }] as const;
            }

            roomId = resolvedDmRoomId;
            window.localStorage.setItem(dmCacheKey, roomId);
            await saveDirectMessageRoom(identity, directMessageTargetUserId, roomId);
          } else {
            roomId = await joinRoomByAlias(identity, channel.matrixAlias ?? '');
          }

          const recentMessages = await loadRecentMessages(identity, roomId, 25);
          const latestMessage = recentMessages.at(-1);

          if (!latestMessage) {
            return [channel.id, channelActivity[channel.id] ?? { hasMention: false, latestTs: 0, unreadCount: 0 }] as const;
          }

          const lastSeenTs = lastSeenByChannel[channel.id] ?? 0;
          const unreadMessages = recentMessages.filter(
            (message) => message.originServerTs > lastSeenTs && message.sender !== identity.userId,
          );

          const isActiveChannel = channel.id === activeChannelId;
          const hasMention = unreadMessages.some((message) => message.body.toLowerCase().includes(currentUserMention));

          return [
            channel.id,
            {
              hasMention: !isActiveChannel && hasMention,
              latestTs: latestMessage.originServerTs,
              unreadCount: isActiveChannel ? 0 : Math.min(unreadMessages.length, 99),
            },
          ] as const;
        } catch (error) {
          console.warn(`[Kodiak Connect] Channel activity check failed for ${channel.name}`, error);
          return [channel.id, channelActivity[channel.id] ?? { hasMention: false, latestTs: 0, unreadCount: 0 }] as const;
        }
      }),
    );

    setChannelActivity((currentActivity) => ({
      ...currentActivity,
      ...Object.fromEntries(activityEntries),
    }));
  }, [activeChannelId, activeSpace, channelActivity, identity, lastSeenByChannel]);

  useEffect(() => {
    void refreshChannelActivity();

    const intervalId = window.setInterval(() => {
      void refreshChannelActivity();
    }, ACTIVITY_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshChannelActivity]);

  useEffect(() => {
    if (!activeChannel || !activeChannelLatestTs) {
      return;
    }

    markChannelSeen(activeChannel.id, activeChannelLatestTs);
  }, [activeChannel, activeChannelLatestTs, markChannelSeen]);

  function handleSelectSpace(spaceId: string) {
    const nextSpace = spaces.find((space) => space.id === spaceId);

    if (!nextSpace) {
      return;
    }

    setActiveSpaceId(spaceId);

    const firstChannel = findInitialChannel(nextSpace);
    if (firstChannel) {
      setActiveChannelId(firstChannel.id);
    }
  }

  function handleSelectChannel(channel: WorkspaceChannel) {
    if (channel.disabled) {
      return;
    }

    const activity = channelActivity[channel.id];

    if (activity?.latestTs) {
      markChannelSeen(channel.id, activity.latestTs);
    }

    setActiveChannelId(channel.id);
  }

  function handleCloseDirectMessage(channelId: string) {
    setDirectMessageChannels((currentChannels) => {
      const nextChannels = currentChannels.filter((channel) => channel.id !== channelId);
      writeStoredDirectMessageChannels(identity.userId, nextChannels);
      return nextChannels;
    });

    if (activeChannelId === channelId) {
      setActiveChannelId('general');
    }
  }

  function handleOpenDirectMessage(userId: string, displayName = getDisplayNameFromUserId(userId)) {
    const directMessageChannel = createDirectMessageChannel(userId, dmDisplayNamesByUserId[userId] || displayName);

    setDirectMessageChannels((currentChannels) => {
      const withoutDuplicate = currentChannels.filter((channel) => channel.id !== directMessageChannel.id);
      const nextChannels = [directMessageChannel, ...withoutDuplicate];

      writeStoredDirectMessageChannels(identity.userId, nextChannels);
      return nextChannels;
    });

    setActiveSpaceId(officialSpace.id);
    setActiveChannelId(directMessageChannel.id);
  }

  function handleStartDirectMessage(userId: string, displayName = getDisplayNameFromUserId(userId)) {
    handleOpenDirectMessage(userId, dmDisplayNamesByUserId[userId] || displayName);
    setDmSearchQuery('');
    setIsStartDmOpen(false);
  }

  function handleAcknowledgeOfficialSpace() {
    saveOfficialSpaceAcknowledgement(identity.userId);
    setHasAcknowledgedOfficialSpace(true);
  }

  if (!activeChannel) {
    return null;
  }

  return (
    <main className="workspace-app-shell">
      <ServerRail spaces={spaces} activeSpaceId={activeSpace.id} onSelectSpace={handleSelectSpace} />
      <ChannelSidebar
        activeSpace={activeSpace}
        activeChannelId={activeChannel.id}
        channelActivity={channelActivity}
        onSelectChannel={handleSelectChannel}
        onStartDirectMessage={() => setIsStartDmOpen(true)}
        onCloseDirectMessage={handleCloseDirectMessage}
        onLogout={onLogout}
      />
      {activeChannel.matrixAlias || activeChannel.matrixDmUserId ? (
        <MatrixChannelPanel
          activeSpace={activeSpace}
          activeChannel={activeChannel}
          identity={identity}
          onOpenDirectMessage={handleOpenDirectMessage}
        />
      ) : (
        <ChatPlaceholder activeSpace={activeSpace} activeChannel={activeChannel} identity={identity} />
      )}

      {isStartDmOpen ? (
        <div className="kodiak-modal-backdrop" role="presentation" onClick={() => setIsStartDmOpen(false)}>
          <div
            className="kodiak-start-dm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-dm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kodiak-start-dm-modal__header">
              <p className="eyebrow eyebrow--ember">Direct Messages</p>
              <h2 id="start-dm-title">Start a DM</h2>
              <p>Search known users or enter a username to open a private conversation.</p>
            </div>

            <label className="kodiak-start-dm-modal__search">
              <span>Search user</span>
              <input
                type="text"
                value={dmSearchQuery}
                onChange={(event) => setDmSearchQuery(event.target.value)}
                placeholder="Search display name or username"
                autoFocus
              />
            </label>

            <div className="kodiak-start-dm-results">
              {directMessageSearchResults.map((user) => (
                <button key={user.userId} type="button" onClick={() => handleStartDirectMessage(user.userId, user.displayName)}>
                  <strong>{user.displayName}</strong>
                  <span>Known user</span>
                </button>
              ))}

              {manualDirectMessageUserId && manualDirectMessageUserId !== identity.userId ? (
                <button
                  type="button"
                  className="kodiak-start-dm-results__manual"
                  onClick={() => handleStartDirectMessage(manualDirectMessageUserId, getDisplayNameFromUserId(manualDirectMessageUserId))}
                >
                  <strong>Start DM with {getDisplayNameFromUserId(manualDirectMessageUserId)}</strong>
                  <span>Username lookup</span>
                </button>
              ) : null}

              {!directMessageSearchResults.length && !manualDirectMessageUserId ? (
                <p className="kodiak-start-dm-results__empty">Type a username like kodiaktest to start a DM.</p>
              ) : null}
            </div>

            <div className="kodiak-start-dm-modal__actions">
              <button type="button" onClick={() => setIsStartDmOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!hasAcknowledgedOfficialSpace ? <OfficialSpaceAcknowledgementModal onAcknowledge={handleAcknowledgeOfficialSpace} /> : null}
    </main>
  );
}
