//! The kept frames as files: one PNG per frame, and one strip per tag (the frames side by
//! side, scaled down, in time order, 8 to a row). The ms of each frame is in its file name
//! and in `index.json`; the judge labels the strip (music-app-comp.md §17.2).

use crate::screen::Kept;
use serde_json::json;
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::BufWriter;
use std::path::Path;

fn write_png(path: &Path, w: u32, h: u32, rgba: &[u8]) -> std::io::Result<()> {
    let f = BufWriter::new(File::create(path)?);
    let mut enc = png::Encoder::new(f, w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut wr = enc.write_header().map_err(std::io::Error::other)?;
    wr.write_image_data(rgba).map_err(std::io::Error::other)?;
    Ok(())
}

fn to_rgba(bgra: &[u8]) -> Vec<u8> {
    let mut out = bgra.to_vec();
    for px in out.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
    }
    out
}

const THUMB_W: u32 = 240;
const PER_ROW: u32 = 8;
const GAP: u32 = 4;

pub fn write(dir: &Path, kept: &[Kept]) -> std::io::Result<usize> {
    if kept.is_empty() {
        return Ok(0);
    }
    let fdir = dir.join("frames");
    fs::create_dir_all(&fdir)?;
    let mut index = Vec::new();
    let mut by_tag: BTreeMap<&str, Vec<&Kept>> = BTreeMap::new();
    for k in kept {
        by_tag.entry(k.tag.as_str()).or_default().push(k);
    }
    for (tag, list) in &by_tag {
        for (i, k) in list.iter().enumerate() {
            let name = format!("{tag}-{i:02}-{:.1}ms.png", k.t as f64 / 1000.0);
            write_png(&fdir.join(&name), k.w, k.h, &to_rgba(&k.bgra))?;
            index.push(json!({ "file": name, "tag": tag, "t": k.t }));
        }
        // The strip: nearest-neighbour thumbnails.
        let k0 = list[0];
        let scale = (k0.w as f64 / THUMB_W as f64).max(1.0);
        let (tw, th) = ((k0.w as f64 / scale) as u32, (k0.h as f64 / scale) as u32);
        let n = list.len() as u32;
        let cols = n.min(PER_ROW);
        let rows = n.div_ceil(PER_ROW);
        let (sw, sh) = (cols * (tw + GAP) + GAP, rows * (th + GAP) + GAP);
        let mut strip = vec![32u8; (sw * sh * 4) as usize];
        for (i, k) in list.iter().enumerate() {
            let (c, r) = (i as u32 % PER_ROW, i as u32 / PER_ROW);
            let (ox, oy) = (GAP + c * (tw + GAP), GAP + r * (th + GAP));
            for y in 0..th {
                let sy = ((y as f64 * scale) as u32).min(k.h - 1);
                for x in 0..tw {
                    let sx = ((x as f64 * scale) as u32).min(k.w - 1);
                    let s = ((sy * k.w + sx) * 4) as usize;
                    let d = (((oy + y) * sw + ox + x) * 4) as usize;
                    strip[d] = k.bgra[s + 2];
                    strip[d + 1] = k.bgra[s + 1];
                    strip[d + 2] = k.bgra[s];
                    strip[d + 3] = 255;
                }
            }
        }
        for px in strip.chunks_exact_mut(4) {
            px[3] = 255;
        }
        write_png(&fdir.join(format!("{tag}-strip.png")), sw, sh, &strip)?;
    }
    fs::write(fdir.join("index.json"), serde_json::to_string_pretty(&index)?)?;
    Ok(kept.len())
}
