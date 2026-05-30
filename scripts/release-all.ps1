param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,

  [string]$Notes = 'Kodiak Connect release.',
  [string]$VpsHost = 'root@51.81.81.159',
  [string]$VpsRepoPath = '/root/Kodiak-Connect_v2',
  [string]$RemoteRoot = '/var/www/kodiak-connect-updates',
  [string]$BaseUrl = 'https://updates.kodiak-connect.com',
  [string]$SigningKeyPath = "$env:USERPROFILE\.tauri\kodiak-connect-v2-release.key",
  [switch]$SkipGitPush
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Action
}

function Assert-File {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path $Path)) {
    throw "Missing required file: $Path"
  }
}

Push-Location $RepoRoot
try {
  $InitialStatus = git status --porcelain
  if ($InitialStatus) {
    throw "Working tree is not clean. Commit, stash, or restore changes before running release-all."
  }

  Assert-File $SigningKeyPath

  Invoke-Step "Bump version to $Version" {
    & "$PSScriptRoot\bump-version.ps1" -Version $Version
  }

  Invoke-Step "Build Windows MSI and updater signature" {
    $env:TAURI_SIGNING_PRIVATE_KEY = $SigningKeyPath
    npm run tauri:build
  }

  Invoke-Step "Build Android debug APK" {
    npm run cap:sync
    Push-Location (Join-Path $RepoRoot 'android')
    try {
      .\gradlew.bat assembleDebug
    }
    finally {
      Pop-Location
    }
  }

  $WindowsMsi = Join-Path $RepoRoot "src-tauri\target\release\bundle\msi\Kodiak Connect_${Version}_x64_en-US.msi"
  $WindowsSig = "$WindowsMsi.sig"
  $AndroidApk = Join-Path $RepoRoot 'android\app\build\outputs\apk\debug\app-debug.apk'

  Assert-File $WindowsMsi
  Assert-File $WindowsSig
  Assert-File $AndroidApk

  if (-not $SkipGitPush) {
    Invoke-Step "Commit and push version bump for VPS Linux build" {
      git add package.json package-lock.json src-tauri/tauri.conf.json src/features/updater/updateManifest.ts src/features/updater/UpdaterPanel.tsx
      git commit -m "chore: prepare $Version release"
      git push
    }
  }

  $RemoteWindowsDir = "$RemoteRoot/$Version/windows"
  $RemoteLinuxDir = "$RemoteRoot/$Version/linux"
  $RemoteAndroidDir = "$RemoteRoot/$Version/android"
  $RemoteWindowsMsi = "kodiak-connect_${Version}_x64_en-US.msi"
  $RemoteLinuxDeb = "kodiak-connect_${Version}_amd64.deb"
  $RemoteAndroidApk = "kodiak-connect_${Version}_android-debug.apk"

  Invoke-Step "Build Linux DEB on VPS" {
    $RemoteCommand = "cd '$VpsRepoPath' && git fetch origin main && git reset --hard origin/main && npm ci && npm run build && TAURI_SIGNING_PRIVATE_KEY='/root/.tauri/kodiak-connect-v2-release.key' npx tauri build --bundles deb && mkdir -p '$RemoteLinuxDir' && cp 'src-tauri/target/release/bundle/deb/Kodiak Connect_${Version}_amd64.deb' '$RemoteLinuxDir/$RemoteLinuxDeb' && cp 'src-tauri/target/release/bundle/deb/Kodiak Connect_${Version}_amd64.deb.sig' '$RemoteLinuxDir/$RemoteLinuxDeb.sig'"
    & ssh $VpsHost $RemoteCommand
  }

  Invoke-Step "Upload Windows and Android artifacts to VPS" {
    & ssh $VpsHost "mkdir -p '$RemoteWindowsDir' '$RemoteAndroidDir'"
    & scp $WindowsMsi "${VpsHost}:$RemoteWindowsDir/$RemoteWindowsMsi"
    & scp $WindowsSig "${VpsHost}:$RemoteWindowsDir/$RemoteWindowsMsi.sig"
    & scp $AndroidApk "${VpsHost}:$RemoteAndroidDir/$RemoteAndroidApk"
  }

  Invoke-Step "Generate and upload release manifest" {
    $WindowsSignature = (Get-Content -Path $WindowsSig -Raw).Trim()
    $LinuxSignature = ((& ssh $VpsHost "cat '$RemoteLinuxDir/$RemoteLinuxDeb.sig'") -join "`n").Trim()

    if (-not $LinuxSignature) {
      throw 'Linux updater signature could not be read from VPS.'
    }

    $Manifest = [ordered]@{
      version = $Version
      notes = $Notes
      pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
      platforms = [ordered]@{
        'windows-x86_64' = [ordered]@{
          signature = $WindowsSignature
          url = "$BaseUrl/$Version/windows/$RemoteWindowsMsi"
        }
        'linux-x86_64' = [ordered]@{
          signature = $LinuxSignature
          url = "$BaseUrl/$Version/linux/$RemoteLinuxDeb"
        }
      }
    }

    $ManifestJson = $Manifest | ConvertTo-Json -Depth 10
    $TempManifest = [System.IO.Path]::GetTempFileName()

    try {
      [System.IO.File]::WriteAllText($TempManifest, $ManifestJson, $Utf8NoBom)
      & scp $TempManifest "${VpsHost}:$RemoteRoot/manifest.json"
    }
    finally {
      Remove-Item $TempManifest -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host ""
  Write-Host "Release $Version complete across Windows, Linux, and Android." -ForegroundColor Green
  Write-Host "$BaseUrl/manifest.json" -ForegroundColor Cyan
  Write-Host "$BaseUrl/$Version/windows/$RemoteWindowsMsi" -ForegroundColor Cyan
  Write-Host "$BaseUrl/$Version/linux/$RemoteLinuxDeb" -ForegroundColor Cyan
  Write-Host "$BaseUrl/$Version/android/$RemoteAndroidApk" -ForegroundColor Cyan
}
finally {
  Pop-Location
}
