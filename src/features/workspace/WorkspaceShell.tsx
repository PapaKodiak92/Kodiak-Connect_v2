import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import { joinRoomByAlias, loadRecentMessages } from '../matrix/matrixRestClient';
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

export function WorkspaceShell({ identity, onLogout }: WorkspaceShellProps) {
  const [activeSpaceId, setActiveSpaceId] = useState(officialSpace.id);
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [channelActivity, setChannelActivity] = useState<ChannelActivityById>({});
  const [lastSeenByChannel, setLastSeenByChannel] = useState<Record<string, number>>(() => readLastSeenByChannel(identity.userId));
  const [hasAcknowledgedOfficialSpace, setHasAcknowledgedOfficialSpace] = useState(() =>
    hasCurrentOfficialSpaceAcknowledgement(identity.userId),
  );

  const activeSpace = useMemo(() => spaces.find((space) => space.id === activeSpaceId) ?? officialSpace, [activeSpaceId]);
  const activeChannel = useMemo(() => {
    return activeSpace.sections.flatMap((section) => section.channels).find((channel) => channel.id === activeChannelId) ?? findInitialChannel(activeSpace);
  }, [activeChannelId, activeSpace]);

  const activeChannelLatestTs = activeChannel ? channelActivity[activeChannel.id]?.latestTs ?? 0 : 0;

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
    const channels = getChannels(activeSpace).filter((channel) => !channel.disabled && channel.matrixAlias);

    const activityEntries = await Promise.all(
      channels.map(async (channel) => {
        try {
          const roomId = await joinRoomByAlias(identity, channel.matrixAlias ?? '');
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
        onLogout={onLogout}
      />
      {activeChannel.matrixAlias ? (
        <MatrixChannelPanel activeSpace={activeSpace} activeChannel={activeChannel} identity={identity} />
      ) : (
        <ChatPlaceholder activeSpace={activeSpace} activeChannel={activeChannel} identity={identity} />
      )}

      {!hasAcknowledgedOfficialSpace ? <OfficialSpaceAcknowledgementModal onAcknowledge={handleAcknowledgeOfficialSpace} /> : null}
    </main>
  );
}
