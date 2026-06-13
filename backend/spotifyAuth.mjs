import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.KODIAK_DATA_DIR
  ? process.env.KODIAK_DATA_DIR
  : join(__dirname, "data");

const SPOTIFY_TOKENS_FILE = join(DATA_DIR, "spotify-tokens.json");
const SPOTIFY_AUTH_STATES_FILE = join(DATA_DIR, "spotify-auth-states.json");

const SPOTIFY_CLIENT_ID = String(process.env.KODIAK_SPOTIFY_CLIENT_ID ?? "").trim();
const SPOTIFY_CLIENT_SECRET = String(process.env.KODIAK_SPOTIFY_CLIENT_SECRET ?? "").trim();
const SPOTIFY_REDIRECT_URI = String(process.env.KODIAK_SPOTIFY_REDIRECT_URI ?? "").trim();

const SPOTIFY_AUTH_STATE_TTL_MS = 10 * 60_000;
const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

function now() {
  return Date.now();
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureDataDir();
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function sendJson(response, statusCode, payload, corsHeaders) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, body, corsHeaders) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    ...corsHeaders,
  });
  response.end(body);
}

function isValidMatrixUserId(userId) {
  return typeof userId === "string" && /^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/.test(userId);
}

function getHeaderValue(request, headerName) {
  const value = request.headers[headerName];
  return Array.isArray(value) ? value[0] : value;
}

function getCurrentUserId(request, body = {}) {
  return body.userId || getHeaderValue(request, "x-kodiak-user-id");
}

function isSpotifyConfigured() {
  return Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET && SPOTIFY_REDIRECT_URI);
}

function createSpotifyState() {
  return randomBytes(24).toString("hex");
}

function getSpotifyBasicAuthHeader() {
  const credentials = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  return `Basic ${credentials}`;
}

function sanitizeSpotifyProfile(profile) {
  return {
    displayName: String(profile?.display_name ?? "").slice(0, 120),
    email: String(profile?.email ?? "").slice(0, 180),
    id: String(profile?.id ?? "").slice(0, 120),
    product: String(profile?.product ?? "").slice(0, 80),
  };
}

async function requestSpotifyToken(formValues) {
  const body = new URLSearchParams(formValues);

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: getSpotifyBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error_description || data?.error || "Spotify token request failed.";
    throw new Error(message);
  }

  return data;
}

async function getSpotifyProfile(accessToken) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || "Spotify profile request failed.");
  }

  return sanitizeSpotifyProfile(data);
}

async function getFreshSpotifyToken(userId) {
  const tokenStore = await readJsonFile(SPOTIFY_TOKENS_FILE, {});
  const stored = tokenStore[userId];

  if (!stored?.accessToken) {
    return null;
  }

  if (Number(stored.expiresAt || 0) - now() > 60_000) {
    return { tokenStore, token: stored };
  }

  if (!stored.refreshToken) {
    delete tokenStore[userId];
    await writeJsonFile(SPOTIFY_TOKENS_FILE, tokenStore);
    return null;
  }

  const refreshed = await requestSpotifyToken({
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
  });

  const nextToken = {
    ...stored,
    accessToken: refreshed.access_token,
    expiresAt: now() + Number(refreshed.expires_in || 3600) * 1000,
    refreshToken: refreshed.refresh_token || stored.refreshToken,
    scope: refreshed.scope || stored.scope || "",
    tokenType: refreshed.token_type || stored.tokenType || "Bearer",
    updatedAt: now(),
  };

  tokenStore[userId] = nextToken;
  await writeJsonFile(SPOTIFY_TOKENS_FILE, tokenStore);

  return { tokenStore, token: nextToken };
}

function getPublicSpotifyConnection(token) {
  return {
    connected: Boolean(token?.accessToken),
    connectedAt: Number(token?.connectedAt || 0),
    expiresAt: Number(token?.expiresAt || 0),
    profile: token?.profile ?? null,
    scope: String(token?.scope ?? ""),
  };
}

export async function handleSpotifyLogin(request, response, corsHeaders, url) {
  if (!isSpotifyConfigured()) {
    sendJson(response, 503, { error: "Spotify is not configured on this backend." }, corsHeaders);
    return;
  }

  const userId = url.searchParams.get("userId") || getHeaderValue(request, "x-kodiak-user-id");

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  const state = createSpotifyState();
  const authStates = await readJsonFile(SPOTIFY_AUTH_STATES_FILE, {});

  authStates[state] = {
    createdAt: now(),
    userId,
  };

  await writeJsonFile(SPOTIFY_AUTH_STATES_FILE, authStates);

  const spotifyUrl = new URL("https://accounts.spotify.com/authorize");
  spotifyUrl.searchParams.set("response_type", "code");
  spotifyUrl.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  spotifyUrl.searchParams.set("scope", SPOTIFY_SCOPES);
  spotifyUrl.searchParams.set("redirect_uri", SPOTIFY_REDIRECT_URI);
  spotifyUrl.searchParams.set("state", state);

  response.writeHead(302, {
    Location: spotifyUrl.toString(),
    ...corsHeaders,
  });
  response.end();
}

export async function handleSpotifyCallback(request, response, corsHeaders, url) {
  if (!isSpotifyConfigured()) {
    sendHtml(response, 503, "<h1>Spotify is not configured.</h1>", corsHeaders);
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    sendHtml(response, 400, `<h1>Spotify connection denied.</h1><p>${error}</p>`, corsHeaders);
    return;
  }

  if (!code || !state) {
    sendHtml(response, 400, "<h1>Spotify callback is missing code or state.</h1>", corsHeaders);
    return;
  }

  const authStates = await readJsonFile(SPOTIFY_AUTH_STATES_FILE, {});
  const authState = authStates[state];

  delete authStates[state];

  for (const [storedState, storedValue] of Object.entries(authStates)) {
    if (now() - Number(storedValue?.createdAt || 0) > SPOTIFY_AUTH_STATE_TTL_MS) {
      delete authStates[storedState];
    }
  }

  await writeJsonFile(SPOTIFY_AUTH_STATES_FILE, authStates);

  if (!authState || now() - Number(authState.createdAt || 0) > SPOTIFY_AUTH_STATE_TTL_MS) {
    sendHtml(response, 400, "<h1>Spotify connection expired. Try again from Kodiak Connect.</h1>", corsHeaders);
    return;
  }

  const userId = authState.userId;

  if (!isValidMatrixUserId(userId)) {
    sendHtml(response, 400, "<h1>Spotify callback user is invalid.</h1>", corsHeaders);
    return;
  }

  try {
    const token = await requestSpotifyToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    });

    const profile = await getSpotifyProfile(token.access_token);
    const tokenStore = await readJsonFile(SPOTIFY_TOKENS_FILE, {});

    tokenStore[userId] = {
      accessToken: token.access_token,
      connectedAt: now(),
      expiresAt: now() + Number(token.expires_in || 3600) * 1000,
      profile,
      refreshToken: token.refresh_token || "",
      scope: token.scope || SPOTIFY_SCOPES,
      tokenType: token.token_type || "Bearer",
      updatedAt: now(),
      userId,
    };

    await writeJsonFile(SPOTIFY_TOKENS_FILE, tokenStore);

    sendHtml(
      response,
      200,
      `<!doctype html>
<html>
  <head><title>Spotify connected</title></head>
  <body style="background:#020617;color:#fff7ed;font-family:system-ui;padding:2rem;">
    <h1>Spotify connected.</h1>
    <p>Kodiak Connect is refreshing your Spotify connection.</p>
    <script>
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: "kodiak:spotify-connected" }, "*");
        }
      } catch {}
      setTimeout(() => window.close(), 700);
    </script>
  </body>
</html>`,
      corsHeaders,
    );
  } catch (callbackError) {
    sendHtml(response, 500, `<h1>Spotify connection failed.</h1><p>${callbackError.message}</p>`, corsHeaders);
  }
}

export async function handleSpotifyStatus(request, response, corsHeaders, url) {
  const userId = url.searchParams.get("userId") || getHeaderValue(request, "x-kodiak-user-id");

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  if (!isSpotifyConfigured()) {
    sendJson(response, 200, { connected: false, configured: false }, corsHeaders);
    return;
  }

  const tokenResult = await getFreshSpotifyToken(userId);

  sendJson(response, 200, {
    configured: true,
    ...getPublicSpotifyConnection(tokenResult?.token),
  }, corsHeaders);
}

export async function handleSpotifyToken(request, response, corsHeaders, url) {
  const userId = url.searchParams.get("userId") || getHeaderValue(request, "x-kodiak-user-id");

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  if (!isSpotifyConfigured()) {
    sendJson(response, 503, { error: "Spotify is not configured on this backend." }, corsHeaders);
    return;
  }

  const tokenResult = await getFreshSpotifyToken(userId);

  if (!tokenResult?.token?.accessToken) {
    sendJson(response, 404, { error: "Spotify is not connected for this user." }, corsHeaders);
    return;
  }

  sendJson(response, 200, {
    accessToken: tokenResult.token.accessToken,
    expiresAt: tokenResult.token.expiresAt,
    profile: tokenResult.token.profile ?? null,
  }, corsHeaders);
}

export async function handleSpotifyDisconnect(request, response, corsHeaders) {
  const body = await new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });

  const userId = getCurrentUserId(request, body);

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  const tokenStore = await readJsonFile(SPOTIFY_TOKENS_FILE, {});
  delete tokenStore[userId];
  await writeJsonFile(SPOTIFY_TOKENS_FILE, tokenStore);

  sendJson(response, 200, { connected: false, ok: true }, corsHeaders);
}
