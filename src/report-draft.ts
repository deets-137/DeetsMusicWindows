// A bug report started from somewhere else (his call 2A, 2026-10-30: a "Report" button on error
// toasts, so a user who meets an error can send it in one step instead of giving up on the app).
// The request is held until the Settings card takes it, the same way `requestSetting` holds a
// row (layout-bus.ts): the card opens at Settings › Bugs with the form filled, and the user
// reads, edits and sends it. Nothing leaves the PC until they press Send.

import { requestSetting } from "./layout-bus";

export interface ReportDraft {
  title: string;
  body: string;
  /** A REPORT_AREAS value in settings-card.ts: it picks the log cut. */
  area: string;
}

let pending: ReportDraft | null = null;

/** Open Settings › Bugs with this report filled in. */
export function startReport(d: ReportDraft): void {
  pending = d;
  // "What went wrong", under the title and the details: the form's html rows carry no row id.
  requestSetting("reportarea");
}

/** Settings-card side: take the waiting draft (null when none). */
export function takeReportDraft(): ReportDraft | null {
  const d = pending;
  pending = null;
  return d;
}
