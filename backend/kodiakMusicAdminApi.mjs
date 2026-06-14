import { rm } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { Pool } from 'pg';
import {
  KodiakMusicDatabaseNotConfiguredError,
  ensureKodiakMusicSchema,
  normalizeMusicText,
  normalizeSha256,
} from './kodiakMusicDb.mjs';

const DEFAULT_MUSIC_MODERATOR_IDS = ['@papakodiak:kodiak-connect.com'];
const MUSIC_MODERATOR_IDS = new Set([
  ...DEFAULT_MUSIC_MODERATOR_IDS,
  ...String(process.env.KODIAK_MUSIC_MODERATOR_IDS ?? process.env.KODIAK_PLATFORM_MODERATOR_IDS ?? '')
    .split(',')
    .map((userId) => userId.trim())
    .filter(Boolean),
]);

const DEFAULT_LIBRARY_DIR = join(process.cwd(), 'backend', 'data', 'kodiak-music-library');
const MUSIC_LIBRARY_DIR = String(process.env.KODIAK_MUSIC_LIBRARY_DIR || DEFAULT_LIBRARY_DIR).trim();
const MUSIC_LIBRARY_ROOT = resolve(MUSIC_LIBRARY_DIR);
const databaseUrl = String(process.env.KODIAK_MUSIC_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const useSsl = String(process.env.KODIAK_MUSIC_DATABASE_SSL ?? '').toLowerCase() === 'true';

let pool = null;

function getPool() {
  if (!databaseUrl) {
    throw new KodiakMusicDatabaseNotConfiguredError();
  }

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.KODIAK_MUSIC_DATABASE_POOL_SIZE ?? 6),
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}

function isValidMatrixUserId(userId) {
  return typeof userId === 'string' && /^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/.test(userId);
}

function isMusicModerator(userId) {
  return isValidMatrixUserId(userId) && MUSIC_MODERATOR_IDS.has(userId);
}

function getHeaderValue(request, headerName) {
  const value = request.headers[headerName];
  return Array.isArray(value) ? value[0] : value;
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, statusCode, payload) {
  if (!response.headersSent) {
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }

  response.end(JSON.stringify(payload));
}

function resolveLibraryFileKey(fileKey) {
  const cleanKey = normalize(String(fileKey ?? '').replace(/^[/\\]+/, ''));

  if (!cleanKey || cleanKey.startsWith('..') || cleanKey.includes(`..${sep}`)) {
    throw new Error('Invalid Kodiak-Music file key.');
  }

  const absolutePath = resolve(MUSIC_LIBRARY_ROOT, cleanKey);

  if (absolutePath !== MUSIC_LIBRARY_ROOT && !absolutePath.startsWith(`${MUSIC_LIBRARY_ROOT}${sep}`)) {
    throw new Error('Kodiak-Music file key escaped the library directory.');
  }

  return absolutePath;
}

async function removeLibraryFile(fileKey) {
  if (!fileKey) {
    return false;
  }

  const filePath = resolveLibraryFileKey(fileKey);
  await rm(filePath, { force: true });
  return true;
}

function normalizeTrackIdentifier(value) {
  const trackId = normalizeMusicText(value, 80).toLowerCase();

  if (!trackId) {
    return '';
  }

  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(trackId)) {
    return '';
  }

  return trackId;
}

class KodiakMusicAdminValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KodiakMusicAdminValidationError';
  }
}

async function deleteKodiakMusicLibraryTrack({ fileSha256 = '', trackId = '' } = {}) {
  await ensureKodiakMusicSchema();

  const cleanSha = normalizeSha256(fileSha256);
  const cleanTrackId = normalizeTrackIdentifier(trackId);

  if (!cleanSha && !cleanTrackId) {
    throw new KodiakMusicAdminValidationError('A valid trackId or fileSha256 is required.');
  }

  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const filters = [];
    const params = [];

    if (cleanTrackId) {
      params.push(cleanTrackId);
      filters.push(`id = $${params.length}::uuid`);
    }

    if (cleanSha) {
      params.push(cleanSha);
      filters.push(`file_sha256 = $${params.length}`);
    }

    const trackResult = await client.query(
      `SELECT id, title, artist_name, album_title, genre_names, source_kind, file_key, file_sha256, stream_path
       FROM kodiak_music_tracks
       WHERE ${filters.join(' OR ')}
       LIMIT 1`,
      params,
    );

    const track = trackResult.rows[0];

    if (!track) {
      await client.query('ROLLBACK');
      return null;
    }

    if (track.source_kind !== 'library') {
      await client.query('ROLLBACK');
      throw new KodiakMusicAdminValidationError('Only hosted Kodiak-Music library tracks can be deleted here.');
    }

    const queueDeleteResult = await client.query(
      `DELETE FROM kodiak_music_lounge_queue
       WHERE track_id = $1::uuid
       RETURNING id`,
      [track.id],
    );

    const requestUpdateResult = await client.query(
      `UPDATE kodiak_music_song_requests
       SET linked_track_id = NULL,
           status = CASE WHEN status = 'added' THEN 'approved' ELSE status END,
           updated_at = now()
       WHERE linked_track_id = $1::uuid
       RETURNING id`,
      [track.id],
    );

    const uploadUpdateResult = await client.query(
      `UPDATE kodiak_music_uploads
       SET track_id = NULL,
           updated_at = now()
       WHERE track_id = $1::uuid
       RETURNING id`,
      [track.id],
    );

    await client.query('DELETE FROM kodiak_music_tracks WHERE id = $1::uuid', [track.id]);
    await client.query('COMMIT');

    const fileRemoved = await removeLibraryFile(track.file_key);

    return {
      deletedTrack: {
        albumTitle: track.album_title ?? '',
        artistName: track.artist_name ?? '',
        fileKey: track.file_key ?? '',
        fileSha256: track.file_sha256 ?? '',
        genreNames: Array.isArray(track.genre_names) ? track.genre_names : [],
        id: String(track.id),
        streamPath: track.stream_path ?? '',
        title: track.title ?? '',
      },
      fileRemoved,
      removedQueueItems: queueDeleteResult.rowCount ?? 0,
      unlinkedSongRequests: requestUpdateResult.rowCount ?? 0,
      unlinkedUploads: uploadUpdateResult.rowCount ?? 0,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failure so the original error is returned.
    }

    throw error;
  } finally {
    client.release();
  }
}

async function handleDeleteLibraryTrack(request, response) {
  const body = await readRequestBody(request);
  const userId = body.userId || getHeaderValue(request, 'x-kodiak-user-id');

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: 'Invalid Matrix userId.' });
    return;
  }

  if (!isMusicModerator(userId)) {
    sendJson(response, 403, { error: 'Only Kodiak-Music moderators can delete hosted library tracks.' });
    return;
  }

  const result = await deleteKodiakMusicLibraryTrack({
    fileSha256: body.fileSha256,
    trackId: body.trackId,
  });

  if (!result) {
    sendJson(response, 404, { error: 'Kodiak-Music library track was not found.' });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    ...result,
  });
}

export async function handleKodiakMusicAdminApiRequest(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (!url.pathname.startsWith('/api/music/')) {
    return false;
  }

  try {
    if (request.method === 'POST' && url.pathname === '/api/music/library/delete') {
      await handleDeleteLibraryTrack(request, response);
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof KodiakMusicDatabaseNotConfiguredError) {
      sendJson(response, 503, {
        configured: false,
        error: 'Kodiak-Music database is not configured. Set KODIAK_MUSIC_DATABASE_URL on the backend service.',
      });
      return true;
    }

    if (error instanceof KodiakMusicAdminValidationError) {
      sendJson(response, 400, { error: error.message });
      return true;
    }

    console.error('[Kodiak Music Admin API] Request failed', error);
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Kodiak-Music admin request failed.' });
    return true;
  }
}
