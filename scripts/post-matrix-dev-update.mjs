import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MATRIX_ACCESS_TOKEN = String(process.env.MATRIX_ACCESS_TOKEN ?? '').trim();
const MATRIX_BASE_URL = String(process.env.MATRIX_BASE_URL ?? 'https://matrix.kodiak-connect.com').trim().replace(/\/+$/, '');
const MATRIX_ROOM_ALIAS = String(process.env.MATRIX_ROOM_ALIAS ?? '#dev-updates:kodiak-connect.com').trim();
const DEV_UPDATE_TITLE = String(process.env.DEV_UPDATE_TITLE ?? '').trim();
const DEV_UPDATE_BODY = String(process.env.DEV_UPDATE_BODY ?? '').trim();
const DEV_UPDATE_CHANGELOG_FILE = String(process.env.DEV_UPDATE_CHANGELOG_FILE ?? '').trim();

function requireValue(name, value) {
  if (!value) throw new Error(`${name} is required.`);
}

function readChangelogBody() {
  if (!DEV_UPDATE_CHANGELOG_FILE) return DEV_UPDATE_BODY;

  const filePath = resolve(process.cwd(), DEV_UPDATE_CHANGELOG_FILE);
  return readFileSync(filePath, 'utf8').trim();
}

function getTitle(body) {
  if (DEV_UPDATE_TITLE) return DEV_UPDATE_TITLE;

  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();

  return 'Kodiak Connect Dev Update';
}

function getTextBody() {
  const body = readChangelogBody();
  const title = getTitle(body);

  if (!body) return title;
  if (body.trim().startsWith('# ')) return body.trim();

  return [title, '', body.trim()].join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getFormattedBody() {
  const lines = getTextBody().split(/\r?\n/);
  const html = [];
  let inList = false;

  for (const line of lines) {
    const escaped = escapeHtml(line);

    if (/^###\s+/.test(line)) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h3>${escaped.replace(/^###\s+/, '')}</h3>`);
      continue;
    }

    if (/^##\s+/.test(line)) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h2>${escaped.replace(/^##\s+/, '')}</h2>`);
      continue;
    }

    if (/^#\s+/.test(line)) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h1>${escaped.replace(/^#\s+/, '')}</h1>`);
      continue;
    }

    if (/^-\s+/.test(line)) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${escaped.replace(/^-\s+/, '')}</li>`);
      continue;
    }

    if (inList) {
      html.push('</ul>');
      inList = false;
    }

    html.push(line.trim() ? `<p>${escaped}</p>` : '<br>');
  }

  if (inList) html.push('</ul>');

  return html.join('\n');
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${MATRIX_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${MATRIX_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body.error ?? body.raw ?? text}`);
  }

  return body;
}

async function resolveRoomId() {
  if (MATRIX_ROOM_ALIAS.startsWith('!')) return MATRIX_ROOM_ALIAS;

  const encodedAlias = encodeURIComponent(MATRIX_ROOM_ALIAS);
  const joinResult = await requestJson(`/_matrix/client/v3/join/${encodedAlias}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  if (!joinResult.room_id) {
    throw new Error('Matrix join response did not include room_id.');
  }

  return joinResult.room_id;
}

async function postDevUpdate() {
  requireValue('MATRIX_ACCESS_TOKEN', MATRIX_ACCESS_TOKEN);
  requireValue('MATRIX_BASE_URL', MATRIX_BASE_URL);
  requireValue('MATRIX_ROOM_ALIAS', MATRIX_ROOM_ALIAS);

  const textBody = getTextBody();
  requireValue('DEV_UPDATE_BODY or DEV_UPDATE_CHANGELOG_FILE', textBody);

  const roomId = await resolveRoomId();
  const txnId = `dev_update_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await requestJson(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      body: textBody,
      format: 'org.matrix.custom.html',
      formatted_body: getFormattedBody(),
      msgtype: 'm.notice',
    }),
  });

  console.log(`[Kodiak Dev Update] Posted update to ${MATRIX_ROOM_ALIAS}.`);
}

postDevUpdate().catch((error) => {
  console.error('[Kodiak Dev Update] Failed to post update.');
  console.error(error);
  process.exit(1);
});
