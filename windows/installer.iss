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

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "autostart"; Description: "Start DeepShell at sign-in (recommended; closing the browser tab does not stop it)"; GroupDescription: "Startup:"

[Files]
Source: "..\build\payload\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\build\payload\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\build\payload\version.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher\launcher.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher\stop.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher\stop.js"; Flags: dontcopy

[Icons]
Name: "{group}\DeepShell"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\launcher.js"""; WorkingDir: "{app}"; Comment: "Open DeepShell"
Name: "{group}\Stop DeepShell"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\stop.js"""; WorkingDir: "{app}"
Name: "{autodesktop}\DeepShell"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\launcher.js"""; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "DeepShell"; ValueType: string; ValueData: """{sys}\wscript.exe"" //nologo ""{app}\launcher.js"""; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\launcher.js"""; WorkingDir: "{app}"; Description: "Launch DeepShell now"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\run"

[Code]
procedure StopHarness;
var
  ResultCode: Integer;
begin
  { stop.js kills the harness by command-line match, wherever it runs from }
  Exec(ExpandConstant('{sys}\wscript.exe'), '//nologo "' + ExpandConstant('{tmp}\stop.js') + '"',
       '', swHide, ewWaitUntilTerminated, ResultCode);
end;

procedure InitializeSetup;
begin
  ExtractTemporaryFile('stop.js');
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
