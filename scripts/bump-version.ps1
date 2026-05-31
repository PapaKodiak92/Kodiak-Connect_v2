param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Replace-RequiredMatch {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Replacement
  )

  $FullPath = Join-Path $RepoRoot $Path
  $Content = Get-Content -Path $FullPath -Raw
  $Regex = [regex]$Pattern

  if (-not $Regex.IsMatch($Content)) {
    throw "No version pattern found in $Path"
  }

  $Updated = $Regex.Replace($Content, $Replacement, 1)
  [System.IO.File]::WriteAllText($FullPath, $Updated, $Utf8NoBom)
}

Push-Location $RepoRoot
try {
  npm version $Version --no-git-tag-version --allow-same-version

  Replace-RequiredMatch `
    -Path 'src-tauri/tauri.conf.json' `
    -Pattern '("version"\s*:\s*")\d+\.\d+\.\d+(")' `
    -Replacement "`${1}$Version`${2}"

  Replace-RequiredMatch `
    -Path 'src/features/updater/updateManifest.ts' `
    -Pattern "(currentVersion:\s*')\d+\.\d+\.\d+(')" `
    -Replacement "`${1}$Version`${2}"

  Write-Host "Kodiak Connect version set to $Version" -ForegroundColor Green
  Write-Host 'Next: build, publish, commit, and tag this release.' -ForegroundColor Cyan
}
finally {
  Pop-Location
}
