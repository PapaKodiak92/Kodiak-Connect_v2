import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

export type KodiakPresenceState = 'online' | 'idle' | 'offline';
export type KodiakFriendStatus = 'none' | 'incoming' | 'outgoing' | 'friends';
export type KodiakReportCategory = 'harassment' | 'spam' | 'scam' | 'threats' | 'impersonation' | 'other';
export type KodiakReportStatus = 'open' | 'reviewed' | 'dismissed';
export type KodiakReportActionType = 'reply' | 'note' | 'status' | 'archive' | 'delete';
export type KodiakPushPlatform = 'android' | 'web' | 'tauri-desktop';
export type KodiakPushProvider = 'fcm' | 'web-push' | 'local';

export interface KodiakMusicLoungeTrack {
  addedAt: number;
  addedByUserId: string;
  id: string;
  playedAt?: number;
  playedByUserId?: string;
  title: string;
  url: string;
}

export interface KodiakMusicLoungeState {
  myVote: 'up' | 'down' | null;
  nowPlaying: KodiakMusicLoungeTrack | null;
  selectedAt: number;
  selectedByUserId: string;
  queue: KodiakMusicLoungeTrack[];
  selectedVibeId: string;
  updatedAt: number;
  voteCounts: {
    down: number;
    up: number;
  };
}

export interface KodiakReportAction {
  actorUserId: string;
  body: string;
  createdAt: number;
  fromStatus?: KodiakReportStatus;
  id: string;
  toStatus?: KodiakReportStatus;
  type: KodiakReportActionType;
  visibleToReporter?: boolean;
}

export interface KodiakReport {
  actions?: KodiakReportAction[];
  archivedAt?: number;
  archivedByUserId?: string;
  category: KodiakReportCategory;
  context?: string;
  createdAt: number;
  details: string;
  id: string;
  messageEventId?: string;
  reporterUserId: string;
  roomId?: string;
  status: KodiakReportStatus;
  targetAvatarUrl?: string;
  targetDisplayName: string;
  targetUserId: string;
  updatedAt: number;
}

export interface KodiakProfile {
  avatarUrl?: string;
  bio?: string;
  createdAt?: number;
  displayName: string;
  normalizedDisplayName?: string;
  updatedAt?: number;
  userId: string;
}

interface KodiakPresenceUser {
  avatarUrl?: string;
  displayName?: string;
  lastSeenAt?: number;
  presence: KodiakPresenceState;
  userId: string;
}

interface KodiakPresenceUsersResponse {
  users?: Record<string, KodiakPresenceUser>;
}

interface KodiakFriendStateResponse {
  statuses?: Record<string, KodiakFriendStatus>;
}

interface KodiakProfilesResponse {
  profiles?: Record<string, KodiakProfile>;
}

interface KodiakProfileResponse {
  profile?: KodiakProfile;
}

interface KodiakReportsResponse {
  canViewAllReports?: boolean;
  ok?: boolean;
  report?: KodiakReport;
  reports?: KodiakReport[];
}

interface KodiakBlockStateResponse {
  blockedByUserIds?: string[];
  blockedUserIds?: string[];
  restrictedUserIds?: string[];
  statuses?: Record<string, KodiakFriendStatus>;
}

export interface KodiakPushRegistration {
  appVersion?: string;
  deviceId: string;
  platform: KodiakPushPlatform;
  provider: KodiakPushProvider;
  token: string;
  userAgent?: string;
}
export type KodiakBackendCallKind = 'voice' | 'video';
export type KodiakBackendCallStatus = 'invite' | 'accept' | 'decline' | 'end' | 'offer' | 'answer' | 'ice';

export interface KodiakBackendCallEvent {
  callId: string;
  callKind: KodiakBackendCallKind;
  candidate?: RTCIceCandidateInit | null;
  createdAt: number;
  eventId: string;
  roomId?: string;
  sdp?: string;
  senderUserId: string;
  status: KodiakBackendCallStatus;
  targetUserId: string;
}

interface KodiakPushRegisterResponse {
  deviceCount?: number;
  ok?: boolean;
}

const KODIAK_API_BASE_URL =
  (import.meta.env.VITE_KODIAK_API_BASE_URL as string | undefined)?.trim() || 'https://api.kodiak-connect.com';

function getHeaders(identity: MatrixLoginIdentity) {
  return {
    'Content-Type': 'application/json',
    'X-Kodiak-User-Id': identity.userId,
  };
}

async function postKodiak<T>(identity: MatrixLoginIdentity, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${KODIAK_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: getHeaders(identity),
    body: JSON.stringify({
      ...body,
      userId: identity.userId,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Kodiak backend request failed: ${path}`;

    try {
      const errorBody = (await response.json()) as { error?: string };
      errorMessage = errorBody.error || errorMessage;
    } catch {
      // Keep fallback.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

export async function registerKodiakPushDevice(identity: MatrixLoginIdentity, registration: KodiakPushRegistration) {
  const data = await postKodiak<KodiakPushRegisterResponse>(identity, '/api/push/register', { ...registration });
  return data.ok === true;
}

export async function notifyKodiakDirectMessage(identity: MatrixLoginIdentity, notification: { roomId: string; targetUserId: string }) {
  await postKodiak<{ ok?: boolean }>(identity, '/api/push/dm', notification);
}

export async function notifyKodiakCall(identity: MatrixLoginIdentity, notification: { callId: string; callKind: 'voice' | 'video'; roomId: string; targetUserId: string }) {
  await postKodiak<{ ok?: boolean }>(identity, '/api/push/call', notification);
}
export interface KodiakCallMediaTokenResponse {
  callId: string;
  callKind: KodiakBackendCallKind;
  roomName: string;
  token: string;
  wsUrl: string;
}

export async function requestKodiakCallMediaToken(
  identity: MatrixLoginIdentity,
  request: {
    callId: string;
    callKind: KodiakBackendCallKind;
    targetUserId: string;
  },
) {
  return await postKodiak<KodiakCallMediaTokenResponse>(
    identity,
    '/api/calls/media-token',
    request as unknown as Record<string, unknown>,
  );
}
export async function sendKodiakBackendCallEvent(
  identity: MatrixLoginIdentity,
  event: {
    callId: string;
    callKind: KodiakBackendCallKind;
    candidate?: RTCIceCandidateInit | null;
    roomId?: string | null;
    sdp?: string | null;
    status: KodiakBackendCallStatus;
    targetUserId: string;
  },
) {
  const data = await postKodiak<{ event?: KodiakBackendCallEvent; ok?: boolean }>(identity, '/api/calls/events', event as unknown as Record<string, unknown>);
  return data.event ?? null;
}

export async function loadKodiakBackendCallEvents(identity: MatrixLoginIdentity, since = 0) {
  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/calls/events?userId=${encodeURIComponent(identity.userId)}&since=${encodeURIComponent(String(since))}`,
    {
      headers: getHeaders(identity),
    },
  );

  if (!response.ok) {
    throw new Error('Kodiak call event request failed.');
  }

  const data = (await response.json()) as { events?: KodiakBackendCallEvent[]; nextSince?: number };
  return {
    events: data.events ?? [],
    nextSince: Number(data.nextSince ?? since),
  };
}

export async function sendKodiakRoomActivity(
  identity: MatrixLoginIdentity,
  activity: { isVisible: boolean; roomId?: string | null },
) {
  await postKodiak<{ ok?: boolean }>(identity, '/api/activity/room', {
    activeRoomId: activity.roomId ?? '',
    isVisible: activity.isVisible,
  });
}

export async function sendKodiakPresenceHeartbeat(
  identity: MatrixLoginIdentity,
  displayName: string,
  avatarUrl?: string | null,
) {
  await postKodiak(identity, '/api/presence/heartbeat', {
    avatarUrl: avatarUrl ?? '',
    displayName,
    status: 'online',
  });
}

export async function loadKodiakPresence(identity: MatrixLoginIdentity, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);

  if (!uniqueUserIds.length) {
    return {};
  }

  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/presence/users?ids=${encodeURIComponent(uniqueUserIds.join(','))}`,
    {
      headers: getHeaders(identity),
    },
  );

  if (!response.ok) {
    throw new Error('Kodiak presence request failed.');
  }

  const data = (await response.json()) as KodiakPresenceUsersResponse;

  return Object.fromEntries(
    Object.entries(data.users ?? {}).map(([userId, user]) => [userId, user.presence ?? 'offline']),
  ) as Record<string, KodiakPresenceState>;
}

export async function loadKodiakFriendState(identity: MatrixLoginIdentity) {
  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/friends/state?userId=${encodeURIComponent(identity.userId)}`,
    {
      headers: getHeaders(identity),
    },
  );

  if (!response.ok) {
    throw new Error('Kodiak friend state request failed.');
  }

  const data = (await response.json()) as KodiakFriendStateResponse;
  return data.statuses ?? {};
}

export async function sendKodiakFriendRequest(identity: MatrixLoginIdentity, targetUserId: string) {
  const data = await postKodiak<KodiakFriendStateResponse>(identity, '/api/friends/request', { targetUserId });
  return data.statuses ?? {};
}

export async function acceptKodiakFriendRequest(identity: MatrixLoginIdentity, requesterUserId: string) {
  const data = await postKodiak<KodiakFriendStateResponse>(identity, '/api/friends/accept', { requesterUserId });
  return data.statuses ?? {};
}

export async function declineKodiakFriendRequest(identity: MatrixLoginIdentity, requesterUserId: string) {
  const data = await postKodiak<KodiakFriendStateResponse>(identity, '/api/friends/decline', { requesterUserId });
  return data.statuses ?? {};
}

export async function cancelKodiakFriendRequest(identity: MatrixLoginIdentity, targetUserId: string) {
  const data = await postKodiak<KodiakFriendStateResponse>(identity, '/api/friends/cancel', { targetUserId });
  return data.statuses ?? {};
}

export async function removeKodiakFriend(identity: MatrixLoginIdentity, targetUserId: string) {
  const data = await postKodiak<KodiakFriendStateResponse>(identity, '/api/friends/remove', { targetUserId });
  return data.statuses ?? {};
}

export async function loadKodiakProfiles(identity: MatrixLoginIdentity, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);

  if (!uniqueUserIds.length) {
    return {};
  }

  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/profiles/users?ids=${encodeURIComponent(uniqueUserIds.join(','))}`,
    {
      headers: getHeaders(identity),
    },
  );

  if (!response.ok) {
    throw new Error('Kodiak profile lookup failed.');
  }

  const data = (await response.json()) as KodiakProfilesResponse;
  return data.profiles ?? {};
}

export async function saveKodiakProfile(
  identity: MatrixLoginIdentity,
  profile: {
    avatarUrl?: string;
    bio: string;
    displayName: string;
  },
) {
  const data = await postKodiak<KodiakProfileResponse>(identity, '/api/profiles/me', profile);
  return data.profile ?? null;
}

export async function searchKodiakProfiles(identity: MatrixLoginIdentity, query: string, limit = 12) {
  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/profiles/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
    {
      headers: getHeaders(identity),
    },
  );

  if (!response.ok) {
    throw new Error('Kodiak profile search failed.');
  }

  const data = (await response.json()) as KodiakProfilesResponse;
  return Object.values(data.profiles ?? {});
}

export async function loadKodiakBlockState(identity: MatrixLoginIdentity) {
  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/blocks/state?userId=${encodeURIComponent(identity.userId)}`,
    {
      headers: getHeaders(identity),
    },
  );

  if (!response.ok) {
    throw new Error('Kodiak block state request failed.');
  }

  const data = (await response.json()) as KodiakBlockStateResponse;

  return {
    blockedByUserIds: data.blockedByUserIds ?? [],
    blockedUserIds: data.blockedUserIds ?? [],
    restrictedUserIds: data.restrictedUserIds ?? [
      ...new Set([...(data.blockedUserIds ?? []), ...(data.blockedByUserIds ?? [])]),
    ],
  };
}

export async function blockKodiakUser(identity: MatrixLoginIdentity, targetUserId: string) {
  const data = await postKodiak<KodiakBlockStateResponse>(identity, '/api/blocks/block', { targetUserId });

  return {
    blockedByUserIds: data.blockedByUserIds ?? [],
    blockedUserIds: data.blockedUserIds ?? [],
    restrictedUserIds: data.restrictedUserIds ?? [
      ...new Set([...(data.blockedUserIds ?? []), ...(data.blockedByUserIds ?? [])]),
    ],
    statuses: data.statuses ?? {},
  };
}

export async function unblockKodiakUser(identity: MatrixLoginIdentity, targetUserId: string) {
  const data = await postKodiak<KodiakBlockStateResponse>(identity, '/api/blocks/unblock', { targetUserId });

  return {
    blockedByUserIds: data.blockedByUserIds ?? [],
    blockedUserIds: data.blockedUserIds ?? [],
    restrictedUserIds: data.restrictedUserIds ?? [
      ...new Set([...(data.blockedUserIds ?? []), ...(data.blockedByUserIds ?? [])]),
    ],
    statuses: data.statuses ?? {},
  };
}

export async function submitKodiakReport(
  identity: MatrixLoginIdentity,
  report: {
    category: KodiakReportCategory;
    context?: string;
    details: string;
    messageEventId?: string;
    roomId?: string;
    targetAvatarUrl?: string;
    targetDisplayName?: string;
    targetUserId: string;
  },
) {
  const data = await postKodiak<KodiakReportsResponse>(identity, '/api/reports/create', report);
  return data.report ?? null;
}

export async function loadKodiakReports(identity: MatrixLoginIdentity, includeArchived = false) {
  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/reports/list?userId=${encodeURIComponent(identity.userId)}&includeArchived=${includeArchived ? 'true' : 'false'}`,
    {
      headers: getHeaders(identity),
    },
  );

  if (!response.ok) {
    throw new Error('Kodiak reports request failed.');
  }

  const data = (await response.json()) as KodiakReportsResponse;
  return data.reports ?? [];
}

export async function replyToKodiakReport(identity: MatrixLoginIdentity, reportId: string, message: string) {
  const data = await postKodiak<KodiakReportsResponse>(identity, '/api/reports/reply', {
    message,
    reportId,
  });

  return data.report ?? null;
}

export async function addKodiakReportNote(identity: MatrixLoginIdentity, reportId: string, note: string) {
  const data = await postKodiak<KodiakReportsResponse>(identity, '/api/reports/note', {
    note,
    reportId,
  });

  return data.report ?? null;
}

export async function updateKodiakReportStatus(
  identity: MatrixLoginIdentity,
  reportId: string,
  status: KodiakReportStatus,
  note?: string,
) {
  const data = await postKodiak<KodiakReportsResponse>(identity, '/api/reports/status', {
    note: note ?? '',
    reportId,
    status,
  });

  return data.report ?? null;
}

export async function archiveKodiakReport(identity: MatrixLoginIdentity, reportId: string, note?: string) {
  const data = await postKodiak<KodiakReportsResponse>(identity, '/api/reports/archive', {
    note: note ?? '',
    reportId,
  });

  return data.report ?? null;
}

export async function deleteKodiakReport(identity: MatrixLoginIdentity, reportId: string) {
  await postKodiak<KodiakReportsResponse>(identity, '/api/reports/delete', {
    reportId,
  });

  return true;
}

export async function loadKodiakMusicLoungeState(identity: MatrixLoginIdentity) {
  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/music-lounge/state?userId=${encodeURIComponent(identity.userId)}`,
    {
      headers: getHeaders(identity),
    },
  );

  if (!response.ok) {
    throw new Error('Kodiak music lounge state request failed.');
  }

  const data = (await response.json()) as { state?: KodiakMusicLoungeState };
  return data.state ?? null;
}

export async function setKodiakMusicLoungeVibe(identity: MatrixLoginIdentity, selectedVibeId: string) {
  const data = await postKodiak<{ state?: KodiakMusicLoungeState; ok?: boolean }>(
    identity,
    '/api/music-lounge/vibe',
    { selectedVibeId },
  );

  return data.state ?? null;
}

export async function voteKodiakMusicLoungeVibe(identity: MatrixLoginIdentity, vote: 'up' | 'down' | null) {
  const data = await postKodiak<{ state?: KodiakMusicLoungeState; ok?: boolean }>(
    identity,
    '/api/music-lounge/vote',
    { vote },
  );

  return data.state ?? null;
}
export async function addKodiakMusicLoungeQueueTrack(
  identity: MatrixLoginIdentity,
  track: { title: string; url?: string },
) {
  const data = await postKodiak<{ state?: KodiakMusicLoungeState; ok?: boolean }>(
    identity,
    '/api/music-lounge/queue',
    {
      title: track.title,
      url: track.url ?? '',
    },
  );

  return data.state ?? null;
}

export async function removeKodiakMusicLoungeQueueTrack(identity: MatrixLoginIdentity, trackId: string) {
  const data = await postKodiak<{ state?: KodiakMusicLoungeState; ok?: boolean }>(
    identity,
    '/api/music-lounge/queue/remove',
    { trackId },
  );

  return data.state ?? null;
}

export async function clearKodiakMusicLoungeQueue(identity: MatrixLoginIdentity) {
  const data = await postKodiak<{ state?: KodiakMusicLoungeState; ok?: boolean }>(
    identity,
    '/api/music-lounge/queue/clear',
    {},
  );

  return data.state ?? null;
}
export async function setKodiakMusicLoungeNowPlaying(identity: MatrixLoginIdentity, trackId: string) {
  const data = await postKodiak<{ state?: KodiakMusicLoungeState; ok?: boolean }>(
    identity,
    '/api/music-lounge/now-playing',
    { trackId },
  );

  return data.state ?? null;
}

export async function clearKodiakMusicLoungeNowPlaying(identity: MatrixLoginIdentity) {
  const data = await postKodiak<{ state?: KodiakMusicLoungeState; ok?: boolean }>(
    identity,
    '/api/music-lounge/now-playing/clear',
    {},
  );

  return data.state ?? null;
}