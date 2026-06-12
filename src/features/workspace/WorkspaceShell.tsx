import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import {
  acceptKodiakFriendRequest,
  blockKodiakUser,
  cancelKodiakFriendRequest,
  declineKodiakFriendRequest,
  loadKodiakBlockState,
  loadKodiakFriendState,
  removeKodiakFriend,
  searchKodiakProfiles,
  sendKodiakFriendRequest,
  unblockKodiakUser,
} from '../backend/kodiakApiClient';
import {
  createDirectMessageRoom,
  joinRoomByAlias,
  loadProfileDisplayName,
  loadRecentMessages,
  loadRecentKodiakCallEvents,
  resolveDirectMessageRoom,
  saveDirectMessageRoom,
} from '../matrix/matrixRestClient';
import { OfficialSpaceAcknowledgementModal } from '../policy/OfficialSpaceAcknowledgementModal';
import {
  hasCurrentOfficialSpaceAcknowledgement,
  saveOfficialSpaceAcknowledgement,
} from '../policy/policyAcknowledgementStorage';
import { playKodiakSound } from '../audio/kodiakSounds';
import { initializeKodiakPushNotifications } from '../notifications/notificationClient';
import { showKodiakDesktopNotification } from '../notifications/kodiakDesktopNotifications';
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

const ACTIVITY_POLL_INTERVAL_MS = 30_000;
const MATRIX_SERVER_NAME = 'kodiak-connect.com';
const SEEDED_USER_LOCALPARTS = ['papakodiak'];
const spaces: WorkspaceSpace[] = [officialSpace];

type FriendStatus = 'none' | 'incoming' | 'outgoing' | 'friends';
type FriendStatusByUserId = Record<string, FriendStatus>;

const GLOBAL_CALL_INVITE_MAX_AGE_MS = 45_000;

type DirectMessageSearchUser = {
  avatarUrl?: string;
  bio?: string;
  displayName: string;
  localpart: string;
  userId: string;
};

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

function getHiddenDirectMessagesKey(userId: string) {
  return `KC_HIDDEN_DMS:${userId}`;
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

function readHiddenDirectMessageChannels(userId: string) {
  try {
    const storedValue = window.localStorage.getItem(getHiddenDirectMessagesKey(userId));

    if (!storedValue) {
      return [];
    }

    return JSON.parse(storedValue) as WorkspaceChannel[];
  } catch {
    return [];
  }
}

function writeHiddenDirectMessageChannels(userId: string, channels: WorkspaceChannel[]) {
  window.localStorage.setItem(getHiddenDirectMessagesKey(userId), JSON.stringify(channels));
}

function mergeUniqueDirectMessageChannels(primaryChannels: WorkspaceChannel[], secondaryChannels: WorkspaceChannel[]) {
  const channelsById = new Map<string, WorkspaceChannel>();

  for (const channel of [...primaryChannels, ...secondaryChannels]) {
    channelsById.set(channel.id, channel);
  }

  return [...channelsById.values()];
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

function areBrowserNotificationsEnabled() {
  return window.localStorage.getItem('KC_BROWSER_NOTIFICATIONS') === 'true';
}

function isNotificationSoundEnabled() {
  return window.localStorage.getItem('KC_NOTIFY_SOUND') !== 'false';
}

function canShowBrowserNotification() {
  return 'Notification' in window && Notification.permission === 'granted' && areBrowserNotificationsEnabled();
}

function getChannelDisplayTitle(channel: WorkspaceChannel) {
  return channel.kind === 'dm' ? channel.name : `#${channel.name}`;
}

function showKodiakBrowserNotification(channel: WorkspaceChannel, messageBody: string, onOpen?: () => void) {
  void showKodiakDesktopNotification({
    title: `Kodiak Connect - ${getChannelDisplayTitle(channel)}`,
    body: messageBody,
    tag: `kodiak-connect-${channel.id}`,
    onClick: onOpen,
  });
}

function getDirectMessageTargetUserId(channel: WorkspaceChannel, currentUserId: string) {
  if (!channel.matrixDmUserId) {
    return null;
  }

  if (channel.matrixDmUserId !== currentUserId) {
    return channel.matrixDmUserId;
  }

  return channel.matrixDmUserId;
}

export function WorkspaceShell({ identity, onLogout }: WorkspaceShellProps) {
  const [activeSpaceId, setActiveSpaceId] = useState(officialSpace.id);
  const [activeChannelId, setActiveChannelId] = useState('general');
  const [isChannelSidebarOpen, setIsChannelSidebarOpen] = useState(() =>
    typeof window === 'undefined' ? true : !window.matchMedia('(max-width: 820px)').matches,
  );
  const [isMemberPanelOpen, setIsMemberPanelOpen] = useState(() =>
    typeof window === 'undefined' ? true : !window.matchMedia('(max-width: 820px)').matches,
  );
  const [directMessageChannels, setDirectMessageChannels] = useState<WorkspaceChannel[]>(() =>
    readStoredDirectMessageChannels(identity.userId),
  );
  const [isStartDmOpen, setIsStartDmOpen] = useState(false);
  const [isFriendCenterOpen, setIsFriendCenterOpen] = useState(false);
  const [dmSearchQuery, setDmSearchQuery] = useState('');
  const [backendUserSearchResults, setBackendUserSearchResults] = useState<DirectMessageSearchUser[]>([]);
  const [dmDisplayNamesByUserId, setDmDisplayNamesByUserId] = useState<Record<string, string>>({});
  const [friendStatusByUserId, setFriendStatusByUserId] = useState<FriendStatusByUserId>({});
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [blockedByUserIds, setBlockedByUserIds] = useState<string[]>([]);
  const friendStatusByUserIdRef = useRef<FriendStatusByUserId>({});
  const [channelActivity, setChannelActivity] = useState<ChannelActivityById>({});
  const [lastSeenByChannel, setLastSeenByChannel] = useState<Record<string, number>>(() => readLastSeenByChannel(identity.userId));
  const globalIncomingCallIdsRef = useRef<Set<string>>(new Set());
  const globalCallStartupBaselineRef = useRef(Date.now());
  const [hasAcknowledgedOfficialSpace, setHasAcknowledgedOfficialSpace] = useState(() =>
    hasCurrentOfficialSpaceAcknowledgement(identity.userId),
  );
  const notifiedLatestTsByChannelRef = useRef<Record<string, number>>({});
  const channelActivityBackoffUntilRef = useRef<Record<string, number>>({});
  const channelActivityRef = useRef<ChannelActivityById>({});
  const lastSeenByChannelRef = useRef<Record<string, number>>(lastSeenByChannel);
  const hasLoadedFriendStateRef = useRef(false);
  const incomingFriendRequestUserIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    friendStatusByUserIdRef.current = friendStatusByUserId;
  }, [friendStatusByUserId]);

  useEffect(() => {
    void initializeKodiakPushNotifications(identity).catch((error) => {
      console.warn('[Kodiak Connect] Push notification setup failed', error);
    });
  }, [identity]);

  useEffect(() => {
    channelActivityRef.current = channelActivity;
  }, [channelActivity]);

  useEffect(() => {
    lastSeenByChannelRef.current = lastSeenByChannel;
  }, [lastSeenByChannel]);

  const restrictedBlockUserIds = useMemo(() => [...new Set([...blockedUserIds, ...blockedByUserIds])], [blockedByUserIds, blockedUserIds]);
  const blockedUserIdSet = useMemo(() => new Set(restrictedBlockUserIds), [restrictedBlockUserIds]);

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
    const usersById = new Map<string, DirectMessageSearchUser>();

    for (const user of backendUserSearchResults) {
      if (user.userId !== identity.userId && !blockedUserIdSet.has(user.userId)) {
        usersById.set(user.userId, user);
      }
    }

    for (const channel of directMessageChannels) {
      if (
        !channel.matrixDmUserId ||
        channel.matrixDmUserId === identity.userId ||
        blockedUserIdSet.has(channel.matrixDmUserId) ||
        usersById.has(channel.matrixDmUserId)
      ) {
        continue;
      }

      usersById.set(channel.matrixDmUserId, {
        displayName: dmDisplayNamesByUserId[channel.matrixDmUserId] || channel.dmDisplayName || channel.name || getDisplayNameFromUserId(channel.matrixDmUserId),
        localpart: getUserLocalpart(channel.matrixDmUserId),
        userId: channel.matrixDmUserId,
      });
    }

    return [...usersById.values()].slice(0, 8);
  }, [backendUserSearchResults, blockedUserIdSet, directMessageChannels, dmDisplayNamesByUserId, identity.userId]);

  useEffect(() => {
    let isActive = true;

    const searchTimerId = window.setTimeout(() => {
      void searchKodiakProfiles(identity, dmSearchQuery, 12)
        .then((profiles) => {
          if (!isActive) {
            return;
          }

          const users = profiles
            .filter((profile) => profile.userId !== identity.userId && !blockedUserIdSet.has(profile.userId))
            .map((profile) => ({
              avatarUrl: profile.avatarUrl,
              bio: profile.bio,
              displayName: profile.displayName || getDisplayNameFromUserId(profile.userId),
              localpart: getUserLocalpart(profile.userId),
              userId: profile.userId,
            }));

          setBackendUserSearchResults(users);

          setDmDisplayNamesByUserId((currentNames) => ({
            ...currentNames,
            ...Object.fromEntries(users.map((user) => [user.userId, user.displayName])),
          }));
        })
        .catch((error) => {
          console.warn('[Kodiak Connect] Backend profile search failed', error);

          if (isActive) {
            setBackendUserSearchResults([]);
          }
        });
    }, 220);

    return () => {
      isActive = false;
      window.clearTimeout(searchTimerId);
    };
  }, [blockedUserIdSet, dmSearchQuery, identity]);

  // Backend profile search powers Start DM. Manual raw Matrix IDs are intentionally not shown in normal search.
  const manualDirectMessageUserId =
    normalizedDmSearchQuery.startsWith('@') && !directMessageSearchResults.some((user) => user.userId.toLowerCase() === normalizedDmSearchQuery)
      ? normalizedDmSearchQuery
      : null;

  const totalUnreadCount = Object.values(channelActivity).reduce((count, activity) => count + (activity.unreadCount ?? 0), 0);
  const incomingFriendRequestCount = Object.values(friendStatusByUserId).filter((status) => status === 'incoming').length;

  useEffect(() => {
    document.title = totalUnreadCount > 0 ? `(${totalUnreadCount}) Kodiak Connect` : 'Kodiak Connect';

    return () => {
      document.title = 'Kodiak Connect';
    };
  }, [totalUnreadCount]);

  useEffect(() => {
    const userIdsToLoad = new Set<string>();

    for (const localpart of SEEDED_USER_LOCALPARTS) {
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

  async function resolveSilentDirectMessageRoom(userId: string, displayName = getDisplayNameFromUserId(userId), createIfMissing = false) {
    const dmCacheKey = getDmRoomCacheKey(identity.userId, userId);
    const cachedRoomId = window.localStorage.getItem(dmCacheKey);
    let roomId = (await resolveDirectMessageRoom(identity, userId, cachedRoomId)) ?? '';

    if (!roomId && createIfMissing) {
      roomId = await createDirectMessageRoom(identity, userId, displayName);
    }

    if (roomId) {
      window.localStorage.setItem(dmCacheKey, roomId);
      await saveDirectMessageRoom(identity, userId, roomId);
    }

    return roomId || null;
  }

  useEffect(() => {
    let isActive = true;

    async function refreshFriendState() {
      try {
        const statuses = await loadKodiakFriendState(identity);

        if (!isActive) {
          return;
        }

        const incomingUserIds = Object.entries(statuses)
          .filter(([, status]) => status === 'incoming')
          .map(([userId]) => userId);

        if (!hasLoadedFriendStateRef.current) {
          hasLoadedFriendStateRef.current = true;
        } else {
          const hasNewIncomingRequest = incomingUserIds.some((userId) => !incomingFriendRequestUserIdsRef.current.has(userId));

          if (hasNewIncomingRequest && window.localStorage.getItem('KC_NOTIFY_SOUND') !== 'false') {
            playKodiakSound('notify', 0.72);
          }
        }

        incomingFriendRequestUserIdsRef.current = new Set(incomingUserIds);
        setFriendStatusByUserId(statuses);
      } catch (error) {
        console.warn('[Kodiak Connect] Backend friend state refresh failed', error);
      }
    }

    void refreshFriendState();

    const intervalId = window.setInterval(() => {
      void refreshFriendState();
    }, 10_000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [identity]);

  useEffect(() => {
    let isActive = true;

    async function refreshBlockState() {
      try {
        const blockState = await loadKodiakBlockState(identity);

        if (isActive) {
          setBlockedUserIds(blockState.blockedUserIds);
          setBlockedByUserIds(blockState.blockedByUserIds);
        }
      } catch (error) {
        console.warn('[Kodiak Connect] Backend block state refresh failed', error);
      }
    }

    void refreshBlockState();

    const intervalId = window.setInterval(() => {
      void refreshBlockState();
    }, 15_000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [identity]);

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
    const currentActivity = channelActivityRef.current;
    const currentLastSeenByChannel = lastSeenByChannelRef.current;
    const currentUserMention = `@${getUserLocalpart(identity.userId)}`;
    const visibleChannels = getChannels(activeSpace);
    const visibleChannelIds = new Set(visibleChannels.map((channel) => channel.id));
    const hiddenDirectMessageChannels = readHiddenDirectMessageChannels(identity.userId).filter(
      (channel) => channel.matrixDmUserId && !visibleChannelIds.has(channel.id),
    );
    const hiddenDirectMessageChannelIds = new Set(hiddenDirectMessageChannels.map((channel) => channel.id));
    const channels = [...visibleChannels, ...hiddenDirectMessageChannels].filter(
      (channel) => !channel.disabled && (channel.matrixAlias || channel.matrixDmUserId),
    );
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

    const activityResults = await Promise.all(
      channels.map(async (channel) => {
        const backoffUntil = channelActivityBackoffUntilRef.current[channel.id] ?? 0;

        if (Date.now() < backoffUntil) {
          return [channel.id, currentActivity[channel.id] ?? { hasMention: false, latestTs: 0, unreadCount: 0 }, null] as const;
        }

        try {
          let roomId = '';
          const directMessageTargetUserId = getDirectMessageTargetUserId(channel, identity.userId);

          if (directMessageTargetUserId) {
            const dmCacheKey = getDmRoomCacheKey(identity.userId, directMessageTargetUserId);
            const cachedDmRoomId = window.localStorage.getItem(dmCacheKey);
            const resolvedDmRoomId = await resolveDirectMessageRoom(identity, directMessageTargetUserId, cachedDmRoomId);

            if (!resolvedDmRoomId) {
              return [channel.id, currentActivity[channel.id] ?? { hasMention: false, latestTs: 0, unreadCount: 0 }, null] as const;
            }

            roomId = resolvedDmRoomId;
            window.localStorage.setItem(dmCacheKey, roomId);
            await saveDirectMessageRoom(identity, directMessageTargetUserId, roomId);
          } else {
            roomId = await joinRoomByAlias(identity, channel.matrixAlias ?? '');
          }

          const recentCallEvents = await loadRecentKodiakCallEvents(identity, roomId, 30);
          const latestIncomingCallInvite = [...recentCallEvents]
            .reverse()
            .find((callEvent) => {
              if (callEvent.status !== 'invite') {
                return false;
              }

              if (callEvent.sender === identity.userId || callEvent.targetUserId !== identity.userId) {
                return false;
              }

              if (globalIncomingCallIdsRef.current.has(callEvent.callId)) {
                return false;
              }

              if (callEvent.createdAt < globalCallStartupBaselineRef.current) {
                return false;
              }

              if (Date.now() - callEvent.createdAt > GLOBAL_CALL_INVITE_MAX_AGE_MS) {
                return false;
              }

              return true;
            });

          if (latestIncomingCallInvite) {
            globalIncomingCallIdsRef.current.add(latestIncomingCallInvite.callId);

            return [
              channel.id,
              currentActivity[channel.id] ?? { hasMention: false, latestTs: 0, unreadCount: 0 },
              {
                body:
                  (latestIncomingCallInvite.callKind === 'video' ? 'Incoming video call from ' : 'Incoming voice call from ') +
                  getChannelDisplayTitle(channel).replace(/^DM\s+/, ''),
                callId: latestIncomingCallInvite.callId,
                channel,
                isCall: true,
                latestTs: latestIncomingCallInvite.createdAt,
              },
            ] as const;
          }

          const recentMessages = await loadRecentMessages(identity, roomId, 25);
          const latestMessage = recentMessages.at(-1);

          if (!latestMessage) {
            return [channel.id, currentActivity[channel.id] ?? { hasMention: false, latestTs: 0, unreadCount: 0 }, null] as const;
          }

          const lastSeenTs = currentLastSeenByChannel[channel.id] ?? 0;
          const unreadMessages = recentMessages.filter(
            (message) => message.originServerTs > lastSeenTs && message.sender !== identity.userId && !blockedUserIdSet.has(message.sender) && !blockedUserIdSet.has(message.sender),
          );

          const isActiveChannel = channel.id === activeChannelId;
          const hasMention = unreadMessages.some((message) => message.body.toLowerCase().includes(currentUserMention));

          const latestIncomingMessage = [...recentMessages]
            .reverse()
            .find((message) => message.sender !== identity.userId && message.originServerTs > (currentActivity[channel.id]?.latestTs ?? 0));

          const shouldNotify =
            !isActiveChannel &&
            Boolean(latestIncomingMessage) &&
            (Boolean(currentActivity[channel.id]?.latestTs) || hiddenDirectMessageChannelIds.has(channel.id)) &&
            latestIncomingMessage!.originServerTs > (notifiedLatestTsByChannelRef.current[channel.id] ?? 0);

          return [
            channel.id,
            {
              hasMention: !isActiveChannel && hasMention,
              latestTs: latestMessage.originServerTs,
              unreadCount: isActiveChannel ? 0 : Math.min(unreadMessages.length, 99),
            },
            shouldNotify && latestIncomingMessage
              ? {
                  body: latestIncomingMessage.body,
                  latestTs: latestIncomingMessage.originServerTs,
                  channel,
                }
              : null,
          ] as const;
        } catch (error) {
          console.warn(`[Kodiak Connect] Channel activity check failed for ${channel.name}`, error);
          return [channel.id, currentActivity[channel.id] ?? { hasMention: false, latestTs: 0, unreadCount: 0 }, null] as const;
        }
      }),
    );

    const activityEntries = activityResults.map(([channelId, activity]) => [channelId, activity] as const);
    const notificationEntries = activityResults.map(([, , notification]) => notification).filter(Boolean);
    const hiddenChannelsToReopen = activityEntries
      .filter(([channelId, activity]) => hiddenDirectMessageChannelIds.has(channelId) && (activity.unreadCount ?? 0) > 0)
      .map(([channelId]) => channelsById.get(channelId))
      .filter((channel): channel is WorkspaceChannel => Boolean(channel));

    if (hiddenChannelsToReopen.length) {
      const reopenedChannelIds = new Set(hiddenChannelsToReopen.map((channel) => channel.id));

      setDirectMessageChannels((currentChannels) => {
        const nextChannels = mergeUniqueDirectMessageChannels(hiddenChannelsToReopen, currentChannels);
        writeStoredDirectMessageChannels(identity.userId, nextChannels);
        return nextChannels;
      });

      const remainingHiddenChannels = readHiddenDirectMessageChannels(identity.userId).filter(
        (channel) => !reopenedChannelIds.has(channel.id),
      );
      writeHiddenDirectMessageChannels(identity.userId, remainingHiddenChannels);
    }

    setChannelActivity((currentActivity) => {
      let hasChanged = false;

      for (const [channelId, nextActivity] of activityEntries) {
        const currentEntry = currentActivity[channelId];

        if (
          !currentEntry ||
          currentEntry.hasMention !== nextActivity.hasMention ||
          currentEntry.latestTs !== nextActivity.latestTs ||
          currentEntry.unreadCount !== nextActivity.unreadCount
        ) {
          hasChanged = true;
          break;
        }
      }

      if (!hasChanged) {
        return currentActivity;
      }

      return {
        ...currentActivity,
        ...Object.fromEntries(activityEntries),
      };
    });

    for (const notification of notificationEntries) {
      if (!notification) {
        continue;
      }

      notifiedLatestTsByChannelRef.current[notification.channel.id] = notification.latestTs;

      if ('isCall' in notification && notification.isCall) {
        setActiveSpaceId(officialSpace.id);
        setActiveChannelId(notification.channel.id);

        showKodiakBrowserNotification(notification.channel, notification.body, () => {
          setActiveSpaceId(officialSpace.id);
          setActiveChannelId(notification.channel.id);
        });

        if (isNotificationSoundEnabled()) {
          playKodiakSound('ringingReceiveCall', 0.7, { force: true });
        }

        continue;
      }

      showKodiakBrowserNotification(notification.channel, notification.body, () => {
        setActiveSpaceId(officialSpace.id);
        setActiveChannelId(notification.channel.id);
        markChannelSeen(notification.channel.id, notification.latestTs);
      });

      if (isNotificationSoundEnabled()) {
        playKodiakSound('notify', 0.7);
      }
    }
  }, [activeChannelId, activeSpace, blockedUserIdSet, identity, markChannelSeen]);

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
      const channelToHide = currentChannels.find((channel) => channel.id === channelId);
      const nextChannels = currentChannels.filter((channel) => channel.id !== channelId);

      if (channelToHide?.kind === 'dm') {
        const hiddenChannels = readHiddenDirectMessageChannels(identity.userId).filter((channel) => channel.id !== channelId);
        writeHiddenDirectMessageChannels(identity.userId, [channelToHide, ...hiddenChannels]);
      }

      writeStoredDirectMessageChannels(identity.userId, nextChannels);
      return nextChannels;
    });

    if (activeChannelId === channelId) {
      setActiveChannelId('general');
    }
  }

  function handleOpenDirectMessage(userId: string, displayName = getDisplayNameFromUserId(userId)) {
    const directMessageChannel = createDirectMessageChannel(userId, dmDisplayNamesByUserId[userId] || displayName);

    writeHiddenDirectMessageChannels(
      identity.userId,
      readHiddenDirectMessageChannels(identity.userId).filter((channel) => channel.id !== directMessageChannel.id),
    );

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

  async function handleSendFriendRequest(userId: string, _displayName = getDisplayNameFromUserId(userId)) {
    const statuses = await sendKodiakFriendRequest(identity, userId);
    setFriendStatusByUserId(statuses);
  }

  async function handleAcceptFriendRequest(userId: string) {
    const statuses = await acceptKodiakFriendRequest(identity, userId);
    setFriendStatusByUserId(statuses);
  }

  async function handleDeclineFriendRequest(userId: string) {
    const statuses = await declineKodiakFriendRequest(identity, userId);
    setFriendStatusByUserId(statuses);
  }

  async function handleCancelFriendRequest(userId: string) {
    const statuses = await cancelKodiakFriendRequest(identity, userId);
    setFriendStatusByUserId(statuses);
  }

  async function handleUnfriendUser(userId: string) {
    const statuses = await removeKodiakFriend(identity, userId);
    setFriendStatusByUserId(statuses);
  }

  async function handleBlockUser(userId: string) {
    const result = await blockKodiakUser(identity, userId);
    setBlockedUserIds(result.blockedUserIds);
    setBlockedByUserIds(result.blockedByUserIds);
    setFriendStatusByUserId(result.statuses);
  }

  async function handleUnblockUser(userId: string) {
    const result = await unblockKodiakUser(identity, userId);
    setBlockedUserIds(result.blockedUserIds);
    setBlockedByUserIds(result.blockedByUserIds);
    setFriendStatusByUserId(result.statuses);
  }

  function handleAcknowledgeOfficialSpace() {
    saveOfficialSpaceAcknowledgement(identity.userId);
    setHasAcknowledgedOfficialSpace(true);
  }

  if (!activeChannel) {
    return null;
  }

  return (
    <main className={`workspace-app-shell ${isChannelSidebarOpen ? '' : 'workspace-app-shell--left-collapsed'} ${isMemberPanelOpen ? '' : 'workspace-app-shell--right-collapsed'}`}>
      <ServerRail
        spaces={spaces}
        activeSpaceId={activeSpace.id}
        isChannelSidebarOpen={isChannelSidebarOpen}
        onSelectSpace={handleSelectSpace}
        onToggleChannelSidebar={() => setIsChannelSidebarOpen((isOpen) => !isOpen)}
      />
      <ChannelSidebar
        activeSpace={activeSpace}
        activeChannelId={activeChannel.id}
        channelActivity={channelActivity}
        onSelectChannel={handleSelectChannel}
        onStartDirectMessage={() => setIsStartDmOpen(true)}
        onOpenFriendCenter={() => setIsFriendCenterOpen(true)}
        onCloseDirectMessage={handleCloseDirectMessage}
        friendCenterCount={incomingFriendRequestCount}
        onLogout={onLogout}
      />
      {activeChannel.matrixAlias || activeChannel.matrixDmUserId ? (
        <MatrixChannelPanel
          activeSpace={activeSpace}
          activeChannel={activeChannel}
          identity={identity}
          blockedByUserIds={blockedByUserIds}
          blockedUserIds={blockedUserIds}
          restrictedUserIds={restrictedBlockUserIds}
          friendStatusByUserId={friendStatusByUserId}
          isMemberPanelOpen={isMemberPanelOpen}
          onToggleMemberPanel={() => setIsMemberPanelOpen((isOpen) => !isOpen)}
          isFriendCenterOpen={isFriendCenterOpen}
          onCloseFriendCenter={() => setIsFriendCenterOpen(false)}
          onOpenDirectMessage={handleOpenDirectMessage}
          onSendFriendRequest={handleSendFriendRequest}
          onAcceptFriendRequest={handleAcceptFriendRequest}
          onDeclineFriendRequest={handleDeclineFriendRequest}
          onCancelFriendRequest={handleCancelFriendRequest}
          onBlockUser={handleBlockUser}
          onUnblockUser={handleUnblockUser}
          onUnfriendUser={handleUnfriendUser}
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
                <p className="kodiak-start-dm-results__empty">Type a username to start a DM.</p>
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






