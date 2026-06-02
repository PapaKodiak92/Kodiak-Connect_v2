const MATRIX_ACCESS_TOKEN = String(process.env.MATRIX_ACCESS_TOKEN ?? '').trim();
const MATRIX_BASE_URL = String(process.env.MATRIX_BASE_URL ?? 'https://matrix.kodiak-connect.com').trim().replace(/\/+$/, '');
const MATRIX_ROOM_ALIAS = String(process.env.MATRIX_ROOM_ALIAS ?? '#dev-updates:kodiak-connect.com').trim();
const DEV_UPDATE_TITLE = String(process.env.DEV_UPDATE_TITLE ?? '').trim();
const DEV_UPDATE_BODY = String(process.env.DEV_UPDATE_BODY ?? '').trim();

function requireValue(name, value) {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
}

function getTextBody() {
  const lines = [DEV_UPDATE_TITLE];

  if (DEV_UPDATE_BODY) {
    lines.push('', DEV_UPDATE_BODY.trim());
  }

  return lines.join('\n');
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
  const escaped = escapeHtml(getTextBody());
  return escaped
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
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
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body.error ?? text}`);
  }

  return body;
}

async function resolveRoomId() {
  if (MATRIX_ROOM_ALIAS.startsWith('!')) {
    return MATRIX_ROOM_ALIAS;
  }

  const encodedAlias = encodeURIComponent(MATRIX_ROOM_ALIAS);
  const joinResult = await requestJson(`/ _matrix/client/v3/join/${encodedAlias}`.replace('/ ', '/'), {
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
  requireValue('DEV_UPDATE_TITLE', DEV_UPDATE_TITLE);
  requireValue('DEV_UPDATE_BODY', DEV_UPDATE_BODY);

  const roomId = await resolveRoomId();
  const txnId = `dev_update_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await requestJson(`/ _matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`.replace('/ ', '/'), {
    method: 'PUT',
    body: JSON.stringify({
      body: getTextBody(),
      format: 'org.matrix.custom.html',
      formatted_body: getFormattedBody(),
      msgtype: 'm.notice',
    }),
  });

  console.log(`[Kodiak Dev Update] Posted "${DEV_UPDATE_TITLE}" to ${MATRIX_ROOM_ALIAS}.`);
}

postDevUpdate().catch((error) => {
  console.error('[Kodiak Dev Update] Failed to post update.');
  console.error(error);
  process.exit(1);
});
