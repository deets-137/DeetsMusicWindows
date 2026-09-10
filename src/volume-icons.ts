// The two speaker glyphs shared by every mute button (titlebar flyout, the max
// stage's volume row, the tray panel). Filled paths on a 24-grid; `fill: currentColor`
// comes from the host button's CSS.

export const ICON_VOL =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm12.5 3a4 4 0 0 0-2.5-3.7v7.4a4 4 0 0 0 2.5-3.7zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';

export const ICON_MUTE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm17 .4L19.6 8l-2.6 2.6L14.4 8 13 9.4l2.6 2.6L13 14.6 14.4 16l2.6-2.6 2.6 2.6 1.4-1.4-2.6-2.6L21 9.4z"/></svg>';
