import {
  KodiakMusicDatabaseNotConfiguredError,
  createKodiakMusicSongRequest,
  getKodiakMusicHealth,
  listKodiakMusicSongRequests,
  searchKodiakMusicTracks,
  updateKodiakMusicSongRequestStatus,
} from './kodiakMusicDb.mjs';

const DEFAULT_MUSIC_MODERATOR_IDS = ['@papakodiak:kodiak-connect.com'];
const MUSIC_MODERATOR_IDS = new Set([
  ...DEFAULT_MUSIC_MODERATOR_IDS,
  ...String(process.env.KODIAK_MUSIC_MODERATOR_IDS ?? process.env.KODIAK_PLATFORM_MODERATOR_IDS ?? '')
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

async function handleMusicHealth(_request, response) {
  const health = await getKodiakMusicHealth();
  sendJson(response, health.ok ? 200 : 503, health);
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

    if (request.method === 'GET' && url.pathname === '/api/music/library/search') {
      await handleLibrarySearch(request, response, url);
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
