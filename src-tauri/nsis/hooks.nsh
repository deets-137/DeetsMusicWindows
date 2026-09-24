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
; DeetsMusic Beta (docs/ops/BETA.md) is never asked: the full app's installer owns the question.
;
; DeetsMusic Beta builds from this same file, so nothing here names the app: ${PRODUCTNAME}
; and ${BUNDLEID} are the template's own defines ("DeetsMusic Beta", com.deetsmusic.beta).

; WELCOME TEXT — replaces NSIS's stock "It is recommended that you close all other
; applications … reboot your computer", which is not true here: a per-user install
; writes no system files, and the template closes DeetsMusic (and DeetsStopCli the CLI)
; itself. Tauri includes this file above `!insertmacro MUI_PAGE_WELCOME`, and a define
; made before that macro is the page's text. $_CLICK is NSIS's own "Click Next to continue."
!define MUI_WELCOMEPAGE_TEXT "Setup installs ${PRODUCTNAME} for your Windows account. It does not need administrator rights.$\r$\n$\r$\nIf ${PRODUCTNAME} is open, Setup closes it for you.$\r$\n$\r$\n$_CLICK"

; THE PATH, NEVER THE NAME (2026-09-23, docs/ops/RELEASE.md §4a). Every process this installer
; stops is matched by its FULL PATH inside this install's folder. The folder reaches PowerShell
; through an environment variable, not inside the quoted command, so a path with an apostrophe
; (a Windows user named O'Brien) cannot break the quoting.
!macro DeetsPathEnv path
  System::Call 'kernel32::SetEnvironmentVariable(t "DEETS_PATH", t "${path}")i'
!macroend

!macro DeetsStopCli
  DetailPrint "Stopping the ${PRODUCTNAME} CLI..."
  !insertmacro DeetsPathEnv "$INSTDIR\cli\"
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "Get-Process -Name deetsmusic,deetsmusic-beta -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith($$env:DEETS_PATH, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force; exit 0"'
  Pop $0
  ; Stop-Process returns before the OS releases the handle — give it a moment.
  Sleep 600
!macroend

; The app itself. Tauri's template closes it with CheckIfAppIsRunning, which matches the process
; NAME, and Windows compares names without case. So the full app's installer, looking for
; DeetsMusic.exe, also closed the dev build (target\debug\deetsmusic.exe) and EVERY `deetsmusic`
; CLI on the PC, wherever it ran — the MCP servers of open AI apps included — after DeetsStopCli
; had carefully spared them. This file is included after the template's utils.nsh and before
; either use of the macro, so it is replaced here: the same prompt, the same messages and the same
; Abort paths, but only `$INSTDIR\<exe>` is ever found or stopped. A copy of the exe anywhere else
; (a dev build, DeetsMusic Beta, the other app's CLI) is left running.
; `${productName}` is shown exactly as the template shows it. $R0–$R3 are the template's registers.
!macro DeetsCountApp
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "@(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($$env:DEETS_PATH)) -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and [string]::Equals($$_.Path, $$env:DEETS_PATH, [StringComparison]::OrdinalIgnoreCase) }).Count"'
  Pop $R0
  Pop $R0
  IntOp $R0 $R0 + 0
!macroend

!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  !define UniqueID ${__LINE__}
  nsis_tauri_utils::StrReplace "$(appRunning)" "{{product_name}}" "${productName}"
  Pop $R1
  nsis_tauri_utils::StrReplace "$(appRunningOkKill)" "{{product_name}}" "${productName}"
  Pop $R2
  nsis_tauri_utils::StrReplace "$(failedToKillApp)" "{{product_name}}" "${productName}"
  Pop $R3

  !insertmacro DeetsPathEnv "$INSTDIR\${executableName}"
  !insertmacro DeetsCountApp
  ${If} $R0 > 0
    IfSilent deets_kill_${UniqueID} 0
    ${IfThen} $PassiveMode != 1 ${|} MessageBox MB_OKCANCEL $R2 IDOK deets_kill_${UniqueID} IDCANCEL deets_cancel_${UniqueID} ${|}
    deets_kill_${UniqueID}:
      DetailPrint "Closing ${productName}..."
      nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($$env:DEETS_PATH)) -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and [string]::Equals($$_.Path, $$env:DEETS_PATH, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force; exit 0"'
      Pop $R0
      Sleep 500
      !insertmacro DeetsCountApp
      ${If} $R0 = 0
        Goto deets_done_${UniqueID}
      ${EndIf}
      IfSilent 0 deets_ui_${UniqueID}
        Abort
      deets_ui_${UniqueID}:
        Abort $R3
    deets_cancel_${UniqueID}:
      Abort $R1
  ${EndIf}
  deets_done_${UniqueID}:
  !undef UniqueID
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro DeetsStopCli
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro DeetsStopCli
!macroend

!macro NSIS_HOOK_POSTINSTALL
  IfSilent deets_skip_ext
  StrCmp "${BUNDLEID}" "com.deetsmusic.app" 0 deets_skip_ext
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
