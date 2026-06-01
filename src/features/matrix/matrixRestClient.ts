import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

export interface MatrixReactionSummary {
  count: number;
  key: string;
  senders: string[];
}

export interface MatrixTextMessage {
  body: string;
  editedAt?: number;
  eventId: string;
  originServerTs: number;
  reactions?: MatrixReactionSummary[];
  replyToEventId?: string;
  sender: string;
}

export interface MatrixTypingState {
  nextBatch?: string;
  userIds?: string[];
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

interface MatrixMessagesResponse {
  chunk?: MatrixEvent[];
}

interface MatrixSyncResponse {
  next_batch?: string;
  rooms?: {
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
    user_ids?: string[];
  };
  type?: string;
}

interface MatrixEvent {
  content?: {
    body?: string;
    msgtype?: string;
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

function buildReactionSummary(
  reactionsByEventId: Map<string, Map<string, Set<string>>>,
  eventId: string,
): MatrixReactionSummary[] {
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

    const existingEdit = editsByEventId.get(relation.event_id);
    const editedAt = event.origin_server_ts ?? 0;

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

export async function resolveRoomAlias(identity: MatrixLoginIdentity, alias: string) {
  const data = await matrixRequest<MatrixResolveAliasResponse>(
    identity,
    `/_matrix/client/v3/directory/room/${encodePathValue(alias)}`,
  );

  return data.room_id;
}

export async function joinRoomByAlias(identity: MatrixLoginIdentity, alias: string) {
  const data = await matrixRequest<MatrixJoinRoomResponse>(
    identity,
    `/_matrix/client/v3/join/${encodePathValue(alias)}`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );

  return data.room_id;
}

export async function loadRecentMessages(identity: MatrixLoginIdentity, roomId: string, limit = 80) {
  const data = await matrixRequest<MatrixMessagesResponse>(
    identity,
    `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/messages?dir=b&limit=${limit}`,
  );

  const events = data.chunk ?? [];
  const reactionsByEventId = new Map<string, Map<string, Set<string>>>();
  const editsByEventId = collectEdits(events);

  for (const event of events) {
    const relation = event.content?.['m.relates_to'];

    if (
      event.type !== 'm.reaction' ||
      relation?.rel_type !== 'm.annotation' ||
      !relation.event_id ||
      !relation.key ||
      !event.sender
    ) {
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

      return (
        event.type === 'm.room.message' &&
        event.content?.msgtype === 'm.text' &&
        event.content.body &&
        event.event_id &&
        relation?.rel_type !== 'm.replace'
      );
    })
    .map<MatrixTextMessage>((event) => {
      const eventId = event.event_id ?? '';
      const edit = editsByEventId.get(eventId);
      const editBelongsToOriginalSender = Boolean(edit && edit.sender === event.sender);
      const effectiveBody = editBelongsToOriginalSender && edit ? edit.body : event.content?.body ?? '';
      const editedAt = editBelongsToOriginalSender && edit ? edit.editedAt : undefined;

      return {
        body: effectiveBody,
        editedAt,
        eventId,
        originServerTs: event.origin_server_ts ?? 0,
        reactions: buildReactionSummary(reactionsByEventId, eventId),
        replyToEventId: event.content?.['m.relates_to']?.['m.in_reply_to']?.event_id,
        sender: event.sender ?? 'unknown',
      };
    })
    .reverse();
}

export async function loadTypingUsers(identity: MatrixLoginIdentity, roomId: string, since?: string): Promise<MatrixTypingState> {
  const syncPath = since
    ? `/_matrix/client/v3/sync?timeout=0&since=${encodePathValue(since)}`
    : '/_matrix/client/v3/sync?timeout=0';
  const data = await matrixRequest<MatrixSyncResponse>(identity, syncPath);
  const roomEvents = data.rooms?.join?.[roomId]?.ephemeral?.events ?? [];
  const typingEvent = [...roomEvents].reverse().find((event) => event.type === 'm.typing');

  return {
    nextBatch: data.next_batch,
    userIds: typingEvent?.content?.user_ids,
  };
}

export async function sendTextMessage(identity: MatrixLoginIdentity, roomId: string, body: string, replyToEventId?: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await matrixRequest<{ event_id: string }>(
    identity,
    `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/m.room.message/${encodePathValue(txnId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        body,
        msgtype: 'm.text',
        ...(replyToEventId
          ? {
              'm.relates_to': {
                'm.in_reply_to': {
                  event_id: replyToEventId,
                },
              },
            }
          : {}),
      }),
    },
  );
}

export async function sendReplacementMessage(identity: MatrixLoginIdentity, roomId: string, targetEventId: string, body: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await matrixRequest<{ event_id: string }>(
    identity,
    `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/m.room.message/${encodePathValue(txnId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        body: `* ${body}`,
        msgtype: 'm.text',
        'm.new_content': {
          body,
          msgtype: 'm.text',
        },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: targetEventId,
        },
      }),
    },
  );
}

export async function sendReaction(identity: MatrixLoginIdentity, roomId: string, targetEventId: string, key: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await matrixRequest<{ event_id: string }>(
    identity,
    `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/m.reaction/${encodePathValue(txnId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: targetEventId,
          key,
        },
      }),
    },
  );
}

export async function sendTypingState(identity: MatrixLoginIdentity, roomId: string, isTyping: boolean, timeout = 5000) {
  await matrixRequest<Record<string, never>>(
    identity,
    `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/typing/${encodePathValue(identity.userId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(isTyping ? { typing: true, timeout } : { typing: false }),
    },
  );
}

export async function redactMessage(identity: MatrixLoginIdentity, roomId: string, eventId: string, reason: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await matrixRequest<{ event_id: string }>(
    identity,
    `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/redact/${encodePathValue(eventId)}/${encodePathValue(txnId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    },
  );
}
