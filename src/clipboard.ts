// Text onto the clipboard, with or without focus. The page's clipboard refuses a window that
// does not have focus, so a copy started by the CLI or an agent (a Diary Done while the app
// sat behind another window, DESK-TESTS.md A6) failed. Rust's Win32 clipboard has no such
// rule (`src-tauri/src/clipboard.rs`), so it is the fallback; the page's own stays first, as
// it is the fast path for a click. Rejects only when both refuse.
import { invoke } from "@tauri-apps/api/core";

export const copyText = (text: string): Promise<void> =>
  navigator.clipboard.writeText(text).catch((e) => {
    console.warn("[clipboard] page refused, trying Rust", e);
    return invoke<void>("clipboard_write", { text });
  });
