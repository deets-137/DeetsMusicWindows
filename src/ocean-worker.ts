// Ocean worker (docs/features/OCEAN.md) — paints the sea's swell layers off the main thread.
// A layer takes tens of ms (more on a scaled display or a tall window), so it never runs on the
// thread that paints. In: a layer spec. Out: { id, blob } — the layer as a PNG.

import { swellLayer, type LayerSpec } from "./ocean-texture";

export interface LayerJob {
  id: number;
  spec: LayerSpec;
}

const port = self as unknown as Worker;

port.onmessage = async (e: MessageEvent<LayerJob>) => {
  const { id, spec } = e.data;
  try {
    const { w, h, data } = swellLayer(spec);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d")!.putImageData(new ImageData(data, w, h), 0, 0);
    port.postMessage({ id, blob: await canvas.convertToBlob({ type: "image/png" }) });
  } catch (err) {
    port.postMessage({ id, blob: null, err: String(err) });
  }
};
