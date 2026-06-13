import {
  KodiakMusicDatabaseNotConfiguredError,
  completeKodiakMusicUpload,
  createKodiakMusicSongRequest,
  createKodiakMusicUploadIntent,
  getKodiakMusicHealth,
  getKodiakMusicTrackBySha256,
  getKodiakMusicTrackForStream,
  getKodiakMusicUploadById,
  listKodiakMusicSongRequests,
  markKodiakMusicUploadFailed,
  normalizeMusicText,
  normalizeSha256,
  searchKodiakMusicTracks,
  updateKodiakMusicSongRequestStatus,
} from './kodiakMusicDb.mjs';
import {
  getKodiakMusicStorageHealth,
  streamKodiakMusicFile,
  writeKodiakMusicUploadStream,
} from './kodiakMusicStorage.mjs';

const DEFAULT_MUSIC_MODERATOR_IDS = ['@papakodiak:kodiak-connect.com'];
const MUSIC_MODERATOR_IDS = new Set([
  ...DEFAULT_MUSIC_MODERATOR_IDS,
  ...String(process.env.KODIAK_MUSIC_MODERATOR_IDS ?? process.env.KODIAK_PLATFORM_MODERATOR_IDS ?? '')
    .split(',')
    .map((userId) => userId.trim())
    .filter(Boolean),
]);

const MUSIC_SYNC_USER_IDS = new Set([
  ...MUSIC_MODERATOR_IDS,
  ...String(process.env.KODIAK_MUSIC_SYNC_USER_IDS ?? '')
    .split(',')
    .map((userId) => userId.trim())
    .filter(Boolean),
]);

function isValidMatrixUserId(userId) {
  return typeof userId === 'string' && /^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/.test(userId);
}

function getHeaderValue(request, headerName) {
  const value = request.headers[headerName];
  return Array.isArray(value) ? value[0] : value;
}

function getCurrentUserId(request, body = {}) {
  return body.userId || getHeaderValue(request, 'x-kodiak-user-id');
}

function isMusicModerator(userId) {
  return isValidMatrixUserId(userId) && MUSIC_MODERATOR_IDS.has(userId);
}

function isMusicSyncUser(userId) {
  return isValidMatrixUserId(userId) && MUSIC_SYNC_USER_IDS.has(userId);
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

function sendDatabaseNotConfigured(response) {
  sendJson(response, 503, {
    configured: false,
    error: 'Kodiak-Music database is not configured. Set KODIAK_MUSIC_DATABASE_URL on the backend service.',
  });
}

function sendInvalidUser(response) {
  sendJson(response, 400, { error: 'Invalid Matrix userId.' });
}

function sendSyncForbidden(response) {
  sendJson(response, 403, { error: 'Only approved Kodiak-Music sync users can upload library tracks.' });
}

async function handleMusicHealth(_request, response) {
  const health = await getKodiakMusicHealth();
  sendJson(response, health.ok ? 200 : 503, health);
}

async function handleSyncHealth(request, response, url) {
  const userId = url.searchParams.get('userId') || getHeaderValue(request, 'x-kodiak-user-id');

  if (!isValidMatrixUserId(userId)) {
    sendInvalidUser(response);
    return;
  }

  const database = await getKodiakMusicHealth();
  const storage = getKodiakMusicStorageHealth();

  sendJson(response, database.ok && storage.ok ? 200 : 503, {
    canSync: isMusicSyncUser(userId),
    curatorName: 'Lupercus',
    database,
    storage,
    syncAppName: 'Lupercus Library Sync',
  });
}

async function handleLibrarySearch(request, response, url) {
  const userId = url.searchParams.get('userId') || getHeaderValue(request, 'x-kodiak-user-id');

  if (!isValidMatrixUserId(userId)) {
    sendInvalidUser(response);
    return;
  }

  const query = url.searchParams.get('q') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? 20);
  const tracks = await searchKodiakMusicTracks({ query, limit });

  sendJson(response, 200, {
    configured: true,
    tracks,
  });
}

async function handleStreamTrack(request, response, url, identifier) {
  const userId = url.searchParams.get('userId') || getHeaderValue(request, 'x-kodiak-user-id');

  if (!isValidMatrixUserId(userId)) {
    sendInvalidUser(response);
    return;
  }

  const track = await getKodiakMusicTrackForStream(identifier);

  if (!track?.fileKey) {
    sendJson(response, 404, { error: 'Kodiak-Music track was not found or is not streamable.' });
    return;
  }

  await streamKodiakMusicFile({
    downloadName: [track.title, track.artistName].filter(Boolean).join(' - '),
    fileKey: track.fileKey,
    mimeType: track.mimeType,
    rangeHeader: getHeaderValue(request, 'range') || '',
    response,
  });
}

async function handleCreateSongRequest(request, response) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);

  if (!isValidMatrixUserId(userId)) {
    sendInvalidUser(response);
    return;
  }

  const songRequest = await createKodiakMusicSongRequest({
    artistName: body.artistName,
    note: body.note,
    referenceUrl: body.referenceUrl,
    requesterUserId: userId,
    title: body.title,
  });

  sendJson(response, 200, {
    ok: true,
    request: songRequest,
  });
}

async function handleListSongRequests(request, response, url) {
  const userId = url.searchParams.get('userId') || getHeaderValue(request, 'x-kodiak-user-id');

  if (!isValidMatrixUserId(userId)) {
    sendInvalidUser(response);
    return;
  }

  const requests = await listKodiakMusicSongRequests({
    canModerate: isMusicModerator(userId),
    limit: Number(url.searchParams.get('limit') ?? 50),
    status: url.searchParams.get('status') ?? '',
    userId,
  });

  sendJson(response, 200, {
    canModerate: isMusicModerator(userId),
    configured: true,
    requests,
  });
}

async function handleSongRequestStatus(request, response) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);

  if (!isValidMatrixUserId(userId)) {
    sendInvalidUser(response);
    return;
  }

  if (!isMusicModerator(userId)) {
    sendJson(response, 403, { error: 'Only Kodiak-Music moderators can update song requests.' });
    return;
  }

  const songRequest = await updateKodiakMusicSongRequestStatus({
    linkedTrackId: body.linkedTrackId,
    moderatorNote: body.moderatorNote,
    moderatorUserId: userId,
    requestId: body.requestId,
    status: body.status,
  });

  if (!songRequest) {
    sendJson(response, 404, { error: 'Song request was not found.' });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    request: songRequest,
  });
}

function normalizeGenreNames(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((genre) => normalizeMusicText(genre, 80))
    .filter(Boolean)
    .slice(0, 12);
}

function buildSyncMetadata(body) {
  return {
    albumTitle: normalizeMusicText(body.albumTitle, 180),
    artistName: normalizeMusicText(body.artistName, 120),
    bitrate: Math.max(Number(body.bitrate) || 0, 0),
    durationMs: Math.max(Number(body.durationMs) || 0, 0),
    explicit: body.explicit === true,
    genreNames: normalizeGenreNames(body.genreNames),
    releaseYear: body.releaseYear ? Number(body.releaseYear) : null,
    title: normalizeMusicText(body.title || body.fileName, 180),
    trackNumber: body.trackNumber ? Number(body.trackNumber) : null,
  };
}

async function handlePrepareSyncUpload(request, response) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);

  if (!isValidMatrixUserId(userId)) {
    sendInvalidUser(response);
    return;
  }

  if (!isMusicSyncUser(userId)) {
    sendSyncForbidden(response);
    return;
  }

  const fileSha256 = normalizeSha256(body.fileSha256);
  const fileName = normalizeMusicText(body.fileName, 260);
  const fileSizeBytes = Math.max(Number(body.fileSizeBytes) || 0, 0);

  if (!fileSha256 || !fileName || fileSizeBytes <= 0) {
    sendJson(response, 400, { error: 'fileName, fileSha256, and fileSizeBytes are required.' });
    return;
  }

  const duplicateTrack = await getKodiakMusicTrackBySha256(fileSha256);
  const syncMetadata = buildSyncMetadata(body);

  if (duplicateTrack) {
    const skippedUpload = await createKodiakMusicUploadIntent({
      errorMessage: 'Duplicate track hash already exists in Kodiak-Music.',
      fileName,
      fileSha256,
      fileSizeBytes,
      originalPath: body.originalPath,
      sourceDeviceId: body.sourceDeviceId,
      status: 'skipped',
      syncMetadata,
      trackId: duplicateTrack.id,
      uploaderUserId: userId,
    });

    sendJson(response, 200, {
      duplicateTrack,
      ok: true,
      shouldUpload: false,
      upload: skippedUpload,
    });
    return;
  }

  const upload = await createKodiakMusicUploadIntent({
    fileName,
    fileSha256,
    fileSizeBytes,
    originalPath: body.originalPath,
    sourceDeviceId: body.sourceDeviceId,
    status: 'pending',
    syncMetadata,
    uploaderUserId: userId,
  });

  sendJson(response, 200, {
    ok: true,
    shouldUpload: true,
    upload,
    uploadUrl: `/api/music/sync/uploads/${encodeURIComponent(upload.id)}/file`,
  });
}

async function handleUploadSyncFile(request, response, uploadId) {
  const userId = getHeaderValue(request, 'x-kodiak-user-id');

  if (!isValidMatrixUserId(userId)) {
    sendInvalidUser(response);
    return;
  }

  if (!isMusicSyncUser(userId)) {
    sendSyncForbidden(response);
    return;
  }

  const upload = await getKodiakMusicUploadById(uploadId);

  if (!upload) {
    sendJson(response, 404, { error: 'Prepared upload was not found.' });
    return;
  }

  if (upload.uploaderUserId !== userId && !isMusicModerator(userId)) {
    sendJson(response, 403, { error: 'This upload belongs to another user.' });
    return;
  }

  if (upload.status === 'skipped') {
    sendJson(response, 409, { error: 'This upload was skipped because the track already exists.' });
    return;
  }

  try {
    const requestMimeType = getHeaderValue(request, 'content-type') || '';
    const storedFile = await writeKodiakMusicUploadStream({
      expectedSha256: upload.fileSha256,
      fileName: upload.fileName,
      request,
      requestMimeType,
      uploadId: upload.id,
    });

    const completedUpload = await completeKodiakMusicUpload({
      actualFileSha256: storedFile.actualSha256,
      actualFileSizeBytes: storedFile.bytesWritten,
      fileKey: storedFile.fileKey,
      mimeType: storedFile.mimeType,
      streamPath: storedFile.streamPath,
      uploadId: upload.id,
    });

    sendJson(response, 200, {
      ok: true,
      ...completedUpload,
    });
  } catch (error) {
    await markKodiakMusicUploadFailed({
      errorMessage: error instanceof Error ? error.message : 'Upload failed.',
      uploadId: upload.id,
    });

    throw error;
  }
}

export async function handleKodiakMusicApiRequest(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (!url.pathname.startsWith('/api/music/')) {
    return false;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/music/health') {
      await handleMusicHealth(request, response);
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/music/sync/health') {
      await handleSyncHealth(request, response, url);
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/music/library/search') {
      await handleLibrarySearch(request, response, url);
      return true;
    }

    const streamMatch = url.pathname.match(/^\/api\/music\/stream\/([^/]+)$/);
    if (request.method === 'GET' && streamMatch) {
      await handleStreamTrack(request, response, url, decodeURIComponent(streamMatch[1]));
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/music/requests') {
      await handleCreateSongRequest(request, response);
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/music/requests') {
      await handleListSongRequests(request, response, url);
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/music/requests/status') {
      await handleSongRequestStatus(request, response);
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/music/sync/uploads/prepare') {
      await handlePrepareSyncUpload(request, response);
      return true;
    }

    const uploadFileMatch = url.pathname.match(/^\/api\/music\/sync\/uploads\/([^/]+)\/file$/);
    if (request.method === 'PUT' && uploadFileMatch) {
      await handleUploadSyncFile(request, response, decodeURIComponent(uploadFileMatch[1]));
      return true;
    }

    sendJson(response, 404, { error: 'Kodiak-Music endpoint not found.' });
    return true;
  } catch (error) {
    if (error instanceof KodiakMusicDatabaseNotConfiguredError) {
      sendDatabaseNotConfigured(response);
      return true;
    }

    console.error('[Kodiak Music API] Request failed', error);
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Kodiak-Music request failed.' });
    return true;
  }
}
