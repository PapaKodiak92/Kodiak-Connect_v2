# Kodiak Connect release workflow

This project is installer-first. Do not start Matrix/chat work until release mechanics stay boring and repeatable.

## Release rules

- Never commit private updater keys.
- Never commit generated installer artifacts.
- Always build with the Tauri private signing key set.
- Always publish the manifest after uploading the matching installer and signature.
- Keep Windows and Linux release builds platform-specific.

## Bump a version

From the repo root on Windows:

```powershell
.\scripts\bump-version.ps1 -Version 0.1.4
npm run build
```

Review the changes, then build the Windows installer:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="$env:USERPROFILE\.tauri\kodiak-connect-v2-release.key"
npm run tauri:build
```

## Publish a Windows updater release

```powershell
.\scripts\publish-windows-release.ps1 -Version 0.1.4 -Notes "Kodiak Connect desktop release."
```

The script uploads:

- `Kodiak Connect_<version>_x64_en-US.msi`
- `Kodiak Connect_<version>_x64_en-US.msi.sig`
- `/var/www/kodiak-connect-updates/manifest.json`

## Validate hosted release

```powershell
curl.exe https://updates.kodiak-connect.com/manifest.json
curl.exe -I https://updates.kodiak-connect.com/<version>/windows/kodiak-connect_<version>_x64_en-US.msi
```

## Commit and tag

```powershell
git add package.json package-lock.json src-tauri/tauri.conf.json src/features/updater/updateManifest.ts src/features/updater/UpdaterPanel.tsx scripts docs
git commit -m "chore: publish <version> release"
git push

git tag v<version>
git push origin v<version>
```
