import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';

const AUDIO_MIME_TYPES = new Map([
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wav', 'audio/wav'],
]);

function printUsage() {
  console.log(`Kodiak-Music single track uploader

Usage:
  npm run music:upload-one -- --file "C:\\Music\\Artist\\Song.mp3" --user-id "@papakodiak:kodiak-connect.com" --title "Song" --artist "Artist" --genre "Rock"

Options:
  --api-base       Backend API base URL. Default: KODIAK_API_BASE_URL or http://localhost:8787
  --file           Local audio file path. Required.
  --user-id        Matrix user id allowed to sync. Default: KODIAK_MUSIC_SYNC_USER_ID
  --title          Track title. Default: file name without extension.
  --artist         Artist name.
  --album          Album title.
  --genre          Genre name. Repeatable.
  --duration-ms    Duration in milliseconds, when known.
  --bitrate        Bitrate in bits per second, when known.
  --release-year   Release year, when known.
  --track-number   Track number, when known.
  --device-id      Source device id. Default: kodiak-music-upload-one
  --explicit       Mark track explicit.
  --help           Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    apiBase: process.env.KODIAK_API_BASE_URL || 'http://localhost:8787',
    deviceId: 'kodiak-music-upload-one',
    explicit: false,
    genres: [],
    userId: process.env.KODIAK_MUSIC_SYNC_USER_ID || '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    switch (token) {
      case '--api-base':
        args.apiBase = String(next || '').trim();
        index += 1;
        break;
      case '--file':
        args.file = String(next || '').trim();
        index += 1;
        break;
      case '--user-id':
        args.userId = String(next || '').trim();
        index += 1;
        break;
      case '--title':
        args.title = String(next || '').trim();
        index += 1;
        break;
      case '--artist':
        args.artistName = String(next || '').trim();
        index += 1;
        break;
      case '--album':
        args.albumTitle = String(next || '').trim();
        index += 1;
        break;
      case '--genre':
        args.genres.push(String(next || '').trim());
        index += 1;
        break;
      case '--duration-ms':
        args.durationMs = Number(next || 0);
        index += 1;
        break;
      case '--bitrate':
        args.bitrate = Number(next || 0);
        index += 1;
        break;
      case '--release-year':
        args.releaseYear = Number(next || 0);
        index += 1;
        break;
      case '--track-number':
        args.trackNumber = Number(next || 0);
        index += 1;
        break;
      case '--device-id':
        args.deviceId = String(next || '').trim();
        index += 1;
        break;
      case '--explicit':
        args.explicit = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function requireValidInput(args) {
  if (args.help) {
    return;
  }

  if (!args.file) {
    throw new Error('Missing required --file path.');
  }

  if (!args.userId) {
    throw new Error('Missing required --user-id or KODIAK_MUSIC_SYNC_USER_ID.');
  }

  if (!/^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/.test(args.userId)) {
    throw new Error(`Invalid Matrix user id: ${args.userId}`);
  }
}

async function calculateSha256(filePath) {
  const hash = createHash('sha256');

  await new Promise((resolvePromise, rejectPromise) => {
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', rejectPromise)
      .on('end', resolvePromise);
  });

  return hash.digest('hex');
}

function getMimeType(filePath) {
  return AUDIO_MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  requireValidInput(args);

  const filePath = resolve(args.file);
  const fileName = basename(filePath);
  const fileStats = await stat(filePath);
  const fileSha256 = await calculateSha256(filePath);
  const title = args.title || basename(fileName, extname(fileName));
  const apiBase = args.apiBase.replace(/\/+$/, '');

  console.log(`[Kodiak-Music] Preparing upload for ${fileName}`);
  console.log(`[Kodiak-Music] SHA-256 ${fileSha256}`);

  const prepareResponse = await fetch(`${apiBase}/api/music/sync/uploads/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Kodiak-User-Id': args.userId,
    },
    body: JSON.stringify({
      albumTitle: args.albumTitle || '',
      artistName: args.artistName || '',
      bitrate: args.bitrate || 0,
      durationMs: args.durationMs || 0,
      explicit: args.explicit,
      fileName,
      fileSha256,
      fileSizeBytes: fileStats.size,
      genreNames: args.genres.filter(Boolean),
      originalPath: filePath,
      releaseYear: args.releaseYear || null,
      sourceDeviceId: args.deviceId,
      title,
      trackNumber: args.trackNumber || null,
      userId: args.userId,
    }),
  });

  const preparePayload = await readJsonResponse(prepareResponse);

  if (!prepareResponse.ok) {
    throw new Error(`Prepare upload failed (${prepareResponse.status}): ${JSON.stringify(preparePayload)}`);
  }

  if (preparePayload.shouldUpload === false) {
    console.log('[Kodiak-Music] Track already exists. Upload skipped.');
    console.log(JSON.stringify(preparePayload.duplicateTrack ?? preparePayload.upload ?? preparePayload, null, 2));
    return;
  }

  const uploadUrl = preparePayload.uploadUrl;

  if (!uploadUrl) {
    throw new Error(`Prepare response did not include uploadUrl: ${JSON.stringify(preparePayload)}`);
  }

  console.log(`[Kodiak-Music] Uploading ${fileStats.size} bytes...`);

  const uploadResponse = await fetch(`${apiBase}${uploadUrl}`, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileStats.size),
      'Content-Type': getMimeType(filePath),
      'X-Kodiak-User-Id': args.userId,
    },
    body: createReadStream(filePath),
    duplex: 'half',
  });

  const uploadPayload = await readJsonResponse(uploadResponse);

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed (${uploadResponse.status}): ${JSON.stringify(uploadPayload)}`);
  }

  console.log('[Kodiak-Music] Upload complete.');
  console.log(JSON.stringify(uploadPayload.track ?? uploadPayload, null, 2));
}

main().catch((error) => {
  console.error(`[Kodiak-Music] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
