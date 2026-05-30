param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

function Replace-FirstMatch {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Replacement
  )

  $FullPath = Join-Path $RepoRoot $Path
  $Content = Get-Content -Path $FullPath -Raw
  $Regex = [regex]$Pattern
  $Updated = $Regex.Replace($Content, $Replacement, 1)

  if ($Updated -eq $Content) {
    throw "No version match found in $Path"
  }

  Set-Content -Path $FullPath -Value $Updated -NoNewline
}

Push-Location $RepoRoot
try {
  npm version $Version --no-git-tag-version

  Replace-FirstMatch \
    -Path 'src-tauri/tauri.conf.json' \
    -Pattern '("version"\s*:\s*")\d+\.\d+\.\d+(")' \
    -Replacement "`${1}$Version`${2}"

  Replace-FirstMatch \
    -Path 'src/features/updater/updateManifest.ts' \
    -Pattern "(currentVersion:\s*')\d+\.\d+\.\d+(')" \
    -Replacement "`${1}$Version`${2}"

  Replace-FirstMatch \
    -Path 'src/features/updater/UpdaterPanel.tsx' \
    -Pattern 'Updater foundation v\d+\.\d+\.\d+' \
    -Replacement "Updater foundation v$Version"

  Write-Host "Kodiak Connect version bumped to $Version" -ForegroundColor Green
  Write-Host 'Next: build, publish, commit, and tag this release.' -ForegroundColor Cyan
}
finally {
  Pop-Location
}
