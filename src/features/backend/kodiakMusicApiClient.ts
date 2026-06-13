import type { MatrixLoginIdentity } from '../auth/matrixLoginService';

export type KodiakMusicSourceKind = 'library' | 'youtube' | 'external';
export type KodiakMusicSongRequestStatus = 'pending' | 'approved' | 'rejected' | 'needs-info' | 'added';

export interface KodiakMusicTrack {
  albumTitle: string;
  artistName: string;
  artworkPath: string;
  createdAt: number;
  durationMs: number;
  explicit: boolean;
  genreNames: string[];
  id: string;
  sourceKind: KodiakMusicSourceKind;
  streamPath: string;
  title: string;
}

export interface KodiakMusicSongRequest {
  artistName: string;
  createdAt: number;
  id: string;
  linkedTrackId: string;
  moderatorNote: string;
  moderatorUserId: string;
  note: string;
  referenceUrl: string;
  requesterUserId: string;
  status: KodiakMusicSongRequestStatus;
  title: string;
  updatedAt: number;
}

export interface KodiakMusicHealth {
  configured: boolean;
  message: string;
  ok: boolean;
}

const KODIAK_API_BASE_URL =
  (import.meta.env.VITE_KODIAK_API_BASE_URL as string | undefined)?.trim() || 'https://api.kodiak-connect.com';

function getHeaders(identity: MatrixLoginIdentity) {
  return {
    'Content-Type': 'application/json',
    'X-Kodiak-User-Id': identity.userId,
  };
}

async function readKodiakMusicResponse<T>(response: Response, fallbackMessage: string) {
  if (!response.ok) {
    let errorMessage = fallbackMessage;

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

export async function loadKodiakMusicHealth(identity: MatrixLoginIdentity) {
  const response = await fetch(`${KODIAK_API_BASE_URL}/api/music/health`, {
    headers: getHeaders(identity),
  });

  return await readKodiakMusicResponse<KodiakMusicHealth>(response, 'Kodiak-Music health check failed.');
}

export async function searchKodiakMusicLibrary(identity: MatrixLoginIdentity, query: string, limit = 20) {
  const response = await fetch(
    `${KODIAK_API_BASE_URL}/api/music/library/search?userId=${encodeURIComponent(identity.userId)}&q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
    {
      headers: getHeaders(identity),
    },
  );

  const data = await readKodiakMusicResponse<{ configured?: boolean; tracks?: KodiakMusicTrack[] }>(
    response,
    'Kodiak-Music library search failed.',
  );

  return data.tracks ?? [];
}

export async function createKodiakMusicSongRequest(
  identity: MatrixLoginIdentity,
  request: {
    artistName?: string;
    note?: string;
    referenceUrl?: string;
    title: string;
  },
) {
  const response = await fetch(`${KODIAK_API_BASE_URL}/api/music/requests`, {
    method: 'POST',
    headers: getHeaders(identity),
    body: JSON.stringify({
      ...request,
      userId: identity.userId,
    }),
  });

  const data = await readKodiakMusicResponse<{ ok?: boolean; request?: KodiakMusicSongRequest }>(
    response,
    'Kodiak-Music song request failed.',
  );

  return data.request ?? null;
}

export async function loadKodiakMusicSongRequests(identity: MatrixLoginIdentity, status?: KodiakMusicSongRequestStatus) {
  const params = new URLSearchParams({
    userId: identity.userId,
  });

  if (status) {
    params.set('status', status);
  }

  const response = await fetch(`${KODIAK_API_BASE_URL}/api/music/requests?${params.toString()}`, {
    headers: getHeaders(identity),
  });

  const data = await readKodiakMusicResponse<{
    canModerate?: boolean;
    configured?: boolean;
    requests?: KodiakMusicSongRequest[];
  }>(response, 'Kodiak-Music request list failed.');

  return {
    canModerate: data.canModerate === true,
    requests: data.requests ?? [],
  };
}

export async function updateKodiakMusicSongRequestStatus(
  identity: MatrixLoginIdentity,
  update: {
    linkedTrackId?: string;
    moderatorNote?: string;
    requestId: string;
    status: KodiakMusicSongRequestStatus;
  },
) {
  const response = await fetch(`${KODIAK_API_BASE_URL}/api/music/requests/status`, {
    method: 'POST',
    headers: getHeaders(identity),
    body: JSON.stringify({
      ...update,
      userId: identity.userId,
    }),
  });

  const data = await readKodiakMusicResponse<{ ok?: boolean; request?: KodiakMusicSongRequest }>(
    response,
    'Kodiak-Music request status update failed.',
  );

  return data.request ?? null;
}
