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
; from outside the Web Store).

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
  MessageBox MB_YESNO|MB_ICONQUESTION "Also set up the DeetsMusic browser extension?$\r$\n$\r$\nIt adds a toolbar button that sends the song you're watching on YouTube to your Apple Music library." IDNO deets_skip_ext
  ExecShell "open" "$INSTDIR\extension\install.html"
  deets_skip_ext:
!macroend
