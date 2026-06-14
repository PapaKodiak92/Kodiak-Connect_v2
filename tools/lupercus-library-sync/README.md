# Lupercus Library Sync

Private Kodiak-Music curator tool for scanning a local music folder and uploading selected tracks to the hosted Kodiak-Music library.

## MVP workflow

1. Open the tool locally.
2. Enter the Kodiak-Music API base URL.
3. Enter the Matrix user id allowed by `KODIAK_MUSIC_SYNC_USER_IDS`.
4. Choose a music folder or audio files.
5. Hash selected files.
6. Upload selected hashed files.

The tool uses the existing sync API:

- `GET /api/music/sync/health`
- `POST /api/music/sync/uploads/prepare`
- `PUT /api/music/sync/uploads/:uploadId/file`

## Commands

From the repo root:

```powershell
npm run lupercus:dev
npm run lupercus:check
npm run lupercus:build
```

This MVP intentionally avoids metadata dependencies. It guesses title from the filename and artist from the parent folder. Full metadata/artwork extraction comes later.
