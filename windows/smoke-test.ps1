# smoke-test.ps1 — prove the installer works: silent-install, launch the
# harness exactly as the Start Menu shortcut does, assert the web UI answers,
# stop it, uninstall, assert cleanup. Runs in CI (windows-latest) on every
# build; also usable locally after windows\build.ps1.
#
#   powershell -ExecutionPolicy Bypass -File windows\smoke-test.ps1
#
# Every external process runs under a watchdog so a hang becomes a diagnosable
# failure (with the Inno /LOG and harness log dumped) instead of a stuck job.

[CmdletBinding()]
param([string]$Installer = "")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if (-not $Installer) { $Installer = Join-Path $root "dist\DeepShell-Setup.exe" }
$appDir = Join-Path $env:LOCALAPPDATA "DeepShell"
$log    = Join-Path $appDir "run\harness.log"
$installLog = Join-Path $root "dist\install.log"

function Assert($cond, $message) {
  if (-not $cond) { throw "SMOKE FAIL: $message" }
  Write-Host "  ok: $message" -ForegroundColor Green
}

function Show-Diagnostics {
  if (Test-Path $installLog) {
    Write-Host "---- install.log (tail) ----"
    Get-Content $installLog -Tail 30
  }
  if (Test-Path $log) {
    Write-Host "---- harness.log (tail) ----"
    Get-Content $log -Tail 30
  }
}

# Run one external process with a hard timeout; dump logs and fail on overrun.
# (WaitForExit returns a real bool — Wait-Process returns nothing either way.)
function Invoke-Watched($file, [string[]]$arguments, [int]$timeoutSec, [string]$what) {
  $p = Start-Process $file -ArgumentList $arguments -PassThru
  if (-not $p.WaitForExit($timeoutSec * 1000)) {
    Write-Host "SMOKE FAIL: $what did not finish within $timeoutSec s" -ForegroundColor Red
    Show-Diagnostics
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    exit 1
  }
  $p.Refresh()
  return $p.ExitCode
}

Write-Host "== DeepShell Windows smoke test ==" -ForegroundColor Cyan
try {

# ---- install ----------------------------------------------------------------
Assert (Test-Path $Installer) "installer exists at $Installer"
# Defender real-time scanning makes extracting tens of thousands of small
# payload files brutally slow; exclude the target dir (CI runner is ephemeral).
try { Add-MpPreference -ExclusionPath $appDir -ErrorAction Stop } catch {
  Write-Host "  note: could not add Defender exclusion (continuing): $_"
}
Remove-Item $installLog -Force -ErrorAction SilentlyContinue
Write-Host "installing silently (watchdog 900 s, Inno log: $installLog)..."
$rc = Invoke-Watched $Installer @("/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/LOG=`"$installLog`"") 900 "installer"
Assert ($rc -eq 0) "installer exit code 0 (got $rc)"

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
$rc = Invoke-Watched wscript.exe @("//nologo","`"$appDir\stop.js`"") 60 "stop script"
Start-Sleep -Seconds 2
$harness = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
           Where-Object { $_.CommandLine -match '@deepseek-ai' -and $_.CommandLine -match '--port 3080' }
Assert (-not $harness) "no harness process remains after stop"

# ---- uninstall ------------------------------------------------------------------
$unins = Get-ChildItem $appDir -Filter "unins*.exe" | Select-Object -First 1
Assert ($null -ne $unins) "uninstaller present"
$rc = Invoke-Watched $unins.FullName @("/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART") 300 "uninstaller"
Assert ($rc -eq 0) "uninstaller exit code 0 (got $rc)"
Start-Sleep -Seconds 3
Assert (-not (Test-Path (Join-Path $appDir "app"))) "install directory removed"

} catch {
  Show-Diagnostics
  throw
}

Write-Host ""
Write-Host "SMOKE PASS: install -> launch -> HTTP 200 -> stop -> uninstall" -ForegroundColor Green
