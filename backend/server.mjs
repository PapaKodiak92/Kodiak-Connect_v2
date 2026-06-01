import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const PRESENCE_FILE = join(DATA_DIR, "presence.json");
const FRIENDS_FILE = join(DATA_DIR, "friends.json");

const PORT = Number(process.env.KODIAK_BACKEND_PORT ?? 8787);
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://localhost:5173",
]);

function now() {
  return Date.now();
}

function getCorsHeaders(origin) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "http://localhost:5173";

  return {
    "Access-Control-Allow-Headers": "Content-Type, X-Kodiak-User-Id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
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

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, payload, corsHeaders) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  response.end(JSON.stringify(payload));
}

function isValidMatrixUserId(userId) {
  return typeof userId === "string" && /^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/.test(userId);
}

function getCurrentUserId(request, body = {}) {
  return body.userId || request.headers["x-kodiak-user-id"];
}

function getFriendKey(userA, userB) {
  return [userA, userB].sort().join("|");
}

function getPresenceState(lastSeenAt) {
  const ageMs = now() - Number(lastSeenAt || 0);

  if (ageMs <= 90_000) {
    return "online";
  }

  if (ageMs <= 10 * 60_000) {
    return "idle";
  }

  return "offline";
}

function getFriendStatusForUser(edge, userId) {
  if (!edge) {
    return "none";
  }

  if (edge.status === "friends") {
    return "friends";
  }

  if (edge.status === "pending") {
    return edge.requesterUserId === userId ? "outgoing" : "incoming";
  }

  return "none";
}

function getFriendStatuses(friendStore, userId) {
  const statuses = {};

  for (const edge of Object.values(friendStore)) {
    if (edge.requesterUserId !== userId && edge.targetUserId !== userId) {
      continue;
    }

    const otherUserId = edge.requesterUserId === userId ? edge.targetUserId : edge.requesterUserId;
    statuses[otherUserId] = getFriendStatusForUser(edge, userId);
  }

  return statuses;
}

async function handlePresenceHeartbeat(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  const presenceStore = await readJsonFile(PRESENCE_FILE, {});
  const existingPresence = presenceStore[userId] ?? {};

  presenceStore[userId] = {
    ...existingPresence,
    avatarUrl: typeof body.avatarUrl === "string" ? body.avatarUrl : existingPresence.avatarUrl ?? "",
    displayName: typeof body.displayName === "string" ? body.displayName.slice(0, 64) : existingPresence.displayName ?? "",
    lastSeenAt: now(),
    status: body.status === "idle" ? "idle" : "online",
    userId,
  };

  await writeJsonFile(PRESENCE_FILE, presenceStore);

  sendJson(response, 200, {
    ok: true,
    presence: {
      ...presenceStore[userId],
      presence: "online",
    },
  }, corsHeaders);
}

async function handlePresenceUsers(response, corsHeaders, url) {
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!ids.length) {
    sendJson(response, 200, { users: {} }, corsHeaders);
    return;
  }

  const presenceStore = await readJsonFile(PRESENCE_FILE, {});
  const users = {};

  for (const userId of ids) {
    if (!isValidMatrixUserId(userId)) {
      continue;
    }

    const storedPresence = presenceStore[userId];

    users[userId] = {
      avatarUrl: storedPresence?.avatarUrl ?? "",
      displayName: storedPresence?.displayName ?? "",
      lastSeenAt: storedPresence?.lastSeenAt ?? 0,
      presence: getPresenceState(storedPresence?.lastSeenAt),
      userId,
    };
  }

  sendJson(response, 200, { users }, corsHeaders);
}

async function handleFriendState(request, response, corsHeaders, url) {
  const userId = url.searchParams.get("userId") || request.headers["x-kodiak-user-id"];

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  const friendStore = await readJsonFile(FRIENDS_FILE, {});
  sendJson(response, 200, { statuses: getFriendStatuses(friendStore, userId) }, corsHeaders);
}

async function handleFriendRequest(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);
  const targetUserId = body.targetUserId;

  if (!isValidMatrixUserId(userId) || !isValidMatrixUserId(targetUserId) || userId === targetUserId) {
    sendJson(response, 400, { error: "Invalid friend request." }, corsHeaders);
    return;
  }

  const friendStore = await readJsonFile(FRIENDS_FILE, {});
  const key = getFriendKey(userId, targetUserId);
  const existingEdge = friendStore[key];

  if (existingEdge?.status === "friends") {
    sendJson(response, 200, { ok: true, status: "friends", statuses: getFriendStatuses(friendStore, userId) }, corsHeaders);
    return;
  }

  if (existingEdge?.status === "pending") {
    if (existingEdge.requesterUserId === targetUserId && existingEdge.targetUserId === userId) {
      friendStore[key] = {
        ...existingEdge,
        acceptedAt: now(),
        status: "friends",
        updatedAt: now(),
      };
      await writeJsonFile(FRIENDS_FILE, friendStore);
      sendJson(response, 200, { ok: true, status: "friends", statuses: getFriendStatuses(friendStore, userId) }, corsHeaders);
      return;
    }

    sendJson(response, 200, { ok: true, status: "outgoing", statuses: getFriendStatuses(friendStore, userId) }, corsHeaders);
    return;
  }

  friendStore[key] = {
    createdAt: now(),
    requesterUserId: userId,
    status: "pending",
    targetUserId,
    updatedAt: now(),
  };

  await writeJsonFile(FRIENDS_FILE, friendStore);
  sendJson(response, 200, { ok: true, status: "outgoing", statuses: getFriendStatuses(friendStore, userId) }, corsHeaders);
}

async function handleFriendAccept(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);
  const requesterUserId = body.requesterUserId || body.targetUserId;

  if (!isValidMatrixUserId(userId) || !isValidMatrixUserId(requesterUserId) || userId === requesterUserId) {
    sendJson(response, 400, { error: "Invalid friend accept." }, corsHeaders);
    return;
  }

  const friendStore = await readJsonFile(FRIENDS_FILE, {});
  const key = getFriendKey(userId, requesterUserId);
  const existingEdge = friendStore[key];

  friendStore[key] = {
    createdAt: existingEdge?.createdAt ?? now(),
    requesterUserId,
    status: "friends",
    targetUserId: userId,
    acceptedAt: now(),
    updatedAt: now(),
  };

  await writeJsonFile(FRIENDS_FILE, friendStore);
  sendJson(response, 200, { ok: true, status: "friends", statuses: getFriendStatuses(friendStore, userId) }, corsHeaders);
}

async function handleFriendClear(request, response, corsHeaders, action) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);
  const targetUserId = body.targetUserId || body.requesterUserId;

  if (!isValidMatrixUserId(userId) || !isValidMatrixUserId(targetUserId) || userId === targetUserId) {
    sendJson(response, 400, { error: `Invalid friend ${action}.` }, corsHeaders);
    return;
  }

  const friendStore = await readJsonFile(FRIENDS_FILE, {});
  const key = getFriendKey(userId, targetUserId);
  delete friendStore[key];

  await writeJsonFile(FRIENDS_FILE, friendStore);
  sendJson(response, 200, { ok: true, status: "none", statuses: getFriendStatuses(friendStore, userId) }, corsHeaders);
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const corsHeaders = getCorsHeaders(origin);

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "kodiak-connect-backend",
        time: new Date().toISOString(),
      }, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/presence/heartbeat") {
      await handlePresenceHeartbeat(request, response, corsHeaders);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/presence/users") {
      await handlePresenceUsers(response, corsHeaders, url);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/friends/state") {
      await handleFriendState(request, response, corsHeaders, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/friends/request") {
      await handleFriendRequest(request, response, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/friends/accept") {
      await handleFriendAccept(request, response, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/friends/decline") {
      await handleFriendClear(request, response, corsHeaders, "decline");
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/friends/cancel") {
      await handleFriendClear(request, response, corsHeaders, "cancel");
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/friends/remove") {
      await handleFriendClear(request, response, corsHeaders, "remove");
      return;
    }

    sendJson(response, 404, { error: "Not found." }, corsHeaders);
  } catch (error) {
    console.error("[Kodiak Backend] Request failed", error);
    sendJson(response, 500, { error: "Internal server error." }, corsHeaders);
  }
});

server.listen(PORT, () => {
  console.log(`[Kodiak Backend] listening on http://localhost:${PORT}`);
});
