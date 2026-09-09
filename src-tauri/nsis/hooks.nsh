; DeetsMusic NSIS hooks (EXTENSION.md §6). Tauri splices these macros into the
; generated installer. After the files land we offer the browser extension: it
; ships unpacked under $INSTDIR\extension, and install.html walks through
; loading it (Chrome refuses to auto-install anything outside the Web Store).
!macro NSIS_HOOK_POSTINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "Also set up the DeetsMusic browser extension?$\r$\n$\r$\nIt adds a toolbar button that sends the song you're watching on YouTube to your Apple Music library." IDNO deets_skip_ext
  ExecShell "open" "$INSTDIR\extension\install.html"
  deets_skip_ext:
!macroend
