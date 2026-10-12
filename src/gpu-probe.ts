// The renderer probe (GRAPHICS-FALLBACK.md §4.1), with no imports, so the dev frame telemetry
// (frames.ts) and the shipped graphics fact (gpu.ts) share it without pulling each other in.

/** The renderer name WebGL reports, or "unknown". One context, freed at once, so the probe
 *  never holds a live context of its own. */
export function rendererName(): string {
  let name = "unknown";
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") ?? c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && dbg) name = String(gl.getParameter((dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL));
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* no WebGL at all: leave it unknown */
  }
  return name;
}
