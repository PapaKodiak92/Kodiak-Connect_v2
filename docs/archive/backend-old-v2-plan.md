# Kodiak Connect v2 Backend Plan

This plan defines the clean backend direction for Kodiak Connect v2.

## Goal

Build v2 as a separate backend from v1 so the MVP can remain online while v2 is developed safely.

## Production domains

Use production names while v2 is under construction:

```text
kodiak-connect.com
matrix-kodiak-connect.com
api-kodiak-connect.com
updates-kodiak-connect.com
```

## Production domains

Use final names only when launch-ready:

```text
kodiak-connect.com
www.kodiak-connect.com
matrix.kodiak-connect.com
api.kodiak-connect.com
updates.kodiak-connect.com
```

## Backend services

Initial backend foundation:

- Matrix Synapse for chat.
- PostgreSQL for Synapse storage.
- Reverse proxy for public routing.
- TURN service later for calls.
- Optional Kodiak API for registration, email, admin, and business logic.

## First backend milestone

- Add production infrastructure templates.
- Bring up a fresh production Matrix server.
- Confirm the Matrix client versions endpoint responds.
- Create a first admin test account.
- Keep login UI frontend-only until the production backend is healthy.

## App integration order

1. Add environment configuration.
2. Add an auth service boundary.
3. Add Matrix SDK login.
4. Add persistent session handling.
5. Add logout.
6. Add basic chat sync.

## Notes

No production secrets belong in this repository. Template files should use obvious placeholder values only.
