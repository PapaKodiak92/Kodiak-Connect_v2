import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

export interface MatrixReactionSummary {
  count: number;
  key: string;
  senders: string[];
}

export type MatrixMediaMessageType = 'm.image' | 'm.audio' | 'm.video' | 'm.file';

export interface MatrixTextMessage {
  body: string;
  editedAt?: number;
  eventId: string;
  fileName?: string;
  info?: {
    mimetype?: string;
    size?: number;
  };
  mediaUrl?: string;
  msgtype?: 'm.text' | MatrixMediaMessageType;
  originServerTs: number;
  reactions?: MatrixReactionSummary[];
  replyToEventId?: string;
  sender: string;
}

export interface MatrixTypingState {
  nextBatch?: string;
  userIds?: string[];
}

export interface MatrixRoomMember {
  avatarUrl?: string;
  displayName?: string;
  userId: string;
}

export type MatrixPresenceState = 'online' | 'offline' | 'unavailable';
export type MatrixDirectRoomsByUserId = Record<string, string[]>;
export type MatrixFriendResponseState = 'accept' | 'decline' | 'remove' | 'cancel';

export interface MatrixFriendEvent {
  createdAt: number;
  eventId: string;
  requesterUserId: string;
  response?: MatrixFriendResponseState;
  sender: string;
  targetUserId: string;
  type: 'request' | 'response';
}

interface MatrixErrorResponse {
  errcode?: string;
  error?: string;
}

interface MatrixResolveAliasResponse {
  room_id: string;
}

interface MatrixJoinRoomResponse {
  room_id: string;
}

interface MatrixDisplayNameResponse {
  displayname?: string;
}

interface MatrixAvatarUrlResponse {
  avatar_url?: string;
}

interface MatrixUploadResponse {
  content_uri: string;
}

interface MatrixCreateRoomResponse {
  room_id: string;
}

interface MatrixMessagesResponse {
  chunk?: MatrixEvent[];
}

interface MatrixJoinedMembersResponse {
  joined?: Record<
    string,
    {
      avatar_url?: string;
      display_name?: string;
    }
  >;
}

interface MatrixSyncResponse {
  next_batch?: string;
  rooms?: {
    invite?: Record<string, { invite_state?: { events?: Array<{ sender?: string; state_key?: string; type?: string }> } }>;
    join?: Record<
      string,
      {
        ephemeral?: {
          events?: MatrixEphemeralEvent[];
        };
      }
    >;
  };
}

interface MatrixEphemeralEvent {
  content?: {
    bio?: string;
    created_at?: number;
    requester_user_id?: string;
    response?: MatrixFriendResponseState;
    target_user_id?: string;
    updated_at?: number;
    user_ids?: string[];
  };
  type?: string;
}

interface MatrixEvent {
  content?: {
    bio?: string;
    body?: string;
    created_at?: number;
    filename?: string;
    info?: {
      mimetype?: string;
      size?: number;
    };
    msgtype?: string;
    requester_user_id?: string;
    response?: MatrixFriendResponseState;
    target_user_id?: string;
    updated_at?: number;
    url?: string;
    'm.new_content'?: {
      body?: string;
      msgtype?: string;
    };
    'm.relates_to'?: MatrixRelation;
  };
  event_id?: string;
  origin_server_ts?: number;
  sender?: string;
  type?: string;
}

interface MatrixRelation {
  event_id?: string;
  key?: string;
  rel_type?: string;
  'm.in_reply_to'?: {
    event_id?: string;
  };
}

interface MatrixEditSummary {
  body: string;
  editedAt: number;
  sender: string;
}

export class MatrixRestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly errcode?: string,
  ) {
    super(message);
    this.name = 'MatrixRestError';
  }
}

const MEDIA_MSGTYPES = new Set(['m.image', 'm.audio', 'm.video', 'm.file']);

function encodePathValue(value: string) {
  return encodeURIComponent(value);
}

async function readMatrixError(response: Response) {
  try {
    return (await response.json()) as MatrixErrorResponse;
  } catch {
    return {};
  }
}

async function matrixRequest<T>(identity: MatrixLoginIdentity, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${identity.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${identity.accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const matrixError = await readMatrixError(response);
    throw new MatrixRestError(matrixError.error || 'Matrix request failed.', response.status, matrixError.errcode);
  }

  return (await response.json()) as T;
}

function buildReactionSummary(reactionsByEventId: Map<string, Map<string, Set<string>>>, eventId: string): MatrixReactionSummary[] {
  const reactionsForMessage = reactionsByEventId.get(eventId);

  if (!reactionsForMessage) {
    return [];
  }

  return [...reactionsForMessage.entries()]
    .filter(([key]) => key !== '??')
    .map(([key, senders]) => ({
      count: senders.size,
      key,
      senders: [...senders],
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function collectEdits(events: MatrixEvent[]) {
  const editsByEventId = new Map<string, MatrixEditSummary>();

  for (const event of events) {
    const relation = event.content?.['m.relates_to'];
    const newContent = event.content?.['m.new_content'];

    if (
      event.type !== 'm.room.message' ||
      relation?.rel_type !== 'm.replace' ||
      !relation.event_id ||
      newContent?.msgtype !== 'm.text' ||
      !newContent.body ||
      !event.sender
    ) {
      continue;
    }

    const editedAt = event.origin_server_ts ?? 0;
    const existingEdit = editsByEventId.get(relation.event_id);

    if (!existingEdit || editedAt > existingEdit.editedAt) {
      editsByEventId.set(relation.event_id, {
        body: newContent.body,
        editedAt,
        sender: event.sender,
      });
    }
  }

  return editsByEventId;
}

function isTransferNotice(body = '') {
  return (
    (body.includes('Open Transfers to preview/download') && (body.includes('Shared GIF') || body.includes('Shared image/GIF') || body.includes('Shared music/audio') || body.includes('Shared video') || body.includes('Shared file'))) ||
    /^📁 Shared \d+ files/.test(body) ||
    /^📎 Shared .+/.test(body) ||
    /^🎞️ Shared GIF:/.test(body)
  );
}

function getMatrixMediaParts(mxcUrl?: string | null) {
  if (!mxcUrl || !mxcUrl.startsWith('mxc://')) {
    return null;
  }

  const [serverName, mediaId] = mxcUrl.slice('mxc://'.length).split('/');

  if (!serverName || !mediaId) {
    return null;
  }

  return { mediaId, serverName };
}

export function getMatrixMediaUrl(identity: MatrixLoginIdentity, mxcUrl?: string | null, width = 96, height = 96) {
  if (!mxcUrl) {
    return null;
  }

  if (!mxcUrl.startsWith('mxc://')) {
    return mxcUrl;
  }

  const parts = getMatrixMediaParts(mxcUrl);

  if (!parts) {
    return null;
  }

  return `${identity.baseUrl}/_matrix/client/v1/media/thumbnail/${encodePathValue(parts.serverName)}/${encodePathValue(parts.mediaId)}?width=${width}&height=${height}&method=crop`;
}

function getMatrixMediaCandidateUrls(identity: MatrixLoginIdentity, mxcUrl?: string | null, width = 96, height = 96) {
  if (!mxcUrl) {
    return [];
  }

  if (!mxcUrl.startsWith('mxc://')) {
    return [mxcUrl];
  }

  const parts = getMatrixMediaParts(mxcUrl);

  if (!parts) {
    return [];
  }

  const serverName = encodePathValue(parts.serverName);
  const mediaId = encodePathValue(parts.mediaId);
  const thumbnailQuery = `width=${width}&height=${height}&method=crop`;

  return [
    `${identity.baseUrl}/_matrix/client/v1/media/thumbnail/${serverName}/${mediaId}?${thumbnailQuery}`,
    `${identity.baseUrl}/_matrix/media/v3/thumbnail/${serverName}/${mediaId}?${thumbnailQuery}`,
    `${identity.baseUrl}/_matrix/media/r0/thumbnail/${serverName}/${mediaId}?${thumbnailQuery}`,
    `${identity.baseUrl}/_matrix/client/v1/media/download/${serverName}/${mediaId}`,
    `${identity.baseUrl}/_matrix/media/v3/download/${serverName}/${mediaId}`,
    `${identity.baseUrl}/_matrix/media/r0/download/${serverName}/${mediaId}`,
  ];
}

export function getMatrixMediaDownloadUrl(identity: MatrixLoginIdentity, mxcUrl?: string | null) {
  if (!mxcUrl) {
    return null;
  }

  if (!mxcUrl.startsWith('mxc://')) {
    return mxcUrl;
  }

  const parts = getMatrixMediaParts(mxcUrl);

  if (!parts) {
    return null;
  }

  const serverName = encodePathValue(parts.serverName);
  const mediaId = encodePathValue(parts.mediaId);

  return `${identity.baseUrl}/_matrix/client/v1/media/download/${serverName}/${mediaId}`;
}

export async function getAuthenticatedMatrixMediaObjectUrl(identity: MatrixLoginIdentity, mxcUrl?: string | null, width = 96, height = 96) {
  const mediaUrls = getMatrixMediaCandidateUrls(identity, mxcUrl, width, height);

  if (!mediaUrls.length) {
    return null;
  }

  let lastError: MatrixRestError | null = null;

  for (const mediaUrl of mediaUrls) {
    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${identity.accessToken}`,
      },
    });

    if (response.ok) {
      const mediaBlob = await response.blob();
      return URL.createObjectURL(mediaBlob);
    }

    const matrixError = await readMatrixError(response);
    lastError = new MatrixRestError(matrixError.error || `Matrix media download failed at ${mediaUrl}.`, response.status, matrixError.errcode);

    if (![400, 404, 405].includes(response.status)) {
      break;
    }
  }

  throw lastError ?? new MatrixRestError('Matrix media download failed.');
}

export async function loadProfileAvatarUrl(identity: MatrixLoginIdentity, userId: string) {
  try {
    const data = await matrixRequest<MatrixAvatarUrlResponse>(identity, `/_matrix/client/v3/profile/${encodePathValue(userId)}/avatar_url`);
    return data.avatar_url?.trim() || null;
  } catch (error) {
    if (error instanceof MatrixRestError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function saveOwnAvatarUrl(identity: MatrixLoginIdentity, avatarUrl: string) {
  await matrixRequest<Record<string, never>>(identity, `/_matrix/client/v3/profile/${encodePathValue(identity.userId)}/avatar_url`, {
    method: 'PUT',
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
}

export async function uploadProfileAvatar(identity: MatrixLoginIdentity, file: File) {
  const uploadPaths = [
    `/_matrix/media/v3/upload?filename=${encodeURIComponent(file.name)}`,
    `/_matrix/media/r0/upload?filename=${encodeURIComponent(file.name)}`,
    `/_matrix/client/v1/media/upload?filename=${encodeURIComponent(file.name)}`,
  ];

  let lastError: MatrixRestError | null = null;

  for (const uploadPath of uploadPaths) {
    const response = await fetch(`${identity.baseUrl}${uploadPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.accessToken}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });

    if (response.ok) {
      const data = (await response.json()) as MatrixUploadResponse;
      return data.content_uri;
    }

    const matrixError = await readMatrixError(response);
    lastError = new MatrixRestError(matrixError.error || `Matrix avatar upload failed at ${uploadPath}.`, response.status, matrixError.errcode);

    if (![400, 404, 405].includes(response.status)) {
      break;
    }
  }

  throw lastError ?? new MatrixRestError('Matrix avatar upload failed.');
}

export async function loadUserPresence(identity: MatrixLoginIdentity, userId: string) {
  return identity.userId === userId ? 'online' : 'offline';
}

export async function setOwnPresence(_identity: MatrixLoginIdentity, _presence: MatrixPresenceState) {
  // Presence is owned by Kodiak backend heartbeat for now.
}

export async function sendFriendRequest(identity: MatrixLoginIdentity, roomId: string, targetUserId: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/com.kodiak.friend.request/${encodePathValue(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({ created_at: Date.now(), requester_user_id: identity.userId, target_user_id: targetUserId }),
  });
}

export async function sendFriendResponse(identity: MatrixLoginIdentity, roomId: string, requesterUserId: string, response: MatrixFriendResponseState) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/com.kodiak.friend.response/${encodePathValue(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({ created_at: Date.now(), requester_user_id: requesterUserId, response, target_user_id: identity.userId }),
  });
}

export async function sendFriendRequestCancellation(identity: MatrixLoginIdentity, roomId: string, targetUserId: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/com.kodiak.friend.response/${encodePathValue(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({ created_at: Date.now(), requester_user_id: identity.userId, response: 'cancel', target_user_id: targetUserId }),
  });
}

export async function loadRecentFriendEvents(identity: MatrixLoginIdentity, roomId: string, limit = 120) {
  const data = await matrixRequest<MatrixMessagesResponse>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/messages?dir=b&limit=${limit}`);

  return (data.chunk ?? [])
    .filter((event) => {
      return (
        (event.type === 'com.kodiak.friend.request' || event.type === 'com.kodiak.friend.response') &&
        event.event_id &&
        event.sender &&
        event.content?.requester_user_id &&
        event.content?.target_user_id
      );
    })
    .map<MatrixFriendEvent>((event) => ({
      createdAt: event.content?.created_at ?? event.origin_server_ts ?? 0,
      eventId: event.event_id ?? '',
      requesterUserId: event.content?.requester_user_id ?? '',
      response: event.content?.response,
      sender: event.sender ?? '',
      targetUserId: event.content?.target_user_id ?? '',
      type: event.type === 'com.kodiak.friend.response' ? 'response' : 'request',
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function loadProfileDisplayName(identity: MatrixLoginIdentity, userId: string) {
  try {
    const data = await matrixRequest<MatrixDisplayNameResponse>(identity, `/_matrix/client/v3/profile/${encodePathValue(userId)}/displayname`);
    return data.displayname?.trim() || null;
  } catch (error) {
    if (error instanceof MatrixRestError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function saveOwnDisplayName(identity: MatrixLoginIdentity, displayName: string) {
  await matrixRequest<Record<string, never>>(identity, `/_matrix/client/v3/profile/${encodePathValue(identity.userId)}/displayname`, {
    method: 'PUT',
    body: JSON.stringify({ displayname: displayName }),
  });
}

export async function resolveRoomAlias(identity: MatrixLoginIdentity, alias: string) {
  const data = await matrixRequest<MatrixResolveAliasResponse>(identity, `/_matrix/client/v3/directory/room/${encodePathValue(alias)}`);
  return data.room_id;
}

export async function joinRoomByAlias(identity: MatrixLoginIdentity, alias: string) {
  const data = await matrixRequest<MatrixJoinRoomResponse>(identity, `/_matrix/client/v3/join/${encodePathValue(alias)}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return data.room_id;
}

export async function joinRoomById(identity: MatrixLoginIdentity, roomId: string) {
  const data = await matrixRequest<MatrixJoinRoomResponse>(identity, `/_matrix/client/v3/join/${encodePathValue(roomId)}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return data.room_id;
}

export async function createDirectMessageRoom(identity: MatrixLoginIdentity, targetUserId: string, displayName: string) {
  const data = await matrixRequest<MatrixCreateRoomResponse>(identity, '/_matrix/client/v3/createRoom', {
    method: 'POST',
    body: JSON.stringify({ invite: [targetUserId], is_direct: true, name: displayName, preset: 'trusted_private_chat', visibility: 'private' }),
  });

  return data.room_id;
}

export async function loadRoomMembers(identity: MatrixLoginIdentity, roomId: string) {
  const data = await matrixRequest<MatrixJoinedMembersResponse>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/joined_members`);

  return Object.entries(data.joined ?? {}).map<MatrixRoomMember>(([userId, member]) => ({
    avatarUrl: member.avatar_url,
    displayName: member.display_name,
    userId,
  }));
}

export async function loadRecentMessages(identity: MatrixLoginIdentity, roomId: string, limit = 80) {
  const data = await matrixRequest<MatrixMessagesResponse>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/messages?dir=b&limit=${limit}`);
  const events = data.chunk ?? [];
  const reactionsByEventId = new Map<string, Map<string, Set<string>>>();
  const editsByEventId = collectEdits(events);

  for (const event of events) {
    const relation = event.content?.['m.relates_to'];

    if (event.type !== 'm.reaction' || relation?.rel_type !== 'm.annotation' || !relation.event_id || !relation.key || !event.sender) {
      continue;
    }

    const reactionsForMessage = reactionsByEventId.get(relation.event_id) ?? new Map<string, Set<string>>();
    const sendersForReaction = reactionsForMessage.get(relation.key) ?? new Set<string>();

    sendersForReaction.add(event.sender);
    reactionsForMessage.set(relation.key, sendersForReaction);
    reactionsByEventId.set(relation.event_id, reactionsForMessage);
  }

  return events
    .filter((event) => {
      const relation = event.content?.['m.relates_to'];
      const msgtype = event.content?.msgtype;

      if (event.type !== 'm.room.message' || !event.event_id || !event.sender || relation?.rel_type === 'm.replace') {
        return false;
      }

      if (msgtype === 'm.text') {
        return Boolean(event.content?.body) && !isTransferNotice(event.content?.body);
      }

      return Boolean(msgtype && MEDIA_MSGTYPES.has(msgtype) && event.content?.url);
    })
    .map<MatrixTextMessage>((event) => {
      const eventId = event.event_id ?? '';
      const msgtype = event.content?.msgtype ?? 'm.text';
      const isMedia = MEDIA_MSGTYPES.has(msgtype);
      const edit = editsByEventId.get(eventId);
      const editBelongsToOriginalSender = Boolean(edit && edit.sender === event.sender);
      const effectiveBody = editBelongsToOriginalSender && edit ? edit.body : event.content?.body ?? '';
      const editedAt = editBelongsToOriginalSender && edit ? edit.editedAt : undefined;

      return {
        body: isMedia ? `KC_MEDIA::${JSON.stringify({ body: effectiveBody, info: event.content?.info ?? {}, msgtype, url: event.content?.url ?? '' })}` : effectiveBody,
        editedAt,
        eventId,
        fileName: event.content?.filename || effectiveBody,
        info: event.content?.info,
        mediaUrl: event.content?.url,
        msgtype: msgtype as MatrixTextMessage['msgtype'],
        originServerTs: event.origin_server_ts ?? 0,
        reactions: buildReactionSummary(reactionsByEventId, eventId),
        replyToEventId: event.content?.['m.relates_to']?.['m.in_reply_to']?.event_id,
        sender: event.sender ?? 'unknown',
      };
    })
    .reverse();
}

export async function loadTypingUsers(identity: MatrixLoginIdentity, roomId: string, since?: string): Promise<MatrixTypingState> {
  const syncPath = since ? `/_matrix/client/v3/sync?timeout=0&since=${encodePathValue(since)}` : '/_matrix/client/v3/sync?timeout=0';
  const data = await matrixRequest<MatrixSyncResponse>(identity, syncPath);
  const roomEvents = data.rooms?.join?.[roomId]?.ephemeral?.events ?? [];
  const typingEvent = [...roomEvents].reverse().find((event) => event.type === 'm.typing');

  return {
    nextBatch: data.next_batch,
    userIds: typingEvent?.content?.user_ids,
  };
}

export async function loadDirectMessageRooms(identity: MatrixLoginIdentity) {
  try {
    return await matrixRequest<MatrixDirectRoomsByUserId>(identity, `/_matrix/client/v3/user/${encodePathValue(identity.userId)}/account_data/m.direct`);
  } catch (error) {
    if (error instanceof MatrixRestError && error.status === 404) {
      return {};
    }

    throw error;
  }
}

export async function saveDirectMessageRoom(identity: MatrixLoginIdentity, targetUserId: string, roomId: string) {
  const currentDirectRooms = await loadDirectMessageRooms(identity);
  const existingRooms = currentDirectRooms[targetUserId] ?? [];
  const nextRooms = existingRooms.includes(roomId) ? existingRooms : [roomId, ...existingRooms];

  await matrixRequest<Record<string, never>>(identity, `/_matrix/client/v3/user/${encodePathValue(identity.userId)}/account_data/m.direct`, {
    method: 'PUT',
    body: JSON.stringify({ ...currentDirectRooms, [targetUserId]: nextRooms }),
  });
}

export async function findDirectMessageRoom(identity: MatrixLoginIdentity, targetUserId: string) {
  const directRooms = await loadDirectMessageRooms(identity);
  return directRooms[targetUserId]?.[0] ?? null;
}

export async function findDirectMessageRooms(identity: MatrixLoginIdentity, targetUserId: string) {
  const directRooms = await loadDirectMessageRooms(identity);
  return directRooms[targetUserId] ?? [];
}

export async function loadDirectMessageInviteRooms(identity: MatrixLoginIdentity, targetUserId: string) {
  const data = await matrixRequest<MatrixSyncResponse>(identity, '/_matrix/client/v3/sync?timeout=0');
  const inviteRooms = data.rooms?.invite ?? {};

  return Object.entries(inviteRooms)
    .filter(([, room]) => room.invite_state?.events?.some((event) => event.sender === targetUserId || event.state_key === targetUserId))
    .map(([roomId]) => roomId);
}

export async function resolveDirectMessageRoom(identity: MatrixLoginIdentity, targetUserId: string, cachedRoomId?: string | null) {
  const directRoomIds = await findDirectMessageRooms(identity, targetUserId);
  const inviteRoomIds = await loadDirectMessageInviteRooms(identity, targetUserId);
  const candidateRoomIds = [...new Set([...inviteRoomIds, ...directRoomIds, ...(cachedRoomId ? [cachedRoomId] : [])])];
  let bestRoom: { latestTargetTs: number; latestTs: number; roomId: string } | null = null;

  for (const candidateRoomId of candidateRoomIds) {
    try {
      const joinedRoomId = await joinRoomById(identity, candidateRoomId);
      const recentMessages = await loadRecentMessages(identity, joinedRoomId, 25);
      const latestMessage = recentMessages.at(-1);
      const latestTargetMessage = [...recentMessages].reverse().find((message) => message.sender === targetUserId);
      const candidate = {
        latestTargetTs: latestTargetMessage?.originServerTs ?? 0,
        latestTs: latestMessage?.originServerTs ?? 0,
        roomId: joinedRoomId,
      };

      if (!bestRoom || candidate.latestTargetTs > bestRoom.latestTargetTs || (candidate.latestTargetTs === bestRoom.latestTargetTs && candidate.latestTs > bestRoom.latestTs)) {
        bestRoom = candidate;
      }
    } catch {
      // Ignore stale/forbidden candidate rooms.
    }
  }

  return bestRoom?.roomId ?? null;
}

export async function sendProfileBio(identity: MatrixLoginIdentity, roomId: string, bio: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/com.kodiak.profile.bio/${encodePathValue(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({ bio, updated_at: Date.now() }),
  });
}

export async function loadRecentProfileBios(identity: MatrixLoginIdentity, roomId: string, limit = 120) {
  const data = await matrixRequest<MatrixMessagesResponse>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/messages?dir=b&limit=${limit}`);
  const biosByUserId = new Map<string, { bio: string; updatedAt: number }>();

  for (const event of data.chunk ?? []) {
    if (event.type !== 'com.kodiak.profile.bio' || !event.sender || typeof event.content?.bio !== 'string') {
      continue;
    }

    const updatedAt = event.content.updated_at ?? event.origin_server_ts ?? 0;
    const existingBio = biosByUserId.get(event.sender);

    if (!existingBio || updatedAt > existingBio.updatedAt) {
      biosByUserId.set(event.sender, { bio: event.content.bio, updatedAt });
    }
  }

  return Object.fromEntries([...biosByUserId.entries()].map(([userId, value]) => [userId, value.bio]));
}

export async function sendTextMessage(identity: MatrixLoginIdentity, roomId: string, body: string, replyToEventId?: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/m.room.message/${encodePathValue(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      body,
      msgtype: 'm.text',
      ...(replyToEventId
        ? {
            'm.relates_to': {
              'm.in_reply_to': { event_id: replyToEventId },
            },
          }
        : {}),
    }),
  });
}

export async function sendReplacementMessage(identity: MatrixLoginIdentity, roomId: string, targetEventId: string, body: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/m.room.message/${encodePathValue(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      body: `* ${body}`,
      msgtype: 'm.text',
      'm.new_content': { body, msgtype: 'm.text' },
      'm.relates_to': { rel_type: 'm.replace', event_id: targetEventId },
    }),
  });
}

export async function sendReaction(identity: MatrixLoginIdentity, roomId: string, targetEventId: string, key: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/m.reaction/${encodePathValue(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({ 'm.relates_to': { rel_type: 'm.annotation', event_id: targetEventId, key } }),
  });
}

export async function sendTypingState(identity: MatrixLoginIdentity, roomId: string, isTyping: boolean, timeout = 5000) {
  await matrixRequest<Record<string, never>>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/typing/${encodePathValue(identity.userId)}`, {
    method: 'PUT',
    body: JSON.stringify(isTyping ? { typing: true, timeout } : { typing: false }),
  });
}

export async function redactMessage(identity: MatrixLoginIdentity, roomId: string, eventId: string, reason: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(identity, `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/redact/${encodePathValue(eventId)}/${encodePathValue(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({ reason }),
  });
}
