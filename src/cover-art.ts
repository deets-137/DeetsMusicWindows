// Covers the app draws for a new playlist (PLAYLISTS.md §11): its letters or a ♪, in the
// theme in use at that moment, saved like a picked image. The saved cover keeps that
// theme for good — it shows which theme the playlist was made in.
//
// The face is Anton, the DM mark's face, in every skin. Colors come from the theme's
// album roles on :root (--album-bg ground, --album-c1 first mark, --album-c2 second).

/** The canvas side. Saved as a PNG: flat color compresses to a few KB. */
const SIDE = 512;
const FACE = '"Anton"';

/** Up to two letters or digits: the first of each of the first two words that have one.
 *  "Late Night" → "LN", "chill" → "C", "🔥🔥" → "" (the caller draws a ♪ instead). */
export function coverLetters(name: string): string {
  const out: string[] = [];
  for (const word of name.split(/\s+/)) {
    const m = /[\p{L}\p{N}]/u.exec(word);
    if (m) out.push(m[0].toLocaleUpperCase());
    if (out.length === 2) break;
  }
  return out.join("");
}

function roles(): { bg: string; c1: string; c2: string } {
  const cs = getComputedStyle(document.documentElement);
  const v = (p: string) => cs.getPropertyValue(p).trim();
  return { bg: v("--album-bg"), c1: v("--album-c1"), c2: v("--album-c2") };
}

/** Letters like the DM mark: the first letter higher in c1, the second lower in c2. */
async function drawLetters(ctx: CanvasRenderingContext2D, letters: string, c: { c1: string; c2: string }): Promise<void> {
  await document.fonts.load(`100px ${FACE}`);
  ctx.textBaseline = "alphabetic";
  ctx.font = `100px ${FACE}`;
  const cap100 = ctx.measureText("H").actualBoundingBoxAscent || 73;
  const two = letters.length === 2;
  // Cap height as a share of the side (the DM mark: 0.54 for two letters).
  let size = (100 * SIDE * (two ? 0.54 : 0.6)) / cap100;
  const drop = two ? SIDE * 0.1 : 0;
  const gap = () => size * 0.03;
  const widths = () => {
    ctx.font = `${size}px ${FACE}`;
    return [...letters].map((l) => ctx.measureText(l).width);
  };
  let w = widths();
  const total = () => w.reduce((a, b) => a + b, 0) + (two ? gap() : 0);
  if (total() > SIDE * 0.84) {
    size *= (SIDE * 0.84) / total();
    w = widths();
  }
  const cap = (cap100 * size) / 100;
  const base = SIDE / 2 + (cap - drop) / 2; // the block (cap + drop) centered
  let x = (SIDE - total()) / 2;
  [...letters].forEach((l, i) => {
    ctx.fillStyle = i === 0 ? c.c1 : c.c2;
    ctx.fillText(l, x, base + (i === 0 ? 0 : drop));
    x += w[i] + gap();
  });
}

/** A ♪ drawn as a shape (Anton has no ♪): head and stem in c1, the flag in c2. */
function drawNote(ctx: CanvasRenderingContext2D, c: { c1: string; c2: string }): void {
  const u = SIDE;
  ctx.fillStyle = c.c1;
  ctx.beginPath();
  ctx.ellipse(u * 0.42, u * 0.7, u * 0.135, u * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(u * 0.515, u * 0.22, u * 0.05, u * 0.47);
  ctx.fillStyle = c.c2;
  ctx.beginPath();
  ctx.moveTo(u * 0.565, u * 0.22);
  ctx.bezierCurveTo(u * 0.6, u * 0.32, u * 0.78, u * 0.36, u * 0.72, u * 0.58);
  ctx.bezierCurveTo(u * 0.7, u * 0.46, u * 0.64, u * 0.41, u * 0.565, u * 0.39);
  ctx.closePath();
  ctx.fill();
}

/** A PNG data URL of the new playlist's cover: its letters, or a ♪ when `kind` is note or
 *  the name has no letter or digit. Null when the canvas is unavailable. */
export async function drawCover(kind: "letters" | "note", name: string): Promise<string | null> {
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const c = roles();
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, SIDE, SIDE);
  const letters = kind === "letters" ? coverLetters(name) : "";
  if (letters) await drawLetters(ctx, letters, c);
  else drawNote(ctx, c);
  return canvas.toDataURL("image/png");
}
