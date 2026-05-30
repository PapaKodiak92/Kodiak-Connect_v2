# Kodiak Connect v2

Kodiak Connect v2 is a clean rebuild of the secure Matrix chat client foundation.

## v2 rules

- Updaters/installers come before chat features.
- `src/app/App.tsx` stays composition-only.
- Feature logic lives under `src/features/*`.
- Platform-specific code lives under `src/platform/android`, `src/platform/desktop`, or `src/platform/web`.
- Mobile upload must stay isolated under `src/features/uploads`.
- Do not mix UI fixes, native plugins, and Matrix logic in the same patch.
- Build and test after every small change.

## Hosting direction

Kodiak Connect v2 is VPS/domain-first, not Vercel-first.

Primary production routing plan:

```text
kodiak-connect.com          - Web app
www.kodiak-connect.com      - Redirect to kodiak-connect.com
updates.kodiak-connect.com  - Tauri updater manifests and installer files
matrix.kodiak-connect.com   - Synapse homeserver later
api.kodiak-connect.com      - Optional backend services later
```

Vercel may still be used later for temporary previews or backup web deploys, but the core production path is the VPS plus the Kodiak Connect domain.

## Current foundation

- Vite + React + TypeScript web app scaffold
- Capacitor config for Android
- Tauri v2 desktop scaffold for Windows and Linux Mint `.deb`
- Updater manifest placeholders
- Clean feature/platform/component boundaries

## First local setup

```bash
npm install
npm run build
```

## Android setup

Generate the native Android project locally after dependencies are installed:

```bash
npm run cap:add:android
npm run cap:sync
npm run cap:open:android
```

Commit the generated `android/` project after confirming it builds in Android Studio.

## Desktop setup

Install the Rust/Tauri prerequisites for your OS, then run:

```bash
npm run tauri:dev
npm run tauri:build
```

The Tauri config currently targets:

- Windows `.msi`
- Linux `.deb`

AppImage can be added later once MSI/DEB are stable.

## Updater signing

Generate a Tauri updater key locally and keep the private key out of git:

```bash
npm run tauri:signer:generate
```

Then replace `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY` in `src-tauri/tauri.conf.json` with the generated public key.

## Release manifest placeholders

- `public/releases/dev.json` is the dev release manifest placeholder.
- `src/features/updater/updateManifest.ts` is the app-side typed manifest model.

Do not publish real updater URLs or signatures until release artifacts are signed.
