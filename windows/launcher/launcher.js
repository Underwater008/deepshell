// launcher.js — DeepShell Windows launcher (runs under wscript.exe: no console
// window ever appears). Start Menu / desktop / autostart entries all point here.
//
// Mirrors deepshell.sh open on macOS:
//   1. If the harness is already running (recorded pid alive), reuse it.
//   2. Otherwise start it hidden: node app\node_modules\@deepseek-ai\dsh\lib\bin.js
//      web --port 3080 --no-open, stdout/stderr appended to run\harness.log.
//   3. Scrape the token URL out of the log ("dsh web: http://127.0.0.1:PORT/?token=…")
//      and hand it to the default browser. --no-open because the launcher owns
//      the browser handoff, which also covers the already-running case.
//
// WSH JScript — ES5 syntax only (var, no arrow functions, no template literals).

var PORT = 3080;
var WAIT_SECONDS = 90;

var fso = new ActiveXObject("Scripting.FileSystemObject");
var sh = new ActiveXObject("WScript.Shell");

var installDir = fso.GetParentFolderName(WScript.ScriptFullName);
var runDir = installDir + "\\run";
var logFile = runDir + "\\harness.log";
var pidFile = runDir + "\\harness.pid";
var nodeExe = installDir + "\\node\\node.exe";
var dshBin = installDir + "\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";

function wmi() { return GetObject("winmgmts:\\\\.\\root\\cimv2"); }

function findHarnessPid() {
  // Command line match, not just the pid file: pid reuse is real on Windows.
  var query = "SELECT ProcessId FROM Win32_Process WHERE Name = 'node.exe' " +
              "AND CommandLine LIKE '%@deepseek-ai%' AND CommandLine LIKE '%--port " + PORT + "%'";
  var procs = wmi().ExecQuery(query);
  var e = new Enumerator(procs);
  for (; !e.atEnd(); e.moveNext()) return e.item().ProcessId;
  return 0;
}

function readText(path) {
  try {
    var f = fso.OpenTextFile(path, 1, false); // ForReading
    var text = f.ReadAll();
    f.Close();
    return text;
  } catch (err) { return ""; }
}

function currentUrl() {
  var matches = readText(logFile).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/g);
  return matches ? matches[matches.length - 1] : null;
}

function openBrowser(url) {
  // rundll32 handoff: no console, no quoting surprises, uses the default browser.
  sh.Run("rundll32 url.dll,FileProtocolHandler " + url, 0, false);
}

function fail(message) {
  WScript.Echo(message + "\n\nLog: " + logFile);
  WScript.Quit(1);
}

function main() {
  if (!fso.FileExists(nodeExe) || !fso.FileExists(dshBin)) {
    fail("DeepShell is not fully installed (node runtime or harness missing). Reinstall DeepShell.");
  }
  if (!fso.FolderExists(runDir)) fso.CreateFolder(runDir);

  var pid = findHarnessPid();
  if (pid === 0) {
    // Fresh start: truncate the log so the first token URL found is the new one,
    // then launch hidden (window style 0), detached (don't wait).
    try { fso.CreateTextFile(logFile, true).Close(); } catch (err) {}
    sh.CurrentDirectory = sh.ExpandEnvironmentStrings("%USERPROFILE%");
    var cmd = "cmd.exe /c \"\"" + nodeExe + "\" \"" + dshBin +
              "\" web --port " + PORT + " --no-open >> \"" + logFile + "\" 2>&1\"";
    sh.Run(cmd, 0, false);

    for (var i = 0; i < WAIT_SECONDS * 2; i++) {
      WScript.Sleep(500);
      pid = findHarnessPid();
      if (pid !== 0) break;
    }
    if (pid === 0) fail("DeepShell did not start within " + WAIT_SECONDS + " seconds.");
    try {
      var p = fso.CreateTextFile(pidFile, true);
      p.Write(String(pid));
      p.Close();
    } catch (err) {}
  }

  for (var s = 0; s < WAIT_SECONDS * 2; s++) {
    var url = currentUrl();
    if (url) { openBrowser(url); return; }
    WScript.Sleep(500);
  }
  fail("DeepShell started but did not print its URL within " + WAIT_SECONDS + " seconds.");
}

main();
