# Kodiak-Music Backend Foundation

Kodiak-Music is the library/player layer for Kodiak Connect. Music Lounge remains the shared social lounge where users vote on music together.

## Current scope

This foundation adds:

- A Postgres schema for the Kodiak-Music catalog.
- A backend database helper using `KODIAK_MUSIC_DATABASE_URL`.
- API endpoints for library search and song requests.
- A frontend API client for those endpoints.
- Backend proxy routing for `/api/music/...` endpoints.

It does **not** upload or stream audio files yet. The next phase is the sync/upload pipeline.

## Data ownership rule

Do not store music files in the Git repository, web root, Synapse data directory, or Postgres data directory.

Postgres stores metadata only. Audio files should live in a dedicated runtime/storage path such as:

```text
/var/lib/kodiak-connect/music-library/
  audio/
  artwork/
  incoming/
  failed/
  logs/
```

Keep this separate from:

- `/opt/kodiak-connect` repo files
- `/var/www/kodiak-connect` web build files
- Synapse runtime data
- Postgres runtime data

## Environment variables

The new music API reads:

```text
KODIAK_MUSIC_DATABASE_URL=<postgres connection string for the kodiak_music database>
KODIAK_MUSIC_DATABASE_SSL=false
KODIAK_MUSIC_DATABASE_POOL_SIZE=6
KODIAK_MUSIC_MODERATOR_IDS=@papakodiak:kodiak-connect.com
```

`DATABASE_URL` is accepted as a fallback, but `KODIAK_MUSIC_DATABASE_URL` is preferred so Kodiak-Music does not accidentally point at the wrong app database.

Do not paste real database credentials into chat or commit them into the repo.

## API endpoints

The public backend proxy handles these routes before forwarding to the existing backend server:

```text
GET  /api/music/health
GET  /api/music/library/search?userId=@user:kodiak-connect.com&q=query&limit=20
POST /api/music/requests
GET  /api/music/requests?userId=@user:kodiak-connect.com
POST /api/music/requests/status
```

If the database URL is missing, the API returns a clear `503` response instead of crashing the backend.

## Database schema

The schema file is:

```text
backend/sql/001_kodiak_music_schema.sql
```

The schema creates:

- `kodiak_music_tracks`
- `kodiak_music_uploads`
- `kodiak_music_song_requests`
- `kodiak_music_lounge_queue`
- `kodiak_music_lounge_votes`

The route layer runs the schema automatically on first music API use.

## Next phase

Next implementation steps:

1. Add upload/session endpoints for Kodiak Music Sync.
2. Add server-side file storage under a dedicated music-library path.
3. Add metadata extraction and hash-based duplicate detection.
4. Add authenticated streaming with HTTP Range support.
5. Replace the temporary JSON-backed Music Lounge queue with the Postgres-backed lounge queue.
