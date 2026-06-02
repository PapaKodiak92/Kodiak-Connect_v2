# Backend Production Checklist

Use this checklist before wiring the frontend to Matrix.

## Repo foundation

- [ ] Review discipline note.
- [ ] Review backend v2 plan.
- [ ] Review production Docker Compose template.
- [ ] Review nginx examples.
- [ ] Review Synapse production notes.

## VPS preparation

- [ ] Create a clean v2 deployment directory.
- [ ] Copy production templates to the VPS.
- [ ] Create real environment values outside git.
- [ ] Confirm DNS for `kodiak-connect.com`.
- [ ] Confirm DNS for `matrix-kodiak-connect.com`.
- [ ] Issue TLS certificates for production domains.

## Matrix production

- [ ] Generate a fresh Synapse config on the VPS.
- [ ] Configure PostgreSQL.
- [ ] Configure reverse proxy headers.
- [ ] Start PostgreSQL.
- [ ] Start Synapse.
- [ ] Start nginx.
- [ ] Confirm Matrix client versions endpoint responds.
- [ ] Create first production admin account.

## Frontend integration gate

Do not wire the login UI to Matrix until all Matrix production checks above pass.

## First frontend integration tasks

- [ ] Add environment config module.
- [ ] Add auth service types.
- [ ] Add Matrix auth service.
- [ ] Replace fake sign-in handler.
- [ ] Add logout.
- [ ] Add session restore.
