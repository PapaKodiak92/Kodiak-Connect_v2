#!/usr/bin/env node

const baseUrl = process.env.MATRIX_BASE_URL || 'https://matrix-v2.kodiak-connect.com';
const roomAlias = process.env.MATRIX_ROOM_ALIAS || '#dev-updates:v2.kodiak-connect.com';
const accessToken = process.env.MATRIX_ACCESS_TOKEN;

function encodePathValue(value) {
  return encodeURIComponent(value);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br />');
}

async function matrixRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || `Matrix request failed with status ${response.status}`);
  }

  return data;
}

function getReleaseFromGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath) {
    return null;
  }

  try {
    const fs = require('node:fs');
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    return event.release || null;
  } catch {
    return null;
  }
}

function getUpdateTitle() {
  const release = getReleaseFromGithubEvent();

  return (
    process.env.DEV_UPDATE_TITLE ||
    release?.name ||
    release?.tag_name ||
    'Kodiak Connect Dev Update'
  );
}

function getUpdateBody() {
  const release = getReleaseFromGithubEvent();

  return (
    process.env.DEV_UPDATE_BODY ||
    release?.body ||
    'No changelog body provided.'
  );
}

async function main() {
  if (!accessToken) {
    throw new Error('Missing MATRIX_ACCESS_TOKEN.');
  }

  const title = getUpdateTitle().trim();
  const body = getUpdateBody().trim();

  if (!title || !body) {
    throw new Error('Update title and body are required.');
  }

  const message = `${title}\n\n${body}`;
  const formattedMessage = `<strong>${escapeHtml(title)}</strong><br /><br />${escapeHtml(body)}`;

  console.log(`Joining ${roomAlias}...`);

  const join = await matrixRequest(`/_matrix/client/v3/join/${encodePathValue(roomAlias)}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  console.log('Publishing dev update...');

  await matrixRequest(
    `/_matrix/client/v3/rooms/${encodePathValue(join.room_id)}/send/m.room.message/${encodePathValue(txnId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        msgtype: 'm.text',
        body: message,
        format: 'org.matrix.custom.html',
        formatted_body: formattedMessage,
      }),
    },
  );

  console.log(`Published to ${roomAlias}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});