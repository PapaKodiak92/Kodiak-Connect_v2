param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,

  [string]$VpsHost = 'root@51.81.81.159',
  [string]$RemoteRoot = '/var/www/kodiak-connect-updates',
  [string]$BaseUrl = 'https://updates.kodiak-connect.com',
  [string]$Notes = 'Kodiak Connect desktop release.',
  [string]$PubDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$BundleDir = Join-Path $RepoRoot 'src-tauri/target/release/bundle/msi'
$MsiFileName = "Kodiak Connect_${Version}_x64_en-US.msi"
$MsiPath = Join-Path $BundleDir $MsiFileName
$SigPath = "$MsiPath.sig"
$RemoteDir = "$RemoteRoot/$Version/windows"
$RemoteMsiName = "kodiak-connect_${Version}_x64_en-US.msi"
$RemoteSigName = "$RemoteMsiName.sig"

if (-not (Test-Path $MsiPath)) {
  throw "Missing MSI artifact: $MsiPath. Run npm run tauri:build first."
}

if (-not (Test-Path $SigPath)) {
  throw "Missing MSI signature: $SigPath. Make sure TAURI_SIGNING_PRIVATE_KEY is set before building."
}

Write-Host "Creating remote release directory: $VpsHost`:$RemoteDir" -ForegroundColor Cyan
& ssh $VpsHost "mkdir -p '$RemoteDir'"

Write-Host "Uploading MSI..." -ForegroundColor Cyan
& scp $MsiPath "${VpsHost}:$RemoteDir/$RemoteMsiName"

Write-Host "Uploading MSI signature..." -ForegroundColor Cyan
& scp $SigPath "${VpsHost}:$RemoteDir/$RemoteSigName"

$Signature = (Get-Content -Path $SigPath -Raw).Trim()
$Manifest = [ordered]@{
  version = $Version
  notes = $Notes
  pub_date = $PubDate
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = $Signature
      url = "$BaseUrl/$Version/windows/$RemoteMsiName"
    }
  }
}

$ManifestJson = $Manifest | ConvertTo-Json -Depth 10
$TempManifest = New-TemporaryFile
Set-Content -Path $TempManifest -Value $ManifestJson -Encoding UTF8

Write-Host "Uploading manifest.json..." -ForegroundColor Cyan
& scp $TempManifest "${VpsHost}:$RemoteRoot/manifest.json"
Remove-Item $TempManifest -Force

Write-Host "Windows release $Version published." -ForegroundColor Green
Write-Host "Manifest: $BaseUrl/manifest.json" -ForegroundColor Cyan
Write-Host "Installer: $BaseUrl/$Version/windows/$RemoteMsiName" -ForegroundColor Cyan
