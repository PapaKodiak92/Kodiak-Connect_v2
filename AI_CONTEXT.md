# Kodiak Connect AI Context

This file is the source of truth for ChatGPT/Codex assistance on Kodiak Connect.

## Golden Rule

Before giving commands or patches, review the repo files that define the current workflow. Do not assume Vercel, generic Tauri, generic Capacitor, or generic Matrix behavior. This project has its own scripts and VPS layout.

## Repository

GitHub:
https://github.com/PapaKodiak92/Kodiak-Connect

Default branch:
main

## Deployment Paths

### Live Web App

The web app is a Vite build.

Build:
npm run build

The built frontend is in:
dist/

The VPS serves the live web app from:
/var/www/kodiak-connect

Typical web deploy:
cd /opt/kodiak-connect
git pull --ff-only origin main
npm install
npm run build
rsync -a --delete /opt/kodiak-connect/dist/ /var/www/kodiak-connect/
chown -R www-data:www-data /var/www/kodiak-connect
nginx -t
systemctl reload nginx

### Packaged Apps

Windows/Linux/Android packaged apps use bundled frontend assets. A web deploy does not update installed apps.

Use the project release script:
.\scripts\release-all.ps1 -Version X.Y.Z -Notes "User-facing release notes"

Before giving packaged release commands, inspect:
scripts/release-all.ps1
scripts/bump-version.ps1
scripts/publish-windows-release.ps1
src-tauri/tauri.conf.json
capacitor.config.ts

## Changelog / Dev Update Posting

Public dev updates must be user-facing only.

Do not mention:
- VPS paths
- database ownership
- Synapse/Postgres internals
- backend incidents
- tokens or secrets
- internal release failures

Use:
docs/changelogs/vX.Y.Z.md

Post with:
gh workflow run post-dev-update.yml --ref main -f title="Kodiak Connect vX.Y.Z — Title" -f changelog_file="docs/changelogs/vX.Y.Z.md"

Before giving changelog commands, inspect:
.github/workflows/post-dev-update.yml
scripts/post-matrix-dev-update.mjs

## VPS Safety Rules

Runtime data lives under:
/opt/kodiak-connect/runtime/

Do not run broad ownership changes across /opt/kodiak-connect without checking mounts.

Keep ownership separate:
- repo files: kodiak:kodiak
- web root: www-data:www-data
- Postgres data: container postgres UID/GID
- Synapse data: container Synapse UID/GID

Always inspect mounts before permission changes:
docker inspect CONTAINER --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'

## Important Reminder

If a task involves code, release, deployment, Matrix, media uploads, profile avatars, GIFs, VPS, Docker, or changelogs, read the current repo files first.
