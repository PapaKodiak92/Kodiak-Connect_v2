import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import {
  createDirectMessageRoom,
  findDirectMessageRoom,
  resolveDirectMessageRoom,
  getAuthenticatedMatrixMediaObjectUrl,
  getMatrixMediaUrl,
  joinRoomByAlias,
  joinRoomById,
  loadProfileAvatarUrl,
  loadProfileDisplayName,
  loadUserPresence,
  loadRecentMessages,
  loadRoomMembers,
  loadRecentProfileBios,
  saveDirectMessageRoom,
  loadTypingUsers,
  MatrixRestError,
  redactMessage,
  sendProfileBio,
  sendReaction,
  saveOwnAvatarUrl,
  saveOwnDisplayName,
  sendReplacementMessage,
  uploadProfileAvatar,
  sendTextMessage,
  sendTypingState,
  setOwnPresence,
  type MatrixTextMessage,
} from '../matrix/matrixRestClient';
import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

interface MatrixChannelPanelProps {
  activeChannel: WorkspaceChannel;
  activeSpace: WorkspaceSpace;
  identity: MatrixLoginIdentity;
  onOpenDirectMessage?: (userId: string, displayName: string) => void;
}

interface MentionSearch {
  query: string;
  startIndex: number;
}

interface MentionSuggestion {
  displayName: string;
  localpart: string;
  userId: string;
}

interface ParsedReplyContext {
  eventId?: string;
  preview: string;
  sender: string;
}

interface ParsedMessageBody {
  body: string;
  reply?: ParsedReplyContext;
}

const REPLY_EVENT_PREFIX = 'KC_REPLY_EVENT=';
const REPLY_SENDER_PREFIX = 'KC_REPLY_SENDER=';
const REPLY_PREVIEW_PREFIX = 'KC_REPLY_PREVIEW=';
const MENTION_PATTERN = /(^|\s)(@[a-zA-Z0-9._-]{2,32})/g;
const ACTIVE_MENTION_PATTERN = /(^|\s)@([a-zA-Z0-9._-]{0,32})$/;
const REACTION_OPTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F525}', '\u{1F440}'];
const PLATFORM_MODERATOR_IDS = ['@papakodiak:v2.kodiak-connect.com'];
const MESSAGE_POLL_INTERVAL_MS = 5000;
const TYPING_POLL_INTERVAL_MS = 2500;
const TYPING_TIMEOUT_MS = 5000;
const TYPING_IDLE_STOP_MS = 2500;
const RESERVED_DISPLAY_NAMES = new Set([
  'admin',
  'administrator',
  'moderator',
  'mod',
  'support',
  'system',
  'kodiak',
  'kodiak connect',
  'kodiakconnect',
  'official',
  'security',
  'trustandsafety',
]);

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

  // Staging fallback: when logged in as kodiaktest, the fixed test DM should point back to papakodiak.
  if (currentUserId.toLowerCase().startsWith('@kodiaktest:')) {
    return '@papakodiak:v2.kodiak-connect.com';
  }

  return channel.matrixDmUserId;
}

function normalizeDisplayName(displayName: string) {
  return displayName.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getDisplayName(userId: string) {
  const withoutPrefix = userId.startsWith('@') ? userId.slice(1) : userId;
  return withoutPrefix.split(':')[0] || userId;
}

function getUserLocalpart(userId: string) {
  return getDisplayName(userId).toLowerCase();
}

function formatMessageTime(timestamp: number) {
  if (!timestamp) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function getMatrixErrorMessage(error: unknown, activeChannel: WorkspaceChannel) {
  if (error instanceof MatrixRestError) {
    if (error.errcode === 'M_NOT_FOUND' || error.status === 404) {
      return `This Matrix room does not exist yet. Create #${activeChannel.name} on staging.`;
    }

    if (error.errcode === 'M_FORBIDDEN' || error.status === 403) {
      return 'You do not have access to this Matrix room yet.';
    }

    return error.message;
  }

  return 'Kodiak Connect could not reach the Matrix room.';
}

function canModerateMessages(userId: string) {
  return PLATFORM_MODERATOR_IDS.includes(userId);
}

function canPostInChannel(channel: WorkspaceChannel, userId: string) {
  if (!channel.readOnly) {
    return true;
  }

  return channel.allowedPosterIds?.includes(userId) ?? false;
}

function getComposerPlaceholder(channel: WorkspaceChannel, canPost: boolean, roomId: string | null, replyTarget: MatrixTextMessage | null) {
  if (!roomId) {
    return 'Room unavailable';
  }

  if (!canPost) {
    return 'Read-only official channel';
  }

  if (replyTarget) {
    return `Reply to ${getDisplayName(replyTarget.sender)}`;
  }

  if (channel.readOnly) {
    return `Post official update in #${channel.name}`;
  }

  return `Message ${channel.kind === 'dm' ? '@' : '#'}${channel.name}`;
}

function getEmptyState(channel: WorkspaceChannel, canPost: boolean) {
  if (channel.kind === 'dm') {
    return 'No messages yet. Send the first direct message.';
  }

  if (channel.id === 'dev-updates') {
    return canPost
      ? 'No development updates yet. Post the first curated changelog when ready.'
      : 'No development updates yet. Official Kodiak updates will appear here.';
  }

  if (channel.id === 'announcements') {
    return canPost ? 'No announcements yet. Publish the first official announcement when ready.' : 'No announcements yet.';
  }

  return 'No messages yet. Send the first message in Official Space.';
}

function getShortMessagePreview(body: string, maxLength = 52) {
  const compactBody = body.replace(/\s+/g, ' ').trim();
  return compactBody.length > maxLength ? `${compactBody.slice(0, maxLength).trim()}...` : compactBody;
}

function parseKeyedReplyBody(body: string): ParsedMessageBody | null {
  if (!body.startsWith(REPLY_EVENT_PREFIX)) {
    return null;
  }

  const [metadataBlock, ...bodyParts] = body.split('\n\n');
  const metadataLines = metadataBlock.split('\n');
  const eventId = metadataLines.find((line) => line.startsWith(REPLY_EVENT_PREFIX))?.slice(REPLY_EVENT_PREFIX.length);
  const sender = metadataLines.find((line) => line.startsWith(REPLY_SENDER_PREFIX))?.slice(REPLY_SENDER_PREFIX.length);
  const preview = metadataLines.find((line) => line.startsWith(REPLY_PREVIEW_PREFIX))?.slice(REPLY_PREVIEW_PREFIX.length);
  const messageBody = bodyParts.join('\n\n').trim();

  if (!sender || !preview || !messageBody) {
    return null;
  }

  return {
    body: messageBody,
    reply: {
      eventId,
      preview: getShortMessagePreview(preview, 52),
      sender,
    },
  };
}

function parseLegacyReplyBody(body: string): ParsedMessageBody | null {
  const match = body.match(/^Replying to ([^:]+): ([\s\S]+?)\n\n([\s\S]+)$/);

  if (!match) {
    return null;
  }

  return {
    body: match[3].trim(),
    reply: {
      preview: getShortMessagePreview(match[2], 52),
      sender: match[1],
    },
  };
}

function parseMessageBody(body: string): ParsedMessageBody {
  return parseKeyedReplyBody(body) ?? parseLegacyReplyBody(body) ?? { body };
}

function buildReplyBody(replyTarget: MatrixTextMessage | null, body: string) {
  if (!replyTarget) {
    return body;
  }

  const parsedTarget = parseMessageBody(replyTarget.body);

  return [
    `${REPLY_EVENT_PREFIX}${replyTarget.eventId}`,
    `${REPLY_SENDER_PREFIX}${getDisplayName(replyTarget.sender)}`,
    `${REPLY_PREVIEW_PREFIX}${getShortMessagePreview(parsedTarget.body, 52)}`,
    '',
    body,
  ].join('\n');
}

function getActiveMentionSearch(draftMessage: string): MentionSearch | null {
  const match = draftMessage.match(ACTIVE_MENTION_PATTERN);

  if (!match) {
    return null;
  }

  return {
    query: match[2].toLowerCase(),
    startIndex: draftMessage.length - match[2].length - 1,
  };
}

function getMentionSuggestions(
  messages: MatrixTextMessage[],
  currentUserLocalpart: string,
  search: MentionSearch | null,
  displayNamesByUserId: Record<string, string>,
) {
  if (!search) {
    return [];
  }

  const suggestionsByLocalpart = new Map<string, MentionSuggestion>();

  for (const message of messages) {
    const localpart = getUserLocalpart(message.sender);

    if (!localpart || localpart === currentUserLocalpart || suggestionsByLocalpart.has(localpart)) {
      continue;
    }

    suggestionsByLocalpart.set(localpart, {
      displayName: displayNamesByUserId[message.sender] || getDisplayName(message.sender),
      localpart,
      userId: message.sender,
    });
  }

  return [...suggestionsByLocalpart.values()]
    .filter((suggestion) => {
      const query = search.query.toLowerCase();
      return suggestion.localpart.includes(query) || suggestion.displayName.toLowerCase().includes(query);
    })
    .slice(0, 6);
}

function applyMentionSuggestion(draftMessage: string, search: MentionSearch | null, suggestion: MentionSuggestion) {
  if (!search) {
    return draftMessage;
  }

  return `${draftMessage.slice(0, search.startIndex)}@${suggestion.localpart} `;
}

function hasUserReacted(message: MatrixTextMessage, reactionKey: string, userId: string) {
  return message.reactions?.some((reaction) => reaction.key === reactionKey && reaction.senders.includes(userId)) ?? false;
}

function getTypingIndicatorText(typingNames: string[]) {
  if (typingNames.length === 0) {
    return '';
  }

  if (typingNames.length === 1) {
    return `${typingNames[0]} is typing`;
  }

  if (typingNames.length === 2) {
    return `${typingNames[0]} and ${typingNames[1]} are typing`;
  }

  return `${typingNames[0]} and ${typingNames.length - 1} others are typing`;
}

function renderMessageTextWithMentions(
  body: string,
  currentUserLocalpart: string,
  displayNamesByLocalpart: Record<string, string>,
): ReactNode[] {
  const renderedParts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MENTION_PATTERN.lastIndex = 0;

  while ((match = MENTION_PATTERN.exec(body)) !== null) {
    const fullMatch = match[0];
    const leadingWhitespace = match[1] ?? '';
    const mention = match[2];
    const mentionStart = match.index + leadingWhitespace.length;

    if (mentionStart > lastIndex) {
      renderedParts.push(body.slice(lastIndex, mentionStart));
    }

    const mentionLocalpart = mention.slice(1).toLowerCase();
    const isMentioningCurrentUser = mentionLocalpart === currentUserLocalpart;
    const visibleMentionName = displayNamesByLocalpart[mentionLocalpart] ?? mention.slice(1);

    renderedParts.push(
      <span key={`${mention}-${mentionStart}`} className={`matrix-mention ${isMentioningCurrentUser ? 'matrix-mention--self' : ''}`}>
        {visibleMentionName}
      </span>,
    );

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < body.length) {
    renderedParts.push(body.slice(lastIndex));
  }

  return renderedParts;
}

export function MatrixChannelPanel({
  activeChannel,
  activeSpace,
  identity,
  onOpenDirectMessage,
}: MatrixChannelPanelProps) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MatrixTextMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [replyTarget, setReplyTarget] = useState<MatrixTextMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<MatrixTextMessage | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<MatrixTextMessage | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [roomMemberUserIds, setRoomMemberUserIds] = useState<string[]>([]);
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, 'online' | 'offline' | 'unavailable'>>({});
  const [isMemberPanelOpen, setIsMemberPanelOpen] = useState(true);
  const [displayNamesByUserId, setDisplayNamesByUserId] = useState<Record<string, string>>({});
  const [avatarUrlsByUserId, setAvatarUrlsByUserId] = useState<Record<string, string>>({});
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [profileBiosByUserId, setProfileBiosByUserId] = useState<Record<string, string>>({});
  const [bioDraft, setBioDraft] = useState('');
  const [openProfileUserId, setOpenProfileUserId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsErrorText, setSettingsErrorText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const messageElementRefs = useRef<Record<string, HTMLElement | null>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pollingTimer = useRef<number | null>(null);
  const typingPollTimer = useRef<number | null>(null);
  const typingStopTimer = useRef<number | null>(null);
  const typingSinceBatchRef = useRef<string | undefined>(undefined);
  const isTypingSentRef = useRef(false);

  const displayName = getDisplayName(identity.userId);
  const currentUserLocalpart = getUserLocalpart(identity.userId);
  const activeMentionSearch = getActiveMentionSearch(draftMessage);
  const mentionSuggestions = getMentionSuggestions(messages, currentUserLocalpart, activeMentionSearch, displayNamesByUserId);
  const canPost = canPostInChannel(activeChannel, identity.userId);
  const canModerate = canModerateMessages(identity.userId);
  const openActionMenuMessage = openActionMenu ? messages.find((message) => message.eventId === openActionMenu.messageId) ?? null : null;
  const openActionMenuParsedMessage = openActionMenuMessage ? parseMessageBody(openActionMenuMessage.body) : null;
  function getKnownDisplayName(userId: string) {
    return displayNamesByUserId[userId] || getDisplayName(userId);
  }

  function getKnownAvatarUrl(userId: string) {
    return avatarUrlsByUserId[userId] || null;
  }

  function getMemberRoleLabel(userId: string) {
    if (userId === identity.userId) {
      return 'You';
    }

    if (canModerateMessages(userId)) {
      return 'Owner';
    }

    return 'Member';
  }

  function getKnownPresence(userId: string) {
    if (userId === identity.userId) {
      return presenceByUserId[userId] ?? 'online';
    }

    return presenceByUserId[userId] ?? 'offline';
  }

  function getPresenceLabel(userId: string) {
    const presence = getKnownPresence(userId);

    if (presence === 'online') {
      return 'Online';
    }

    if (presence === 'unavailable') {
      return 'Idle';
    }

    return 'Offline';
  }

  function getAvatarInitials(displayName: string) {
    const compactName = displayName.trim();

    if (!compactName) {
      return '?';
    }

    const parts = compactName.split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return compactName.slice(0, 2).toUpperCase();
  }

  function renderUserAvatar(userId: string, className = '') {
    const avatarUrl = getKnownAvatarUrl(userId);
    const displayName = getKnownDisplayName(userId);

    return (
      <span className={`matrix-avatar ${className}`} aria-hidden="true">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{getAvatarInitials(displayName)}</span>}
      </span>
    );
  }

  const displayNamesByLocalpart = Object.fromEntries(
    Object.entries(displayNamesByUserId).map(([userId, displayName]) => [getUserLocalpart(userId), displayName]),
  );

  const typingIndicatorText = typingUserIds.length
    ? getTypingIndicatorText(typingUserIds.map((userId) => getKnownDisplayName(userId)))
    : '';
  const channelHeadingPrefix = activeChannel.kind === 'dm' ? '' : '#';
  const channelEyebrowLabel = activeChannel.kind === 'dm' ? 'Direct Message' : activeSpace.name;
  const headerDisplayName = getKnownDisplayName(identity.userId);

  const refreshProfileBios = useCallback(
    async (targetRoomId: string) => {
      const biosByUserId = await loadRecentProfileBios(identity, targetRoomId);

      setProfileBiosByUserId((currentBios) => {
        let hasChanged = false;
        const nextBios = { ...currentBios };

        for (const [userId, bio] of Object.entries(biosByUserId)) {
          if (nextBios[userId] !== bio) {
            nextBios[userId] = bio;
            hasChanged = true;
          }
        }

        return hasChanged ? nextBios : currentBios;
      });
    },
    [identity],
  );

  const refreshMessages = useCallback(
    async (targetRoomId: string) => {
      const recentMessages = await loadRecentMessages(identity, targetRoomId);
      setMessages(recentMessages);

      void refreshProfileBios(targetRoomId).catch((error) => {
        console.warn('[Kodiak Connect] Failed to refresh profile bios', error);
      });
    },
    [identity, refreshProfileBios],
  );

  const stopTyping = useCallback(async () => {
    if (!roomId || !isTypingSentRef.current) {
      return;
    }

    isTypingSentRef.current = false;

    try {
      await sendTypingState(identity, roomId, false);
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to stop Matrix typing notification', error);
    }
  }, [identity, roomId]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
  }, [activeChannel.id]);

  useEffect(() => {
    let isActive = true;
    const userIdsToLoad = new Set<string>([identity.userId]);

    for (const message of messages) {
      userIdsToLoad.add(message.sender);

      for (const reaction of message.reactions ?? []) {
        for (const sender of reaction.senders) {
          userIdsToLoad.add(sender);
        }
      }
    }

    for (const userId of typingUserIds) {
      userIdsToLoad.add(userId);
    }

    for (const userId of roomMemberUserIds) {
      userIdsToLoad.add(userId);
    }

    const userIdsToRefresh = [...userIdsToLoad];

    if (!userIdsToRefresh.length) {
      return () => {
        isActive = false;
      };
    }

    void Promise.all(
      userIdsToRefresh.map(async (userId) => {
        try {
          const displayName = await loadProfileDisplayName(identity, userId);
          return [userId, displayName || getDisplayName(userId)] as const;
        } catch {
          return [userId, getDisplayName(userId)] as const;
        }
      }),
    ).then((entries) => {
      if (!isActive) {
        return;
      }

      setDisplayNamesByUserId((currentNames) => {
        let hasChanged = false;
        const nextNames = { ...currentNames };

        for (const [userId, displayName] of entries) {
          if (nextNames[userId] !== displayName) {
            nextNames[userId] = displayName;
            hasChanged = true;
          }
        }

        return hasChanged ? nextNames : currentNames;
      });
    });

    return () => {
      isActive = false;
    };
  }, [displayNamesByUserId, identity, messages, roomMemberUserIds, typingUserIds]);

  useEffect(() => {
    let isActive = true;
    const userIdsToLoad = new Set<string>([identity.userId]);

    for (const message of messages) {
      userIdsToLoad.add(message.sender);

      for (const reaction of message.reactions ?? []) {
        for (const sender of reaction.senders) {
          userIdsToLoad.add(sender);
        }
      }
    }

    for (const userId of typingUserIds) {
      userIdsToLoad.add(userId);
    }

    for (const userId of roomMemberUserIds) {
      userIdsToLoad.add(userId);
    }

    const userIdsToRefresh = [...userIdsToLoad];

    void Promise.all(
      userIdsToRefresh.map(async (userId) => {
        try {
          const avatarMxcUrl = await loadProfileAvatarUrl(identity, userId);
          return [userId, (await getAuthenticatedMatrixMediaObjectUrl(identity, avatarMxcUrl, 96, 96)) ?? ''] as const;
        } catch {
          return [userId, ''] as const;
        }
      }),
    ).then((entries) => {
      if (!isActive) {
        return;
      }

      setAvatarUrlsByUserId((currentAvatars) => {
        let hasChanged = false;
        const nextAvatars = { ...currentAvatars };

        for (const [userId, avatarUrl] of entries) {
          if (nextAvatars[userId] !== avatarUrl) {
            nextAvatars[userId] = avatarUrl;
            hasChanged = true;
          }
        }

        return hasChanged ? nextAvatars : currentAvatars;
      });
    });

    return () => {
      isActive = false;
    };
  }, [avatarUrlsByUserId, identity, messages, roomMemberUserIds, typingUserIds]);

  useEffect(() => {
    if (openProfileUserId && roomId) {
      void refreshProfileBios(roomId).catch((error) => {
        console.warn('[Kodiak Connect] Failed to refresh profile bio on profile open', error);
      });
    }
  }, [openProfileUserId, refreshProfileBios, roomId]);

  useEffect(() => {
    if (!roomId) {
      return undefined;
    }

    let isActive = true;

    void loadRecentProfileBios(identity, roomId).then((biosByUserId) => {
      if (!isActive) {
        return;
      }

      setProfileBiosByUserId((currentBios) => ({
        ...currentBios,
        ...biosByUserId,
      }));
    }).catch((error) => {
      console.warn('[Kodiak Connect] Failed to load profile bios', error);
    });

    return () => {
      isActive = false;
    };
  }, [identity, messages.length, roomId]);

  useEffect(() => {
    setDisplayNameDraft(getKnownDisplayName(identity.userId));
    setBioDraft(profileBiosByUserId[identity.userId] ?? '');
  }, [displayNamesByUserId, identity.userId, profileBiosByUserId]);

  useEffect(() => {
    let isActive = true;

    async function connectRoom() {
      if (!activeChannel.matrixAlias && !activeChannel.matrixDmUserId) {
        setIsLoading(false);
        setRoomId(null);
        setErrorText('This channel is not connected to Matrix yet.');
        return;
      }

      setIsLoading(true);
      setErrorText(null);
      setReplyTarget(null);
      setEditingMessage(null);
      setOpenActionMenu(null);
      setPendingDeleteMessage(null);
      setTypingUserIds([]);
      typingSinceBatchRef.current = undefined;
      isTypingSentRef.current = false;

      try {
        let joinedRoomId = '';

        const directMessageTargetUserId = getDirectMessageTargetUserId(activeChannel, identity.userId);

        if (directMessageTargetUserId) {
          const dmCacheKey = getDmRoomCacheKey(identity.userId, directMessageTargetUserId);
          const cachedRoomId = window.localStorage.getItem(dmCacheKey);

          joinedRoomId = (await resolveDirectMessageRoom(identity, directMessageTargetUserId, cachedRoomId)) ?? '';

          if (!joinedRoomId) {
            joinedRoomId = await createDirectMessageRoom(
              identity,
              directMessageTargetUserId,
              activeChannel.dmDisplayName ?? getDisplayName(directMessageTargetUserId),
            );
          }

          window.localStorage.setItem(dmCacheKey, joinedRoomId);
          await saveDirectMessageRoom(identity, directMessageTargetUserId, joinedRoomId);
        } else {
          joinedRoomId = await joinRoomByAlias(identity, activeChannel.matrixAlias ?? '');
        }

        if (!isActive) {
          return;
        }

        setRoomId(joinedRoomId);
        await refreshMessages(joinedRoomId);
      } catch (error) {
        if (!isActive) {
          return;
        }

        console.error('[Kodiak Connect] Failed to connect Matrix room', error);
        setRoomId(null);
        setMessages([]);
        setErrorText(getMatrixErrorMessage(error, activeChannel));
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void connectRoom();

    return () => {
      isActive = false;
    };
  }, [activeChannel, activeChannel.matrixAlias, identity, refreshMessages]);

  useEffect(() => {
    void setOwnPresence(identity, 'online');

    const handleBeforeUnload = () => {
      void setOwnPresence(identity, 'offline');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void setOwnPresence(identity, 'offline');
    };
  }, [identity]);

  useEffect(() => {
    if (!roomMemberUserIds.length) {
      return undefined;
    }

    let isActive = true;

    async function refreshMemberPresence() {
      const presenceEntries = await Promise.all(
        roomMemberUserIds.map(async (userId) => {
          if (userId === identity.userId) {
            return [userId, 'online'] as const;
          }

          return [userId, await loadUserPresence(identity, userId)] as const;
        }),
      );

      if (!isActive) {
        return;
      }

      setPresenceByUserId((currentPresence) => {
        let hasChanged = false;
        const nextPresence = { ...currentPresence };

        for (const [userId, presence] of presenceEntries) {
          if (nextPresence[userId] !== presence) {
            nextPresence[userId] = presence;
            hasChanged = true;
          }
        }

        return hasChanged ? nextPresence : currentPresence;
      });
    }

    void refreshMemberPresence();

    const presenceIntervalId = window.setInterval(() => {
      void refreshMemberPresence();
    }, 10000);

    return () => {
      isActive = false;
      window.clearInterval(presenceIntervalId);
    };
  }, [identity, roomMemberUserIds]);

  useEffect(() => {
    if (!roomId) {
      setRoomMemberUserIds([]);
      return undefined;
    }

    let isActive = true;

    async function refreshRoomMembers() {
      if (!roomId) {
        return;
      }

      try {
        const members = await loadRoomMembers(identity, roomId);

        if (!isActive) {
          return;
        }

        setRoomMemberUserIds(
          members
            .map((member) => member.userId)
            .filter(Boolean)
            .sort((a, b) => {
              if (a === identity.userId) return -1;
              if (b === identity.userId) return 1;

              const roleRankA = canModerateMessages(a) ? 0 : 1;
              const roleRankB = canModerateMessages(b) ? 0 : 1;

              if (roleRankA !== roleRankB) {
                return roleRankA - roleRankB;
              }

              return getKnownDisplayName(a).localeCompare(getKnownDisplayName(b));
            }),
        );

        setDisplayNamesByUserId((currentNames) => {
          let hasChanged = false;
          const nextNames = { ...currentNames };

          for (const member of members) {
            if (member.displayName && nextNames[member.userId] !== member.displayName) {
              nextNames[member.userId] = member.displayName;
              hasChanged = true;
            }
          }

          return hasChanged ? nextNames : currentNames;
        });

        setAvatarUrlsByUserId((currentAvatars) => {
          let hasChanged = false;
          const nextAvatars = { ...currentAvatars };

          for (const member of members) {
            if (member.avatarUrl && !nextAvatars[member.userId]) {
              hasChanged = true;
            }
          }

          return hasChanged ? nextAvatars : currentAvatars;
        });
      } catch (error) {
        console.warn('[Kodiak Connect] Failed to load room members', error);
      }
    }

    void refreshRoomMembers();

    const memberIntervalId = window.setInterval(() => {
      void refreshRoomMembers();
    }, 15000);

    return () => {
      isActive = false;
      window.clearInterval(memberIntervalId);
    };
  }, [identity, roomId]);

  useEffect(() => {
    if (!roomId) {
      return undefined;
    }

    pollingTimer.current = window.setInterval(() => {
      void refreshMessages(roomId).catch((error) => {
        console.error('[Kodiak Connect] Matrix room refresh failed', error);
      });
    }, MESSAGE_POLL_INTERVAL_MS);

    return () => {
      if (pollingTimer.current) {
        window.clearInterval(pollingTimer.current);
      }
    };
  }, [refreshMessages, roomId]);

  useEffect(() => {
    if (!roomId) {
      return undefined;
    }

    async function refreshTypingUsers() {
      if (!roomId) {
        return;
      }

      try {
        const typingState = await loadTypingUsers(identity, roomId, typingSinceBatchRef.current);
        typingSinceBatchRef.current = typingState.nextBatch ?? typingSinceBatchRef.current;

        if (typingState.userIds) {
          setTypingUserIds(typingState.userIds.filter((userId) => userId !== identity.userId));
        }
      } catch (error) {
        console.warn('[Kodiak Connect] Matrix typing poll failed', error);
      }
    }

    void refreshTypingUsers();

    typingPollTimer.current = window.setInterval(() => {
      void refreshTypingUsers();
    }, TYPING_POLL_INTERVAL_MS);

    return () => {
      if (typingPollTimer.current) {
        window.clearInterval(typingPollTimer.current);
      }
    };
  }, [identity, roomId]);

  useEffect(() => {
    if (!roomId || !canPost) {
      return undefined;
    }

    if (typingStopTimer.current) {
      window.clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
    }

    if (!draftMessage.trim()) {
      void stopTyping();
      return undefined;
    }

    if (!isTypingSentRef.current) {
      isTypingSentRef.current = true;
      void sendTypingState(identity, roomId, true, TYPING_TIMEOUT_MS).catch((error) => {
        isTypingSentRef.current = false;
        console.warn('[Kodiak Connect] Failed to send Matrix typing notification', error);
      });
    }

    typingStopTimer.current = window.setTimeout(() => {
      void stopTyping();
    }, TYPING_IDLE_STOP_MS);

    return () => {
      if (typingStopTimer.current) {
        window.clearTimeout(typingStopTimer.current);
      }
    };
  }, [canPost, draftMessage, identity, roomId, stopTyping]);

  useEffect(() => {
    return () => {
      void stopTyping();
    };
  }, [stopTyping]);

  useEffect(() => {
    const messageList = messageListRef.current;

    if (!messageList || !shouldStickToBottomRef.current) {
      return;
    }

    messageList.scrollTop = messageList.scrollHeight;
  }, [messages, activeChannel.id]);

  function findMessageForDomTarget(target: EventTarget | null) {
    const element = target instanceof HTMLElement ? target : null;
    const messageElement = element?.closest<HTMLElement>('[data-message-event-id]');
    const eventId = messageElement?.dataset.messageEventId;

    if (!eventId) {
      return null;
    }

    return messages.find((message) => message.eventId === eventId) ?? null;
  }

  function handleMessageListContextMenu(event: MouseEvent<HTMLDivElement>) {
    const message = findMessageForDomTarget(event.target);

    if (!message) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openMessageActionMenu(message, event.clientX, event.clientY);
  }

  function handleMessageListScroll() {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    const distanceFromBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 160;
  }

  function handleJumpToMessage(eventId?: string) {
    if (!eventId) {
      return;
    }

    const targetElement = messageElementRefs.current[eventId];

    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
    targetElement.classList.add('matrix-message--focused');

    window.setTimeout(() => {
      targetElement.classList.remove('matrix-message--focused');
    }, 1600);
  }

  function insertMentionSuggestion(suggestion: MentionSuggestion) {
    setDraftMessage((currentDraft) => applyMentionSuggestion(currentDraft, getActiveMentionSearch(currentDraft), suggestion));
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Tab' || mentionSuggestions.length === 0) {
      return;
    }

    event.preventDefault();
    insertMentionSuggestion(mentionSuggestions[0]);
  }

  function getSafeMenuPosition(clientX: number, clientY: number) {
    const menuWidth = 230;
    const menuHeight = 210;
    const padding = 14;

    return {
      x: Math.min(Math.max(clientX, padding), window.innerWidth - menuWidth - padding),
      y: Math.min(Math.max(clientY, padding), window.innerHeight - menuHeight - padding),
    };
  }

  function closeMessageActionMenu() {
    setOpenActionMenu(null);
  }

  function openMessageActionMenu(message: MatrixTextMessage, clientX: number, clientY: number) {
    if (!canPost && !onOpenDirectMessage) {
      return;
    }

    const position = getSafeMenuPosition(clientX, clientY);

    setOpenActionMenu({
      messageId: message.eventId,
      x: position.x,
      y: position.y,
    });

    setReactionPickerMessageId(null);
  }

  function startEditingMessage(message: MatrixTextMessage) {
    const parsedMessage = parseMessageBody(message.body);

    setEditingMessage({ ...message, body: parsedMessage.body });
    setReplyTarget(null);
    setReactionPickerMessageId(null);
    setOpenActionMenu(null);
    setDraftMessage(parsedMessage.body);
  }

  function cancelEditingMessage() {
    setEditingMessage(null);
    setDraftMessage('');
  }

  function requestDeleteMessage(message: MatrixTextMessage) {
    if (!roomId || (!canModerate && message.sender !== identity.userId)) {
      return;
    }

    setPendingDeleteMessage(message);
    setOpenActionMenu(null);
    setReactionPickerMessageId(null);
  }

  function closeDeleteConfirmation() {
    setPendingDeleteMessage(null);
  }

  async function confirmDeleteMessage() {
    const message = pendingDeleteMessage;

    if (!roomId || !message || (!canModerate && message.sender !== identity.userId)) {
      return;
    }

    setErrorText(null);

    try {
      await redactMessage(
        identity,
        roomId,
        message.eventId,
        message.sender === identity.userId ? 'User deleted message' : 'Moderator deleted message',
      );
      setPendingDeleteMessage(null);
      setReactionPickerMessageId(null);
      setOpenActionMenu(null);
      await refreshMessages(roomId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to delete Matrix message', error);
      setErrorText(getMatrixErrorMessage(error, activeChannel));
    }
  }

  async function handleReactToMessage(message: MatrixTextMessage, reactionKey: string) {
    if (!roomId || !canPost || hasUserReacted(message, reactionKey, identity.userId)) {
      return;
    }

    setErrorText(null);

    try {
      await sendReaction(identity, roomId, message.eventId, reactionKey);
      setReactionPickerMessageId(null);
      await refreshMessages(roomId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to send Matrix reaction', error);
      setErrorText(getMatrixErrorMessage(error, activeChannel));
    }
  }

  function handleAvatarFileChange(file: File | null) {
    setSettingsErrorText(null);

    if (!file) {
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      return;
    }

    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
    const maxSizeBytes = 2 * 1024 * 1024;

    if (!allowedTypes.has(file.type)) {
      setSettingsErrorText('Profile picture must be a PNG, JPG, JPEG, or WEBP image.');
      return;
    }

    if (file.size > maxSizeBytes) {
      setSettingsErrorText('Profile picture must be 2 MB or smaller.');
      return;
    }

    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
  }

  async function handleSaveAccountSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextDisplayName = displayNameDraft.trim();

    if (!nextDisplayName) {
      setSettingsErrorText('Display name cannot be empty.');
      return;
    }

    if (nextDisplayName.length > 32) {
      setSettingsErrorText('Display name must be 32 characters or less.');
      return;
    }

    const nextBio = bioDraft.trim();

    if (nextBio.length > 180) {
      setSettingsErrorText('Bio must be 180 characters or less.');
      return;
    }

    const normalizedNextDisplayName = normalizeDisplayName(nextDisplayName);

    if (RESERVED_DISPLAY_NAMES.has(normalizedNextDisplayName)) {
      setSettingsErrorText('That display name is reserved.');
      return;
    }

    const duplicateDisplayNameUser = Object.entries(displayNamesByUserId).find(([userId, displayName]) => {
      return userId !== identity.userId && normalizeDisplayName(displayName) === normalizedNextDisplayName;
    });

    if (duplicateDisplayNameUser) {
      setSettingsErrorText('That display name is already taken.');
      return;
    }

    setIsSavingSettings(true);
    setSettingsErrorText(null);

    try {
      const currentDisplayName = getKnownDisplayName(identity.userId);

      if (normalizeDisplayName(currentDisplayName) !== normalizedNextDisplayName) {
        await saveOwnDisplayName(identity, nextDisplayName);

        setDisplayNamesByUserId((currentNames) => ({
          ...currentNames,
          [identity.userId]: nextDisplayName,
        }));
      }

      let savedAvatarUrl = avatarUrlsByUserId[identity.userId] ?? '';

      if (avatarFile) {
        try {
          const avatarMxcUrl = await uploadProfileAvatar(identity, avatarFile);
          await saveOwnAvatarUrl(identity, avatarMxcUrl);

          const authenticatedAvatarUrl = await getAuthenticatedMatrixMediaObjectUrl(identity, avatarMxcUrl, 96, 96).catch(() => null);
          savedAvatarUrl = authenticatedAvatarUrl ?? avatarPreviewUrl ?? savedAvatarUrl;

          setAvatarUrlsByUserId((currentAvatars) => ({
            ...currentAvatars,
            [identity.userId]: savedAvatarUrl,
          }));
        } catch (avatarError) {
          console.error('[Kodiak Connect] Failed to save profile picture', avatarError);
          const isRateLimited = avatarError instanceof MatrixRestError && avatarError.status === 429;
          const avatarErrorMessage = avatarError instanceof Error ? avatarError.message : 'Unknown avatar upload error.';

          setSettingsErrorText(
            isRateLimited
              ? 'Matrix is rate-limiting profile picture uploads. Wait about a minute, then press Save again.'
              : `Display name saved, but profile picture could not be saved. ${avatarErrorMessage}`,
          );
          return;
        }
      }

      if (roomId) {
        try {
          await sendProfileBio(identity, roomId, nextBio);
        } catch (bioError) {
          console.error('[Kodiak Connect] Failed to save profile bio', bioError);
          setSettingsErrorText('Profile saved, but bio could not be published. Try again in a moment.');
          return;
        }
      }

      setProfileBiosByUserId((currentBios) => ({
        ...currentBios,
        [identity.userId]: nextBio,
      }));
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setIsSettingsOpen(false);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to save profile settings', error);
      setSettingsErrorText('Could not save profile settings. Try again.');
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = draftMessage.trim();

    if (!roomId || !trimmedMessage || !canPost) {
      return;
    }

    setIsSending(true);
    setErrorText(null);

    try {
      await stopTyping();

      if (editingMessage) {
        await sendReplacementMessage(identity, roomId, editingMessage.eventId, trimmedMessage);
        setEditingMessage(null);
      } else {
        await sendTextMessage(identity, roomId, buildReplyBody(replyTarget, trimmedMessage));
      }

      setDraftMessage('');
      setReplyTarget(null);
      await refreshMessages(roomId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to send Matrix message', error);
      setErrorText(getMatrixErrorMessage(error, activeChannel));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="chat-placeholder" aria-label={`${activeChannel.name} channel`}>
      <header className="chat-placeholder__header">
        <div>
          <p className="eyebrow eyebrow--ember">{channelEyebrowLabel}</p>
          <h1>{channelHeadingPrefix}{activeChannel.name}</h1>
          <p>{activeChannel.description}</p>
        </div>

        <button
          type="button"
          className="chat-placeholder__user chat-placeholder__user--button"
          onClick={() => {
            setDisplayNameDraft(getKnownDisplayName(identity.userId));
            setAvatarFile(null);
            setAvatarPreviewUrl(null);
            setBioDraft(profileBiosByUserId[identity.userId] ?? '');
            setSettingsErrorText(null);
            setIsSettingsOpen(true);
          }}
        >
          {renderUserAvatar(identity.userId, 'matrix-avatar--pill')}
          <span className="status-light status-light--online" aria-hidden="true" />
          <span>{headerDisplayName}</span>
        </button>
      </header>

      <div className={`matrix-channel-content ${isMemberPanelOpen ? '' : 'matrix-channel-content--members-collapsed'}`}>
      <div className="matrix-chat-body">
        {errorText ? (
          <div className="matrix-chat-status matrix-chat-status--error">
            <span className="status-light status-light--offline" aria-hidden="true" />
            <span>{errorText}</span>
          </div>
        ) : null}

        {isLoading ? (
          <div className="matrix-empty-state">Loading #{activeChannel.name}...</div>
        ) : messages.length ? (
          <div
            ref={messageListRef}
            className="matrix-message-list"
            aria-label="Message history"
            onContextMenuCapture={handleMessageListContextMenu}
            onScroll={handleMessageListScroll}
          >
            {messages.map((message) => {
              const parsedMessage = parseMessageBody(message.body);
              const isOwnMessage = message.sender === identity.userId;

              return (
                <div key={message.eventId} className={`matrix-message-group ${isOwnMessage ? 'matrix-message-group--own' : ''}`}>
                  {parsedMessage.reply ? (
                    <button
                      type="button"
                      className="matrix-reply-thread-link"
                      onClick={() => handleJumpToMessage(parsedMessage.reply?.eventId)}
                      disabled={!parsedMessage.reply.eventId}
                      title={`Replying to ${parsedMessage.reply.sender}: ${parsedMessage.reply.preview}`}
                    >
                      <span className="matrix-reply-thread-link__arrow" aria-hidden="true">↪</span>
                      <strong>{parsedMessage.reply.sender}</strong>
                      <span className="matrix-reply-thread-link__separator" aria-hidden="true">·</span>
                      <span className="matrix-reply-thread-link__preview">{parsedMessage.reply.preview}</span>
                    </button>
                  ) : null}

                  <article
                    ref={(element) => {
                      messageElementRefs.current[message.eventId] = element;
                    }}
                    className={`matrix-message ${isOwnMessage ? 'matrix-message--own' : ''}`}
                    data-message-event-id={message.eventId}
                  >
                    <button
                      type="button"
                      className="matrix-profile-trigger matrix-message__avatar-slot"
                      onClick={() => setOpenProfileUserId(message.sender)}
                    >
                      {renderUserAvatar(message.sender, 'matrix-avatar--message')}
                    </button>

                    <div className="matrix-message__content">
                      <header className="matrix-message__meta">
                        <button
                          type="button"
                          className="matrix-profile-trigger matrix-profile-trigger--name"
                          onClick={() => setOpenProfileUserId(message.sender)}
                        >
                          <strong>{getKnownDisplayName(message.sender)}</strong>
                        </button>
                        <time>{formatMessageTime(message.originServerTs)}</time>
                      </header>
                      <p>{renderMessageTextWithMentions(parsedMessage.body, currentUserLocalpart, displayNamesByLocalpart)}</p>
                    {message.editedAt ? <span className="matrix-message__edited">edited</span> : null}

                    {message.reactions?.length ? (
                      <div className="matrix-reactions" aria-label="Message reactions">
                        {message.reactions.map((reaction) => (
                          <button
                            key={reaction.key}
                            type="button"
                            className={hasUserReacted(message, reaction.key, identity.userId) ? 'matrix-reaction--mine' : undefined}
                            onClick={() => void handleReactToMessage(message, reaction.key)}
                            title={reaction.senders.map(getKnownDisplayName).join(', ')}
                          >
                            <span>{reaction.key}</span>
                            <strong>{reaction.count}</strong>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {reactionPickerMessageId === message.eventId ? (
                      <div className="matrix-reaction-picker" aria-label="Choose a reaction">
                        {REACTION_OPTIONS.map((reactionKey) => (
                          <button key={reactionKey} type="button" onClick={() => void handleReactToMessage(message, reactionKey)}>
                            {reactionKey}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="matrix-empty-state">{getEmptyState(activeChannel, canPost)}</div>
        )}
      </div>

      <aside className={`matrix-member-panel ${isMemberPanelOpen ? '' : 'matrix-member-panel--collapsed'}`} aria-label="Room members">
        <button
          type="button"
          className="matrix-member-panel__toggle"
          aria-label={isMemberPanelOpen ? 'Hide member panel' : 'Show member panel'}
          title={isMemberPanelOpen ? 'Hide members' : 'Show members'}
          onClick={() => setIsMemberPanelOpen((isOpen) => !isOpen)}
        >
          {isMemberPanelOpen ? '›' : '‹'}
        </button>

        <div className="matrix-member-panel__inner">
        <div className="matrix-member-panel__header">
          <span>Members</span>
          <strong>{roomMemberUserIds.length}</strong>
        </div>

        <div className="matrix-member-list">
          {roomMemberUserIds.map((userId) => (
            <button key={userId} type="button" className="matrix-member-row" onClick={() => setOpenProfileUserId(userId)}>
              <span className="matrix-member-row__avatar">
                {renderUserAvatar(userId, 'matrix-avatar--member')}
                <i className={`matrix-presence-dot matrix-presence-dot--${getKnownPresence(userId)}`} aria-hidden="true" />
              </span>
              <span>
                <strong>{getKnownDisplayName(userId)}</strong>
                <small>
                  <i className={`matrix-presence-text-dot matrix-presence-text-dot--${getKnownPresence(userId)}`} aria-hidden="true" />
                  {getPresenceLabel(userId)} · {getMemberRoleLabel(userId)}
                </small>
              </span>
            </button>
          ))}
        </div>
        </div>
      </aside>
      </div>

      <form className="message-composer-placeholder" onSubmit={handleSendMessage}>
        {typingIndicatorText ? (
          <div className="matrix-typing-indicator" aria-live="polite">
            <span>{typingIndicatorText}</span>
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <i aria-hidden="true" />
          </div>
        ) : null}

        {editingMessage ? (
          <div className="message-edit-preview">
            <div>
              <strong>Editing message</strong>
              <span>Save your changes or cancel editing.</span>
            </div>
            <button type="button" onClick={cancelEditingMessage} aria-label="Cancel edit">
              Cancel
            </button>
          </div>
        ) : null}

        {!editingMessage && replyTarget ? (
          <div className="message-reply-preview">
            <div>
              <strong>Replying to {getKnownDisplayName(replyTarget.sender)}</strong>
              <span>{getShortMessagePreview(parseMessageBody(replyTarget.body).body, 72)}</span>
            </div>
            <button type="button" onClick={() => setReplyTarget(null)} aria-label="Cancel reply">
              Cancel
            </button>
          </div>
        ) : null}

        {mentionSuggestions.length ? (
          <div className="message-mention-suggestions" role="listbox" aria-label="Mention suggestions">
            {mentionSuggestions.map((suggestion) => (
              <button key={suggestion.userId} type="button" onClick={() => insertMentionSuggestion(suggestion)}>
                {renderUserAvatar(suggestion.userId, 'matrix-avatar--suggestion')}
                <span>{suggestion.displayName}</span>
                <small>Press Tab to mention</small>
              </button>
            ))}
          </div>
        ) : null}

        <input
          type="text"
          placeholder={editingMessage ? 'Edit message' : getComposerPlaceholder(activeChannel, canPost, roomId, replyTarget)}
          value={draftMessage}
          onChange={(event) => setDraftMessage(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={!roomId || isSending || !canPost}
        />
        <button type="submit" disabled={!roomId || isSending || !canPost || !draftMessage.trim()}>
          {isSending ? (editingMessage ? 'Saving...' : 'Sending...') : editingMessage ? 'Save' : activeChannel.readOnly ? 'Publish' : 'Send'}
        </button>
      </form>

      {openActionMenu && openActionMenuMessage && openActionMenuParsedMessage ? (
        <div
          className="matrix-message-action-menu matrix-message-action-menu--floating kodiak-global-message-action-menu"
          style={{ left: openActionMenu.x, top: openActionMenu.y }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {openActionMenuMessage.sender !== identity.userId && onOpenDirectMessage ? (
            <button
              type="button"
              onClick={() => {
                onOpenDirectMessage(openActionMenuMessage.sender, getKnownDisplayName(openActionMenuMessage.sender));
                setOpenActionMenu(null);
                setReactionPickerMessageId(null);
                setReplyTarget(null);
                setEditingMessage(null);
              }}
            >
              Message {getKnownDisplayName(openActionMenuMessage.sender)}
            </button>
          ) : null}
          {canPost ? (
            <button
              type="button"
              onClick={() => {
                setReactionPickerMessageId((currentMessageId) =>
                  currentMessageId === openActionMenuMessage.eventId ? null : openActionMenuMessage.eventId,
                );
                setOpenActionMenu(null);
              }}
            >
              React
            </button>
          ) : null}
          {canPost ? (
            <button
              type="button"
              onClick={() => {
                setReplyTarget({ ...openActionMenuMessage, body: openActionMenuParsedMessage.body });
                setEditingMessage(null);
                setOpenActionMenu(null);
              }}
            >
              Reply
            </button>
          ) : null}
          {openActionMenuMessage.sender === identity.userId ? (
            <button type="button" onClick={() => startEditingMessage({ ...openActionMenuMessage, body: openActionMenuParsedMessage.body })}>
              Edit
            </button>
          ) : null}
          {openActionMenuMessage.sender === identity.userId || canModerate ? (
            <button type="button" className="matrix-message-action--danger" onClick={() => requestDeleteMessage(openActionMenuMessage)}>
              Delete
            </button>
          ) : null}
        </div>
      ) : null}

      {openActionMenu ? (
        <div
          className="matrix-action-menu-backdrop"
          aria-label="Close message actions"
          role="presentation"
          onClick={closeMessageActionMenu}
          onMouseDown={(event) => {
            if (event.button === 2) {
              event.preventDefault();
              event.stopPropagation();
              closeMessageActionMenu();
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMessageActionMenu();
          }}
        />
      ) : null}

      {openProfileUserId ? (
        <div className="kodiak-modal-backdrop" role="presentation" onClick={() => setOpenProfileUserId(null)}>
          <div
            className="kodiak-profile-card"
            role="dialog"
            aria-modal="true"
            aria-label={`${getKnownDisplayName(openProfileUserId)} profile`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kodiak-profile-card__hero">
              {renderUserAvatar(openProfileUserId, 'matrix-avatar--profile-card')}
              <div>
                <h2>{getKnownDisplayName(openProfileUserId)}</h2>
                <p>{profileBiosByUserId[openProfileUserId]?.trim() || 'No bio yet.'}</p>
              </div>
            </div>

            <div className="kodiak-profile-card__actions">
              {openProfileUserId === identity.userId ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpenProfileUserId(null);
                    setDisplayNameDraft(getKnownDisplayName(identity.userId));
                    setBioDraft(profileBiosByUserId[identity.userId] ?? '');
                    setAvatarFile(null);
                    setAvatarPreviewUrl(null);
                    setSettingsErrorText(null);
                    setIsSettingsOpen(true);
                  }}
                >
                  Edit profile
                </button>
              ) : onOpenDirectMessage ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenDirectMessage(openProfileUserId, getKnownDisplayName(openProfileUserId));
                    setOpenProfileUserId(null);
                  }}
                >
                  Message
                </button>
              ) : null}
              <button type="button" disabled>Add Friend Soon</button>
              <button type="button" disabled>Block Soon</button>
              <button type="button" className="kodiak-profile-card__danger" disabled>Report Soon</button>
            </div>
          </div>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="kodiak-modal-backdrop" role="presentation">
          <form className="kodiak-confirm-modal kodiak-settings-modal" role="dialog" aria-modal="true" aria-labelledby="account-settings-title" onSubmit={handleSaveAccountSettings}>
            <div className="kodiak-confirm-modal__header">
              <p className="eyebrow eyebrow--ember">Account settings</p>
              <h2 id="account-settings-title">Profile settings</h2>
              <p>This is how people see you in chats, DMs, replies, and mentions.</p>
            </div>

            <div className="kodiak-avatar-setting">
              <div className="kodiak-avatar-setting__preview">
                {avatarPreviewUrl ? (
                  <img src={avatarPreviewUrl} alt="" />
                ) : getKnownAvatarUrl(identity.userId) ? (
                  <img src={getKnownAvatarUrl(identity.userId) ?? ''} alt="" />
                ) : (
                  <span>{getAvatarInitials(headerDisplayName)}</span>
                )}
              </div>
              <label>
                <span>Profile picture</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={(event) => handleAvatarFileChange(event.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <label className="kodiak-settings-field">
              <span>Display name</span>
              <input
                type="text"
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
                maxLength={32}
                placeholder="PapaKodiak"
                autoFocus
              />
            </label>

            <label className="kodiak-settings-field kodiak-settings-field--bio">
              <span>Bio</span>
              <textarea
                value={bioDraft}
                onChange={(event) => setBioDraft(event.target.value)}
                maxLength={180}
                placeholder="Tell people a little about yourself."
              />
              <small>{bioDraft.length}/180</small>
            </label>

            {settingsErrorText ? <p className="kodiak-settings-error">{settingsErrorText}</p> : null}

            <div className="kodiak-confirm-modal__actions">
              <button type="button" onClick={() => setIsSettingsOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={isSavingSettings}>
                {isSavingSettings ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingDeleteMessage ? (
        <div className="kodiak-modal-backdrop" role="presentation">
          <div className="kodiak-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-message-title">
            <div className="kodiak-confirm-modal__header">
              <p className="eyebrow eyebrow--ember">Message action</p>
              <h2 id="delete-message-title">Delete this message?</h2>
              <p>This removes the message from the room history. This action cannot be undone.</p>
            </div>

            <div className="kodiak-confirm-modal__preview">
              <strong>{getKnownDisplayName(pendingDeleteMessage.sender)}</strong>
              <span>{getShortMessagePreview(parseMessageBody(pendingDeleteMessage.body).body, 120)}</span>
            </div>

            <div className="kodiak-confirm-modal__actions">
              <button type="button" onClick={closeDeleteConfirmation}>
                Cancel
              </button>
              <button type="button" className="kodiak-confirm-modal__danger" onClick={() => void confirmDeleteMessage()}>
                Delete message
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
