import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

export type KodiakPresenceState = 'online' | 'idle' | 'offline';
export type KodiakFriendStatus = 'none' | 'incoming' | 'outgoing' | 'friends';

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

const KODIAK_API_BASE_URL =
  (import.meta.env.VITE_KODIAK_API_BASE_URL as string | undefined)?.trim() || 'http://localhost:8787';

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
    throw new Error(`Kodiak backend request failed: ${path}`);
  }

  return (await response.json()) as T;
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
