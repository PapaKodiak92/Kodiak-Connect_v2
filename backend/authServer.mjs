import { createHash, createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const AUTH_PENDING_FILE = join(DATA_DIR, 'auth-pending.json');
const AUTH_ACCOUNTS_FILE = join(DATA_DIR, 'auth-accounts.json');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');

const PORT = Number(process.env.KODIAK_AUTH_PORT ?? 8788);
const MATRIX_HOMESERVER_URL = String(process.env.KODIAK_MATRIX_HOMESERVER_URL ?? process.env.VITE_MATRIX_BASE_URL ?? 'https://matrix.kodiak-connect.com').replace(/\/+$/, '');
const MATRIX_SERVER_NAME = String(process.env.KODIAK_MATRIX_SERVER_NAME ?? process.env.VITE_MATRIX_SERVER_NAME ?? 'kodiak-connect.com');
const MATRIX_ADMIN_TOKEN = String(process.env.KODIAK_MATRIX_ADMIN_TOKEN ?? '').trim();
const MATRIX_REGISTRATION_SHARED_SECRET = String(process.env.KODIAK_MATRIX_REGISTRATION_SHARED_SECRET ?? '').trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY ?? '').trim();
const AUTH_EMAIL_FROM = String(process.env.AUTH_EMAIL_FROM ?? '').trim();
const TURNSTILE_SECRET_KEY = String(process.env.TURNSTILE_SECRET_KEY ?? '').trim();
const REQUIRE_TURNSTILE = String(process.env.KODIAK_AUTH_REQUIRE_TURNSTILE ?? 'false') === 'true';
const ENCRYPTION_SECRET = String(process.env.KODIAK_AUTH_ENCRYPTION_KEY ?? MATRIX_ADMIN_TOKEN ?? 'kodiak-connect-dev-auth-key');
const VERIFICATION_TTL_MS = 15 * 60 * 1000;

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://localhost:5173',
  'https://kodiak-connect.com',
  'https://www.kodiak-connect.com',
];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...String(process.env.KODIAK_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

function now() {
  return Date.now();
}

function getCorsHeaders(origin) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'http://localhost:5173';

  return {
    'Access-Control-Allow-Headers': 'Content-Type, X-Kodiak-User-Id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureDataDir();
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
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

function sendJson(response, statusCode, payload, corsHeaders) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders,
  });
  response.end(JSON.stringify(payload));
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username) {
  return /^[a-z0-9._=-]{3,32}$/.test(username) && !username.includes('..');
}

function getMatrixUserId(username) {
  return `@${username}:${MATRIX_SERVER_NAME}`;
}

function createCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createSignupId() {
  return `signup_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
}

function hashValue(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function hashCode(code) {
  return hashValue(`kodiak-code:${code}`);
}

function safeEqualHash(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getEncryptionKey() {
  return createHash('sha256').update(ENCRYPTION_SECRET).digest();
}

function encryptText(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptText(value) {
  const [ivRaw, authTagRaw, encryptedRaw] = String(value).split('.');
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagRaw, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64')), decipher.final()]).toString('utf8');
}

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return firstForwarded?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
}

async function assertRateLimit(key, maxAttempts, windowMs) {
  const store = await readJsonFile(join(DATA_DIR, 'auth-rate-limits.json'), {});
  const currentTime = now();
  const entry = store[key] ?? { attempts: 0, resetAt: currentTime + windowMs };

  if (currentTime > entry.resetAt) {
    store[key] = { attempts: 1, resetAt: currentTime + windowMs };
    await writeJsonFile(join(DATA_DIR, 'auth-rate-limits.json'), store);
    return;
  }

  if (entry.attempts >= maxAttempts) {
    const waitSeconds = Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000));
    const error = new Error(`Too many attempts. Try again in ${waitSeconds}s.`);
    error.statusCode = 429;
    throw error;
  }

  store[key] = { attempts: entry.attempts + 1, resetAt: entry.resetAt };
  await writeJsonFile(join(DATA_DIR, 'auth-rate-limits.json'), store);
}

async function verifyTurnstile(token, remoteIp) {
  if (!TURNSTILE_SECRET_KEY) {
    if (REQUIRE_TURNSTILE) {
      throw Object.assign(new Error('Turnstile is required but TURNSTILE_SECRET_KEY is missing.'), { statusCode: 500 });
    }

    return;
  }

  if (!token) {
    throw Object.assign(new Error('Complete the Cloudflare verification check.'), { statusCode: 400 });
  }

  const formData = new URLSearchParams();
  formData.set('secret', TURNSTILE_SECRET_KEY);
  formData.set('response', token);

  if (remoteIp && remoteIp !== 'unknown') {
    formData.set('remoteip', remoteIp);
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.success) {
    throw Object.assign(new Error('Cloudflare verification failed. Try again.'), { statusCode: 400 });
  }
}

async function sendVerificationEmail(email, username, code) {
  const subject = 'Verify your Kodiak Connect account';
  const text = [
    `Your Kodiak Connect verification code is ${code}.`,
    '',
    `Username: ${username}`,
    'This code expires in 15 minutes.',
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2>Kodiak Connect verification</h2>
      <p>Your verification code is:</p>
      <p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p>
      <p>Username: <strong>${username}</strong></p>
      <p>This code expires in 15 minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `;

  if (!RESEND_API_KEY || !AUTH_EMAIL_FROM) {
    console.warn(`[Kodiak Auth] Email is not configured. Verification code for ${email}: ${code}`);
    return { devCode: code, sent: false };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: AUTH_EMAIL_FROM,
      to: email,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error('[Kodiak Auth] Resend failed', response.status, errorBody);
    throw Object.assign(new Error('Could not send verification email. Check mail service configuration.'), { statusCode: 502 });
  }

  return { sent: true };
}

function createRegistrationMac(nonce, username, password, admin) {
  const adminFlag = admin ? 'admin' : 'notadmin';
  const hmac = createHmac('sha1', Buffer.from(MATRIX_REGISTRATION_SHARED_SECRET, 'utf8'));

  for (const part of [nonce, username, password, adminFlag]) {
    if (part !== nonce) {
      hmac.update(Buffer.from([0]));
    }

    hmac.update(Buffer.from(String(part), 'utf8'));
  }

  return hmac.digest('hex');
}

async function createMatrixAccountWithSharedSecret(username, password) {
  const registerEndpoint = `${MATRIX_HOMESERVER_URL}/_synapse/admin/v1/register`;
  const nonceResponse = await fetch(registerEndpoint);

  if (!nonceResponse.ok) {
    const body = await nonceResponse.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || 'Could not get Matrix registration nonce.'), { statusCode: nonceResponse.status });
  }

  const nonceBody = await nonceResponse.json();
  const nonce = nonceBody.nonce;

  if (!nonce) {
    throw Object.assign(new Error('Matrix registration nonce was missing.'), { statusCode: 502 });
  }

  const response = await fetch(registerEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      admin: false,
      mac: createRegistrationMac(nonce, username, password, false),
      nonce,
      password,
      username,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || 'Could not create Matrix account.'), { statusCode: response.status });
  }

  return getMatrixUserId(username);
}

async function createMatrixAccount(username, password) {
  if (MATRIX_REGISTRATION_SHARED_SECRET) {
    return createMatrixAccountWithSharedSecret(username, password);
  }

  if (!MATRIX_ADMIN_TOKEN) {
    throw Object.assign(new Error('KODIAK_MATRIX_ADMIN_TOKEN is missing. Cannot create Matrix users.'), { statusCode: 500 });
  }

  const userId = getMatrixUserId(username);
  const endpoint = `${MATRIX_HOMESERVER_URL}/_synapse/admin/v2/users/${encodeURIComponent(userId)}`;
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${MATRIX_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      admin: false,
      deactivated: false,
      displayname: username,
      password,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || 'Could not create Matrix account.'), { statusCode: response.status });
  }

  return userId;
}

async function isUsernameAvailable(username, accounts) {
  const userId = getMatrixUserId(username);

  if (accounts.byUsername?.[username] || accounts.byUserId?.[userId]) {
    return false;
  }

  try {
    const response = await fetch(`${MATRIX_HOMESERVER_URL}/_matrix/client/v3/register/available?username=${encodeURIComponent(username)}`);

    if (response.status === 200) {
      const body = await response.json().catch(() => ({}));
      return body.available !== false;
    }

    if (response.status === 400) {
      return false;
    }
  } catch {
    // Keep backend functional if the availability endpoint is disabled.
  }

  return true;
}

function createEmptyAccountsStore() {
  return {
    byEmail: {},
    byUserId: {},
    byUsername: {},
  };
}

async function handleSignupStart(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? '');
  const turnstileToken = String(body.turnstileToken ?? '');
  const ip = getClientIp(request);

  await assertRateLimit(`signup:${ip}`, 8, 15 * 60 * 1000);
  await verifyTurnstile(turnstileToken, ip);

  if (!isValidEmail(email)) {
    sendJson(response, 400, { error: 'Enter a valid email address.' }, corsHeaders);
    return;
  }

  if (!isValidUsername(username)) {
    sendJson(response, 400, { error: 'Username must be 3-32 lowercase letters, numbers, dots, underscores, equals, or hyphens.' }, corsHeaders);
    return;
  }

  if (password.length < 8) {
    sendJson(response, 400, { error: 'Password must be 8 characters or greater.' }, corsHeaders);
    return;
  }

  const accounts = await readJsonFile(AUTH_ACCOUNTS_FILE, createEmptyAccountsStore());
  accounts.byEmail = accounts.byEmail ?? {};
  accounts.byUsername = accounts.byUsername ?? {};
  accounts.byUserId = accounts.byUserId ?? {};

  if (accounts.byEmail[email]) {
    sendJson(response, 409, { error: 'That email is already registered.' }, corsHeaders);
    return;
  }

  if (!(await isUsernameAvailable(username, accounts))) {
    sendJson(response, 409, { error: 'That username is already taken.' }, corsHeaders);
    return;
  }

  const pendingStore = await readJsonFile(AUTH_PENDING_FILE, {});
  const createdAt = now();
  const code = createCode();
  const signupId = createSignupId();

  for (const [existingId, pending] of Object.entries(pendingStore)) {
    if (pending.expiresAt < createdAt || pending.email === email || pending.username === username) {
      delete pendingStore[existingId];
    }
  }

  pendingStore[signupId] = {
    attempts: 0,
    codeHash: hashCode(code),
    createdAt,
    email,
    expiresAt: createdAt + VERIFICATION_TTL_MS,
    passwordCiphertext: encryptText(password),
    username,
  };

  await writeJsonFile(AUTH_PENDING_FILE, pendingStore);
  const emailResult = await sendVerificationEmail(email, username, code);

  sendJson(
    response,
    200,
    {
      devVerificationCode: emailResult.devCode,
      emailSent: emailResult.sent,
      expiresAt: pendingStore[signupId].expiresAt,
      signupId,
    },
    corsHeaders,
  );
}

async function handleSignupVerify(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const signupId = String(body.signupId ?? '').trim();
  const code = String(body.code ?? '').trim().replace(/\s+/g, '');
  const ip = getClientIp(request);

  await assertRateLimit(`verify:${ip}`, 12, 15 * 60 * 1000);

  if (!signupId || !/^\d{6}$/.test(code)) {
    sendJson(response, 400, { error: 'Enter the 6-digit verification code.' }, corsHeaders);
    return;
  }

  const pendingStore = await readJsonFile(AUTH_PENDING_FILE, {});
  const pending = pendingStore[signupId];

  if (!pending) {
    sendJson(response, 404, { error: 'Verification session not found. Start signup again.' }, corsHeaders);
    return;
  }

  if (pending.expiresAt < now()) {
    delete pendingStore[signupId];
    await writeJsonFile(AUTH_PENDING_FILE, pendingStore);
    sendJson(response, 410, { error: 'Verification code expired. Start signup again.' }, corsHeaders);
    return;
  }

  if (pending.attempts >= 6) {
    delete pendingStore[signupId];
    await writeJsonFile(AUTH_PENDING_FILE, pendingStore);
    sendJson(response, 429, { error: 'Too many incorrect codes. Start signup again.' }, corsHeaders);
    return;
  }

  if (!safeEqualHash(hashCode(code), pending.codeHash)) {
    pending.attempts += 1;
    await writeJsonFile(AUTH_PENDING_FILE, pendingStore);
    sendJson(response, 400, { error: 'Incorrect verification code.' }, corsHeaders);
    return;
  }

  const accounts = await readJsonFile(AUTH_ACCOUNTS_FILE, createEmptyAccountsStore());
  accounts.byEmail = accounts.byEmail ?? {};
  accounts.byUsername = accounts.byUsername ?? {};
  accounts.byUserId = accounts.byUserId ?? {};

  if (accounts.byEmail[pending.email] || accounts.byUsername[pending.username]) {
    delete pendingStore[signupId];
    await writeJsonFile(AUTH_PENDING_FILE, pendingStore);
    sendJson(response, 409, { error: 'That account was already created.' }, corsHeaders);
    return;
  }

  const password = decryptText(pending.passwordCiphertext);
  const userId = await createMatrixAccount(pending.username, password);
  const createdAt = now();

  const account = {
    createdAt,
    email: pending.email,
    emailVerifiedAt: createdAt,
    userId,
    username: pending.username,
  };

  accounts.byEmail[pending.email] = account;
  accounts.byUsername[pending.username] = account;
  accounts.byUserId[userId] = account;
  await writeJsonFile(AUTH_ACCOUNTS_FILE, accounts);

  const profiles = await readJsonFile(PROFILES_FILE, {});
  profiles[userId] = {
    avatarUrl: '',
    bio: '',
    createdAt,
    displayName: pending.username,
    normalizedDisplayName: pending.username,
    updatedAt: createdAt,
    userId,
  };
  await writeJsonFile(PROFILES_FILE, profiles);

  delete pendingStore[signupId];
  await writeJsonFile(AUTH_PENDING_FILE, pendingStore);

  sendJson(response, 200, { ok: true, userId, username: pending.username }, corsHeaders);
}

async function handleSignupResend(request, response, corsHeaders) {
  const body = await readRequestBody(request);
  const signupId = String(body.signupId ?? '').trim();
  const ip = getClientIp(request);

  await assertRateLimit(`resend:${ip}`, 5, 15 * 60 * 1000);

  const pendingStore = await readJsonFile(AUTH_PENDING_FILE, {});
  const pending = pendingStore[signupId];

  if (!pending) {
    sendJson(response, 404, { error: 'Verification session not found. Start signup again.' }, corsHeaders);
    return;
  }

  const code = createCode();
  pending.codeHash = hashCode(code);
  pending.attempts = 0;
  pending.expiresAt = now() + VERIFICATION_TTL_MS;
  await writeJsonFile(AUTH_PENDING_FILE, pendingStore);

  const emailResult = await sendVerificationEmail(pending.email, pending.username, code);
  sendJson(response, 200, { devVerificationCode: emailResult.devCode, emailSent: emailResult.sent, expiresAt: pending.expiresAt }, corsHeaders);
}

const server = createServer(async (request, response) => {
  const corsHeaders = getCorsHeaders(request.headers.origin);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);

  try {
    if (request.method === 'GET' && url.pathname === '/api/auth/health') {
      sendJson(response, 200, { ok: true, service: 'kodiak-auth', time: new Date().toISOString() }, corsHeaders);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/signup/start') {
      await handleSignupStart(request, response, corsHeaders);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/signup/verify') {
      await handleSignupVerify(request, response, corsHeaders);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/signup/resend') {
      await handleSignupResend(request, response, corsHeaders);
      return;
    }

    sendJson(response, 404, { error: 'Not found.' }, corsHeaders);
  } catch (error) {
    console.error('[Kodiak Auth] Request failed', error);
    sendJson(response, error.statusCode ?? 500, { error: error.message || 'Internal server error.' }, corsHeaders);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Kodiak Auth] listening on http://localhost:${PORT}`);
});
