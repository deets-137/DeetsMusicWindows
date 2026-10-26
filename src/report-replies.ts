// Replies reach the filer (2026-10-26, his call; DeetsSolutions docs/support.md, "Replies
// reach the filer"). We keep no contact details, so the app tells the user itself: shortly
// after launch and then every few hours it asks report.rs to read the open reports in
// Settings › Bugs › My reports (each at most once a day; none open = no request), and shows
// one toast per report Aditya has replied to since. Open shows the thread, as My reports'
// Open does, and clears the New reply dot.
import { invoke } from "@tauri-apps/api/core";
import { noticeOff, toast } from "./toast";
import * as diag from "./diag";

interface ReplyNews {
  code: string;
  kind: string;
  title: string;
}

const FIRST_MS = 30_000; // after the launch's own requests
const EVERY_MS = 6 * 60 * 60 * 1000; // report.rs skips a report read within 20 h
// The toast's Don't show again: the checks stop too, since nothing would show.
const NOTICE_KEY = "deets.notice.reportReplies";

async function check(): Promise<void> {
  if (noticeOff(NOTICE_KEY)) return;
  let news: ReplyNews[];
  try {
    news = await invoke<ReplyNews[]>("report_check");
  } catch (e) {
    console.warn("[report] check", e);
    return;
  }
  for (const n of news) {
    diag.log("report:reply", { kind: n.kind });
    const what = n.kind === "issue" ? "bug report" : "suggestion";
    toast({
      kind: "info",
      text: `Aditya replied to your ${what}: “${n.title}”`,
      dismissKey: NOTICE_KEY,
      actions: [{ label: "Open", run: () => void invoke("report_open", { code: n.code }).catch((e) => console.warn("[report] open", e)) }],
    });
  }
}

export function initReportReplies(): void {
  diag.log("report:arm", { firstMs: FIRST_MS, everyMs: EVERY_MS });
  window.setTimeout(() => {
    void check();
    window.setInterval(() => void check(), EVERY_MS);
  }, FIRST_MS);
}
