import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { once } from 'node:events';

const DEFAULT_LIBRARY_DIR = join(process.cwd(), 'backend', 'data', 'kodiak-music-library');
const MUSIC_LIBRARY_DIR = String(process.env.KODIAK_MUSIC_LIBRARY_DIR || DEFAULT_LIBRARY_DIR).trim();
const MUSIC_LIBRARY_ROOT = resolve(MUSIC_LIBRARY_DIR);
const MAX_UPLOAD_BYTES = Math.max(Number(process.env.KODIAK_MUSIC_MAX_UPLOAD_BYTES ?? 157286400), 1024 * 1024);
const ALLOWED_AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav']);

export function getKodiakMusicStorageHealth() {
  return {
    allowedExtensions: [...ALLOWED_AUDIO_EXTENSIONS],
    libraryDir: MUSIC_LIBRARY_DIR,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    ok: Boolean(MUSIC_LIBRARY_DIR),
  };
}

function sanitizeFileName(value) {
  const safeName = basename(String(value ?? '').trim()).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180);
  return safeName || 'track.mp3';
}

function getSafeAudioExtension(fileName) {
  const extension = extname(sanitizeFileName(fileName)).toLowerCase();

  if (!ALLOWED_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported audio file type. Allowed: ${[...ALLOWED_AUDIO_EXTENSIONS].join(', ')}`);
  }

  return extension;
}

function getMimeTypeForExtension(extension, fallback = 'application/octet-stream') {
  switch (extension) {
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    case '.m4a':
      return 'audio/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
      return 'audio/ogg';
    case '.opus':
      return 'audio/opus';
    case '.wav':
      return 'audio/wav';
    default:
      return fallback;
  }
}

async function ensureMusicStorageDirs() {
  const incomingDir = join(MUSIC_LIBRARY_DIR, 'incoming');
  const audioDir = join(MUSIC_LIBRARY_DIR, 'audio');

  await mkdir(incomingDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  return { audioDir, incomingDir };
}

function resolveLibraryFileKey(fileKey) {
  const cleanKey = normalize(String(fileKey ?? '').replace(/^[/\\]+/, ''));

  if (!cleanKey || cleanKey.startsWith('..') || cleanKey.includes(`..${sep}`)) {
    throw new Error('Invalid Kodiak-Music file key.');
  }

  const absolutePath = resolve(MUSIC_LIBRARY_ROOT, cleanKey);

  if (absolutePath !== MUSIC_LIBRARY_ROOT && !absolutePath.startsWith(`${MUSIC_LIBRARY_ROOT}${sep}`)) {
    throw new Error('Kodiak-Music file key escaped the library directory.');
  }

  return absolutePath;
}

export async function writeKodiakMusicUploadStream({ request, uploadId, expectedSha256, fileName, requestMimeType = '' }) {
  const cleanExpectedSha = String(expectedSha256 ?? '').toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(cleanExpectedSha)) {
    throw new Error('A valid expected SHA-256 hash is required.');
  }

  const extension = getSafeAudioExtension(fileName);
  const { audioDir, incomingDir } = await ensureMusicStorageDirs();
  const tempPath = join(incomingDir, `${uploadId}.upload`);
  const hash = createHash('sha256');
  const writer = createWriteStream(tempPath, { flags: 'w' });

  let totalBytes = 0;

  try {
    for await (const chunk of request) {
      totalBytes += chunk.length;

      if (totalBytes > MAX_UPLOAD_BYTES) {
        throw new Error(`Upload is too large. Maximum allowed size is ${MAX_UPLOAD_BYTES} bytes.`);
      }

      hash.update(chunk);

      if (!writer.write(chunk)) {
        await once(writer, 'drain');
      }
    }

    writer.end();
    await once(writer, 'finish');

    const actualSha256 = hash.digest('hex');

    if (actualSha256 !== cleanExpectedSha) {
      throw new Error('Uploaded file hash did not match the prepared SHA-256 hash.');
    }

    const shardDir = join(audioDir, actualSha256.slice(0, 2));
    await mkdir(shardDir, { recursive: true });

    const finalFileName = `${actualSha256}${extension}`;
    const finalPath = join(shardDir, finalFileName);

    try {
      await stat(finalPath);
      await rm(tempPath, { force: true });
    } catch {
      await rename(tempPath, finalPath);
    }

    const fileKey = `audio/${actualSha256.slice(0, 2)}/${finalFileName}`;

    return {
      actualSha256,
      bytesWritten: totalBytes,
      fileKey,
      mimeType: requestMimeType || getMimeTypeForExtension(extension),
      streamPath: `/api/music/stream/${actualSha256}`,
    };
  } catch (error) {
    writer.destroy();
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function streamKodiakMusicFile({ response, fileKey, mimeType = '', rangeHeader = '', downloadName = '' }) {
  const filePath = resolveLibraryFileKey(fileKey);
  const fileStats = await stat(filePath);
  const totalBytes = fileStats.size;

  if (!totalBytes) {
    response.writeHead(416, {
      'Content-Range': 'bytes */0',
    });
    response.end();
    return;
  }

  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': mimeType || getMimeTypeForExtension(extname(filePath).toLowerCase(), 'application/octet-stream'),
  };

  if (downloadName) {
    headers['Content-Disposition'] = `inline; filename="${sanitizeFileName(downloadName)}"`;
  }

  const range = String(rangeHeader ?? '').trim();

  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);

    if (!match) {
      response.writeHead(416, {
        ...headers,
        'Content-Range': `bytes */${totalBytes}`,
      });
      response.end();
      return;
    }

    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : totalBytes - 1;

    if (!match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      start = Math.max(totalBytes - suffixLength, 0);
      end = totalBytes - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalBytes) {
      response.writeHead(416, {
        ...headers,
        'Content-Range': `bytes */${totalBytes}`,
      });
      response.end();
      return;
    }

    end = Math.min(end, totalBytes - 1);

    response.writeHead(206, {
      ...headers,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
    });

    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    ...headers,
    'Content-Length': String(totalBytes),
  });
  createReadStream(filePath).pipe(response);
}
