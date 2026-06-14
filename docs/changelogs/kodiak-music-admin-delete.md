# Kodiak-Music Admin Delete

Added the first moderator-only Kodiak-Music library delete path.

## What changed

- Moderators can delete hosted Kodiak-Music library tracks through the backend admin endpoint.
- Deleting a hosted track removes it from the searchable library catalog.
- Deleting a hosted track also clears related lounge queue references.
- The hosted audio file is removed from Kodiak-Music storage.
- Invalid delete requests now return a clean validation error instead of a server failure.

## Notes

This is a foundation update for safer library management. The Music Lounge admin button is planned next so moderators do not need to use manual API calls.
