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

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Command,
    [Parameter(Mandatory = $true)][string]$ErrorMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$ErrorMessage (exit code $LASTEXITCODE)"
  }
}

function Assert-File {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path $Path)) {
    throw "Missing required file: $Path"
  }
}

Push-Location $RepoRoot
try {
  $InitialStatus = & git status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to read git status.'
  }

  if ($InitialStatus) {
    throw "Working tree is not clean. Commit, stash, or restore changes before running release-all."
  }

  Assert-File $SigningKeyPath

  Invoke-Step "Bump version to $Version" {
    & "$PSScriptRoot\bump-version.ps1" -Version $Version
  }

  Invoke-Step "Build Windows MSI and updater signature" {
    $env:TAURI_SIGNING_PRIVATE_KEY = $SigningKeyPath
    Invoke-NativeChecked -ErrorMessage 'Windows Tauri build failed' -Command { npm run tauri:build }
  }

  Invoke-Step "Build Android debug APK" {
    Invoke-NativeChecked -ErrorMessage 'Capacitor sync failed' -Command { npm run cap:sync }
    Push-Location (Join-Path $RepoRoot 'android')
    try {
      Invoke-NativeChecked -ErrorMessage 'Android debug APK build failed' -Command { .\gradlew.bat assembleDebug }
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
      Invoke-NativeChecked -ErrorMessage 'Failed to stage release files' -Command {
        git add package.json package-lock.json src-tauri/tauri.conf.json src/features/updater/updateManifest.ts src/features/updater/UpdaterPanel.tsx
      }

      $StagedFiles = & git diff --cached --name-only
      if ($LASTEXITCODE -ne 0) {
        throw 'Failed to inspect staged release files.'
      }

      if ($StagedFiles) {
        Invoke-NativeChecked -ErrorMessage 'Failed to commit release version bump' -Command { git commit -m "chore: prepare $Version release" }
        Invoke-NativeChecked -ErrorMessage 'Failed to push release version bump' -Command { git push }
      }
      else {
        Write-Host "No version changes to commit; assuming $Version is already pushed." -ForegroundColor Yellow
      }
    }
  }

  $RemoteWindowsDir = "$RemoteRoot/$Version/windows"
  $RemoteLinuxDir = "$RemoteRoot/$Version/linux"
  $RemoteAndroidDir = "$RemoteRoot/$Version/android"
  $RemoteWindowsMsi = "kodiak-connect_${Version}_x64_en-US.msi"
  $RemoteLinuxDeb = "kodiak-connect_${Version}_amd64.deb"
  $RemoteAndroidApk = "kodiak-connect_${Version}_android-debug.apk"

  Invoke-Step "Build and publish Linux DEB on VPS" {
    $RemoteScript = @"
set -e
export PATH="`$HOME/.cargo/bin:`$PATH"
if [ -f '/root/.tauri/kodiak-connect-v2.env' ]; then
  . '/root/.tauri/kodiak-connect-v2.env'
fi
if [ -z "`$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" ]; then
  echo 'Missing TAURI_SIGNING_PRIVATE_KEY_PASSWORD on VPS. Create /root/.tauri/kodiak-connect-v2.env.' >&2
  exit 1
fi
cd '$VpsRepoPath'
git fetch origin main
git reset --hard origin/main
npm ci
npm run build
cargo --version
TAURI_SIGNING_PRIVATE_KEY='/root/.tauri/kodiak-connect-v2-release.key' npx tauri build --bundles deb
DEB_FILE="`$(find src-tauri/target/release/bundle/deb -maxdepth 1 -type f -name 'Kodiak Connect_${Version}_amd64.deb' | head -n 1)"
SIG_FILE="`$DEB_FILE.sig"
if [ -z "`$DEB_FILE" ] || [ ! -f "`$DEB_FILE" ]; then
  echo "Missing Linux DEB artifact for $Version" >&2
  exit 1
fi
if [ ! -f "`$SIG_FILE" ]; then
  echo "Missing Linux DEB signature for $Version" >&2
  exit 1
fi
mkdir -p '$RemoteLinuxDir'
cp "`$DEB_FILE" '$RemoteLinuxDir/$RemoteLinuxDeb'
cp "`$SIG_FILE" '$RemoteLinuxDir/$RemoteLinuxDeb.sig'
test -f '$RemoteLinuxDir/$RemoteLinuxDeb'
test -f '$RemoteLinuxDir/$RemoteLinuxDeb.sig'
"@

    $RemoteScript = ($RemoteScript -replace "`r`n", "`n").TrimStart() + "`n"
    $TempScript = [System.IO.Path]::GetTempFileName()
    try {
      [System.IO.File]::WriteAllText($TempScript, $RemoteScript, $Utf8NoBom)
      Invoke-NativeChecked -ErrorMessage 'Failed to upload Linux release script to VPS' -Command {
        scp $TempScript "${VpsHost}:/tmp/kodiak-release-linux-$Version.sh"
      }
      Invoke-NativeChecked -ErrorMessage 'Linux DEB build/publish failed on VPS' -Command {
        ssh $VpsHost "bash /tmp/kodiak-release-linux-$Version.sh && rm -f /tmp/kodiak-release-linux-$Version.sh"
      }
    }
    finally {
      Remove-Item $TempScript -Force -ErrorAction SilentlyContinue
    }
  }

  Invoke-Step "Upload Windows and Android artifacts to VPS" {
    Invoke-NativeChecked -ErrorMessage 'Failed to create remote Windows/Android release folders' -Command {
      ssh $VpsHost "mkdir -p '$RemoteWindowsDir' '$RemoteAndroidDir'"
    }
    Invoke-NativeChecked -ErrorMessage 'Failed to upload Windows MSI' -Command {
      scp $WindowsMsi "${VpsHost}:$RemoteWindowsDir/$RemoteWindowsMsi"
    }
    Invoke-NativeChecked -ErrorMessage 'Failed to upload Windows MSI signature' -Command {
      scp $WindowsSig "${VpsHost}:$RemoteWindowsDir/$RemoteWindowsMsi.sig"
    }
    Invoke-NativeChecked -ErrorMessage 'Failed to upload Android APK' -Command {
      scp $AndroidApk "${VpsHost}:$RemoteAndroidDir/$RemoteAndroidApk"
    }
  }

  Invoke-Step "Verify all remote artifacts before manifest" {
    Invoke-NativeChecked -ErrorMessage 'Remote release artifact verification failed' -Command {
      ssh $VpsHost "test -f '$RemoteWindowsDir/$RemoteWindowsMsi' && test -f '$RemoteWindowsDir/$RemoteWindowsMsi.sig' && test -f '$RemoteLinuxDir/$RemoteLinuxDeb' && test -f '$RemoteLinuxDir/$RemoteLinuxDeb.sig' && test -f '$RemoteAndroidDir/$RemoteAndroidApk'"
    }
  }

  Invoke-Step "Generate and upload release manifest" {
    $WindowsSignature = (Get-Content -Path $WindowsSig -Raw).Trim()
    $LinuxSignature = ((& ssh $VpsHost "cat '$RemoteLinuxDir/$RemoteLinuxDeb.sig'") -join "`n").Trim()
    if ($LASTEXITCODE -ne 0) {
      throw 'Failed to read Linux updater signature from VPS.'
    }

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
      Invoke-NativeChecked -ErrorMessage 'Failed to upload release manifest' -Command {
        scp $TempManifest "${VpsHost}:$RemoteRoot/manifest.json"
      }
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
