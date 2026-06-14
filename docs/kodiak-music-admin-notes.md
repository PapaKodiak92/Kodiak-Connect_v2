# Kodiak-Music Admin Notes

Kodiak-Music moderator actions are backend-only until the Music Lounge admin UI is wired.

## Delete hosted library track

Use `POST /api/music/library/delete` with either `trackId` or `fileSha256`.

Required identity:

- `userId` in the JSON body, or
- `X-Kodiak-User-Id` header

Only Kodiak-Music moderators can delete hosted library tracks.

Example:

```bash
curl -i -X POST "http://127.0.0.1:8787/api/music/library/delete" \
  -H "Content-Type: application/json" \
  -H "X-Kodiak-User-Id: @papakodiak:kodiak-connect.com" \
  --data '{"userId":"@papakodiak:kodiak-connect.com","fileSha256":"TRACK_SHA256_HERE"}'
```

The endpoint removes the library track row, removes lounge queue references, unlinks upload/request references, and deletes the hosted audio file from `KODIAK_MUSIC_LIBRARY_DIR`.
