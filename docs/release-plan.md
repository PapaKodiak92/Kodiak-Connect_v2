# Kodiak Connect v2 release foundation

## Release order

1. Web build proves the React/Vite foundation compiles.
2. Android project is generated and synced with Capacitor.
3. Tauri desktop build produces local Windows/Linux bundles.
4. Tauri updater keys are generated locally.
5. Signed desktop release artifacts are uploaded to the release host.
6. Update manifests are published only after artifacts and signatures exist.
7. Matrix/Synapse work begins after installer/update flow is stable.

## Channels

- `dev`: internal/manual testing
- `stable`: public user builds later

## Artifact targets

- Web: Vercel build output from `dist/`
- Android: APK first, AAB later if store distribution is needed
- Windows: MSI first, EXE/bootstrapper later if useful
- Linux Mint: DEB first
- Linux AppImage: later only if useful

## Safety rules

- Never commit updater private keys.
- Never commit Android keystores.
- Never point the updater at unsigned or missing release artifacts.
- Never combine updater/signing changes with Matrix logic changes.
