; installer.iss — DeepShell Windows installer (Inno Setup 6).
;
; Per-user install into %LOCALAPPDATA%\DeepShell — no admin rights needed.
; Payload layout (assembled by windows\build.ps1 before ISCC runs):
;   build\payload\node\     portable Node.js runtime
;   build\payload\app\      npm tree with the pinned @deepseek-ai/dsh
;   build\payload\version.txt
;   windows\launcher\*.js   no-console WSH launcher/stop (installed at {app})
;
; Compiled by build.ps1 with /DDshVersion=<resolved harness version>.

#ifndef DshVersion
  #define DshVersion "dev"
#endif

[Setup]
AppId={{7E4B1C3A-2D5F-4A8B-9E6C-1F3D5A7B9C2E}}
AppName=DeepShell
AppVerName=DeepShell — DeepSeek Harness shell (harness {#DshVersion})
AppPublisher=DeepShell community
AppPublisherURL=https://github.com/Underwater008/deepshell
AppSupportURL=https://github.com/Underwater008/deepshell/issues
DefaultDirName={localappdata}\DeepShell
DefaultGroupName=DeepShell
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=DeepShell-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
UninstallDisplayName=DeepShell
; Seamless, Store-style install (Codex/ChatGPT precedent): no wizard pages at
; all. Double-click -> progress bar -> done -> app opens. No questions, no
; decisions: Start Menu entry and start-at-sign-in are on by default (the
; same lifecycle the macOS launchd service has), launch happens automatically.
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\build\payload\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\build\payload\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\build\payload\version.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher\launcher.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher\stop.js"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\DeepShell"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\launcher.js"""; WorkingDir: "{app}"; Comment: "Open DeepShell"
Name: "{group}\Stop DeepShell"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\stop.js"""; WorkingDir: "{app}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "DeepShell"; ValueType: string; ValueData: """{sys}\wscript.exe"" //nologo ""{app}\launcher.js"""; Flags: uninsdeletevalue

[Run]
Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\launcher.js"""; WorkingDir: "{app}"; Flags: nowait skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\run"

[Code]
procedure StopHarness;
var
  ResultCode: Integer;
begin
  { Kill a running harness from a previous install by command-line match.
    PowerShell -NonInteractive: errors exit silently, no dialog can ever
    block the (possibly silent) install. Best-effort; ResultCode ignored. }
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
       '-NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | ' +
       'Where-Object { $_.Name -eq ''node.exe'' -and $_.CommandLine -match ''--port 3080'' -and ' +
       '$_.CommandLine -match ''@deepseek-ai'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { A previous install may have the harness running; its node.exe would lock files. }
  StopHarness;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then StopHarness;
end;
