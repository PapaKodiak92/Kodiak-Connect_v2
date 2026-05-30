param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,

  [string]$Notes = 'Kodiak Connect desktop release.',
  [string]$SigningKeyPath = "$env:USERPROFILE\.tauri\kodiak-connect-v2-release.key",
  [string]$SigningKeyPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
  [string]$VpsHost = 'root@51.81.81.159'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

Push-Location $RepoRoot
try {
  if (-not (Test-Path $SigningKeyPath)) {
    throw "Missing Tauri signing key: $SigningKeyPath"
  }

  Write-Host "Bumping Kodiak Connect to $Version..." -ForegroundColor Cyan
  & "$PSScriptRoot\bump-version.ps1" -Version $Version

  Write-Host "Running production build and signed Windows bundle..." -ForegroundColor Cyan
  $env:TAURI_SIGNING_PRIVATE_KEY = $SigningKeyPath

  if ($SigningKeyPassword) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $SigningKeyPassword
  }

  npm run tauri:build

  Write-Host "Publishing Windows release to VPS and updating manifest..." -ForegroundColor Cyan
  & "$PSScriptRoot\publish-windows-release.ps1" -Version $Version -Notes $Notes -VpsHost $VpsHost

  Write-Host "Windows release $Version is uploaded and manifest is updated." -ForegroundColor Green
  Write-Host "Validate with:" -ForegroundColor Cyan
  Write-Host "curl.exe https://updates.kodiak-connect.com/manifest.json"
  Write-Host "curl.exe -I https://updates.kodiak-connect.com/$Version/windows/kodiak-connect_${Version}_x64_en-US.msi"
  Write-Host ""
  Write-Host "After validation, commit and tag:" -ForegroundColor Cyan
  Write-Host "git add package.json package-lock.json src-tauri/tauri.conf.json src/features/updater/updateManifest.ts src/features/updater/UpdaterPanel.tsx scripts docs"
  Write-Host "git commit -m \"chore: publish $Version windows release\""
  Write-Host "git push"
  Write-Host "git tag v$Version"
  Write-Host "git push origin v$Version"
}
finally {
  Pop-Location
}
