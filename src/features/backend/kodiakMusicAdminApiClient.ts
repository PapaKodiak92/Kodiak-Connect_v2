import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import type { KodiakMusicTrack } from './kodiakMusicApiClient';

const KODIAK_API_BASE_URL =
  (import.meta.env.VITE_KODIAK_API_BASE_URL as string | undefined)?.trim() || 'https://api.kodiak-connect.com';

function getHeaders(identity: MatrixLoginIdentity) {
  return {
    'Content-Type': 'application/json',
    'X-Kodiak-User-Id': identity.userId,
  };
}

async function readAdminResponse<T>(response: Response, fallbackMessage: string) {
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

export interface KodiakMusicDeleteLibraryTrackResult {
  deletedTrack: KodiakMusicTrack & {
    fileKey?: string;
    fileSha256?: string;
  };
  fileRemoved: boolean;
  ok: boolean;
  removedQueueItems: number;
  unlinkedSongRequests: number;
  unlinkedUploads: number;
}

export async function deleteKodiakMusicLibraryTrack(
  identity: MatrixLoginIdentity,
  track: Pick<KodiakMusicTrack, 'id' | 'streamPath'>,
) {
  const response = await fetch(`${KODIAK_API_BASE_URL}/api/music/library/delete`, {
    method: 'POST',
    headers: getHeaders(identity),
    body: JSON.stringify({
      trackId: track.id,
      userId: identity.userId,
    }),
  });

  return await readAdminResponse<KodiakMusicDeleteLibraryTrackResult>(
    response,
    'Kodiak-Music library delete failed.',
  );
}
