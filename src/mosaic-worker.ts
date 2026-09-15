// Mosaic worker (PLAYLISTS.md §11) — draws one playlist's derived cover off the main
// thread. In: { id, urls (cover templates), seed, size, bg }. Out: { id, blob } — a JPEG,
// or null when no cover loaded. The fetches ride the webview's HTTP cache: Apple's image
// server answers with `Access-Control-Allow-Origin: *` and a long max-age.

interface Job {
  id: number;
  urls: string[];
  seed: string;
  size: number;
  bg: string;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const port = self as unknown as Worker;

/** Tile fetch sizes: a few fixed steps, so playlists that share songs share cached images. */
const FETCH_PX = [60, 120, 240, 480];
const PARALLEL = 6;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator, so one playlist always gets the same picture. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A square count (1, 4, 9 … 100) is an even grid. Any other count cuts the square
 *  again and again into parts sized by how many covers each part holds — mixed tiles
 *  that still fill the whole square. */
function layout(n: number, size: number, rnd: () => number): Rect[] {
  const k = Math.round(Math.sqrt(n));
  const out: Rect[] = [];
  if (k * k === n) {
    const edge = (i: number) => Math.round((i * size) / k);
    for (let r = 0; r < k; r++)
      for (let c = 0; c < k; c++) out.push({ x: edge(c), y: edge(r), w: edge(c + 1) - edge(c), h: edge(r + 1) - edge(r) });
    return out;
  }
  const split = (x: number, y: number, w: number, h: number, m: number): void => {
    if (m === 1) {
      out.push({ x, y, w, h });
      return;
    }
    const a = Math.min(m - 1, Math.max(1, Math.round(m * (0.3 + 0.4 * rnd()))));
    if (w >= h) {
      const cut = Math.round((w * a) / m);
      split(x, y, cut, h, a);
      split(x + cut, y, w - cut, h, m - a);
    } else {
      const cut = Math.round((h * a) / m);
      split(x, y, w, cut, a);
      split(x, y + cut, w, h - cut, m - a);
    }
  };
  split(0, 0, size, size, n);
  return out;
}

async function bitmap(template: string, px: number): Promise<ImageBitmap | null> {
  const s = String(px);
  try {
    const res = await fetch(template.replace("{w}", s).replace("{h}", s).replace("{f}", "jpg"));
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

async function draw(job: Job): Promise<Blob | null> {
  const rnd = random(hash(job.seed));
  const urls = [...job.urls];
  for (let i = urls.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [urls[i], urls[j]] = [urls[j], urls[i]];
  }
  const rects = layout(urls.length, job.size, rnd);
  const canvas = new OffscreenCanvas(job.size, job.size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = job.bg || "#808080";
  ctx.fillRect(0, 0, job.size, job.size);

  let drawn = 0;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const r = rects[i];
      const want = Math.max(r.w, r.h);
      const bmp = await bitmap(urls[i], FETCH_PX.find((p) => p >= want) ?? FETCH_PX[FETCH_PX.length - 1]);
      if (!bmp) continue;
      // Center-crop the square cover to the tile's shape.
      const side = Math.min(bmp.width, bmp.height);
      const sw = r.w >= r.h ? side : (side * r.w) / r.h;
      const sh = r.w >= r.h ? (side * r.h) / r.w : side;
      ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
      bmp.close();
      drawn++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, urls.length) }, worker));
  if (!drawn) return null;
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}

port.onmessage = (e: MessageEvent<Job>) => {
  draw(e.data)
    .then((blob) => port.postMessage({ id: e.data.id, blob }))
    .catch(() => port.postMessage({ id: e.data.id, blob: null }));
};
