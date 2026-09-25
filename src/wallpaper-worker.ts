// Wallpaper worker (COVER-WALLPAPER.md §3.3) — bakes the SOFT copy of the Glass wallpaper off
// the main thread: the same tiles the page shows sharp, drawn small, then blurred and
// saturated the way the live frost would. The painted frost lays it under each card. One JPEG
// comes back, or null when no tile loaded.
//
// The covers are fetched at the exact links the sharp tiles use, so the webview's HTTP cache
// serves them (Apple's image server answers `Access-Control-Allow-Origin: *` with a long
// max-age). A user picture arrives as a Blob the page already fetched.

export interface WallTile {
  src: string | Blob;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface WallJob {
  id: number;
  /** The canvas size in CSS px. */
  w: number;
  h: number;
  /** The soft copy is drawn at this fraction of the canvas size; CSS stretches it back. */
  scale: number;
  /** The blur radius in CSS px (skin token --wallpaper-blur). */
  blur: number;
  /** The frost's saturation (skin token --glass-frost-sat). */
  sat: number;
  bg: string;
  tiles: WallTile[];
}

const port = self as unknown as Worker;
const PARALLEL = 6;

async function bitmap(src: string | Blob): Promise<ImageBitmap | null> {
  try {
    if (typeof src !== "string") return await createImageBitmap(src);
    const res = await fetch(src);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

async function draw(job: WallJob): Promise<Blob | null> {
  const W = Math.max(1, Math.round(job.w * job.scale));
  const H = Math.max(1, Math.round(job.h * job.scale));
  const sharp = new OffscreenCanvas(W, H);
  const ctx = sharp.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = job.bg || "#000";
  ctx.fillRect(0, 0, W, H);

  let drawn = 0;
  let next = 0;
  const run = async () => {
    while (next < job.tiles.length) {
      const t = job.tiles[next++];
      const bmp = await bitmap(t.src);
      if (!bmp) continue;
      // Center-crop the picture to the tile's shape ("cover").
      const r = t.w / t.h;
      const sw = bmp.width / bmp.height > r ? bmp.height * r : bmp.width;
      const sh = bmp.width / bmp.height > r ? bmp.height : bmp.width / r;
      ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, t.x * job.scale, t.y * job.scale, t.w * job.scale, t.h * job.scale);
      bmp.close();
      drawn++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, job.tiles.length) }, run));
  if (!drawn) return null;

  // The blur, drawn a little oversized so its edges do not fade to the ground.
  const soft = new OffscreenCanvas(W, H);
  const sctx = soft.getContext("2d");
  if (!sctx) return null;
  const r = job.blur * job.scale;
  const m = Math.ceil(r * 2);
  sctx.filter = `blur(${r}px) saturate(${job.sat})`;
  sctx.drawImage(sharp, -m, -m, W + 2 * m, H + 2 * m);
  return soft.convertToBlob({ type: "image/jpeg", quality: 0.8 });
}

port.onmessage = (e: MessageEvent<WallJob>) => {
  draw(e.data)
    .then((blob) => port.postMessage({ id: e.data.id, blob }))
    .catch(() => port.postMessage({ id: e.data.id, blob: null }));
};
