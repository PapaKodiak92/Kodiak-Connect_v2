import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const PRESENCE_FILE = join(DATA_DIR, "presence.json");
const FRIENDS_FILE = join(DATA_DIR, "friends.json");
const PROFILES_FILE = join(DATA_DIR, "profiles.json");
const BLOCKS_FILE = join(DATA_DIR, "blocks.json");
const REPORTS_FILE = join(DATA_DIR, "reports.json");

const PORT = Number(process.env.KODIAK_BACKEND_PORT ?? 8787);
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://localhost:5173",
  "https://kodiak-connect.com",
  "https://www.kodiak-connect.com",
];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...String(process.env.KODIAK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);
const PLATFORM_MODERATOR_IDS = new Set([
  "@papakodiak:kodiak-connect.com",
  ...String(process.env.KODIAK_PLATFORM_MODERATOR_IDS ?? "")
    .split(",")
    .map((userId) => userId.trim())
    .filter(Boolean),
]);

const RESERVED_DISPLAY_NAMES = new Set([
  "admin",
  "administrator",
  "moderator",
  "mod",
  "support",
  "system",
  "kodiak",
  "kodiak connect",
  "kodiakconnect",
  "official",
  "security",
  "trustandsafety",
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

function getHeaderValue(request, headerName) {
  const value = request.headers[headerName];
  return Array.isArray(value) ? value[0] : value;
}

function getCurrentUserId(request, body = {}) {
  return body.userId || getHeaderValue(request, "x-kodiak-user-id");
}

function normalizeDisplayName(displayName) {
  return String(displayName ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getDefaultDisplayName(userId) {
  const withoutPrefix = userId.startsWith("@") ? userId.slice(1) : userId;
  return withoutPrefix.split(":")[0] || userId;
}

function getDefaultProfile(userId) {
  const displayName = getDefaultDisplayName(userId);

  return {
    avatarUrl: "",
    bio: "",
    createdAt: 0,
    displayName,
    normalizedDisplayName: normalizeDisplayName(displayName),
    updatedAt: 0,
    userId,
  };
}

function sanitizeProfile(profile, userId) {
  return {
    ...getDefaultProfile(userId),
    ...(profile ?? {}),
    userId,
  };
}

function getFriendKey(userA, userB) {
  return [userA, userB].sort().join("|");
}

function getPresenceState(lastSeenAt) {
  const ageMs = now() - Number(lastSeenAt || 0);

  if (ageMs <= 90_000) return "online";
  if (ageMs <= 10 * 60_000) return "idle";
  return "offline";
}

function getFriendStatusForUser(edge, userId) {
  if (!edge) return "none";
  if (edge.status === "friends") return "friends";

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

function getBlockedUserIds(blockStore, userId) {
  return Object.keys(blockStore[userId] ?? {});
}

function getBlockedByUserIds(blockStore, userId) {
  return Object.entries(blockStore)
    .filter(([, blockedTargets]) => Boolean(blockedTargets?.[userId]))
    .map(([blockerUserId]) => blockerUserId);
}

function getBlockStatePayload(blockStore, userId) {
  const blockedUserIds = getBlockedUserIds(blockStore, userId);
  const blockedByUserIds = getBlockedByUserIds(blockStore, userId);

  return {
    blockedByUserIds,
    blockedUserIds,
    restrictedUserIds: [...new Set([...blockedUserIds, ...blockedByUserIds])],
  };
}

function hasEitherUserBlocked(blockStore, userA, userB) {
  return Boolean(blockStore[userA]?.[userB] || blockStore[userB]?.[userA]);
}

function isPlatformModerator(userId) {
  return PLATFORM_MODERATOR_IDS.has(userId);
}

function createReportId() {
  return `report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createReportActionId() {
  return `action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeReportCategory(category) {
  const allowedCategories = new Set([
    "harassment",
    "spam",
    "scam",
    "threats",
    "impersonation",
    "other",
  ]);

  return allowedCategories.has(category) ? category : "other";
}

function sanitizeReportStatus(status) {
  const allowedStatuses = new Set(["open", "reviewed", "dismissed"]);
  return allowedStatuses.has(status) ? status : null;
}

function sanitizeReportForViewer(report, viewerUserId) {
  if (isPlatformModerator(viewerUserId)) {
    return {
      ...report,
      actions: report.actions ?? [],
    };
  }

  return {
    ...report,
    actions: (report.actions ?? []).filter((action) => action.visibleToReporter),
  };
}

function getReportForViewerAction(reportsStore, reportId, actorUserId) {
  const report = reportsStore[reportId];

  if (!report) {
    return { error: "Report not found.", statusCode: 404 };
  }

  if (!isPlatformModerator(actorUserId) && report.reporterUserId !== actorUserId) {
    return { error: "You can only reply to reports you submitted.", statusCode: 403 };
  }

  return { report };
}

function getReportForModeration(reportsStore, reportId, actorUserId) {
  if (!isPlatformModerator(actorUserId)) {
    return { error: "Only platform moderators can handle reports.", statusCode: 403 };
  }

  const report = reportsStore[reportId];

  if (!report) {
    return { error: "Report not found.", statusCode: 404 };
  }

  return { report };
}

async function handleBlockState(request, response, corsHeaders, url) {
  const userId = url.searchParams.get("userId") || getHeaderValue(request, "x-kodiak-user-id");

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  const blockStore = await readJsonFile(BLOCKS_FILE, {});
  sendJson(response, 200, getBlockStatePayload(blockStore, userId), corsHeaders);
}

async function handleBlockUser(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);
  const targetUserId = body.targetUserId;

  if (!isValidMatrixUserId(userId) || !isValidMatrixUserId(targetUserId) || userId === targetUserId) {
    sendJson(response, 400, { error: "Invalid block request." }, corsHeaders);
    return;
  }

  const blockStore = await readJsonFile(BLOCKS_FILE, {});
  const friendStore = await readJsonFile(FRIENDS_FILE, {});

  blockStore[userId] = blockStore[userId] ?? {};
  blockStore[userId][targetUserId] = {
    blockedAt: now(),
    targetUserId,
  };

  delete friendStore[getFriendKey(userId, targetUserId)];

  await writeJsonFile(BLOCKS_FILE, blockStore);
  await writeJsonFile(FRIENDS_FILE, friendStore);

  sendJson(response, 200, {
    ok: true,
    ...getBlockStatePayload(blockStore, userId),
    statuses: getFriendStatuses(friendStore, userId),
  }, corsHeaders);
}

async function handleUnblockUser(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);
  const targetUserId = body.targetUserId;

  if (!isValidMatrixUserId(userId) || !isValidMatrixUserId(targetUserId) || userId === targetUserId) {
    sendJson(response, 400, { error: "Invalid unblock request." }, corsHeaders);
    return;
  }

  const blockStore = await readJsonFile(BLOCKS_FILE, {});
  const friendStore = await readJsonFile(FRIENDS_FILE, {});

  if (blockStore[userId]) {
    delete blockStore[userId][targetUserId];

    if (!Object.keys(blockStore[userId]).length) {
      delete blockStore[userId];
    }
  }

  await writeJsonFile(BLOCKS_FILE, blockStore);

  sendJson(response, 200, {
    ok: true,
    ...getBlockStatePayload(blockStore, userId),
    statuses: getFriendStatuses(friendStore, userId),
  }, corsHeaders);
}

async function handleCreateReport(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const reporterUserId = getCurrentUserId(request, body);
  const targetUserId = body.targetUserId;

  if (!isValidMatrixUserId(reporterUserId) || !isValidMatrixUserId(targetUserId) || reporterUserId === targetUserId) {
    sendJson(response, 400, { error: "Invalid report target." }, corsHeaders);
    return;
  }

  const details = String(body.details ?? "").trim();

  if (details.length < 5) {
    sendJson(response, 400, { error: "Please add a short description before submitting the report." }, corsHeaders);
    return;
  }

  if (details.length > 1500) {
    sendJson(response, 400, { error: "Report details must be 1500 characters or less." }, corsHeaders);
    return;
  }

  const profileStore = await readJsonFile(PROFILES_FILE, {});
  const reportsStore = await readJsonFile(REPORTS_FILE, {});
  const targetProfile = sanitizeProfile(profileStore[targetUserId], targetUserId);

  const createdAt = now();
  const reportId = createReportId();

  const report = {
    actions: [],
    archivedAt: 0,
    archivedByUserId: "",
    category: sanitizeReportCategory(body.category),
    context: String(body.context ?? "").slice(0, 500),
    createdAt,
    details,
    id: reportId,
    messageEventId: String(body.messageEventId ?? "").slice(0, 160),
    reporterUserId,
    roomId: String(body.roomId ?? "").slice(0, 160),
    status: "open",
    targetAvatarUrl: String(body.targetAvatarUrl ?? targetProfile.avatarUrl ?? "").slice(0, 500),
    targetDisplayName: String(body.targetDisplayName ?? targetProfile.displayName ?? getDefaultDisplayName(targetUserId)).slice(0, 64),
    targetUserId,
    updatedAt: createdAt,
  };

  reportsStore[reportId] = report;
  await writeJsonFile(REPORTS_FILE, reportsStore);

  sendJson(response, 200, { ok: true, report: sanitizeReportForViewer(report, reporterUserId) }, corsHeaders);
}

async function handleListReports(request, response, corsHeaders, url) {
  const userId = url.searchParams.get("userId") || getHeaderValue(request, "x-kodiak-user-id");
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  const reportsStore = await readJsonFile(REPORTS_FILE, {});
  const canViewAllReports = isPlatformModerator(userId);
  const reports = Object.values(reportsStore)
    .filter((report) => canViewAllReports || report.reporterUserId === userId)
    .filter((report) => includeArchived || !report.archivedAt)
    .map((report) => sanitizeReportForViewer(report, userId))
    .sort((a, b) => Number(b.updatedAt ?? b.createdAt ?? 0) - Number(a.updatedAt ?? a.createdAt ?? 0))
    .slice(0, 100);

  sendJson(response, 200, { canViewAllReports, reports }, corsHeaders);
}

async function handleReportReply(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const actorUserId = getCurrentUserId(request, body);
  const reportId = String(body.reportId ?? "").trim();
  const message = String(body.message ?? "").trim();

  if (!isValidMatrixUserId(actorUserId) || !reportId) {
    sendJson(response, 400, { error: "Invalid report reply request." }, corsHeaders);
    return;
  }

  if (message.length < 2) {
    sendJson(response, 400, { error: "Reply must include a message." }, corsHeaders);
    return;
  }

  if (message.length > 1200) {
    sendJson(response, 400, { error: "Reply must be 1200 characters or less." }, corsHeaders);
    return;
  }

  const reportsStore = await readJsonFile(REPORTS_FILE, {});
  const result = getReportForViewerAction(reportsStore, reportId, actorUserId);

  if (result.error) {
    sendJson(response, result.statusCode, { error: result.error }, corsHeaders);
    return;
  }

  const updatedAt = now();
  const report = {
    ...result.report,
    actions: [
      ...(result.report.actions ?? []),
      {
        actorUserId,
        body: message,
        createdAt: updatedAt,
        id: createReportActionId(),
        type: "reply",
        visibleToReporter: true,
      },
    ],
    archivedAt: 0,
    archivedByUserId: "",
    updatedAt,
  };

  reportsStore[reportId] = report;
  await writeJsonFile(REPORTS_FILE, reportsStore);

  sendJson(response, 200, { ok: true, report: sanitizeReportForViewer(report, actorUserId) }, corsHeaders);
}

async function handleReportNote(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const actorUserId = getCurrentUserId(request, body);
  const reportId = String(body.reportId ?? "").trim();
  const note = String(body.note ?? "").trim();

  if (!isValidMatrixUserId(actorUserId) || !reportId) {
    sendJson(response, 400, { error: "Invalid report note request." }, corsHeaders);
    return;
  }

  if (note.length < 2) {
    sendJson(response, 400, { error: "Private note must include text." }, corsHeaders);
    return;
  }

  if (note.length > 1200) {
    sendJson(response, 400, { error: "Private note must be 1200 characters or less." }, corsHeaders);
    return;
  }

  const reportsStore = await readJsonFile(REPORTS_FILE, {});
  const result = getReportForModeration(reportsStore, reportId, actorUserId);

  if (result.error) {
    sendJson(response, result.statusCode, { error: result.error }, corsHeaders);
    return;
  }

  const updatedAt = now();
  const report = {
    ...result.report,
    actions: [
      ...(result.report.actions ?? []),
      {
        actorUserId,
        body: note,
        createdAt: updatedAt,
        id: createReportActionId(),
        type: "note",
        visibleToReporter: false,
      },
    ],
    updatedAt,
  };

  reportsStore[reportId] = report;
  await writeJsonFile(REPORTS_FILE, reportsStore);

  sendJson(response, 200, { ok: true, report: sanitizeReportForViewer(report, actorUserId) }, corsHeaders);
}

async function handleReportStatus(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const actorUserId = getCurrentUserId(request, body);
  const reportId = String(body.reportId ?? "").trim();
  const nextStatus = sanitizeReportStatus(body.status);
  const note = String(body.note ?? "").trim();

  if (!isValidMatrixUserId(actorUserId) || !reportId || !nextStatus) {
    sendJson(response, 400, { error: "Invalid report status request." }, corsHeaders);
    return;
  }

  if (note.length > 1200) {
    sendJson(response, 400, { error: "Status note must be 1200 characters or less." }, corsHeaders);
    return;
  }

  const reportsStore = await readJsonFile(REPORTS_FILE, {});
  const result = getReportForModeration(reportsStore, reportId, actorUserId);

  if (result.error) {
    sendJson(response, result.statusCode, { error: result.error }, corsHeaders);
    return;
  }

  const updatedAt = now();
  const report = {
    ...result.report,
    actions: [
      ...(result.report.actions ?? []),
      {
        actorUserId,
        body: note || `Status changed to ${nextStatus}.`,
        createdAt: updatedAt,
        fromStatus: result.report.status,
        id: createReportActionId(),
        toStatus: nextStatus,
        type: "status",
        visibleToReporter: true,
      },
    ],
    status: nextStatus,
    updatedAt,
  };

  reportsStore[reportId] = report;
  await writeJsonFile(REPORTS_FILE, reportsStore);

  sendJson(response, 200, { ok: true, report: sanitizeReportForViewer(report, actorUserId) }, corsHeaders);
}

async function handleReportArchive(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const actorUserId = getCurrentUserId(request, body);
  const reportId = String(body.reportId ?? "").trim();
  const note = String(body.note ?? "").trim();

  if (!isValidMatrixUserId(actorUserId) || !reportId) {
    sendJson(response, 400, { error: "Invalid report archive request." }, corsHeaders);
    return;
  }

  const reportsStore = await readJsonFile(REPORTS_FILE, {});
  const result = getReportForModeration(reportsStore, reportId, actorUserId);

  if (result.error) {
    sendJson(response, result.statusCode, { error: result.error }, corsHeaders);
    return;
  }

  const updatedAt = now();
  const report = {
    ...result.report,
    actions: [
      ...(result.report.actions ?? []),
      {
        actorUserId,
        body: note || "Report archived.",
        createdAt: updatedAt,
        id: createReportActionId(),
        type: "archive",
        visibleToReporter: false,
      },
    ],
    archivedAt: updatedAt,
    archivedByUserId: actorUserId,
    updatedAt,
  };

  reportsStore[reportId] = report;
  await writeJsonFile(REPORTS_FILE, reportsStore);

  sendJson(response, 200, { ok: true, report: sanitizeReportForViewer(report, actorUserId) }, corsHeaders);
}

async function handleReportDelete(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const actorUserId = getCurrentUserId(request, body);
  const reportId = String(body.reportId ?? "").trim();

  if (!isValidMatrixUserId(actorUserId) || !reportId) {
    sendJson(response, 400, { error: "Invalid report delete request." }, corsHeaders);
    return;
  }

  const reportsStore = await readJsonFile(REPORTS_FILE, {});
  const result = getReportForModeration(reportsStore, reportId, actorUserId);

  if (result.error) {
    sendJson(response, result.statusCode, { error: result.error }, corsHeaders);
    return;
  }

  delete reportsStore[reportId];
  await writeJsonFile(REPORTS_FILE, reportsStore);

  sendJson(response, 200, { ok: true, deletedReportId: reportId }, corsHeaders);
}

async function handleProfileSearch(response, corsHeaders, url) {
  const query = String(url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 12), 1), 25);

  const profileStore = await readJsonFile(PROFILES_FILE, {});
  const presenceStore = await readJsonFile(PRESENCE_FILE, {});
  const friendStore = await readJsonFile(FRIENDS_FILE, {});

  const candidateUserIds = new Set([
    ...Object.keys(profileStore),
    ...Object.keys(presenceStore),
  ]);

  for (const edge of Object.values(friendStore)) {
    if (edge?.requesterUserId) candidateUserIds.add(edge.requesterUserId);
    if (edge?.targetUserId) candidateUserIds.add(edge.targetUserId);
  }

  const profiles = {};

  for (const userId of candidateUserIds) {
    if (!isValidMatrixUserId(userId)) {
      continue;
    }

    const storedProfile = profileStore[userId];
    const storedPresence = presenceStore[userId];
    const profile = sanitizeProfile(storedProfile, userId);

    if (!storedProfile && storedPresence?.displayName) {
      profile.displayName = storedPresence.displayName;
      profile.normalizedDisplayName = normalizeDisplayName(storedPresence.displayName);
    }

    const searchableText = [
      profile.displayName,
      profile.bio,
      userId,
      getDefaultDisplayName(userId),
    ].join(" ").toLowerCase();

    if (query && !searchableText.includes(query)) {
      continue;
    }

    profiles[userId] = profile;

    if (Object.keys(profiles).length >= limit) {
      break;
    }
  }

  sendJson(response, 200, { profiles }, corsHeaders);
}

async function handleProfileUsers(response, corsHeaders, url) {
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const profileStore = await readJsonFile(PROFILES_FILE, {});
  const profiles = {};

  for (const userId of ids) {
    if (isValidMatrixUserId(userId)) {
      profiles[userId] = sanitizeProfile(profileStore[userId], userId);
    }
  }

  sendJson(response, 200, { profiles }, corsHeaders);
}

async function handleProfileMe(request, response, corsHeaders) {
  const userId = getHeaderValue(request, "x-kodiak-user-id");

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  const profileStore = await readJsonFile(PROFILES_FILE, {});
  sendJson(response, 200, { profile: sanitizeProfile(profileStore[userId], userId) }, corsHeaders);
}

async function handleSaveProfileMe(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const userId = getCurrentUserId(request, body);

  if (!isValidMatrixUserId(userId)) {
    sendJson(response, 400, { error: "Invalid Matrix userId." }, corsHeaders);
    return;
  }

  const profileStore = await readJsonFile(PROFILES_FILE, {});
  const existingProfile = sanitizeProfile(profileStore[userId], userId);

  const nextDisplayName = String(body.displayName ?? existingProfile.displayName).trim().replace(/\s+/g, " ");
  const normalizedDisplayName = normalizeDisplayName(nextDisplayName);
  const nextBio = String(body.bio ?? existingProfile.bio ?? "").trim();
  const nextAvatarUrl = Object.prototype.hasOwnProperty.call(body, "avatarUrl")
    ? String(body.avatarUrl ?? "")
    : existingProfile.avatarUrl ?? "";

  if (!nextDisplayName) {
    sendJson(response, 400, { error: "Display name cannot be empty." }, corsHeaders);
    return;
  }

  if (nextDisplayName.length > 32) {
    sendJson(response, 400, { error: "Display name must be 32 characters or less." }, corsHeaders);
    return;
  }

  if (nextBio.length > 180) {
    sendJson(response, 400, { error: "Bio must be 180 characters or less." }, corsHeaders);
    return;
  }

  if (RESERVED_DISPLAY_NAMES.has(normalizedDisplayName)) {
    sendJson(response, 409, { error: "That display name is reserved." }, corsHeaders);
    return;
  }

  const duplicateProfile = Object.values(profileStore).find((profile) => {
    return profile?.userId !== userId && profile?.normalizedDisplayName === normalizedDisplayName;
  });

  if (duplicateProfile) {
    sendJson(response, 409, { error: "That display name is already taken." }, corsHeaders);
    return;
  }

  const profile = {
    ...existingProfile,
    avatarUrl: nextAvatarUrl,
    bio: nextBio,
    createdAt: existingProfile.createdAt || now(),
    displayName: nextDisplayName,
    normalizedDisplayName,
    updatedAt: now(),
    userId,
  };

  profileStore[userId] = profile;
  await writeJsonFile(PROFILES_FILE, profileStore);

  sendJson(response, 200, { ok: true, profile }, corsHeaders);
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
  sendJson(response, 200, { ok: true, presence: { ...presenceStore[userId], presence: "online" } }, corsHeaders);
}

async function handlePresenceUsers(response, corsHeaders, url) {
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const presenceStore = await readJsonFile(PRESENCE_FILE, {});
  const users = {};

  for (const userId of ids) {
    if (!isValidMatrixUserId(userId)) continue;

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
  const userId = url.searchParams.get("userId") || getHeaderValue(request, "x-kodiak-user-id");

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
  const blockStore = await readJsonFile(BLOCKS_FILE, {});

  if (hasEitherUserBlocked(blockStore, userId, targetUserId)) {
    sendJson(response, 409, { error: "Cannot send a friend request while block is active." }, corsHeaders);
    return;
  }

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
  const blockStore = await readJsonFile(BLOCKS_FILE, {});

  if (hasEitherUserBlocked(blockStore, userId, requesterUserId)) {
    sendJson(response, 409, { error: "Cannot accept a friend request while block is active." }, corsHeaders);
    return;
  }

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
  const blockStore = await readJsonFile(BLOCKS_FILE, {});

  if (hasEitherUserBlocked(blockStore, userId, targetUserId)) {
    sendJson(response, 409, { error: "Cannot send a friend request while a block is active." }, corsHeaders);
    return;
  }

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
      sendJson(response, 200, { ok: true, service: "kodiak-connect-backend", time: new Date().toISOString() }, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reports/create") {
      await handleCreateReport(request, response, corsHeaders);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/reports/list") {
      await handleListReports(request, response, corsHeaders, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reports/reply") {
      await handleReportReply(request, response, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reports/note") {
      await handleReportNote(request, response, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reports/status") {
      await handleReportStatus(request, response, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reports/archive") {
      await handleReportArchive(request, response, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reports/delete") {
      await handleReportDelete(request, response, corsHeaders);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/blocks/state") {
      await handleBlockState(request, response, corsHeaders, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/blocks/block") {
      await handleBlockUser(request, response, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/blocks/unblock") {
      await handleUnblockUser(request, response, corsHeaders);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/profiles/search") {
      await handleProfileSearch(response, corsHeaders, url);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/profiles/users") {
      await handleProfileUsers(response, corsHeaders, url);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/profiles/me") {
      await handleProfileMe(request, response, corsHeaders);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/profiles/me") {
      await handleSaveProfileMe(request, response, corsHeaders);
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Kodiak Backend] listening on http://localhost:${PORT}`);
});
