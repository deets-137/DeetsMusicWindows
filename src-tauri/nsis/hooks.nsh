; DeetsMusic NSIS hooks (EXTENSION.md §6). Tauri splices these macros into the
; generated installer.
;
; PRE(UN)INSTALL — stop the CLI. Tauri's template closes the APP before it writes or
; deletes files, but it knows nothing about the CLI we ship beside it (bundle.resources
; → $INSTDIR\cli). That CLI is long-lived in practice: `deetsmusic mcp` serves an MCP
; session for as long as the agent runs, and Windows refuses to replace or delete a file
; a process holds open. An install then leaves a stale CLI next to a new app, and an
; uninstall leaves the whole folder behind while still removing the registry entry — a
; half-uninstall that Windows reports as "not installed". So stop it first, both ways.
;
; Matched by PATH, not by image name: a dev build under target\debug is also called
; deetsmusic.exe, and an uninstall has no business killing the one being worked in.
;
; POSTINSTALL — offer the browser extension. It ships unpacked under $INSTDIR\extension,
; and install.html walks through loading it (Chrome refuses to auto-install anything
; from outside the Web Store). Asked at most once per PC (2026-09-14):
; - never on an updater install (/UPDATE) or a silent one: a loaded unpacked extension
;   reads its files from $INSTDIR\extension, so the browser picks up the new copy at its
;   next start with nothing to set up;
; - never once the extension has reached this app (the bridge writes extension-connected);
; - never after a No (this macro writes extension-declined). Settings › Connections ›
;   Extension install guide stays the way back.
; Both marks live in the app data folder, which an uninstall keeps (RELEASE.md §5).

; WELCOME TEXT — replaces NSIS's stock "It is recommended that you close all other
; applications … reboot your computer", which is not true here: a per-user install
; writes no system files, and the template closes DeetsMusic (and DeetsStopCli the CLI)
; itself. Tauri includes this file above `!insertmacro MUI_PAGE_WELCOME`, and a define
; made before that macro is the page's text. $_CLICK is NSIS's own "Click Next to continue."
!define MUI_WELCOMEPAGE_TEXT "Setup installs DeetsMusic for your Windows account. It does not need administrator rights.$\r$\n$\r$\nIf DeetsMusic is open, Setup closes it for you.$\r$\n$\r$\n$_CLICK"

!macro DeetsStopCli
  DetailPrint "Stopping the DeetsMusic CLI..."
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "Get-Process -Name deetsmusic -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like $\'$INSTDIR\cli\*$\' } | Stop-Process -Force; exit 0"'
  Pop $0
  ; Stop-Process returns before the OS releases the handle — give it a moment.
  Sleep 600
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro DeetsStopCli
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro DeetsStopCli
!macroend

!macro NSIS_HOOK_POSTINSTALL
  IfSilent deets_skip_ext
  ${If} $UpdateMode = 1
    Goto deets_skip_ext
  ${EndIf}
  IfFileExists "$APPDATA\com.deetsmusic.app\extension-connected" deets_skip_ext
  IfFileExists "$APPDATA\com.deetsmusic.app\extension-declined" deets_skip_ext
  MessageBox MB_YESNO|MB_ICONQUESTION "Also set up the DeetsMusic browser extension?$\r$\n$\r$\nIt adds a toolbar button that sends the song you're watching on YouTube to your Apple Music library." IDYES deets_open_ext
  CreateDirectory "$APPDATA\com.deetsmusic.app"
  FileOpen $0 "$APPDATA\com.deetsmusic.app\extension-declined" w
  FileWrite $0 "No to the extension question at install (src-tauri/nsis/hooks.nsh). Delete this file to be asked again."
  FileClose $0
  Goto deets_skip_ext
  deets_open_ext:
  ExecShell "open" "$INSTDIR\extension\install.html"
  deets_skip_ext:
!macroend
