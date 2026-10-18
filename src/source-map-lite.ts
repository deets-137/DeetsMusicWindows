// Just enough of a v3 source map to name the source line behind a column of a minified chunk:
// the page sample (page-sample.ts) files each live timer under the line that made it, and in a
// `--built` bundle that line is `index-XXXX.js:1:23456`. Pure, so it has a unit test
// (tests/source-map-lite.test.ts). No dependency: the app ships none for this.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** One generated line's segments: [generated column, source index, source line], all 0-based,
 *  in column order. Segments with no source are left out. */
export type MapLines = number[][][];

/** Decode a `mappings` string. The source column and the name fields are read past, not kept. */
export function decodeMappings(mappings: string): MapLines {
  const lines: MapLines = [];
  let src = 0;
  let srcLine = 0;
  for (const text of mappings.split(";")) {
    const segs: number[][] = [];
    let genCol = 0;
    for (const seg of text.split(",")) {
      if (!seg) continue;
      const v: number[] = [];
      let shift = 0;
      let value = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        value += (d & 31) << shift;
        if (d & 32) shift += 5;
        else {
          v.push(value & 1 ? -(value >>> 1) : value >>> 1);
          shift = 0;
          value = 0;
        }
      }
      genCol += v[0];
      if (v.length >= 4) {
        src += v[1];
        srcLine += v[2];
        segs.push([genCol, src, srcLine]);
      }
    }
    lines.push(segs);
  }
  return lines;
}

/** The source behind a 1-based line and column (a stack frame's numbers), or null. The segment
 *  that starts at or before the column wins. */
export function lookup(lines: MapLines, line: number, col: number): { src: number; line: number } | null {
  const segs = lines[line - 1];
  if (!segs?.length) return null;
  const c = col - 1;
  let best: number[] | null = null;
  for (const s of segs) {
    if (s[0] <= c) best = s;
    else break;
  }
  best ??= segs[0];
  return { src: best[1], line: best[2] + 1 };
}
