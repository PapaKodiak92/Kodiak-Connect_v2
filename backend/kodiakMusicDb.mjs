import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, 'sql', '001_kodiak_music_schema.sql');
const databaseUrl = String(process.env.KODIAK_MUSIC_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const useSsl = String(process.env.KODIAK_MUSIC_DATABASE_SSL ?? '').toLowerCase() === 'true';

let pool = null;
let schemaReadyPromise = null;

export class KodiakMusicDatabaseNotConfiguredError extends Error {
  constructor() {
    super('Kodiak-Music database is not configured. Set KODIAK_MUSIC_DATABASE_URL.');
    this.name = 'KodiakMusicDatabaseNotConfiguredError';
  }
}

export function isKodiakMusicDatabaseConfigured() {
  return Boolean(databaseUrl);
}

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

export function normalizeMusicText(value, maxLength = 160) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeSearchValue(value, maxLength = 160) {
  return normalizeMusicText(value, maxLength).toLowerCase();
}

export function sanitizeMusicUrl(value) {
  const url = normalizeMusicText(value, 700);

  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }

    return parsed.toString().slice(0, 700);
  } catch {
    return '';
  }
}

export function normalizeSha256(value) {
  const sha = normalizeMusicText(value, 96).toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(sha)) {
    return '';
  }

  return sha;
}

export async function ensureKodiakMusicSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const sql = await readFile(schemaPath, 'utf8');
      await getPool().query(sql);
    })();
  }

  return schemaReadyPromise;
}

function mapTrack(row) {
  return {
    albumTitle: row.album_title ?? '',
    artistName: row.artist_name ?? '',
    artworkPath: row.artwork_path ?? '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    durationMs: Number(row.duration_ms ?? 0),
    explicit: row.explicit === true,
    genreNames: Array.isArray(row.genre_names) ? row.genre_names : [],
    id: String(row.id),
    sourceKind: row.source_kind ?? 'library',
    streamPath: row.stream_path ?? '',
    title: row.title ?? '',
  };
}

function mapStreamTrack(row) {
  return {
    ...mapTrack(row),
    fileKey: row.file_key ?? '',
    fileSha256: row.file_sha256 ?? '',
    mimeType: row.mime_type ?? '',
  };
}

function mapSongRequest(row) {
  return {
    artistName: row.artist_name ?? '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    id: String(row.id),
    linkedTrackId: row.linked_track_id ? String(row.linked_track_id) : '',
    moderatorNote: row.moderator_note ?? '',
    moderatorUserId: row.moderator_user_id ?? '',
    note: row.note ?? '',
    referenceUrl: row.reference_url ?? '',
    requesterUserId: row.requester_user_id ?? '',
    status: row.status ?? 'pending',
    title: row.title ?? '',
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
  };
}

function mapUpload(row) {
  return {
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    errorMessage: row.error_message ?? '',
    fileName: row.file_name ?? '',
    fileSha256: row.file_sha256 ?? '',
    fileSizeBytes: Number(row.file_size_bytes ?? 0),
    id: String(row.id),
    originalPath: row.original_path ?? '',
    sourceDeviceId: row.source_device_id ?? '',
    status: row.status ?? 'pending',
    syncMetadata: row.sync_metadata && typeof row.sync_metadata === 'object' ? row.sync_metadata : {},
    trackId: row.track_id ? String(row.track_id) : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    uploaderUserId: row.uploader_user_id ?? '',
  };
}

export async function getKodiakMusicHealth() {
  if (!isKodiakMusicDatabaseConfigured()) {
    return {
      configured: false,
      ok: false,
      message: 'KODIAK_MUSIC_DATABASE_URL is not configured.',
    };
  }

  await ensureKodiakMusicSchema();
  await getPool().query('SELECT 1');

  return {
    configured: true,
    ok: true,
    message: 'Kodiak-Music database is online.',
  };
}

export async function searchKodiakMusicTracks({ query = '', limit = 20 } = {}) {
  await ensureKodiakMusicSchema();

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const search = normalizeMusicText(query, 120);

  if (!search) {
    const result = await getPool().query(
      `SELECT id, title, artist_name, album_title, genre_names, source_kind, stream_path, artwork_path, duration_ms, explicit, created_at
       FROM kodiak_music_tracks
       ORDER BY created_at DESC
       LIMIT $1`,
      [safeLimit],
    );

    return result.rows.map(mapTrack);
  }

  const likeSearch = `%${search}%`;
  const result = await getPool().query(
    `SELECT id, title, artist_name, album_title, genre_names, source_kind, stream_path, artwork_path, duration_ms, explicit, created_at
     FROM kodiak_music_tracks
     WHERE search_vector @@ plainto_tsquery('simple', $1)
        OR title ILIKE $2
        OR artist_name ILIKE $2
        OR album_title ILIKE $2
        OR EXISTS (
          SELECT 1
          FROM unnest(genre_names) AS genre_name
          WHERE genre_name ILIKE $2
        )
     ORDER BY
       CASE WHEN normalized_title = $3 THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT $4`,
    [search, likeSearch, normalizeSearchValue(search), safeLimit],
  );

  return result.rows.map(mapTrack);
}

export async function getKodiakMusicTrackBySha256(fileSha256) {
  await ensureKodiakMusicSchema();

  const cleanSha = normalizeSha256(fileSha256);

  if (!cleanSha) {
    return null;
  }

  const result = await getPool().query(
    `SELECT id, title, artist_name, album_title, genre_names, source_kind, stream_path, artwork_path, duration_ms, explicit, created_at
     FROM kodiak_music_tracks
     WHERE file_sha256 = $1
     LIMIT 1`,
    [cleanSha],
  );

  return result.rows[0] ? mapTrack(result.rows[0]) : null;
}

export async function getKodiakMusicTrackForStream(identifier) {
  await ensureKodiakMusicSchema();

  const cleanIdentifier = normalizeMusicText(identifier, 96).toLowerCase();

  if (!cleanIdentifier) {
    return null;
  }

  const looksLikeSha = /^[a-f0-9]{64}$/.test(cleanIdentifier);
  const looksLikeUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(cleanIdentifier);

  if (!looksLikeSha && !looksLikeUuid) {
    return null;
  }

  const result = looksLikeSha
    ? await getPool().query(
        `SELECT id, title, artist_name, album_title, genre_names, source_kind, file_key, stream_path, artwork_path, mime_type, file_sha256, duration_ms, explicit, created_at
         FROM kodiak_music_tracks
         WHERE file_sha256 = $1 AND source_kind = 'library'
         LIMIT 1`,
        [cleanIdentifier],
      )
    : await getPool().query(
        `SELECT id, title, artist_name, album_title, genre_names, source_kind, file_key, stream_path, artwork_path, mime_type, file_sha256, duration_ms, explicit, created_at
         FROM kodiak_music_tracks
         WHERE id = $1::uuid AND source_kind = 'library'
         LIMIT 1`,
        [cleanIdentifier],
      );

  return result.rows[0] ? mapStreamTrack(result.rows[0]) : null;
}

export async function createKodiakMusicSongRequest({ requesterUserId, title, artistName = '', referenceUrl = '', note = '' }) {
  await ensureKodiakMusicSchema();

  const cleanTitle = normalizeMusicText(title, 180);
  const cleanArtist = normalizeMusicText(artistName, 120);

  if (!cleanTitle) {
    throw new Error('Song title is required.');
  }

  const result = await getPool().query(
    `INSERT INTO kodiak_music_song_requests (
       requester_user_id,
       title,
       normalized_title,
       artist_name,
       normalized_artist_name,
       reference_url,
       note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      requesterUserId,
      cleanTitle,
      normalizeSearchValue(cleanTitle, 180),
      cleanArtist,
      normalizeSearchValue(cleanArtist, 120),
      sanitizeMusicUrl(referenceUrl),
      normalizeMusicText(note, 600),
    ],
  );

  return mapSongRequest(result.rows[0]);
}

export async function listKodiakMusicSongRequests({ userId, canModerate = false, status = '', limit = 50 } = {}) {
  await ensureKodiakMusicSchema();

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const cleanStatus = normalizeMusicText(status, 30);
  const params = [];
  const filters = [];

  if (!canModerate) {
    params.push(userId);
    filters.push(`requester_user_id = $${params.length}`);
  }

  if (cleanStatus) {
    params.push(cleanStatus);
    filters.push(`status = $${params.length}`);
  }

  params.push(safeLimit);

  const result = await getPool().query(
    `SELECT *
     FROM kodiak_music_song_requests
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return result.rows.map(mapSongRequest);
}

export async function updateKodiakMusicSongRequestStatus({ moderatorUserId, requestId, status, moderatorNote = '', linkedTrackId = '' }) {
  await ensureKodiakMusicSchema();

  const cleanRequestId = normalizeMusicText(requestId, 80);
  const cleanStatus = normalizeMusicText(status, 30);
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'needs-info', 'added']);

  if (!cleanRequestId || !allowedStatuses.has(cleanStatus)) {
    throw new Error('Invalid request status update.');
  }

  const result = await getPool().query(
    `UPDATE kodiak_music_song_requests
     SET status = $2,
         moderator_user_id = $3,
         moderator_note = $4,
         linked_track_id = NULLIF($5, '')::uuid,
         updated_at = now()
     WHERE id = $1::uuid
     RETURNING *`,
    [cleanRequestId, cleanStatus, moderatorUserId, normalizeMusicText(moderatorNote, 600), normalizeMusicText(linkedTrackId, 80)],
  );

  return result.rows[0] ? mapSongRequest(result.rows[0]) : null;
}

export async function createKodiakMusicUploadIntent({
  uploaderUserId,
  sourceDeviceId = '',
  originalPath = '',
  fileName = '',
  fileSha256 = '',
  fileSizeBytes = 0,
  status = 'pending',
  trackId = '',
  errorMessage = '',
  syncMetadata = {},
}) {
  await ensureKodiakMusicSchema();

  const cleanSha = normalizeSha256(fileSha256);

  if (!cleanSha) {
    throw new Error('A valid SHA-256 hash is required before upload.');
  }

  const result = await getPool().query(
    `INSERT INTO kodiak_music_uploads (
       uploader_user_id,
       source_device_id,
       original_path,
       file_name,
       file_sha256,
       file_size_bytes,
       status,
       track_id,
       error_message,
       sync_metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')::uuid, $9, $10::jsonb)
     RETURNING *`,
    [
      normalizeMusicText(uploaderUserId, 120),
      normalizeMusicText(sourceDeviceId, 160),
      normalizeMusicText(originalPath, 700),
      normalizeMusicText(fileName, 260),
      cleanSha,
      Math.max(Number(fileSizeBytes) || 0, 0),
      normalizeMusicText(status, 30),
      normalizeMusicText(trackId, 80),
      normalizeMusicText(errorMessage, 700),
      JSON.stringify(syncMetadata ?? {}),
    ],
  );

  return mapUpload(result.rows[0]);
}

export async function getKodiakMusicUploadById(uploadId) {
  await ensureKodiakMusicSchema();

  const cleanUploadId = normalizeMusicText(uploadId, 80);

  if (!cleanUploadId) {
    return null;
  }

  const result = await getPool().query(
    `SELECT *
     FROM kodiak_music_uploads
     WHERE id = $1::uuid
     LIMIT 1`,
    [cleanUploadId],
  );

  return result.rows[0] ? mapUpload(result.rows[0]) : null;
}

export async function markKodiakMusicUploadFailed({ uploadId, errorMessage }) {
  await ensureKodiakMusicSchema();

  const result = await getPool().query(
    `UPDATE kodiak_music_uploads
     SET status = 'failed',
         error_message = $2,
         updated_at = now()
     WHERE id = $1::uuid
     RETURNING *`,
    [normalizeMusicText(uploadId, 80), normalizeMusicText(errorMessage, 700)],
  );

  return result.rows[0] ? mapUpload(result.rows[0]) : null;
}

export async function upsertKodiakMusicTrackFromSync(track) {
  await ensureKodiakMusicSchema();

  const title = normalizeMusicText(track.title, 180);

  if (!title) {
    throw new Error('Track title is required.');
  }

  const artistName = normalizeMusicText(track.artistName, 120);
  const albumTitle = normalizeMusicText(track.albumTitle, 180);
  const genreNames = Array.isArray(track.genreNames)
    ? track.genreNames.map((genre) => normalizeMusicText(genre, 80)).filter(Boolean).slice(0, 12)
    : [];
  const fileSha256 = normalizeSha256(track.fileSha256) || null;

  const result = await getPool().query(
    `INSERT INTO kodiak_music_tracks (
       title,
       normalized_title,
       artist_name,
       normalized_artist_name,
       album_title,
       normalized_album_title,
       genre_names,
       source_kind,
       file_key,
       stream_path,
       artwork_path,
       mime_type,
       file_sha256,
       duration_ms,
       bitrate,
       release_year,
       track_number,
       explicit,
       uploaded_by_user_id,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'library', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
     ON CONFLICT (file_sha256)
     DO UPDATE SET
       title = EXCLUDED.title,
       normalized_title = EXCLUDED.normalized_title,
       artist_name = EXCLUDED.artist_name,
       normalized_artist_name = EXCLUDED.normalized_artist_name,
       album_title = EXCLUDED.album_title,
       normalized_album_title = EXCLUDED.normalized_album_title,
       genre_names = EXCLUDED.genre_names,
       file_key = EXCLUDED.file_key,
       stream_path = EXCLUDED.stream_path,
       artwork_path = EXCLUDED.artwork_path,
       mime_type = EXCLUDED.mime_type,
       duration_ms = EXCLUDED.duration_ms,
       bitrate = EXCLUDED.bitrate,
       release_year = EXCLUDED.release_year,
       track_number = EXCLUDED.track_number,
       explicit = EXCLUDED.explicit,
       updated_at = now()
     RETURNING id, title, artist_name, album_title, genre_names, source_kind, stream_path, artwork_path, duration_ms, explicit, created_at`,
    [
      title,
      normalizeSearchValue(title, 180),
      artistName,
      normalizeSearchValue(artistName, 120),
      albumTitle,
      normalizeSearchValue(albumTitle, 180),
      genreNames,
      normalizeMusicText(track.fileKey, 700),
      normalizeMusicText(track.streamPath, 700),
      normalizeMusicText(track.artworkPath, 700),
      normalizeMusicText(track.mimeType, 120),
      fileSha256,
      Math.max(Number(track.durationMs) || 0, 0),
      Math.max(Number(track.bitrate) || 0, 0),
      track.releaseYear ? Number(track.releaseYear) : null,
      track.trackNumber ? Number(track.trackNumber) : null,
      track.explicit === true,
      normalizeMusicText(track.uploadedByUserId, 120),
    ],
  );

  return mapTrack(result.rows[0]);
}

export async function completeKodiakMusicUpload({ uploadId, fileKey, streamPath, mimeType, actualFileSha256, actualFileSizeBytes }) {
  await ensureKodiakMusicSchema();

  const upload = await getKodiakMusicUploadById(uploadId);

  if (!upload) {
    return null;
  }

  const metadata = upload.syncMetadata ?? {};
  const track = await upsertKodiakMusicTrackFromSync({
    ...metadata,
    artworkPath: metadata.artworkPath ?? '',
    fileKey,
    fileSha256: actualFileSha256,
    mimeType,
    streamPath,
    uploadedByUserId: upload.uploaderUserId,
  });

  const result = await getPool().query(
    `UPDATE kodiak_music_uploads
     SET status = 'uploaded',
         track_id = $2::uuid,
         file_size_bytes = $3,
         error_message = '',
         updated_at = now()
     WHERE id = $1::uuid
     RETURNING *`,
    [upload.id, track.id, Math.max(Number(actualFileSizeBytes) || 0, 0)],
  );

  return {
    track,
    upload: result.rows[0] ? mapUpload(result.rows[0]) : upload,
  };
}
