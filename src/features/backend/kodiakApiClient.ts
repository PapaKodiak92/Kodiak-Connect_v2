import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

export type KodiakPresenceState = 'online' | 'idle' | 'offline';
export type KodiakFriendStatus = 'none' | 'incoming' | 'outgoing' | 'friends';

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

interface KodiakBlockStateResponse {
  blockedByUserIds?: string[];
  blockedUserIds?: string[];
  restrictedUserIds?: string[];
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
