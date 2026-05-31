import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

export interface MatrixTextMessage {
  body: string;
  eventId: string;
  originServerTs: number;
  sender: string;
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
  chunk?: Array<{
    content?: {
      body?: string;
      msgtype?: string;
    };
    event_id?: string;
    origin_server_ts?: number;
    sender?: string;
    type?: string;
  }>;
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

export async function loadRecentMessages(identity: MatrixLoginIdentity, roomId: string, limit = 30) {
  const data = await matrixRequest<MatrixMessagesResponse>(
    identity,
    `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/messages?dir=b&limit=${limit}`,
  );

  return (data.chunk ?? [])
    .filter((event) => event.type === 'm.room.message' && event.content?.msgtype === 'm.text' && event.content.body && event.event_id)
    .map<MatrixTextMessage>((event) => ({
      body: event.content?.body ?? '',
      eventId: event.event_id ?? '',
      originServerTs: event.origin_server_ts ?? 0,
      sender: event.sender ?? 'unknown',
    }))
    .reverse();
}

export async function sendTextMessage(identity: MatrixLoginIdentity, roomId: string, body: string) {
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await matrixRequest<{ event_id: string }>(
    identity,
    `/_matrix/client/v3/rooms/${encodePathValue(roomId)}/send/m.room.message/${encodePathValue(txnId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        body,
        msgtype: 'm.text',
      }),
    },
  );
}
