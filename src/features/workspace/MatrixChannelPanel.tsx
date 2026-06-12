import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import { playKodiakSound, stopKodiakCallSounds, unlockKodiakSounds } from '../audio/kodiakSounds';
import { getKodiakWebRtcUnsupportedMessage, isKodiakWebRtcSupported, KodiakVoiceCallPeer } from '../calls/kodiakWebRtcCall';
import { openKodiakCallInSystemBrowser, shouldUseKodiakBrowserCallFallback } from '../calls/linuxCallBrowserFallback';
import { KodiakAttachmentBridge } from '../attachments/KodiakAttachmentBridge';
import { isKodiakDesktopNotificationAvailable, requestKodiakDesktopNotificationPermission, showKodiakDesktopNotification } from '../notifications/kodiakDesktopNotifications';
import {
  loadKodiakPresence,
  loadKodiakProfiles,
  loadKodiakReports,
  notifyKodiakDirectMessage,
  notifyKodiakCall,
  sendKodiakRoomActivity,
  submitKodiakReport,
  saveKodiakProfile,
  sendKodiakPresenceHeartbeat,
  type KodiakPresenceState,
  type KodiakReport,
  type KodiakReportCategory,
} from '../backend/kodiakApiClient';
import {
  createDirectMessageRoom,
  findDirectMessageRoom,
  getAuthenticatedMatrixMediaObjectUrl,
  getMatrixMediaUrl,
  joinRoomByAlias,
  joinRoomById,
  loadRecentMessages,
  loadRecentKodiakCallEvents,
  loadRoomMembers,
  loadTypingUsers,
  MatrixRestError,
  redactMessage,
  resolveDirectMessageRoom,
  saveDirectMessageRoom,
  sendReaction,
  sendReplacementMessage,
  sendTextMessage,
  sendKodiakCallEvent,
  sendTypingState,
  uploadProfileAvatar,
  type MatrixCallEvent,
  type MatrixCallKind,
  type MatrixTextMessage,
} from '../matrix/matrixRestClient';
import type { WorkspaceChannel, WorkspaceSpace } from './workspaceTypes';

type FriendStatus = 'none' | 'incoming' | 'outgoing' | 'friends';

const CALL_INVITE_MAX_AGE_MS = 45_000;

interface MatrixChannelPanelProps {
  activeChannel: WorkspaceChannel;
  activeSpace: WorkspaceSpace;
  identity: MatrixLoginIdentity;
  blockedByUserIds?: string[];
  blockedUserIds?: string[];
  restrictedUserIds?: string[];
  friendStatusByUserId?: Record<string, FriendStatus>;
  isMemberPanelOpen: boolean;
  onToggleMemberPanel: () => void;
  isFriendCenterOpen?: boolean;
  onCloseFriendCenter?: () => void;
  onOpenDirectMessage?: (userId: string, displayName: string) => void;
  onSendFriendRequest?: (userId: string, displayName: string) => Promise<void> | void;
  onAcceptFriendRequest?: (userId: string) => Promise<void> | void;
  onDeclineFriendRequest?: (userId: string) => Promise<void> | void;
  onCancelFriendRequest?: (userId: string) => Promise<void> | void;
  onBlockUser?: (userId: string) => Promise<void> | void;
  onUnblockUser?: (userId: string) => Promise<void> | void;
  onUnfriendUser?: (userId: string) => Promise<void> | void;
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


interface KodiakCallSession {
  callId: string;
  connectedAt?: number;
  callKind: MatrixCallKind;
  direction: 'incoming' | 'outgoing';
  displayName: string;
  startedAt: number;
  status: 'ringing' | 'connected';
  targetUserId: string;
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
const URL_PATTERN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
const REACTION_OPTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F525}', '\u{1F440}', '\u{1F389}', '\u{1F62E}', '\u{1F622}', '\u{1F621}', '\u{1F64F}', '\u{1F914}', '\u{1F43B}'];
const PLATFORM_MODERATOR_IDS = ['@papakodiak:kodiak-connect.com'];
const MESSAGE_POLL_INTERVAL_MS = 5000;
const TYPING_POLL_INTERVAL_MS = 2500;
const TYPING_TIMEOUT_MS = 5000;
const TYPING_IDLE_STOP_MS = 2500;
const ROOM_ACTIVITY_INTERVAL_MS = 8_000;
const STICK_TO_BOTTOM_DISTANCE_PX = 160;
const SHOW_JUMP_TO_LATEST_DISTANCE_PX = 520;
const KODIAK_PROFILE_CACHE_KEY = 'KC_BACKEND_PROFILE_CACHE';
const KODIAK_THEME_KEY = 'KC_THEME_MODE';

type KodiakThemeMode = 'default' | 'system';

function readKodiakThemeMode(): KodiakThemeMode {
  return window.localStorage.getItem(KODIAK_THEME_KEY) === 'system' ? 'system' : 'default';
}

function applyKodiakThemeMode(themeMode: KodiakThemeMode) {
  window.localStorage.setItem(KODIAK_THEME_KEY, themeMode);
  document.documentElement.dataset.kodiakTheme = themeMode;
}

function readKodiakProfileCache() {
  try {
    return JSON.parse(window.localStorage.getItem(KODIAK_PROFILE_CACHE_KEY) ?? '{}') as {
      avatars?: Record<string, string>;
      bios?: Record<string, string>;
      displayNames?: Record<string, string>;
    };
  } catch {
    return {};
  }
}

function writeKodiakProfileCache(cache: {
  avatars?: Record<string, string>;
  bios?: Record<string, string>;
  displayNames?: Record<string, string>;
}) {
  window.localStorage.setItem(KODIAK_PROFILE_CACHE_KEY, JSON.stringify(cache));
}

function isDefaultKodiakProfile(userId: string, profile: { avatarUrl?: string; bio?: string; createdAt?: number; displayName?: string; updatedAt?: number }) {
  const defaultDisplayName = getDisplayName(userId);

  return (
    (profile.displayName ?? defaultDisplayName) === defaultDisplayName &&
    !(profile.bio ?? '').trim() &&
    !(profile.avatarUrl ?? '').trim() &&
    !Number(profile.createdAt ?? 0) &&
    !Number(profile.updatedAt ?? 0)
  );
}

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
      return `This Matrix room does not exist yet. Create #${activeChannel.name} in Kodiak Connect.`;
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
  eligibleUserIds: string[],
  currentUserLocalpart: string,
  search: MentionSearch | null,
  displayNamesByUserId: Record<string, string>,
) {
  if (!search) {
    return [];
  }

  const query = search.query.trim().toLowerCase();
  const currentLocalpart = currentUserLocalpart.trim().toLowerCase();
  const suggestionsByLocalpart = new Map<string, MentionSuggestion>();

  for (const userId of eligibleUserIds) {
    const localpart = getUserLocalpart(userId).trim().toLowerCase();

    if (!localpart || localpart === currentLocalpart || suggestionsByLocalpart.has(localpart)) {
      continue;
    }

    const displayName = displayNamesByUserId[userId] || getDisplayName(userId);

    suggestionsByLocalpart.set(localpart, {
      displayName,
      localpart,
      userId,
    });
  }

  return [...suggestionsByLocalpart.values()]
    .filter((suggestion) => {
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

function normalizeMessageUrl(rawUrl: string) {
  return rawUrl.toLowerCase().startsWith('www.') ? 'https://' + rawUrl : rawUrl;
}

function renderTextSegmentWithLinks(segment: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_PATTERN.lastIndex = 0;

  while ((match = URL_PATTERN.exec(segment)) !== null) {
    const rawUrl = match[0];
    const trailingMatch = rawUrl.match(/[),.!?]+$/);
    const trailingPunctuation = trailingMatch?.[0] ?? '';
    const cleanUrl = trailingPunctuation ? rawUrl.slice(0, -trailingPunctuation.length) : rawUrl;
    const cleanUrlEnd = match.index + cleanUrl.length;

    if (match.index > lastIndex) {
      parts.push(segment.slice(lastIndex, match.index));
    }

    parts.push(
      <a
        key={'url-' + keyPrefix + '-' + match.index}
        className="matrix-message-link"
        href={normalizeMessageUrl(cleanUrl)}
        target="_blank"
        rel="noreferrer"
      >
        {cleanUrl}
      </a>,
    );

    if (trailingPunctuation) {
      parts.push(trailingPunctuation);
    }

    lastIndex = cleanUrlEnd + trailingPunctuation.length;
  }

  if (lastIndex < segment.length) {
    parts.push(segment.slice(lastIndex));
  }

  return parts;
}

function renderMessageTextWithMentions(
  body: string,
  currentUserLocalpart: string,
  displayNamesByLocalpart: Record<string, string>,
): ReactNode[] {
  const renderedParts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let segmentIndex = 0;

  MENTION_PATTERN.lastIndex = 0;

  while ((match = MENTION_PATTERN.exec(body)) !== null) {
    const fullMatch = match[0];
    const leadingWhitespace = match[1] ?? '';
    const mention = match[2];
    const mentionStart = match.index + leadingWhitespace.length;

    if (mentionStart > lastIndex) {
      renderedParts.push(...renderTextSegmentWithLinks(body.slice(lastIndex, mentionStart), 'segment-' + segmentIndex));
      segmentIndex += 1;
    }

    const mentionLocalpart = mention.slice(1).toLowerCase();
    const isMentioningCurrentUser = mentionLocalpart === currentUserLocalpart;
    const visibleMentionName = displayNamesByLocalpart[mentionLocalpart] ?? mention.slice(1);

    renderedParts.push(
      <span key={mention + '-' + mentionStart} className={'matrix-mention ' + (isMentioningCurrentUser ? 'matrix-mention--self' : '')}>
        {visibleMentionName}
      </span>,
    );

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < body.length) {
    renderedParts.push(...renderTextSegmentWithLinks(body.slice(lastIndex), 'segment-' + segmentIndex));
  }

  return renderedParts;
}


function getReportCategoryLabel(category: string) {
  switch (category) {
    case 'harassment':
      return 'Harassment or abuse';
    case 'spam':
      return 'Spam';
    case 'scam':
      return 'Scam or suspicious behavior';
    case 'threats':
      return 'Threats or safety concern';
    case 'impersonation':
      return 'Impersonation';
    default:
      return 'Other';
  }
}

export function MatrixChannelPanel({
  activeChannel,
  activeSpace,
  identity,
  blockedByUserIds = [],
  blockedUserIds = [],
  restrictedUserIds = [],
  friendStatusByUserId = {},
  isMemberPanelOpen,
  onToggleMemberPanel,
  isFriendCenterOpen = false,
  onCloseFriendCenter,
  onOpenDirectMessage,
  onSendFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onCancelFriendRequest,
  onBlockUser,
  onUnblockUser,
  onUnfriendUser,
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
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, KodiakPresenceState | 'unavailable'>>({});

  const [displayNamesByUserId, setDisplayNamesByUserId] = useState<Record<string, string>>(() => readKodiakProfileCache().displayNames ?? {});
  const [avatarUrlsByUserId, setAvatarUrlsByUserId] = useState<Record<string, string>>(() => readKodiakProfileCache().avatars ?? {});
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [profileBiosByUserId, setProfileBiosByUserId] = useState<Record<string, string>>(() => readKodiakProfileCache().bios ?? {});
  const [bioDraft, setBioDraft] = useState('');
  const [openProfileUserId, setOpenProfileUserId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [settingsTab, setSettingsTab] = useState<'profile' | 'sounds' | 'themes'>('profile');
  const [themeMode, setThemeMode] = useState<KodiakThemeMode>(() => readKodiakThemeMode());
  const [soundTestText, setSoundTestText] = useState<string | null>(null);
  const [isStartMinimizedEnabled, setIsStartMinimizedEnabled] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsErrorText, setSettingsErrorText] = useState<string | null>(null);
  const [friendActionUserId, setFriendActionUserId] = useState<string | null>(null);
  const [pendingUnfriendUserId, setPendingUnfriendUserId] = useState<string | null>(null);
  const [pendingBlockUserId, setPendingBlockUserId] = useState<string | null>(null);
  const [pendingUnblockUserId, setPendingUnblockUserId] = useState<string | null>(null);
  const [pendingReportUserId, setPendingReportUserId] = useState<string | null>(null);
  const [reportCategory, setReportCategory] = useState<KodiakReportCategory>('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportErrorText, setReportErrorText] = useState<string | null>(null);
  const [reportSuccessText, setReportSuccessText] = useState<string | null>(null);
  const [isSafetyCenterOpen, setIsSafetyCenterOpen] = useState(false);
  const [safetyReports, setSafetyReports] = useState<KodiakReport[]>([]);
  const [isLoadingSafetyReports, setIsLoadingSafetyReports] = useState(false);
  const [safetyReportErrorText, setSafetyReportErrorText] = useState<string | null>(null);
  const [areMessageSoundsEnabled, setAreMessageSoundsEnabled] = useState(() => window.localStorage.getItem('KC_SOUND_MESSAGES') !== 'false');
  const [isSentSoundEnabled, setIsSentSoundEnabled] = useState(() => window.localStorage.getItem('KC_SOUND_SENT') !== 'false');
  const [isReceivedSoundEnabled, setIsReceivedSoundEnabled] = useState(() => window.localStorage.getItem('KC_SOUND_RECEIVED') !== 'false');
  const [areBrowserNotificationsEnabled, setAreBrowserNotificationsEnabled] = useState(() => window.localStorage.getItem('KC_BROWSER_NOTIFICATIONS') === 'true');
  const [isNotificationSoundEnabled, setIsNotificationSoundEnabled] = useState(() => window.localStorage.getItem('KC_NOTIFY_SOUND') !== 'false');
  const [activeCallSession, setActiveCallSession] = useState<KodiakCallSession | null>(null);
  const [callStatusText, setCallStatusText] = useState<string | null>(null);
  const [isCallMuted, setIsCallMuted] = useState(false);
  const [isCallCameraEnabled, setIsCallCameraEnabled] = useState(false);
  const [hasRemoteCallVideo, setHasRemoteCallVideo] = useState(false);
  const [callDurationTick, setCallDurationTick] = useState(0);
  const [speakingCallParticipant, setSpeakingCallParticipant] = useState<'self' | 'remote' | null>(null);
  const callSpeakingCleanupRefs = useRef<Array<() => void>>([]);
  const callSpeakingDetectorKeysRef = useRef<Set<'self' | 'remote'>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [profileActionErrorText, setProfileActionErrorText] = useState<string | null>(null);
  const [isJumpToLatestVisible, setIsJumpToLatestVisible] = useState(false);
  const messageElementRefs = useRef<Record<string, HTMLElement | null>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pollingTimer = useRef<number | null>(null);
  const typingPollTimer = useRef<number | null>(null);
  const typingStopTimer = useRef<number | null>(null);
  const typingSinceBatchRef = useRef<string | undefined>(undefined);
  const isTypingSentRef = useRef(false);
  const hasLoadedSoundBaselineRef = useRef(false);
  const latestSoundMessageTsRef = useRef(0);
  const activeCallSessionRef = useRef<KodiakCallSession | null>(null);
  const kodiakVoiceCallPeerRef = useRef<KodiakVoiceCallPeer | null>(null);
  const pendingCallOfferSdpRef = useRef<string | null>(null);
  const remoteCallAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingRemoteCallStreamRef = useRef<MediaStream | null>(null);
  const pendingLocalCallStreamRef = useRef<MediaStream | null>(null);
  const localCallVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteCallVideoRef = useRef<HTMLVideoElement | null>(null);
  const handledCallEventIdsRef = useRef<Set<string>>(new Set());
  const callEventStartupBaselineRef = useRef(Date.now());
  const restrictedUserIdSetRef = useRef<Set<string>>(new Set());
  const backendAvatarObjectUrlsRef = useRef<Record<string, { source: string; url: string }>>({});

  const displayName = getDisplayName(identity.userId);
  const currentUserLocalpart = getUserLocalpart(identity.userId);
  const activeMentionSearch = getActiveMentionSearch(draftMessage);
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

  const activeDmTargetUserId = activeChannel.kind === 'dm' ? getDirectMessageTargetUserId(activeChannel, identity.userId) : null;
  const activeDmTargetDisplayName = activeDmTargetUserId ? getKnownDisplayName(activeDmTargetUserId) : '';

  const restrictedUserIdSet = useMemo(() => {
    return new Set([...blockedUserIds, ...blockedByUserIds, ...restrictedUserIds]);
  }, [blockedByUserIds, blockedUserIds, restrictedUserIds]);

  useEffect(() => {
    restrictedUserIdSetRef.current = restrictedUserIdSet;
  }, [restrictedUserIdSet]);

  const visibleRoomMemberUserIds = useMemo<string[]>(() => {
    return roomMemberUserIds.filter((userId: string) => !isUserRestricted(userId));
  }, [restrictedUserIdSet, roomMemberUserIds]);

  const mentionSuggestions = useMemo<MentionSuggestion[]>(() => {
    return getMentionSuggestions(
      visibleRoomMemberUserIds,
      getUserLocalpart(identity.userId),
      getActiveMentionSearch(draftMessage),
      displayNamesByUserId,
    );
  }, [displayNamesByUserId, draftMessage, identity.userId, visibleRoomMemberUserIds]);





  function isUserRestricted(userId: string) {
    return restrictedUserIdSet.has(userId);
  }

  function isUserBlocked(userId: string) {
    return blockedUserIds.includes(userId);
  }

  function isUserBlockedBy(userId: string) {
    return blockedByUserIds.includes(userId);
  }


  function doesMessageMentionBlockedUser(messageBody: string) {
    const normalizedBody = messageBody.toLowerCase();

    return [...new Set([...blockedUserIds, ...blockedByUserIds])].some((userId) => {
      const displayName = getKnownDisplayName(userId).toLowerCase();
      const localpart = getUserLocalpart(userId).toLowerCase();

      return normalizedBody.includes(`@${displayName}`) || normalizedBody.includes(`@${localpart}`);
    });
  }

  function doesMessageMentionRestrictedUser(messageBody: string) {
    const normalizedBody = messageBody.toLowerCase();

    return [...restrictedUserIdSet].some((userId) => {
      const mentionKeys = [
        getKnownDisplayName(userId),
        getUserLocalpart(userId),
      ]
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value && value !== 'loading profile...');

      return mentionKeys.some((mentionKey) => normalizedBody.includes(`@${mentionKey}`));
    });
  }

  function getFriendStatus(userId: string) {
    return friendStatusByUserId[userId] ?? 'none';
  }

  const incomingFriendUserIds = Object.entries(friendStatusByUserId)
    .filter(([userId, status]) => status === 'incoming' && !isUserRestricted(userId))
    .map(([userId]) => userId);

  const outgoingFriendUserIds = Object.entries(friendStatusByUserId)
    .filter(([userId, status]) => status === 'outgoing' && !isUserRestricted(userId))
    .map(([userId]) => userId);

  const friendUserIds = Object.entries(friendStatusByUserId)
    .filter(([userId, status]) => status === 'friends' && !isUserRestricted(userId))
    .map(([userId]) => userId);

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

    if (presence === 'unavailable' || presence === 'idle') {
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

  useEffect(() => {
    writeKodiakProfileCache({
      avatars: avatarUrlsByUserId,
      bios: profileBiosByUserId,
      displayNames: displayNamesByUserId,
    });
  }, [avatarUrlsByUserId, displayNamesByUserId, profileBiosByUserId]);

  useEffect(() => {
    setProfileActionErrorText(null);
  }, [openProfileUserId]);

  // Safety/action errors should not sit in chat forever.
  useEffect(() => {
    if (!errorText) {
      return undefined;
    }

    const errorTimerId = window.setTimeout(() => {
      setErrorText(null);
    }, 4500);

    return () => {
      window.clearTimeout(errorTimerId);
    };
  }, [errorText]);

  const displayNamesByLocalpart = Object.fromEntries(
    Object.entries(displayNamesByUserId).map(([userId, displayName]) => [getUserLocalpart(userId), displayName]),
  );


  useEffect(() => {
    function unlockSounds() {
      unlockKodiakSounds();
      window.removeEventListener('pointerdown', unlockSounds, true);
      window.removeEventListener('keydown', unlockSounds, true);
    }

    window.addEventListener('pointerdown', unlockSounds, true);
    window.addEventListener('keydown', unlockSounds, true);

    return () => {
      window.removeEventListener('pointerdown', unlockSounds, true);
      window.removeEventListener('keydown', unlockSounds, true);
    };
  }, []);
  useEffect(() => {
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

    for (const userId of Object.keys(friendStatusByUserId)) {
      userIdsToLoad.add(userId);
    }

    for (const userId of blockedUserIds) {
      userIdsToLoad.add(userId);
    }

    for (const userId of blockedByUserIds ?? []) {
      userIdsToLoad.add(userId);
    }

    for (const userId of restrictedUserIds ?? []) {
      userIdsToLoad.add(userId);
    }

    if (openProfileUserId) {
      userIdsToLoad.add(openProfileUserId);
    }

    const userIds = [...userIdsToLoad].filter(Boolean);

    if (!userIds.length) {
      return undefined;
    }

    let isActive = true;

    async function refreshBackendProfiles() {
      try {
        const profilesByUserId = await loadKodiakProfiles(identity, userIds);

        if (!isActive) {
          return;
        }

        setDisplayNamesByUserId((currentNames) => {
          let hasChanged = false;
          const nextNames = { ...currentNames };

          for (const [userId, profile] of Object.entries(profilesByUserId)) {
            if (isDefaultKodiakProfile(userId, profile) && nextNames[userId] && nextNames[userId] !== getDisplayName(userId)) {
              continue;
            }

            const nextDisplayName = profile.displayName || getDisplayName(userId);

            if (nextNames[userId] !== nextDisplayName) {
              nextNames[userId] = nextDisplayName;
              hasChanged = true;
            }
          }

          return hasChanged ? nextNames : currentNames;
        });

        setProfileBiosByUserId((currentBios) => {
          let hasChanged = false;
          const nextBios = { ...currentBios };

          for (const [userId, profile] of Object.entries(profilesByUserId)) {
            if (isDefaultKodiakProfile(userId, profile) && (nextBios[userId] ?? '').trim()) {
              continue;
            }

            const nextBio = profile.bio ?? '';

            if (nextBios[userId] !== nextBio) {
              nextBios[userId] = nextBio;
              hasChanged = true;
            }
          }

          return hasChanged ? nextBios : currentBios;
        });

        const avatarEntries = await Promise.all(
          Object.entries(profilesByUserId).map(async ([userId, profile]) => {
            const profileAvatarUrl = profile.avatarUrl ?? '';

            if (!profileAvatarUrl) {
              return [userId, ''] as const;
            }

            const cachedAvatar = backendAvatarObjectUrlsRef.current[userId];

            if (cachedAvatar?.source === profileAvatarUrl) {
              return [userId, cachedAvatar.url] as const;
            }

            const avatarUrl = profileAvatarUrl.startsWith('mxc://')
              ? (await getAuthenticatedMatrixMediaObjectUrl(identity, profileAvatarUrl, 96, 96).catch(() => null)) ?? ''
              : profileAvatarUrl;

            if (avatarUrl) {
              backendAvatarObjectUrlsRef.current[userId] = {
                source: profileAvatarUrl,
                url: avatarUrl,
              };
            }

            return [userId, avatarUrl] as const;
          }),
        );

        if (!isActive) {
          return;
        }

        setAvatarUrlsByUserId((currentAvatars) => {
          let hasChanged = false;
          const nextAvatars = { ...currentAvatars };

          for (const [userId, avatarUrl] of avatarEntries) {
            if (avatarUrl && nextAvatars[userId] !== avatarUrl) {
              nextAvatars[userId] = avatarUrl;
              hasChanged = true;
            }
          }

          return hasChanged ? nextAvatars : currentAvatars;
        });
      } catch (error) {
        console.warn('[Kodiak Connect] Backend profile refresh failed', error);
      }
    }

    void refreshBackendProfiles();

    const profileIntervalId = window.setInterval(() => {
      void refreshBackendProfiles();
    }, 30_000);

    return () => {
      isActive = false;
      window.clearInterval(profileIntervalId);
    };
  }, [friendStatusByUserId, identity, messages, openProfileUserId, roomMemberUserIds, typingUserIds]);







  const visibleMessages = useMemo<MatrixTextMessage[]>(() => {
    return messages.filter((message: MatrixTextMessage) => !isUserRestricted(message.sender));
  }, [messages, restrictedUserIdSet]);

  const visibleTypingUserIds = useMemo<string[]>(() => {
    return typingUserIds.filter((userId: string) => !isUserRestricted(userId));
  }, [restrictedUserIdSet, typingUserIds]);

  const typingIndicatorText = visibleTypingUserIds.length
    ? getTypingIndicatorText(visibleTypingUserIds.map((userId: string) => getKnownDisplayName(userId)))
    : '';
  const channelHeadingPrefix = activeChannel.kind === 'dm' ? '' : '#';
  const channelEyebrowLabel = activeChannel.kind === 'dm' ? 'Direct Message' : activeSpace.name;
  const headerDisplayName = getKnownDisplayName(identity.userId);
  const roomMemberPresenceKey = roomMemberUserIds.join('|');

  const refreshProfileBios = useCallback(async (_targetRoomId: string) => {
    // Kodiak Backend owns profile bios now.
  }, []);

  const processRecentCallEvents = useCallback(
    (callEvents: MatrixCallEvent[]) => {
      for (const callEvent of callEvents) {
        if (!callEvent.eventId || handledCallEventIdsRef.current.has(callEvent.eventId)) {
          continue;
        }

        handledCallEventIdsRef.current.add(callEvent.eventId);

        if (callEvent.sender === identity.userId || callEvent.targetUserId !== identity.userId) {
          continue;
        }

        if (restrictedUserIdSetRef.current.has(callEvent.sender) || restrictedUserIdSetRef.current.has(callEvent.sender.trim().toLowerCase())) {
          continue;
        }

        const callerDisplayName = getKnownDisplayName(callEvent.sender);
        const currentCall = activeCallSessionRef.current;

        if (callEvent.status === 'invite') {
          const isStaleInvite =
            callEvent.createdAt < callEventStartupBaselineRef.current ||
            Date.now() - callEvent.createdAt > CALL_INVITE_MAX_AGE_MS;

          if (isStaleInvite) {
            continue;
          }

          if (activeCallSessionRef.current?.callId === callEvent.callId) {
            continue;
          }
          pendingCallOfferSdpRef.current = callEvent.sdp ?? null;

          const nextCall: KodiakCallSession = {
            callId: callEvent.callId,
            callKind: callEvent.callKind,
            direction: 'incoming',
            displayName: callerDisplayName,
            startedAt: callEvent.createdAt,
            status: 'ringing',
            targetUserId: callEvent.sender,
          };

          setActiveCallSession(nextCall);
          setCallStatusText(callerDisplayName + ' is calling.');

          if (isNotificationSoundEnabled) {
            void playKodiakSound('ringingReceiveCall', 0.76, { force: true });
          }

          void showKodiakDesktopNotification({
            title: 'Kodiak Connect - Incoming ' + callEvent.callKind + ' call',
            body: callerDisplayName + ' is calling you.',
            tag: 'kodiak-call-' + callEvent.callId,
          });

          continue;
        }

        if (!currentCall || currentCall.callId !== callEvent.callId) {
          continue;
        }

        if (callEvent.status === 'accept') {
          setActiveCallSession({ ...currentCall, connectedAt: currentCall.connectedAt ?? Date.now(), status: 'connected' });
          stopKodiakCallSounds();
          setCallStatusText(callerDisplayName + ' accepted the call.');
          void playKodiakSound('notify', 0.55, { force: true });
          continue;
        }

        if (callEvent.status === 'offer' || callEvent.status === 'answer' || callEvent.status === 'ice') {
          void handleKodiakWebRtcCallEvent(callEvent, currentCall);
          continue;
        }

        if (callEvent.status === 'decline') {
          cleanupKodiakVoiceCall();
          activeCallSessionRef.current = null;
          setActiveCallSession(null);
          setCallStatusText(null);
          void playKodiakSound('notify', 0.45, { force: true });
          continue;
        }

        if (callEvent.status === 'end') {
          cleanupKodiakVoiceCall();
          activeCallSessionRef.current = null;
          setActiveCallSession(null);
          setCallStatusText(null);
          void playKodiakSound('notify', 0.45, { force: true });
        }
      }
    },
    [identity.userId, isNotificationSoundEnabled],
  );

  const refreshMessages = useCallback(
    async (targetRoomId: string) => {
      const recentMessages = await loadRecentMessages(identity, targetRoomId);

      if (activeChannel.kind === 'dm') {
        const recentCallEvents = await loadRecentKodiakCallEvents(identity, targetRoomId, 40).catch((error) => {
          console.warn('[Kodiak Connect] Failed to refresh call events', error);
          return [];
        });

        processRecentCallEvents(recentCallEvents);
      }

      const latestMessageTs = recentMessages.reduce((latestTs, message) => Math.max(latestTs, message.originServerTs), 0);

      if (!hasLoadedSoundBaselineRef.current) {
        hasLoadedSoundBaselineRef.current = true;
        latestSoundMessageTsRef.current = latestMessageTs;
      } else if (areMessageSoundsEnabled && isReceivedSoundEnabled) {
        const hasNewIncomingMessage = recentMessages.some((message) => {
          return (
            message.sender !== identity.userId &&
            message.originServerTs > latestSoundMessageTsRef.current &&
            !restrictedUserIdSetRef.current.has(message.sender.trim().toLowerCase())
          );
        });

        if (hasNewIncomingMessage) {
          playKodiakSound('messageReceived', 0.62);
        }

        latestSoundMessageTsRef.current = Math.max(latestSoundMessageTsRef.current, latestMessageTs);
      }

      setMessages(recentMessages);

      void refreshProfileBios(targetRoomId).catch((error) => {
        console.warn('[Kodiak Connect] Failed to refresh profile bios', error);
      });
    },
    [activeChannel.kind, areMessageSoundsEnabled, identity, isReceivedSoundEnabled, processRecentCallEvents, refreshProfileBios],
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
    activeCallSessionRef.current = activeCallSession;
  }, [activeCallSession]);

  useEffect(() => {
    if (activeCallSession?.status !== 'connected') {
      return;
    }

    setCallDurationTick((value) => value + 1);

    const timer = window.setInterval(() => {
      setCallDurationTick((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeCallSession?.callId, activeCallSession?.status]);

  useEffect(() => {
    applyKodiakThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    window.localStorage.setItem('KC_SOUND_MESSAGES', String(areMessageSoundsEnabled));
    window.localStorage.setItem('KC_SOUND_SENT', String(isSentSoundEnabled));
    window.localStorage.setItem('KC_SOUND_RECEIVED', String(isReceivedSoundEnabled));
    window.localStorage.setItem('KC_BROWSER_NOTIFICATIONS', String(areBrowserNotificationsEnabled));
    window.localStorage.setItem('KC_NOTIFY_SOUND', String(isNotificationSoundEnabled));
  }, [areBrowserNotificationsEnabled, areMessageSoundsEnabled, isNotificationSoundEnabled, isReceivedSoundEnabled, isSentSoundEnabled]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setIsJumpToLatestVisible(false);
    hasLoadedSoundBaselineRef.current = false;
    latestSoundMessageTsRef.current = 0;
  }, [activeChannel.id]);

  // Matrix display-name reads disabled. Kodiak Backend owns display names.


  // Matrix profile-avatar reads disabled. Kodiak Backend owns avatar references.


  useEffect(() => {
    if (openProfileUserId && roomId) {
      void refreshProfileBios(roomId).catch((error) => {
        console.warn('[Kodiak Connect] Failed to refresh profile bio on profile open', error);
      });
    }
  }, [openProfileUserId, refreshProfileBios, roomId]);

  // Matrix room bio reads disabled. Kodiak Backend owns bios.

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

      setIsLoading((currentLoading) => roomId ? currentLoading : true);
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
    if (!roomId) {
      return undefined;
    }

    let isActive = true;

    function isRoomVisible() {
      return document.visibilityState === 'visible' && document.hasFocus();
    }

    function sendRoomActivity(isVisible = isRoomVisible()) {
      if (!isActive) {
        return;
      }

      void sendKodiakRoomActivity(identity, {
        isVisible,
        roomId: isVisible ? roomId : '',
      }).catch((error) => {
        console.warn('[Kodiak Connect] Kodiak room activity update failed', error);
      });
    }

    function handleVisibilityChange() {
      sendRoomActivity(isRoomVisible());
    }

    function handlePageHide() {
      sendRoomActivity(false);
    }

    sendRoomActivity();

    const activityIntervalId = window.setInterval(() => {
      sendRoomActivity();
    }, ROOM_ACTIVITY_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('blur', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      isActive = false;
      window.clearInterval(activityIntervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('blur', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);

      void sendKodiakRoomActivity(identity, {
        isVisible: false,
        roomId: '',
      }).catch((error) => {
        console.warn('[Kodiak Connect] Kodiak room activity cleanup failed', error);
      });
    };
  }, [identity, roomId]);

  useEffect(() => {
    let isActive = true;

    function sendPresenceHeartbeat() {
      if (!isActive) {
        return;
      }

      void sendKodiakPresenceHeartbeat(identity, getKnownDisplayName(identity.userId), getKnownAvatarUrl(identity.userId)).catch((error) => {
        console.warn('[Kodiak Connect] Kodiak presence heartbeat failed', error);
      });
    }

    sendPresenceHeartbeat();

    const heartbeatIntervalId = window.setInterval(sendPresenceHeartbeat, 30_000);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatIntervalId);
    };
  }, [avatarUrlsByUserId, displayNamesByUserId, identity]);

  useEffect(() => {
    const presenceUserIds = roomMemberPresenceKey ? roomMemberPresenceKey.split('|').filter(Boolean) : [];

    if (!presenceUserIds.length) {
      return undefined;
    }

    let isActive = true;

    async function refreshMemberPresence() {
      const kodiakPresenceByUserId = await loadKodiakPresence(identity, presenceUserIds).catch((error) => {
        console.warn('[Kodiak Connect] Kodiak presence lookup failed', error);
        return {} as Record<string, KodiakPresenceState>;
      });

      const presenceEntries = presenceUserIds.map((userId) => {
        if (userId === identity.userId) {
          return [userId, 'online'] as const;
        }

        return [userId, kodiakPresenceByUserId[userId] ?? 'offline'] as const;
      });

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
    }, 60000);

    return () => {
      isActive = false;
      window.clearInterval(presenceIntervalId);
    };
  }, [identity, roomMemberPresenceKey]);

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
          setTypingUserIds(typingState.userIds.filter((userId) => userId !== identity.userId && !isUserRestricted(userId)));
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

    if (!messageList) {
      return undefined;
    }

    if (!shouldStickToBottomRef.current) {
      const distanceFromBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
      setIsJumpToLatestVisible(distanceFromBottom > SHOW_JUMP_TO_LATEST_DISTANCE_PX);
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      messageList.scrollTop = messageList.scrollHeight;
      shouldStickToBottomRef.current = true;
      setIsJumpToLatestVisible(false);
    });

    return () => window.cancelAnimationFrame(frameId);
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
    event.preventDefault();
    event.stopPropagation();

    if (openActionMenu) {
      closeMessageActionMenu();
      return;
    }

    const message = findMessageForDomTarget(event.target);

    if (!message) {
      return;
    }

    openMessageActionMenu(message, event.clientX, event.clientY);
  }

  function handleMessageListScroll() {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    const distanceFromBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
    const isCloseToBottom = distanceFromBottom < STICK_TO_BOTTOM_DISTANCE_PX;

    shouldStickToBottomRef.current = isCloseToBottom;
    setIsJumpToLatestVisible(!isCloseToBottom && distanceFromBottom > SHOW_JUMP_TO_LATEST_DISTANCE_PX);
  }

  function scrollToLatestMessages() {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    shouldStickToBottomRef.current = true;
    setIsJumpToLatestVisible(false);
    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior: 'smooth',
    });
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const firstVisibleMentionSuggestion = mentionSuggestions.find((suggestion) => !isUserRestricted(suggestion.userId));

    if (event.key === 'Tab' && firstVisibleMentionSuggestion) {
      event.preventDefault();
      insertMentionSuggestion(firstVisibleMentionSuggestion);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();

      if (!roomId || (isSending && Boolean(editingMessage)) || !canPost || !draftMessage.trim()) {
        return;
      }

      event.currentTarget.form?.requestSubmit();
    }
  }

  function getSafeMenuPosition(clientX: number, clientY: number) {
    const menuWidth = 190;
    const menuHeight = 175;
    const padding = 8;

    return {
      x: Math.min(Math.max(clientX + 6, padding), window.innerWidth - menuWidth - padding),
      y: Math.min(Math.max(clientY + 6, padding), window.innerHeight - menuHeight - padding),
    };
  }

  function closeMessageActionMenu() {
    setOpenActionMenu(null);
  }

  function stopKodiakSpeakingDetectors() {
    for (const cleanup of callSpeakingCleanupRefs.current) {
      cleanup();
    }

    callSpeakingCleanupRefs.current = [];
    callSpeakingDetectorKeysRef.current.clear();
    setSpeakingCallParticipant(null);
  }

  function startKodiakSpeakingDetector(stream: MediaStream, participant: 'self' | 'remote') {
    const audioTracks = stream.getAudioTracks();

    if (!audioTracks.length || callSpeakingDetectorKeysRef.current.has(participant)) {
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ??
      (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    const audioContext = new AudioContextConstructor();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(new MediaStream(audioTracks));
    const data = new Uint8Array(1024);

    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.25;
    source.connect(analyser);

    callSpeakingDetectorKeysRef.current.add(participant);

    let animationFrameId = 0;
    let speakingFrames = 0;
    let silentFrames = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(data);

      let sum = 0;

      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / data.length);
      const isSpeakingNow = rms > 0.012;

      if (isSpeakingNow) {
        speakingFrames += 1;
        silentFrames = 0;

        if (speakingFrames >= 2) {
          setSpeakingCallParticipant(participant);
        }
      } else {
        silentFrames += 1;
        speakingFrames = 0;

        if (silentFrames >= 10) {
          setSpeakingCallParticipant((current) => (current === participant ? null : current));
        }
      }

      animationFrameId = window.requestAnimationFrame(tick);
    };

    tick();

    callSpeakingCleanupRefs.current.push(() => {
      window.cancelAnimationFrame(animationFrameId);
      callSpeakingDetectorKeysRef.current.delete(participant);

      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        // Already disconnected.
      }

      void audioContext.close().catch(() => undefined);
    });
  }

  function attachKodiakLocalMediaStream(stream: MediaStream) {
    pendingLocalCallStreamRef.current = stream;
    startKodiakSpeakingDetector(stream, 'self');

    const hasLiveVideo = stream
      .getVideoTracks()
      .some((track) => track.readyState === 'live' && track.enabled);

    setIsCallCameraEnabled(hasLiveVideo);
    attachKodiakLocalVideoStream(stream);
  }

  function attachKodiakLocalVideoStream(stream: MediaStream) {
    const videoElement = localCallVideoRef.current;
    const hasVideoTrack = stream.getVideoTracks().some((track) => track.readyState === 'live');

    if (!videoElement || !hasVideoTrack) {
      return;
    }

    if (videoElement.srcObject !== stream) {
      videoElement.srcObject = stream;
    }

    videoElement.muted = true;
    videoElement.playsInline = true;

    void videoElement.play().catch((error) => {
      console.warn('[Kodiak Connect] Failed to play local call video', error);
    });
  }

  useEffect(() => {
    if (!activeCallSession || !pendingLocalCallStreamRef.current) {
      return;
    }

    attachKodiakLocalVideoStream(pendingLocalCallStreamRef.current);
  }, [activeCallSession?.callId, isCallCameraEnabled]);

  function attachKodiakRemoteMediaStream(stream: MediaStream) {
    pendingRemoteCallStreamRef.current = stream;
    startKodiakSpeakingDetector(stream, 'remote');

    const remoteVideoTracks = stream.getVideoTracks();
    setHasRemoteCallVideo(remoteVideoTracks.some((track) => track.readyState === 'live'));

    for (const track of remoteVideoTracks) {
      track.onmute = () => setHasRemoteCallVideo(false);
      track.onended = () => setHasRemoteCallVideo(false);
      track.onunmute = () => setHasRemoteCallVideo(true);
    }

    const videoElement = remoteCallVideoRef.current;

    if (videoElement && stream.getVideoTracks().length > 0) {
      videoElement.srcObject = stream;

      void videoElement.play().catch((error) => {
        console.warn('[Kodiak Connect] Failed to play remote call video', error);
      });
    }

    attachKodiakRemoteAudioStream(stream);
  }

  function attachKodiakRemoteAudioStream(stream: MediaStream) {
    pendingRemoteCallStreamRef.current = stream;

    const audioElement = remoteCallAudioRef.current;

    if (!audioElement) {
      return;
    }

    if (audioElement.srcObject !== stream) {
      audioElement.srcObject = stream;
    }

    audioElement.muted = false;
    audioElement.volume = 1;

    void audioElement.play().catch((error) => {
      console.warn('[Kodiak Connect] Failed to play remote call audio', error);
      setCallStatusText('Tap the call panel if remote audio does not start.');
    });
  }

  useEffect(() => {
    if (!activeCallSession || !pendingRemoteCallStreamRef.current) {
      return;
    }

    attachKodiakRemoteAudioStream(pendingRemoteCallStreamRef.current);

    const videoElement = remoteCallVideoRef.current;

    if (
      videoElement &&
      pendingRemoteCallStreamRef.current.getVideoTracks().length > 0 &&
      videoElement.srcObject !== pendingRemoteCallStreamRef.current
    ) {
      videoElement.srcObject = pendingRemoteCallStreamRef.current;

      void videoElement.play().catch((error) => {
        console.warn('[Kodiak Connect] Failed to replay remote call video', error);
      });
    }
  }, [activeCallSession?.callId, hasRemoteCallVideo]);

  function cleanupKodiakVoiceCall() {
    stopKodiakCallSounds();
    kodiakVoiceCallPeerRef.current?.close();
    kodiakVoiceCallPeerRef.current = null;
    pendingCallOfferSdpRef.current = null;
    pendingRemoteCallStreamRef.current = null;
    pendingLocalCallStreamRef.current = null;
    setIsCallMuted(false);
    setIsCallCameraEnabled(false);
    setHasRemoteCallVideo(false);

    if (remoteCallAudioRef.current) {
      remoteCallAudioRef.current.srcObject = null;
    }

    if (localCallVideoRef.current) {
      localCallVideoRef.current.srcObject = null;
    }

    if (remoteCallVideoRef.current) {
      remoteCallVideoRef.current.srcObject = null;
    }
  }

  function createKodiakVoiceCallPeer(session: KodiakCallSession) {
    cleanupKodiakVoiceCall();

    const peer = new KodiakVoiceCallPeer({
      callKind: session.callKind,
      onConnectionStateChange: (state) => {
        if (state === 'connected') {
          setActiveCallSession((current) => current?.callId === session.callId ? { ...current, connectedAt: current.connectedAt ?? Date.now(), status: 'connected' } : current);
          stopKodiakCallSounds();
          setCallStatusText('Voice call connected.');
        }

        if (state === 'disconnected') {
          setCallStatusText('Reconnecting voice call...');
        }

        if (state === 'failed') {
          setCallStatusText('Voice call connection failed. End the call and try again.');
        }

        if (state === 'closed') {
          activeCallSessionRef.current = null;
          setActiveCallSession(null);
          setCallStatusText(null);
        }
      },
      onIceCandidate: (candidate) => {
        const currentRoomId = roomId;

        if (!currentRoomId) {
          return;
        }

        void sendKodiakCallEvent(identity, currentRoomId, {
          callId: session.callId,
          callKind: session.callKind,
          candidate,
          status: 'ice',
          targetUserId: session.targetUserId,
        }).catch((error) => {
          console.warn('[Kodiak Connect] Failed to send ICE candidate', error);
        });
      },
      onLocalStream: attachKodiakLocalMediaStream,
      onRemoteStream: attachKodiakRemoteMediaStream,
    });

    kodiakVoiceCallPeerRef.current = peer;

    return peer;
  }

  function getRequiredCallRoomId() {
    if (!roomId) {
      throw new Error('A Matrix room is required for call signaling.');
    }

    return roomId;
  }

  async function prepareKodiakWebRtcOffer(session: KodiakCallSession) {
    const peer = kodiakVoiceCallPeerRef.current ?? createKodiakVoiceCallPeer(session);
    setCallStatusText('Starting microphone...');

    const offerSdp = await peer.createOffer();

    setCallStatusText('Calling ' + session.displayName + '...');

    return offerSdp;
  }

  async function answerKodiakWebRtcOffer(session: KodiakCallSession, offerSdp: string) {
    const peer = kodiakVoiceCallPeerRef.current ?? createKodiakVoiceCallPeer(session);
    setCallStatusText('Starting microphone...');

    const answerSdp = await peer.createAnswer(offerSdp);

    await sendKodiakCallEvent(identity, getRequiredCallRoomId(), {
      callId: session.callId,
      callKind: session.callKind,
      sdp: answerSdp,
      status: 'answer',
      targetUserId: session.targetUserId,
    });

    setActiveCallSession({ ...session, connectedAt: session.connectedAt ?? Date.now(), status: 'connected' });
    stopKodiakCallSounds();
          setCallStatusText('Voice call connected.');
  }

  async function handleKodiakWebRtcCallEvent(callEvent: MatrixCallEvent, currentCall: KodiakCallSession) {
    try {
      if (callEvent.sender === identity.userId) {
        return;
      }

      if (callEvent.status === 'offer' && callEvent.sdp) {
        pendingCallOfferSdpRef.current = callEvent.sdp;

        if (currentCall.status === 'connected') {
          await answerKodiakWebRtcOffer(currentCall, callEvent.sdp);
        }

        return;
      }

      if (callEvent.status === 'answer' && callEvent.sdp) {
        await kodiakVoiceCallPeerRef.current?.applyAnswer(callEvent.sdp);
        setActiveCallSession({ ...currentCall, connectedAt: currentCall.connectedAt ?? Date.now(), status: 'connected' });
        stopKodiakCallSounds();
          setCallStatusText('Voice call connected.');
        return;
      }

      if (callEvent.status === 'ice' && callEvent.candidate) {
        await kodiakVoiceCallPeerRef.current?.addIceCandidate(callEvent.candidate);
      }
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to process WebRTC call event', error);
      setCallStatusText('Voice call connection failed.');
    }
  }

  async function toggleKodiakCallCamera() {
    const session = activeCallSessionRef.current;
    const peer = kodiakVoiceCallPeerRef.current;

    if (!session || session.status !== 'connected' || !peer) {
      return;
    }

    const nextCameraEnabled = !isCallCameraEnabled;

    try {
      setCallStatusText(nextCameraEnabled ? 'Turning camera on...' : 'Turning camera off...');

      const offerSdp = await peer.setCameraEnabled(nextCameraEnabled);
      setIsCallCameraEnabled(peer.hasCameraEnabled());

      if (offerSdp) {
        await sendKodiakCallEvent(identity, getRequiredCallRoomId(), {
          callId: session.callId,
          callKind: session.callKind,
          sdp: offerSdp,
          status: 'offer',
          targetUserId: session.targetUserId,
        });
      }

      setCallStatusText(nextCameraEnabled ? 'Camera on.' : 'Camera off.');
    } catch (error) {
      setIsCallCameraEnabled(peer.hasCameraEnabled());
      setCallStatusText(error instanceof Error ? error.message : 'Could not change camera state.');
    }
  }

  function toggleKodiakCallMute() {
    setIsCallMuted((currentValue) => {
      const nextValue = !currentValue;
      kodiakVoiceCallPeerRef.current?.setMuted(nextValue);
      return nextValue;
    });
  }

  function renderKodiakCallParticipant(userId: string, label: string, modifier = '') {
    const classes = ['kodiak-call-participant'];

    if (modifier && speakingCallParticipant === modifier) {
      classes.push('kodiak-call-participant--speaking');
    }

    if (modifier) {
      classes.push('kodiak-call-participant--' + modifier);
    }

    return (
      <div className={classes.join(' ')} key={userId}>
        <div className="kodiak-call-participant__avatar">
          {renderUserAvatar(userId, 'matrix-avatar--call')}
        </div>
        <span>{label}</span>
      </div>
    );
  }

  function formatKodiakCallDuration(startedAt: number, tick: number) {
    void tick;

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return minutes + ':' + seconds.toString().padStart(2, '0');
  }

  function getCallKindLabel(callKind: MatrixCallKind) {
    return callKind === 'video' ? 'video call' : 'voice call';
  }

  async function sendKodiakCallSignal(session: KodiakCallSession, status: 'accept' | 'decline' | 'end') {
    if (!roomId) {
      return;
    }

    await sendKodiakCallEvent(identity, getRequiredCallRoomId(), {
      callId: session.callId,
      callKind: session.callKind,
      status,
      targetUserId: session.targetUserId,
    });
  }

  async function openLinuxCallFallbackInBrowser() {
    setCallStatusText('Linux desktop WebRTC is not available in this app runtime. Opening Kodiak Connect in your browser for calls...');

    try {
      await openKodiakCallInSystemBrowser();
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to open browser call fallback', error);
      setCallStatusText(getKodiakWebRtcUnsupportedMessage());
    }
  }

  async function startKodiakCall(callKind: MatrixCallKind) {
    if (!roomId || !activeDmTargetUserId) {
      setCallStatusText('Open a direct message before starting a call.');
      return;
    }

    if (!isKodiakWebRtcSupported()) {
      if (shouldUseKodiakBrowserCallFallback()) {
        await openLinuxCallFallbackInBrowser();
        return;
      }

      setCallStatusText(getKodiakWebRtcUnsupportedMessage());
      return;
    }

    unlockKodiakSounds();

    const callId = 'kc-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const nextCall: KodiakCallSession = {
      callId,
      callKind,
      direction: 'outgoing',
      displayName: activeDmTargetDisplayName || getKnownDisplayName(activeDmTargetUserId),
      startedAt: Date.now(),
      status: 'ringing',
      targetUserId: activeDmTargetUserId,
    };

    console.info('[Kodiak Connect] Starting call UI session', nextCall);

    activeCallSessionRef.current = nextCall;
    setCallStatusText(null);
    setActiveCallSession(nextCall);
    setCallStatusText('Starting microphone...');

    try {
      const offerSdp = await prepareKodiakWebRtcOffer(nextCall);

      activeCallSessionRef.current = nextCall;
      setActiveCallSession((currentCall) =>
        currentCall?.callId === callId ? { ...currentCall, status: 'ringing' } : currentCall,
      );

      void playKodiakSound('ringingSendCall', 0.68, { force: true });

      await sendKodiakCallEvent(identity, getRequiredCallRoomId(), {
        callId,
        callKind,
        sdp: offerSdp,
        status: 'invite',
        targetUserId: activeDmTargetUserId,
      });

      setCallStatusText('Calling ' + nextCall.displayName + '...');
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to start call', error);
      cleanupKodiakVoiceCall();
      activeCallSessionRef.current = null;
      setActiveCallSession(null);
      setCallStatusText(
        error instanceof Error
          ? error.message
          : 'Call could not be started.',
      );
      return;
    }

    void notifyKodiakCall(identity, {
      callId,
      callKind,
      roomId,
      targetUserId: activeDmTargetUserId,
    }).catch((error) => {
      console.warn('[Kodiak Connect] Failed to send call push notification', error);
    });
  }

  async function respondToKodiakCall(status: 'accept' | 'decline') {
    const session = activeCallSessionRef.current;

    if (!session) {
      return;
    }

    if (status === 'accept' && !isKodiakWebRtcSupported()) {
      if (shouldUseKodiakBrowserCallFallback()) {
        await openLinuxCallFallbackInBrowser();
        return;
      }

      setCallStatusText(getKodiakWebRtcUnsupportedMessage());

      try {
        await sendKodiakCallSignal(session, 'decline');
      } catch (error) {
        console.warn('[Kodiak Connect] Failed to decline unsupported call', error);
      }

      cleanupKodiakVoiceCall();
      activeCallSessionRef.current = null;
      setActiveCallSession(null);
      return;
    }

    try {
      await sendKodiakCallSignal(session, status);

      if (status === 'accept') {
        stopKodiakCallSounds();
        setActiveCallSession({ ...session, connectedAt: session.connectedAt ?? Date.now(), status: 'connected' });
        stopKodiakCallSounds();
        setCallStatusText('Call accepted. Connecting audio...');

        if (pendingCallOfferSdpRef.current) {
          await answerKodiakWebRtcOffer(session, pendingCallOfferSdpRef.current);
        } else {
          setCallStatusText('Waiting for call audio offer...');
        }
        void playKodiakSound('notify', 0.55, { force: true });
      } else {
        cleanupKodiakVoiceCall();
        setActiveCallSession(null);
        setCallStatusText(null);
        void playKodiakSound('notify', 0.45, { force: true });
      }
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to respond to call', error);
      setCallStatusText('Could not respond to the call.');
    }
  }

  async function endKodiakCall() {
    const session = activeCallSessionRef.current;

    if (!session) {
      return;
    }

    cleanupKodiakVoiceCall();
    activeCallSessionRef.current = null;
    setActiveCallSession(null);
    setCallStatusText(null);

    try {
      await sendKodiakCallSignal(session, 'end');
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to send call end signal', error);
    }
  }

  async function sendDirectMessagePushIfNeeded(targetRoomId: string) {
    const directMessageTargetUserId = getDirectMessageTargetUserId(activeChannel, identity.userId);

    if (activeChannel.kind !== 'dm' || !directMessageTargetUserId || directMessageTargetUserId === identity.userId) {
      return;
    }

    try {
      await notifyKodiakDirectMessage(identity, {
        roomId: targetRoomId,
        targetUserId: directMessageTargetUserId,
      });
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to send direct message push notification', error);
    }
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

  async function handleBrowserNotificationToggle(enabled: boolean) {
    setSettingsErrorText(null);

    if (!enabled) {
      setAreBrowserNotificationsEnabled(false);
      return;
    }

    if (!isKodiakDesktopNotificationAvailable()) {
      setSettingsErrorText('Desktop notifications are not supported in this environment.');
      setAreBrowserNotificationsEnabled(false);
      return;
    }

    const hasPermission = await requestKodiakDesktopNotificationPermission();
    setAreBrowserNotificationsEnabled(hasPermission);

    if (!hasPermission) {
      setSettingsErrorText('Desktop notification permission was not granted.');
    }
  }

  async function handleSendFriendRequestClick(userId: string) {
    if (isUserRestricted(userId)) {
      setProfileActionErrorText('Cannot send a friend request while a block is active.');
      setErrorText(null);
      return;
    }

    if (!onSendFriendRequest) {
      return;
    }

    setFriendActionUserId(userId);
    setProfileActionErrorText(null);
    setErrorText(null);

    try {
      await onSendFriendRequest(userId, getKnownDisplayName(userId));
    } catch (error) {
      console.error('[Kodiak Connect] Failed to send friend request', error);
      setErrorText(null);
      setProfileActionErrorText(error instanceof Error ? error.message : 'Could not send friend request. Try again.');
    } finally {
      setFriendActionUserId(null);
    }
  }

  async function handleAcceptFriendRequestClick(userId: string) {
    if (!onAcceptFriendRequest) {
      return;
    }

    setFriendActionUserId(userId);
    setErrorText(null);

    try {
      await onAcceptFriendRequest(userId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to accept friend request', error);
      setErrorText('Could not accept friend request. Try again.');
    } finally {
      setFriendActionUserId(null);
    }
  }

  async function handleDeclineFriendRequestClick(userId: string) {
    if (!onDeclineFriendRequest) {
      return;
    }

    setFriendActionUserId(userId);
    setErrorText(null);

    try {
      await onDeclineFriendRequest(userId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to decline friend request', error);
      setErrorText('Could not decline friend request. Try again.');
    } finally {
      setFriendActionUserId(null);
    }
  }

  function requestUnfriendUser(userId: string) {
    setPendingUnfriendUserId(userId);
  }

  async function handleCancelFriendRequestClick(userId: string) {
    if (!onCancelFriendRequest) {
      return;
    }

    setFriendActionUserId(userId);
    setErrorText(null);

    try {
      await onCancelFriendRequest(userId);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to cancel friend request', error);
      setErrorText('Could not cancel friend request. Try again.');
    } finally {
      setFriendActionUserId(null);
    }
  }

  async function handleUnfriendUserClick(userId: string) {
    if (!onUnfriendUser) {
      return;
    }

    setFriendActionUserId(userId);
    setErrorText(null);

    try {
      await onUnfriendUser(userId);
      setPendingUnfriendUserId(null);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to unfriend user', error);
      setErrorText('Could not remove friend. Try again.');
    } finally {
      setFriendActionUserId(null);
    }
  }

  async function refreshSafetyReports() {
    setIsLoadingSafetyReports(true);
    setSafetyReportErrorText(null);

    try {
      const reports = await loadKodiakReports(identity);
      setSafetyReports(reports);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to load safety reports', error);
      setSafetyReportErrorText(error instanceof Error ? error.message : 'Could not load report history.');
    } finally {
      setIsLoadingSafetyReports(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<boolean>('get_start_minimized'))
      .then((enabled) => {
        if (!cancelled) {
          setIsStartMinimizedEnabled(Boolean(enabled));
        }
      })
      .catch((error) => {
        console.warn('[Kodiak Connect] Failed to load start minimized setting', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleStartMinimizedChange(enabled: boolean) {
    setIsStartMinimizedEnabled(enabled);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const savedValue = await invoke<boolean>('set_start_minimized', { enabled });
      setIsStartMinimizedEnabled(Boolean(savedValue));
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to save start minimized setting', error);
      setIsStartMinimizedEnabled(!enabled);
      setSettingsErrorText('Could not save startup setting.');
    }
  }

  async function handleTestKodiakSound() {
    unlockKodiakSounds();
    setSoundTestText('Playing test sound...');

    const played = await playKodiakSound('messageReceived', 0.72, { force: true });
    setSoundTestText(played ? 'Sound test played.' : 'Sound test failed. Check Linux audio output and installed codecs.');
  }

  function openSafetyCenter() {
    setIsSafetyCenterOpen(true);
    void refreshSafetyReports();
  }

  function requestReportUser(userId: string) {
    setPendingReportUserId(userId);
    setReportCategory('harassment');
    setReportDetails('');
    setReportErrorText(null);
    setReportSuccessText(null);
  }

  async function handleSubmitReportUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pendingReportUserId) {
      return;
    }

    const trimmedDetails = reportDetails.trim();

    if (trimmedDetails.length < 5) {
      setReportErrorText('Please add a short description before submitting.');
      return;
    }

    setIsSubmittingReport(true);
    setReportErrorText(null);
    setReportSuccessText(null);

    try {
      await submitKodiakReport(identity, {
        category: reportCategory,
        context: activeChannel.name,
        details: trimmedDetails,
        roomId: roomId ?? '',
        targetAvatarUrl: avatarUrlsByUserId[pendingReportUserId] ?? '',
        targetDisplayName: getKnownDisplayName(pendingReportUserId),
        targetUserId: pendingReportUserId,
      });

      void refreshSafetyReports();
      setReportSuccessText('Report submitted. Kodiak Trust & Safety can review it.');
      setReportDetails('');
    } catch (error) {
      console.error('[Kodiak Connect] Failed to submit report', error);
      setReportErrorText(error instanceof Error ? error.message : 'Could not submit report. Try again.');
    } finally {
      setIsSubmittingReport(false);
    }
  }

  function requestBlockUser(userId: string) {
    setPendingBlockUserId(userId);
  }

  function requestUnblockUser(userId: string) {
    setPendingUnblockUserId(userId);
  }

  async function handleBlockUserClick(userId: string) {
    if (!onBlockUser) {
      return;
    }

    setFriendActionUserId(userId);
    setErrorText(null);

    try {
      await onBlockUser(userId);
      setPendingBlockUserId(null);
      setOpenProfileUserId(null);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to block user', error);
      setErrorText('Could not block user. Try again.');
    } finally {
      setFriendActionUserId(null);
    }
  }

  async function handleUnblockUserClick(userId: string) {
    if (!onUnblockUser) {
      return;
    }

    setFriendActionUserId(userId);
    setErrorText(null);

    try {
      await onUnblockUser(userId);
      setPendingUnblockUserId(null);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to unblock user', error);
      setErrorText('Could not unblock user. Try again.');
    } finally {
      setFriendActionUserId(null);
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

  async function readAvatarDataUrl(file: File) {
    const sourceDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read profile picture.'));
      reader.readAsDataURL(file);
    });

    return await new Promise<string>((resolve) => {
      const image = new Image();

      image.onload = () => {
        const maxSize = 256;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');

        if (!context) {
          resolve(sourceDataUrl);
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };

      image.onerror = () => resolve(sourceDataUrl);
      image.src = sourceDataUrl;
    });
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

    setIsSavingSettings(true);
    setSettingsErrorText(null);

    try {
      const savedProfile = await saveKodiakProfile(identity, {
        bio: nextBio,
        displayName: nextDisplayName,
      });

      setDisplayNamesByUserId((currentNames) => ({
        ...currentNames,
        [identity.userId]: savedProfile?.displayName ?? nextDisplayName,
      }));

      setProfileBiosByUserId((currentBios) => ({
        ...currentBios,
        [identity.userId]: savedProfile?.bio ?? nextBio,
      }));

      let nextAvatarSource = '';
      let avatarUploadFailed = false;

      if (avatarFile) {
        try {
          nextAvatarSource = await uploadProfileAvatar(identity, avatarFile);

          const savedAvatarProfile = await saveKodiakProfile(identity, {
            avatarUrl: nextAvatarSource,
            bio: nextBio,
            displayName: nextDisplayName,
          });

          setDisplayNamesByUserId((currentNames) => ({
            ...currentNames,
            [identity.userId]: savedAvatarProfile?.displayName ?? nextDisplayName,
          }));

          setProfileBiosByUserId((currentBios) => ({
            ...currentBios,
            [identity.userId]: savedAvatarProfile?.bio ?? nextBio,
          }));
        } catch (avatarError) {
          console.error('[Kodiak Connect] Failed to upload profile avatar through Matrix media. Falling back to optimized backend avatar data URL.', avatarError);

          try {
            nextAvatarSource = await readAvatarDataUrl(avatarFile);

            const savedAvatarProfile = await saveKodiakProfile(identity, {
              avatarUrl: nextAvatarSource,
              bio: nextBio,
              displayName: nextDisplayName,
            });

            setDisplayNamesByUserId((currentNames) => ({
              ...currentNames,
              [identity.userId]: savedAvatarProfile?.displayName ?? nextDisplayName,
            }));

            setProfileBiosByUserId((currentBios) => ({
              ...currentBios,
              [identity.userId]: savedAvatarProfile?.bio ?? nextBio,
            }));
          } catch (fallbackError) {
            avatarUploadFailed = true;
            console.error('[Kodiak Connect] Failed to save fallback profile avatar', fallbackError);
            setSettingsErrorText('Profile text saved, but the profile picture upload failed. Try a smaller PNG/JPG.');
          }
        }
      }

      if (nextAvatarSource) {
        const authenticatedAvatarUrl = nextAvatarSource.startsWith('mxc://')
          ? await getAuthenticatedMatrixMediaObjectUrl(identity, nextAvatarSource, 96, 96).catch(() => null)
          : nextAvatarSource;
        const savedAvatarUrl = authenticatedAvatarUrl || avatarPreviewUrl || '';

        if (savedAvatarUrl) {
          setAvatarUrlsByUserId((currentAvatars) => ({
            ...currentAvatars,
            [identity.userId]: savedAvatarUrl,
          }));

          backendAvatarObjectUrlsRef.current[identity.userId] = {
            source: nextAvatarSource,
            url: savedAvatarUrl,
          };
        }
      }

      if (avatarUploadFailed) {
        return;
      }

      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setIsSettingsOpen(false);
    } catch (error) {
      console.error('[Kodiak Connect] Failed to save profile settings', error);
      setSettingsErrorText(error instanceof Error ? error.message : 'Could not save profile settings. Try again.');
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function copyMessageTextToClipboard(messageBody: string) {
    try {
      await navigator.clipboard.writeText(messageBody);
      setErrorText('Copied message text.');
    } catch (error) {
      console.warn('[Kodiak Connect] Failed to copy message text', error);
      setErrorText('Could not copy message text.');
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    unlockKodiakSounds();

    const trimmedMessage = draftMessage.trim();

    if (!roomId || !trimmedMessage || !canPost) {
      return;
    }

    if (doesMessageMentionRestrictedUser(trimmedMessage)) {
      setErrorText('You cannot @mention someone while a block is active.');
      return;
    }

    if (doesMessageMentionBlockedUser(trimmedMessage)) {
      setErrorText('You cannot @mention someone while a block is active.');
      return;
    }

    const targetRoomId = roomId;
    const replyContext = replyTarget;
    const activeEditTarget = editingMessage;
    const shouldPlaySentSound = !activeEditTarget && areMessageSoundsEnabled && isSentSoundEnabled;

    setErrorText(null);

    void stopTyping().catch((error) => {
      console.warn('[Kodiak Connect] Failed to stop Matrix typing notification before send', error);
    });

    if (!activeEditTarget) {
      setDraftMessage('');
      setReplyTarget(null);
      setIsSending(false);

      window.requestAnimationFrame(() => {
        composerInputRef.current?.focus();
      });

      if (shouldPlaySentSound) {
        playKodiakSound('messageSent', 0.55);
      }

      void sendTextMessage(identity, targetRoomId, buildReplyBody(replyContext, trimmedMessage))
        .then(async () => {
          await sendDirectMessagePushIfNeeded(targetRoomId);
          await refreshMessages(targetRoomId);
        })
        .catch((error) => {
          console.error('[Kodiak Connect] Failed to send Matrix message', error);
          setDraftMessage((currentDraft) => currentDraft || trimmedMessage);
          setReplyTarget((currentReplyTarget) => currentReplyTarget ?? replyContext);
          setErrorText(getMatrixErrorMessage(error, activeChannel));

          window.requestAnimationFrame(() => {
            composerInputRef.current?.focus();
          });
        });

      return;
    }

    setIsSending(true);

    try {
      await sendReplacementMessage(identity, targetRoomId, activeEditTarget.eventId, trimmedMessage);
      setEditingMessage(null);
      setDraftMessage('');
      setReplyTarget(null);

      void refreshMessages(targetRoomId).catch((error) => {
        console.error('[Kodiak Connect] Matrix room refresh failed after edit', error);
      });

      window.requestAnimationFrame(() => {
        composerInputRef.current?.focus();
      });
    } catch (error) {
      console.error('[Kodiak Connect] Failed to edit Matrix message', error);
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
        {activeChannel.kind === 'dm' ? (
          <div className="kodiak-call-actions">
            <button
              type="button"
              className="kodiak-call-button"
              onClick={() => void startKodiakCall('voice')}
              disabled={!roomId || !activeDmTargetUserId || Boolean(activeCallSession)}
              title={activeDmTargetUserId ? 'Start voice call with ' + activeDmTargetDisplayName : 'Open a direct message to start a call'}
            >
              Voice Call
            </button>
            <button
              type="button"
              className="kodiak-call-button kodiak-call-button--video"
              onClick={() => void startKodiakCall('video')}
              disabled={!roomId || !activeDmTargetUserId || Boolean(activeCallSession)}
              title={activeDmTargetUserId ? 'Start video call with ' + activeDmTargetDisplayName : 'Open a direct message to start a call'}
            >
              Video Call
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="chat-placeholder__user chat-placeholder__user--button"
          onClick={() => {
            setDisplayNameDraft(getKnownDisplayName(identity.userId));
            setAvatarFile(null);
            setAvatarPreviewUrl(null);
            setBioDraft(profileBiosByUserId[identity.userId] ?? '');
            setSettingsErrorText(null);
            setSettingsTab('profile');
            setIsSettingsOpen(true);
          }}
        >
          {renderUserAvatar(identity.userId, 'matrix-avatar--pill')}
          <span className="status-light status-light--online" aria-hidden="true" />
          <span>{headerDisplayName}</span>
        </button>
      </header>

      {activeCallSession ? (
        <div className={'kodiak-call-panel kodiak-call-panel--' + activeCallSession.direction}>
          <div>
            <strong>
              {activeCallSession.status === 'connected'
                ? 'Active ' + getCallKindLabel(activeCallSession.callKind)
                : activeCallSession.direction === 'incoming'
                  ? 'Incoming ' + getCallKindLabel(activeCallSession.callKind)
                  : 'Outgoing ' + getCallKindLabel(activeCallSession.callKind)}
            </strong>
            <span>{activeCallSession.displayName}</span>
            <div className="kodiak-call-panel__participants">
              {renderKodiakCallParticipant(identity.userId, getKnownDisplayName(identity.userId), 'self')}
              {renderKodiakCallParticipant(activeCallSession.targetUserId, activeCallSession.displayName, 'remote')}
            </div>
            {activeCallSession.status === 'connected' ? (
              <span className="kodiak-call-panel__duration">
                {formatKodiakCallDuration(activeCallSession.connectedAt ?? activeCallSession.startedAt, callDurationTick)}
              </span>
            ) : null}
          </div>
          <audio ref={remoteCallAudioRef} className="kodiak-call-audio" autoPlay playsInline />
          <div className={'kodiak-call-stage kodiak-call-stage--' + (activeCallSession.callKind === 'video' || isCallCameraEnabled || hasRemoteCallVideo ? 'video' : 'voice')}>
            {activeCallSession.callKind === 'video' || isCallCameraEnabled || hasRemoteCallVideo ? (
              <>
                <video ref={remoteCallVideoRef} className="kodiak-call-stage__remote" autoPlay playsInline />
                <video ref={localCallVideoRef} className="kodiak-call-stage__local" autoPlay muted playsInline />
              </>
            ) : (
              <>
                {callStatusText ? (
                  <div className="kodiak-call-panel__notice">{callStatusText}</div>
                ) : null}
                <div className="kodiak-call-stage__voice">
                <div className="kodiak-call-stage__avatars" aria-label="Call participants">
                  <div className={'kodiak-call-stage__avatar-wrap kodiak-call-stage__avatar-wrap--self' + (speakingCallParticipant === 'self' ? ' kodiak-call-stage__avatar-wrap--speaking' : '')}>
                    {renderUserAvatar(identity.userId, 'matrix-avatar--call-stage')}
                    <span>{getKnownDisplayName(identity.userId)}</span>
                  </div>
                  <div className={'kodiak-call-stage__avatar-wrap kodiak-call-stage__avatar-wrap--remote' + (speakingCallParticipant === 'remote' ? ' kodiak-call-stage__avatar-wrap--speaking' : '')}>
                    {renderUserAvatar(activeCallSession.targetUserId, 'matrix-avatar--call-stage')}
                    <span>{activeCallSession.displayName}</span>
                  </div>
                </div>
                <small>
                  {speakingCallParticipant === 'self'
                    ? getKnownDisplayName(identity.userId) + ' is speaking'
                    : speakingCallParticipant === 'remote'
                      ? activeCallSession.displayName + ' is speaking'
                      : activeCallSession.status === 'connected'
                        ? 'Voice connected'
                        : 'Connecting voice...'}
                </small>
              </div>
              </>
            )}
          </div>
          <div className="kodiak-call-panel__actions">
            {activeCallSession.direction === 'incoming' && activeCallSession.status === 'ringing' ? (
              <>
                <button type="button" onClick={() => void respondToKodiakCall('accept')}>
                  Accept
                </button>
                <button type="button" onClick={() => void respondToKodiakCall('decline')}>
                  Decline
                </button>
              </>
            ) : null}
            {activeCallSession.status === 'connected' ? (
              <>
                <button type="button" className="kodiak-call-panel__mute" onClick={toggleKodiakCallMute}>
                  {isCallMuted ? 'Unmute' : 'Mute'}
                </button>
                <button type="button" className="kodiak-call-panel__camera" onClick={() => void toggleKodiakCallCamera()}>
                  {isCallCameraEnabled ? 'Camera Off' : 'Camera On'}
                </button>
              </>
            ) : null}
            <button type="button" className="kodiak-call-panel__end" onClick={() => void endKodiakCall()}>
              End
            </button>
          </div>
        </div>
      ) : callStatusText ? (
        <div className="kodiak-call-status">{callStatusText}</div>
      ) : null}

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
            {visibleMessages.map((message: MatrixTextMessage) => {
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
                      <span className="matrix-reply-thread-link__arrow" aria-hidden="true">Reply</span>
                      <strong>{parsedMessage.reply.sender}</strong>
                      <span className="matrix-reply-thread-link__separator" aria-hidden="true"> - </span>
                      <span className="matrix-reply-thread-link__preview">{parsedMessage.reply.preview}</span>
                    </button>
                  ) : null}

                  <article
                    ref={(element) => {
                      messageElementRefs.current[message.eventId] = element;
                    }}
                    className={`matrix-message ${isOwnMessage ? 'matrix-message--own' : ''}`}
                    data-message-event-id={message.eventId}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openMessageActionMenu(message, event.clientX, event.clientY);
                    }}
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

        {isJumpToLatestVisible ? (
          <button
            type="button"
            className="matrix-jump-to-latest"
            onClick={scrollToLatestMessages}
            aria-label="Jump to latest message"
          >
            <span aria-hidden="true">&darr;</span>
            <strong>Latest</strong>
          </button>
        ) : null}
      </div>

      <aside className={`matrix-member-panel ${isMemberPanelOpen ? '' : 'matrix-member-panel--collapsed'}`} aria-label="Room members">
        <button
          type="button"
          className="matrix-member-panel__toggle"
          aria-label={isMemberPanelOpen ? 'Hide member panel' : 'Show member panel'}
          title={isMemberPanelOpen ? 'Hide members' : 'Show members'}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleMemberPanel();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onToggleMemberPanel();
            }
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d={isMemberPanelOpen ? 'M9 5l6 7-6 7' : 'M15 5l-6 7 6 7'}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
            />
          </svg>
        </button>

        <div className="matrix-member-panel__inner">
        <div className="matrix-member-panel__header">
          <span>Members</span>
          <strong>{visibleRoomMemberUserIds.length}</strong>
        </div>

        <div className="matrix-member-list">
          {visibleRoomMemberUserIds.map((userId: string) => (
            <button key={userId} type="button" className="matrix-member-row" onClick={() => setOpenProfileUserId(userId)}>
              <span className="matrix-member-row__avatar">
                {renderUserAvatar(userId, 'matrix-avatar--member')}
                <i className={`matrix-presence-dot matrix-presence-dot--${getKnownPresence(userId)}`} aria-hidden="true" />
              </span>
              <span>
                <strong>{getKnownDisplayName(userId)}</strong>
                <small>
                  <i className={`matrix-presence-text-dot matrix-presence-text-dot--${getKnownPresence(userId)}`} aria-hidden="true" />
                  {getPresenceLabel(userId)} - {getMemberRoleLabel(userId)}
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

        {mentionSuggestions.filter((suggestion) => !isUserRestricted(suggestion.userId)).length ? (
          <div className="message-mention-suggestions" role="listbox" aria-label="Mention suggestions">
            {mentionSuggestions.filter((suggestion) => !isUserRestricted(suggestion.userId)).map((suggestion) => (
              <button key={suggestion.userId} type="button" onClick={() => insertMentionSuggestion(suggestion)}>
                {renderUserAvatar(suggestion.userId, 'matrix-avatar--suggestion')}
                <span>{suggestion.displayName}</span>
                <small>Press Tab to mention</small>
              </button>
            ))}
          </div>
        ) : null}

        <div className="message-composer-main-row">
          <KodiakAttachmentBridge identity={identity} />
          <textarea
            ref={composerInputRef}
            placeholder={editingMessage ? 'Edit message' : getComposerPlaceholder(activeChannel, canPost, roomId, replyTarget)}
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            disabled={!roomId || (isSending && Boolean(editingMessage)) || !canPost}
            rows={1}
            aria-label={editingMessage ? 'Edit message' : getComposerPlaceholder(activeChannel, canPost, roomId, replyTarget)}
          />
          <button type="submit" disabled={!roomId || (isSending && Boolean(editingMessage)) || !canPost || !draftMessage.trim()}>
          {isSending ? (editingMessage ? 'Saving...' : 'Sending...') : editingMessage ? 'Save' : activeChannel.readOnly ? 'Publish' : 'Send'}
          </button>
        </div>
      </form>

      {openActionMenu && openActionMenuMessage && openActionMenuParsedMessage ? createPortal(
        <div
          className="matrix-message-action-menu matrix-message-action-menu--floating kodiak-global-message-action-menu"
          style={{ position: 'fixed', left: openActionMenu.x, top: openActionMenu.y }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMessageActionMenu();
          }}
        >
          {openActionMenuMessage.sender !== identity.userId && onOpenDirectMessage ? (
            <button
              type="button"
              onClick={() => {
                onOpenDirectMessage(openActionMenuMessage.sender, getKnownDisplayName(openActionMenuMessage.sender));
                closeMessageActionMenu();
              }}
            >
              Message {getKnownDisplayName(openActionMenuMessage.sender)}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              void copyMessageTextToClipboard(openActionMenuParsedMessage.body);
              closeMessageActionMenu();
            }}
          >
            Copy text
          </button>

          {canPost ? (
            <button
              type="button"
              onClick={() => {
                setReactionPickerMessageId((currentMessageId) =>
                  currentMessageId === openActionMenuMessage.eventId ? null : openActionMenuMessage.eventId,
                );
                closeMessageActionMenu();
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
                closeMessageActionMenu();
              }}
            >
              Reply
            </button>
          ) : null}

          {openActionMenuMessage.sender === identity.userId ? (
            <button
              type="button"
              onClick={() => {
                startEditingMessage({ ...openActionMenuMessage, body: openActionMenuParsedMessage.body });
                closeMessageActionMenu();
              }}
            >
              Edit
            </button>
          ) : null}

          {openActionMenuMessage.sender === identity.userId || canModerate ? (
            <button
              type="button"
              className="matrix-message-action--danger"
              onClick={() => {
                requestDeleteMessage(openActionMenuMessage);
                closeMessageActionMenu();
              }}
            >
              Delete
            </button>
          ) : null}
        </div>,
        document.body,
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
              {openProfileUserId !== identity.userId ? (
                isUserBlocked(openProfileUserId) ? (
                  <button type="button" disabled>Blocked</button>
                ) : getFriendStatus(openProfileUserId) === 'friends' ? (
                  <button type="button" disabled>Friends</button>
                ) : getFriendStatus(openProfileUserId) === 'outgoing' ? (
                  <button
                    type="button"
                    className="kodiak-profile-card__danger"
                    disabled={friendActionUserId === openProfileUserId || !onCancelFriendRequest}
                    onClick={() => void handleCancelFriendRequestClick(openProfileUserId)}
                  >
                    {friendActionUserId === openProfileUserId ? 'Canceling...' : 'Cancel Request'}
                  </button>
                ) : getFriendStatus(openProfileUserId) === 'incoming' ? (
                  <>
                    <button type="button" disabled={friendActionUserId === openProfileUserId} onClick={() => void handleAcceptFriendRequestClick(openProfileUserId)}>
                      {friendActionUserId === openProfileUserId ? 'Accepting...' : 'Accept'}
                    </button>
                    <button type="button" disabled={friendActionUserId === openProfileUserId} onClick={() => void handleDeclineFriendRequestClick(openProfileUserId)}>
                      Decline
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={friendActionUserId === openProfileUserId || !onSendFriendRequest} onClick={() => void handleSendFriendRequestClick(openProfileUserId)}>
                    {friendActionUserId === openProfileUserId ? 'Sending...' : 'Add Friend'}
                  </button>
                )
              ) : null}
              {openProfileUserId !== identity.userId ? (
                isUserBlocked(openProfileUserId) ? (
                  <button
                    type="button"
                    className="kodiak-profile-card__danger"
                    disabled={friendActionUserId === openProfileUserId || !onUnblockUser}
                    onClick={() => requestUnblockUser(openProfileUserId)}
                  >
                    Unblock
                  </button>
                ) : (
                  <button
                    type="button"
                    className="kodiak-profile-card__danger"
                    disabled={friendActionUserId === openProfileUserId || !onBlockUser}
                    onClick={() => requestBlockUser(openProfileUserId)}
                  >
                    Block
                  </button>
                )
              ) : null}
              {openProfileUserId !== identity.userId ? (
                <button
                  type="button"
                  className="kodiak-profile-card__danger"
                  onClick={() => requestReportUser(openProfileUserId)}
                >
                  Report
                </button>
              ) : null}
            </div>

            {profileActionErrorText ? (
              <p className="kodiak-profile-card__action-error" role="alert">
                {profileActionErrorText}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {pendingReportUserId ? (
        <div className="kodiak-modal-backdrop kodiak-modal-backdrop--stacked" role="presentation" onClick={() => setPendingReportUserId(null)}>
          <form
            className="kodiak-report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-modal-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void handleSubmitReportUser(event)}
          >
            <div className="kodiak-report-modal__header">
              <p className="eyebrow eyebrow--ember">Trust & Safety</p>
              <h2 id="report-modal-title">Report {getKnownDisplayName(pendingReportUserId)}</h2>
              <p>Send a report to Kodiak Trust & Safety. Blocking protects you; reporting helps protect the platform.</p>
            </div>

            <div className="kodiak-report-modal__user">
              {renderUserAvatar(pendingReportUserId, 'matrix-avatar--suggestion')}
              <div>
                <strong>{getKnownDisplayName(pendingReportUserId)}</strong>
                <span>{pendingReportUserId}</span>
              </div>
            </div>

            {reportSuccessText ? (
              <div className="kodiak-report-modal__success" role="status">
                {reportSuccessText}
              </div>
            ) : (
              <>
                <label className="kodiak-report-modal__field">
                  <span>Reason</span>
                  <select value={reportCategory} onChange={(event) => setReportCategory(event.target.value as KodiakReportCategory)}>
                    <option value="harassment">Harassment or abuse</option>
                    <option value="spam">Spam</option>
                    <option value="scam">Scam or suspicious behavior</option>
                    <option value="threats">Threats or safety concern</option>
                    <option value="impersonation">Impersonation</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <label className="kodiak-report-modal__field">
                  <span>Details</span>
                  <textarea
                    value={reportDetails}
                    onChange={(event) => setReportDetails(event.target.value)}
                    placeholder="What happened?"
                    maxLength={1500}
                    rows={5}
                  />
                  <small>{reportDetails.length}/1500</small>
                </label>

                {reportErrorText ? (
                  <p className="kodiak-report-modal__error" role="alert">
                    {reportErrorText}
                  </p>
                ) : null}
              </>
            )}

            <div className="kodiak-report-modal__actions">
              <button
                type="button"
                onClick={() => {
                  setPendingReportUserId(null);
                  setReportErrorText(null);
                  setReportSuccessText(null);
                }}
              >
                {reportSuccessText ? 'Done' : 'Cancel'}
              </button>

              {!reportSuccessText ? (
                <button type="submit" className="kodiak-report-modal__danger" disabled={isSubmittingReport}>
                  {isSubmittingReport ? 'Submitting...' : 'Submit Report'}
                </button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      {pendingBlockUserId ? (
        <div className="kodiak-modal-backdrop kodiak-modal-backdrop--stacked" role="presentation" onClick={() => setPendingBlockUserId(null)}>
          <div
            className="kodiak-block-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="block-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kodiak-block-modal__header">
              <p className="eyebrow eyebrow--ember">Safety</p>
              <h2 id="block-modal-title">Block {getKnownDisplayName(pendingBlockUserId)}?</h2>
              <p>This removes them from your Friend Center and hides them from user search. Message suppression is coming next.</p>
            </div>

            <div className="kodiak-block-modal__user">
              {renderUserAvatar(pendingBlockUserId, 'matrix-avatar--suggestion')}
              <div>
                <strong>{getKnownDisplayName(pendingBlockUserId)}</strong>
                <span>User will be blocked</span>
              </div>
            </div>

            <div className="kodiak-block-modal__actions">
              <button type="button" onClick={() => setPendingBlockUserId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="kodiak-block-modal__danger"
                disabled={friendActionUserId === pendingBlockUserId}
                onClick={() => void handleBlockUserClick(pendingBlockUserId)}
              >
                {friendActionUserId === pendingBlockUserId ? 'Blocking...' : 'Block'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingUnblockUserId ? (
        <div className="kodiak-modal-backdrop kodiak-modal-backdrop--stacked" role="presentation" onClick={() => setPendingUnblockUserId(null)}>
          <div
            className="kodiak-block-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unblock-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kodiak-block-modal__header">
              <p className="eyebrow eyebrow--ember">Safety</p>
              <h2 id="unblock-modal-title">Unblock {getKnownDisplayName(pendingUnblockUserId)}?</h2>
              <p>They will be visible in user search again. This does not automatically restore friendship.</p>
            </div>

            <div className="kodiak-block-modal__user">
              {renderUserAvatar(pendingUnblockUserId, 'matrix-avatar--suggestion')}
              <div>
                <strong>{getKnownDisplayName(pendingUnblockUserId)}</strong>
                <span>User will be unblocked</span>
              </div>
            </div>

            <div className="kodiak-block-modal__actions">
              <button type="button" onClick={() => setPendingUnblockUserId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="kodiak-block-modal__danger"
                disabled={friendActionUserId === pendingUnblockUserId}
                onClick={() => void handleUnblockUserClick(pendingUnblockUserId)}
              >
                {friendActionUserId === pendingUnblockUserId ? 'Unblocking...' : 'Unblock'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingUnfriendUserId ? (
        <div className="kodiak-modal-backdrop kodiak-modal-backdrop--stacked" role="presentation" onClick={() => setPendingUnfriendUserId(null)}>
          <div
            className="kodiak-unfriend-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unfriend-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="kodiak-unfriend-modal__header">
              <p className="eyebrow eyebrow--ember">Friend Center</p>
              <h2 id="unfriend-modal-title">Unfriend {getKnownDisplayName(pendingUnfriendUserId)}?</h2>
              <p>This removes them from your Friend Center. You can send another request later.</p>
            </div>

            <div className="kodiak-unfriend-modal__user">
              {renderUserAvatar(pendingUnfriendUserId, 'matrix-avatar--suggestion')}
              <div>
                <strong>{getKnownDisplayName(pendingUnfriendUserId)}</strong>
                <span>Friend</span>
              </div>
            </div>

            <div className="kodiak-unfriend-modal__actions">
              <button type="button" onClick={() => setPendingUnfriendUserId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="kodiak-unfriend-modal__danger"
                disabled={friendActionUserId === pendingUnfriendUserId}
                onClick={() => void handleUnfriendUserClick(pendingUnfriendUserId)}
              >
                {friendActionUserId === pendingUnfriendUserId ? 'Removing...' : 'Unfriend'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSafetyCenterOpen ? (
        <div className="kodiak-modal-backdrop" role="presentation" onClick={() => setIsSafetyCenterOpen(false)}>
          <div
            className="kodiak-safety-center-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="safety-center-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="kodiak-safety-center-modal__close"
              aria-label="Close Safety Center"
              onClick={() => setIsSafetyCenterOpen(false)}
            >
              X
            </button>

            <div className="kodiak-safety-center-modal__header">
              <p className="eyebrow eyebrow--ember">Trust & Safety</p>
              <h2 id="safety-center-title">Safety Center</h2>
              <p>View reports you have submitted. Admin review tools come later.</p>
            </div>

            <div className="kodiak-safety-center-modal__toolbar">
              <span>{safetyReports.length} submitted report{safetyReports.length === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => void refreshSafetyReports()} disabled={isLoadingSafetyReports}>
                {isLoadingSafetyReports ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {safetyReportErrorText ? (
              <p className="kodiak-safety-center-modal__error" role="alert">
                {safetyReportErrorText}
              </p>
            ) : null}

            <div className="kodiak-safety-center-modal__body">
              {isLoadingSafetyReports && !safetyReports.length ? (
                <p className="kodiak-safety-center-empty">Loading report history...</p>
              ) : safetyReports.length ? (
                <div className="kodiak-safety-report-list">
                  {safetyReports.map((report) => (
                    <article key={report.id} className="kodiak-safety-report-card">
                      <div className="kodiak-safety-report-card__top">
                        <div>
                          <strong>{report.targetDisplayName || getKnownDisplayName(report.targetUserId)}</strong>
                          <span>{report.targetUserId}</span>
                        </div>
                        <em className="kodiak-safety-report-card__status">{report.status}</em>
                      </div>

                      <div className="kodiak-safety-report-card__meta">
                        <span>{getReportCategoryLabel(report.category)}</span>
                        <span>{new Date(report.createdAt).toLocaleString()}</span>
                      </div>

                      <p>{report.details}</p>

                      {report.context || report.roomId ? (
                        <small>
                          {report.context ? `Context: ${report.context}` : ''}
                          {report.context && report.roomId ? '  -  ' : ''}
                          {report.roomId ? `Room: ${report.roomId}` : ''}
                        </small>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="kodiak-safety-center-empty">No submitted reports yet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isFriendCenterOpen ? (
        <div className="kodiak-modal-backdrop" role="presentation" onClick={onCloseFriendCenter}>
          <div
            className="kodiak-friend-center-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="friend-center-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="kodiak-friend-center-modal__close"
              aria-label="Close Friend Center"
              onClick={onCloseFriendCenter}
            >
              X
            </button>

            <div className="kodiak-friend-center-modal__header">
              <p className="eyebrow eyebrow--ember">Social</p>
              <h2 id="friend-center-title">Friend Center</h2>
              <p>Manage friends, incoming requests, and outgoing requests.</p>
            </div>

            <div className="kodiak-friend-center-modal__body">
              <section className="kodiak-friend-center-section kodiak-friend-center-section--blocked">
                <div className="kodiak-friend-center-section__heading">
                  <span>Blocked Users</span>
                  <strong>{blockedUserIds.length}</strong>
                </div>

                {blockedUserIds.length ? (
                  <div className="kodiak-friend-center-list">
                    {blockedUserIds.map((userId) => (
                      <div key={userId} className="kodiak-friend-center-row">
                        {renderUserAvatar(userId, 'matrix-avatar--suggestion')}
                        <div>
                          <strong>{getKnownDisplayName(userId)}</strong>
                          <small>Blocked</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onCloseFriendCenter?.();
                            setOpenProfileUserId(userId);
                          }}
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          className="kodiak-friend-center-row__danger"
                          disabled={friendActionUserId === userId || !onUnblockUser}
                          onClick={() => void handleUnblockUserClick(userId)}
                        >
                          {friendActionUserId === userId ? 'Unblocking...' : 'Unblock'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="kodiak-friend-center-empty">No blocked users.</p>
                )}
              </section>
              <section className="kodiak-friend-center-section">
                <div className="kodiak-friend-center-section__heading">
                  <span>Incoming Requests</span>
                  <strong>{incomingFriendUserIds.length}</strong>
                </div>

                {incomingFriendUserIds.length ? (
                  <div className="kodiak-friend-center-list">
                    {incomingFriendUserIds.map((userId) => (
                      <div key={userId} className="kodiak-friend-center-row">
                        {renderUserAvatar(userId, 'matrix-avatar--suggestion')}
                        <div>
                          <strong>{getKnownDisplayName(userId)}</strong>
                          <small>Wants to be friends</small>
                        </div>
                        <button type="button" disabled={friendActionUserId === userId} onClick={() => void handleAcceptFriendRequestClick(userId)}>
                          Accept
                        </button>
                        <button type="button" disabled={friendActionUserId === userId} onClick={() => void handleDeclineFriendRequestClick(userId)}>
                          Decline
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onCloseFriendCenter?.();
                            setOpenProfileUserId(userId);
                          }}
                        >
                          Profile
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="kodiak-friend-center-empty">No incoming friend requests.</p>
                )}
              </section>

              <section className="kodiak-friend-center-section">
                <div className="kodiak-friend-center-section__heading">
                  <span>Friends</span>
                  <strong>{friendUserIds.length}</strong>
                </div>

                {friendUserIds.length ? (
                  <div className="kodiak-friend-center-list">
                    {friendUserIds.map((userId) => (
                      <div key={userId} className="kodiak-friend-center-row">
                        {renderUserAvatar(userId, 'matrix-avatar--suggestion')}
                        <div>
                          <strong>{getKnownDisplayName(userId)}</strong>
                          <small>Friend</small>
                        </div>
                        {onOpenDirectMessage ? (
                          <button
                            type="button"
                            onClick={() => {
                              onOpenDirectMessage(userId, getKnownDisplayName(userId));
                              onCloseFriendCenter?.();
                            }}
                          >
                            Message
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            onCloseFriendCenter?.();
                            setOpenProfileUserId(userId);
                          }}
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          className="kodiak-friend-center-row__danger"
                          disabled={friendActionUserId === userId}
                          onClick={() => requestUnfriendUser(userId)}
                        >
                          {friendActionUserId === userId ? 'Removing...' : 'Unfriend'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="kodiak-friend-center-empty">No friends yet.</p>
                )}
              </section>

              <section className="kodiak-friend-center-section">
                <div className="kodiak-friend-center-section__heading">
                  <span>Outgoing Requests</span>
                  <strong>{outgoingFriendUserIds.length}</strong>
                </div>

                {outgoingFriendUserIds.length ? (
                  <div className="kodiak-friend-center-list">
                    {outgoingFriendUserIds.map((userId) => (
                      <div key={userId} className="kodiak-friend-center-row">
                        {renderUserAvatar(userId, 'matrix-avatar--suggestion')}
                        <div>
                          <strong>{getKnownDisplayName(userId)}</strong>
                          <small>Pending request</small>
                        </div>
                        <em>Pending</em>
                        <button
                          type="button"
                          className="kodiak-friend-center-row__danger"
                          disabled={friendActionUserId === userId || !onCancelFriendRequest}
                          onClick={() => void handleCancelFriendRequestClick(userId)}
                        >
                          {friendActionUserId === userId ? 'Canceling...' : 'Cancel'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onCloseFriendCenter?.();
                            setOpenProfileUserId(userId);
                          }}
                        >
                          Profile
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="kodiak-friend-center-empty">No outgoing friend requests.</p>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="kodiak-modal-backdrop" role="presentation">
          <form className="kodiak-confirm-modal kodiak-settings-modal" role="dialog" aria-modal="true" aria-labelledby="account-settings-title" onSubmit={handleSaveAccountSettings}>
            <button
              type="button"
              className="kodiak-settings-modal__close"
              aria-label="Close profile settings"
              onClick={() => setIsSettingsOpen(false)}
            >
              X
            </button>
            <div className="kodiak-confirm-modal__header">
              <p className="eyebrow eyebrow--ember">Account settings</p>
              <h2 id="account-settings-title">Profile settings</h2>
              <p>This is how people see you in chats, DMs, replies, and mentions.</p>
            </div>

            <div className="kodiak-settings-tabs" role="tablist" aria-label="Settings sections">
              <button type="button" className={settingsTab === 'profile' ? 'is-active' : ''} onClick={() => setSettingsTab('profile')}>
                Profile
              </button>
              <button type="button" className={settingsTab === 'sounds' ? 'is-active' : ''} onClick={() => setSettingsTab('sounds')}>
                Sounds
              </button>
              <button type="button" className={settingsTab === 'themes' ? 'is-active' : ''} onClick={() => setSettingsTab('themes')}>
                Themes
              </button>
            </div>

            {settingsTab === 'profile' ? (
              <>
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
              </>
            ) : null}

            {settingsTab === 'sounds' ? (
              <div className="kodiak-sound-settings kodiak-sound-settings--panel">
                <strong>Sounds</strong>
                <p>These settings work inside the desktop app and are saved on this device.</p>
                <label>
                  <input
                    type="checkbox"
                    checked={areMessageSoundsEnabled}
                    onChange={(event) => setAreMessageSoundsEnabled(event.target.checked)}
                  />
                  <span>Message sounds</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={isSentSoundEnabled}
                    onChange={(event) => setIsSentSoundEnabled(event.target.checked)}
                    disabled={!areMessageSoundsEnabled}
                  />
                  <span>Sent sound</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={isReceivedSoundEnabled}
                    onChange={(event) => setIsReceivedSoundEnabled(event.target.checked)}
                    disabled={!areMessageSoundsEnabled}
                  />
                  <span>Received sound</span>
                </label>
                <button type="button" className="kodiak-settings-test-button" onClick={() => void handleTestKodiakSound()}>
                  Test received sound
                </button>
                {soundTestText ? <small className="kodiak-settings-help">{soundTestText}</small> : null}
              </div>
            ) : null}

            {settingsTab === 'themes' ? (
              <div className="kodiak-theme-settings">
                <strong>Themes</strong>
                <p>Default keeps the current Kodiak look. System follows your operating system preference. More themes can be added later.</p>

                <label className={themeMode === 'default' ? 'is-active' : ''}>
                  <input
                    type="radio"
                    name="kodiak-theme"
                    checked={themeMode === 'default'}
                    onChange={() => setThemeMode('default')}
                  />
                  <span>
                    <strong>Default</strong>
                    <small>Kodiak dark theme</small>
                  </span>
                </label>

                <label className={themeMode === 'system' ? 'is-active' : ''}>
                  <input
                    type="radio"
                    name="kodiak-theme"
                    checked={themeMode === 'system'}
                    onChange={() => setThemeMode('system')}
                  />
                  <span>
                    <strong>System settings</strong>
                    <small>Match your OS light or dark preference</small>
                  </span>
                </label>

                <div className="kodiak-startup-settings">
                  <strong>Startup</strong>
                  <label className={isStartMinimizedEnabled ? 'is-active' : ''}>
                    <input
                      type="checkbox"
                      checked={isStartMinimizedEnabled}
                      onChange={(event) => void handleStartMinimizedChange(event.target.checked)}
                    />
                    <span>
                      <strong>Start minimized to tray</strong>
                      <small>Open Kodiak Connect in the system tray instead of showing the window.</small>
                    </span>
                  </label>
                </div>
              </div>
            ) : null}

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














