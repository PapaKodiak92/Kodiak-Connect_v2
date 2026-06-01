# Backend Staging Checklist

Use this checklist before wiring the frontend to Matrix.

## Repo foundation

- [ ] Review discipline note.
- [ ] Review backend v2 plan.
- [ ] Review staging Docker Compose template.
- [ ] Review nginx examples.
- [ ] Review Synapse staging notes.

## VPS preparation

- [ ] Create a clean v2 deployment directory.
- [ ] Copy staging templates to the VPS.
- [ ] Create real environment values outside git.
- [ ] Confirm DNS for `v2.kodiak-connect.com`.
- [ ] Confirm DNS for `matrix-v2.kodiak-connect.com`.
- [ ] Issue TLS certificates for staging domains.

## Matrix staging

- [ ] Generate a fresh Synapse config on the VPS.
- [ ] Configure PostgreSQL.
- [ ] Configure reverse proxy headers.
- [ ] Start PostgreSQL.
- [ ] Start Synapse.
- [ ] Start nginx.
- [ ] Confirm Matrix client versions endpoint responds.
- [ ] Create first staging admin account.

## Frontend integration gate

Do not wire the login UI to Matrix until all Matrix staging checks above pass.

## First frontend integration tasks

- [ ] Add environment config module.
- [ ] Add auth service types.
- [ ] Add Matrix auth service.
- [ ] Replace fake sign-in handler.
- [ ] Add logout.
- [ ] Add session restore.
