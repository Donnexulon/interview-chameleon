#define AppName "Interview Chameleon"
#define AppVersion "1.0.0-beta.1"
#define AppPublisher "Interview Chameleon"
#define AppExeName "InterviewChameleon.exe"

[Setup]
AppId={{9B7E5C72-BFC5-4677-A60D-18C76CF08D31}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\Interview Chameleon
DefaultGroupName=Interview Chameleon
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\release
OutputBaseFilename=InterviewChameleon-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\PROPRIETARY_NOTICE.txt
SetupIconFile=..\desktop\interview-chameleon.ico
UninstallDisplayIcon={app}\{#AppExeName}
CloseApplications=yes
RestartApplications=no
#ifdef SignToolName
SignTool={#SignToolName}
SignedUninstaller=yes
#endif

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce

[Files]
Source: "..\dist\release\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "prerequisites\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\Interview Chameleon"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\Interview Chameleon"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft WebView2 Runtime..."; Flags: waituntilterminated; Check: not IsWebView2Installed
Filename: "{app}\{#AppExeName}"; Description: "Launch Interview Chameleon"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebViewClientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasRuntimeAt(const Root: Integer; const Key: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function IsWebView2Installed: Boolean;
var
  MachineKey, UserKey: String;
begin
  MachineKey := 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WebViewClientId;
  UserKey := 'Software\Microsoft\EdgeUpdate\Clients\' + WebViewClientId;
  Result := HasRuntimeAt(HKLM, MachineKey) or HasRuntimeAt(HKCU, UserKey);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataPath: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    DataPath := ExpandConstant('{localappdata}\Interview Chameleon');
    if DirExists(DataPath) and
      (MsgBox('Delete all local Interview Chameleon sessions, preferences, logs, models, and backups? Choose No to preserve them for reinstall.',
        mbConfirmation, MB_YESNO) = IDYES) then
      DelTree(DataPath, True, True, True);
  end;
end;
