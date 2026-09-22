// stop.js — stop the DeepShell harness (runs under wscript.exe, no console).
// Used by the uninstaller, by reinstalls (stop before replacing files), and by
// the "Stop DeepShell" Start Menu entry. Matches the harness process by
// command line, never a bare node.exe, so other Node apps are untouched.
// Best-effort and fully silent: any error exits quietly instead of popping a
// dialog (a modal dialog here could block a silent install/uninstall forever).

var PORT = 3080;

try {
  var fso = new ActiveXObject("Scripting.FileSystemObject");
  var sh = new ActiveXObject("WScript.Shell");
  var installDir = fso.GetParentFolderName(WScript.ScriptFullName);
  var pidFile = installDir + "\\run\\harness.pid";

  var query = "SELECT ProcessId FROM Win32_Process WHERE Name = 'node.exe' " +
              "AND CommandLine LIKE '%@deepseek-ai%' AND CommandLine LIKE '%--port " + PORT + "%'";
  var procs = GetObject("winmgmts:\\\\.\\root\\cimv2").ExecQuery(query);
  var e = new Enumerator(procs);
  for (; !e.atEnd(); e.moveNext()) {
    try { sh.Run("taskkill /PID " + e.item().ProcessId + " /T /F", 0, true); } catch (err) {}
  }

  try { if (fso.FileExists(pidFile)) fso.DeleteFile(pidFile, true); } catch (err) {}
} catch (err) {}
WScript.Quit(0);
