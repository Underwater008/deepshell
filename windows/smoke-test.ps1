# smoke-test.ps1 — prove the installer works: silent-install, launch the
# harness exactly as the Start Menu shortcut does, assert the web UI answers,
# stop it, uninstall, assert cleanup. Runs in CI (windows-latest) on every
# build; also usable locally after windows\build.ps1.
#
#   powershell -ExecutionPolicy Bypass -File windows\smoke-test.ps1

[CmdletBinding()]
param([string]$Installer = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if (-not $Installer) { $Installer = Join-Path $root "dist\DeepShell-Setup.exe" }
$appDir = Join-Path $env:LOCALAPPDATA "DeepShell"
$log    = Join-Path $appDir "run\harness.log"

function Assert($cond, $message) {
  if (-not $cond) { throw "SMOKE FAIL: $message" }
  Write-Host "  ok: $message" -ForegroundColor Green
}

Write-Host "== DeepShell Windows smoke test ==" -ForegroundColor Cyan

# ---- install ----------------------------------------------------------------
Assert (Test-Path $Installer) "installer exists at $Installer"
Write-Host "installing silently..."
& $Installer /VERYSILENT /SUPPRESSMSGBOXES /NORESTART | Out-Null
Assert ($LASTEXITCODE -eq 0) "installer exit code 0 (got $LASTEXITCODE)"

Assert (Test-Path (Join-Path $appDir "node\node.exe")) "portable node installed"
Assert (Test-Path (Join-Path $appDir "app\node_modules\@deepseek-ai\dsh\lib\bin.js")) "harness installed"
Assert (Test-Path (Join-Path $appDir "launcher.js")) "launcher installed"
Assert (Test-Path (Join-Path $appDir "stop.js")) "stop script installed"

# ---- launch (same invocation as the Start Menu shortcut) ---------------------
Write-Host "launching harness via wscript launcher..."
Start-Process wscript.exe -ArgumentList "//nologo", "`"$appDir\launcher.js`""

$tokenUrl = $null
foreach ($i in 1..240) {   # up to 120 s: first boot composes the web profile
  Start-Sleep -Milliseconds 500
  if (Test-Path $log) {
    $m = [regex]::Match((Get-Content $log -Raw -ErrorAction SilentlyContinue),
                        'http://127\.0\.0\.1:\d+/\?token=[A-Za-z0-9_-]+')
    if ($m.Success) { $tokenUrl = $m.Value; break }
  }
}
Assert ($null -ne $tokenUrl) "harness printed its token URL (log: $log)"
Write-Host "  url: $tokenUrl"

$response = Invoke-WebRequest -Uri $tokenUrl -UseBasicParsing -TimeoutSec 30
Assert ($response.StatusCode -eq 200) "web UI answers HTTP 200"

# ---- stop ---------------------------------------------------------------------
Write-Host "stopping harness..."
& wscript.exe //nologo "$appDir\stop.js"
Start-Sleep -Seconds 2
$harness = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
           Where-Object { $_.CommandLine -match '@deepseek-ai' -and $_.CommandLine -match '--port 3080' }
Assert (-not $harness) "no harness process remains after stop"

# ---- uninstall ------------------------------------------------------------------
$unins = Get-ChildItem $appDir -Filter "unins*.exe" | Select-Object -First 1
Assert ($null -ne $unins) "uninstaller present"
& $unins.FullName /VERYSILENT /SUPPRESSMSGBOXES /NORESTART | Out-Null
Assert ($LASTEXITCODE -eq 0) "uninstaller exit code 0 (got $LASTEXITCODE)"
Start-Sleep -Seconds 3
Assert (-not (Test-Path (Join-Path $appDir "app"))) "install directory removed"

Write-Host ""
Write-Host "SMOKE PASS: install -> launch -> HTTP 200 -> stop -> uninstall" -ForegroundColor Green
