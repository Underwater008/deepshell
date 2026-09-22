# build.ps1 — assemble the DeepShell Windows payload and compile the installer.
#
# Downloads a portable Node.js LTS, npm-installs the pinned upstream harness
# (@deepseek-ai/dsh) into payload/app, then runs Inno Setup. Output lands in
# dist\DeepShell-Setup.exe. Runs locally (needs Inno Setup 6 installed) and in
# the windows-release GitHub Actions workflow (Inno is preinstalled there).
#
#   powershell -ExecutionPolicy Bypass -File windows\build.ps1
#   powershell -ExecutionPolicy Bypass -File windows\build.ps1 -DshVersion 0.1.5-rc.2 -NodeVersion 22.14.0
#
# -DshVersion latest  resolves the npm dist-tag at build time (default).
# The resolved versions are written into payload\version.txt for support.

[CmdletBinding()]
param(
  [string]$DshVersion = "",         # empty = pinned windows\dsh-version.txt; "latest" = npm dist-tag
  [string]$NodeVersion = "",        # empty = latest LTS from nodejs.org
  [string]$Arch = "x64"
)

$ErrorActionPreference = "Stop"
$root    = Split-Path -Parent (Split-Path -Parent $PSCommandPath)   # repo root
$build   = Join-Path $root "build"
$payload = Join-Path $build "payload"
$dist    = Join-Path $root "dist"

function Resolve-NodeLts {
  $index = Invoke-RestMethod "https://nodejs.org/dist/index.json"
  $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
  if (-not $lts) { throw "could not resolve latest Node LTS from nodejs.org" }
  return $lts.version.TrimStart("v")
}

function Resolve-DshVersion {
  param([string]$spec)
  # Release builds pin a known-good harness (windows\dsh-version.txt) instead
  # of chasing @latest: upstream rc publishes can be incomplete on npm
  # (observed: rc.3 referencing a sub-package that was not published yet).
  # Bump the pin deliberately after a green build. "latest" stays available
  # for manual workflow dispatches that want bleeding edge.
  if (-not $spec) {
    $pin = (Get-Content (Join-Path $PSScriptRoot "dsh-version.txt") -Raw).Trim()
    if (-not $pin) { throw "windows\dsh-version.txt is empty" }
    return $pin
  }
  if ($spec -ne "latest") { return $spec }
  $v = (npm view "@deepseek-ai/dsh@latest" version 2>$null | Select-Object -First 1).Trim()
  if (-not $v) { throw "could not resolve @deepseek-ai/dsh@latest from npm" }
  return $v
}

Write-Host "== DeepShell Windows payload build ==" -ForegroundColor Cyan

# ---- resolve versions -------------------------------------------------------
if (-not $NodeVersion) { $NodeVersion = Resolve-NodeLts }
$DshVersion = Resolve-DshVersion $DshVersion
Write-Host "node: v$NodeVersion ($Arch)   dsh: $DshVersion"

# ---- clean -------------------------------------------------------------------
Remove-Item -Recurse -Force $build -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $build, $payload, $dist | Out-Null

# ---- portable node -----------------------------------------------------------
$nodeZip = Join-Path $build "node.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-$Arch.zip"
Write-Host "downloading $nodeUrl"
Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
Expand-Archive -Path $nodeZip -DestinationPath $build
Move-Item (Join-Path $build "node-v$NodeVersion-win-$Arch") (Join-Path $payload "node")
Remove-Item $nodeZip

$nodeExe = Join-Path $payload "node\node.exe"
$npmCli  = Join-Path $payload "node\node_modules\npm\bin\npm-cli.js"
if (-not (Test-Path $nodeExe)) { throw "portable node extraction failed: $nodeExe missing" }
if (-not (Test-Path $npmCli))  { throw "portable npm missing at $npmCli" }

# ---- harness payload -----------------------------------------------------------
$appDir = Join-Path $payload "app"
New-Item -ItemType Directory -Force $appDir | Out-Null
@{ dependencies = @{ "@deepseek-ai/dsh" = $DshVersion } } |
  ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $appDir "package.json")

Write-Host "installing @deepseek-ai/dsh@$DshVersion into payload\app (this is the big download)..."
& $nodeExe $npmCli install --prefix $appDir --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm install failed ($LASTEXITCODE)" }

$dshBin = Join-Path $appDir "node_modules\@deepseek-ai\dsh\lib\bin.js"
if (-not (Test-Path $dshBin)) { throw "harness CLI missing at $dshBin" }

# Smoke: the CLI must parse and report its version under the portable runtime.
& $nodeExe $dshBin --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "harness CLI smoke check failed ($LASTEXITCODE)" }

# ---- version stamp + support info --------------------------------------------
@"
deepshell-windows build
  built:        $([DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"))
  dsh:          $DshVersion
  node:         v$NodeVersion ($Arch)
  installer:    Inno Setup 6
"@ | Set-Content -Encoding UTF8 (Join-Path $payload "version.txt")

# ---- compile installer ----------------------------------------------------------
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { $iscc = "${env:ProgramFiles}\Inno Setup 6\ISCC.exe" }
if (-not (Test-Path $iscc)) {
  throw "Inno Setup 6 not found — install from https://jrsoftware.org/isinfo.php (preinstalled on GitHub windows runners)"
}

Write-Host "compiling installer..."
& $iscc "/DDshVersion=$DshVersion" (Join-Path $root "windows\installer.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC failed ($LASTEXITCODE)" }

$exe = Join-Path $dist "DeepShell-Setup.exe"
if (-not (Test-Path $exe)) { throw "expected installer missing at $exe" }
Write-Host ""
Write-Host "built: $exe" -ForegroundColor Green
Write-Host ("size:  {0:N1} MB" -f ((Get-Item $exe).Length / 1MB))
