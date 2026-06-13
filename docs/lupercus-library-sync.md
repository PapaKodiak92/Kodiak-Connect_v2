# Lupercus Library Sync

Lupercus Library Sync is the private curator tool for Kodiak-Music.

Kodiak-Music is the user-facing player/library system. Music Lounge is the shared social listening room. Lupercus is credited as the curator of the music library.

## Intended flow

```text
Lupercus' PC
  -> Lupercus Library Sync
  -> Kodiak VPS upload API
  -> VPS audio storage + Postgres music catalog
  -> Kodiak-Music / Music Lounge
```

## Backend environment

Set these on the backend/public API service that handles `/api/music/...`:

```bash
KODIAK_MUSIC_DATABASE_URL=postgres://...
KODIAK_MUSIC_LIBRARY_DIR=/var/lib/kodiak-connect/music-library
KODIAK_MUSIC_SYNC_USER_IDS=@lupercus:kodiak-connect.com
KODIAK_MUSIC_MAX_UPLOAD_BYTES=157286400
```

Use the real Matrix user id for Lupercus in `KODIAK_MUSIC_SYNC_USER_IDS`.

Do not store audio files in Postgres. Postgres stores catalog/search metadata. Audio files live under `KODIAK_MUSIC_LIBRARY_DIR`.

## Storage layout

```text
/var/lib/kodiak-connect/music-library/
  incoming/
  audio/
```

Keep this path separate from:

- repo files under `/opt/kodiak-connect`
- web root files under `/var/www/kodiak-connect`
- Synapse data
- Postgres data

## Sync API

### Health

```http
GET /api/music/sync/health?userId=@user:kodiak-connect.com
```

Returns database status, storage settings, upload limits, and whether the user can sync.

### Prepare upload

```http
POST /api/music/sync/uploads/prepare
Content-Type: application/json
X-Kodiak-User-Id: @user:kodiak-connect.com
```

Body:

```json
{
  "fileName": "Song.mp3",
  "fileSha256": "64-character-sha256",
  "fileSizeBytes": 12345678,
  "title": "Song",
  "artistName": "Artist",
  "albumTitle": "Album",
  "genreNames": ["Rock"],
  "durationMs": 180000,
  "bitrate": 320000,
  "releaseYear": 2001,
  "trackNumber": 1,
  "sourceDeviceId": "lupercus-main-pc",
  "originalPath": "D:\\Music\\Artist\\Song.mp3"
}
```

Response:

- `shouldUpload: false` when a duplicate SHA-256 already exists.
- `shouldUpload: true` with `uploadUrl` when the raw file should be uploaded.

### Upload file bytes

```http
PUT /api/music/sync/uploads/:uploadId/file
Content-Type: audio/mpeg
X-Kodiak-User-Id: @user:kodiak-connect.com
```

Body is the raw audio file bytes. The backend calculates SHA-256 while streaming, verifies it matches the prepared hash, stores the file under `audio/<hash-prefix>/<hash>.<ext>`, and upserts the track metadata into Postgres.

## Current limitations

- This is the server foundation for the future desktop sync app.
- Artwork extraction/upload is not wired yet.
- Streaming endpoint is reserved by `streamPath` but still needs the playback route.
- Upload access is restricted by `KODIAK_MUSIC_SYNC_USER_IDS` and music moderators.
