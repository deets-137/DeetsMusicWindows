// The user's own files a rule may use (RULEZ.md §5): pictures for the Glass canvas and short
// sound clips. The window's half of user_files.rs: one cached list, the add / rename / delete
// calls, and the link a file is read through. A rule names a file's id, never a path.
//
// A picture is resized and read for its aurora colors on this side (wallpaper.ts did that
// for the one old picture; the same code), then saved as JPEG. A sound is checked for its
// length after a decode (5 s at most) and saved as chosen.

import { invoke } from "@tauri-apps/api/core";
import { setSetting } from "./settings-store";
import { decodeClip } from "./sound";
import { paletteFromPixels, type AlbumPalette } from "./album-slots";
import { toast } from "./toast";
import * as diag from "./diag";
import { TELEMETRY } from "./telemetry-on";

/** A picture is kept at most this long on its long side (COVER-WALLPAPER.md §8). */
const PICTURE_MAX = 2560;
/** The picture's colors are read from a copy this small. */
const COLOR_PX = 48;

/** Read, resize and color-sample a picture file: a JPEG data URL and its aurora palette.
 *  Rejects with `not-an-image` when the browser cannot decode it. */
export function readPicture(file: File): Promise<{ dataUrl: string; colors: AlbumPalette; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, PICTURE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext("2d");
      const small = document.createElement("canvas");
      small.width = small.height = COLOR_PX;
      const sctx = small.getContext("2d", { willReadFrequently: true });
      if (!ctx || !sctx) return reject(new Error("no-canvas"));
      ctx.drawImage(img, 0, 0, c.width, c.height);
      sctx.drawImage(img, 0, 0, COLOR_PX, COLOR_PX);
      const colors = paletteFromPixels(sctx.getImageData(0, 0, COLOR_PX, COLOR_PX).data);
      resolve({ dataUrl: c.toDataURL("image/jpeg", 0.9), colors, w: c.width, h: c.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not-an-image"));
    };
    img.src = url;
  });
}

export type FileKind = "picture" | "sound";
export interface UserFile {
  id: string;
  kind: FileKind;
  name: string;
  ext: string;
  bytes: number;
  added: number;
}

/** A clip may be this long (his call, RULEZ.md §5.1). */
export const MAX_CLIP_S = 5;
const MAX_SOUND_BYTES = 2_000_000;

let files: UserFile[] = [];
let loaded: Promise<UserFile[]> | null = null;
const subs = new Set<() => void>();

const publish = () => subs.forEach((cb) => cb());

/** Every file, oldest first, from the cache (empty until `loadFiles` has answered once). */
export const userFiles = (kind?: FileKind): UserFile[] => (kind ? files.filter((f) => f.kind === kind) : files);
export const userFile = (id: string): UserFile | undefined => files.find((f) => f.id === id);
/** `http://files.localhost/<id>`: the file, immutable under its id. */
export const fileUrl = (id: string): string => `http://files.localhost/${id}`;

/** Hear the list change (an add, a rename, a delete, the first load). */
export function onFilesChange(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Read the list once (later calls share it). The first read after the update takes the old
 *  wallpaper in as "My picture" and points the canvas at it, so a chosen picture survives. */
export function loadFiles(): Promise<UserFile[]> {
  if (loaded) return loaded;
  loaded = invoke<{ files: UserFile[]; migrated: UserFile | null }>("user_files_list")
    .then((r) => {
      files = r.files;
      if (r.migrated) {
        setSetting("glassPictureId", r.migrated.id);
        diag.log("files:migrated", { id: r.migrated.id });
      }
      publish();
      return files;
    })
    .catch((e) => {
      console.error("[files] list", e);
      loaded = null;
      return files;
    });
  return loaded;
}

const extOf = (file: File): string => file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
const nameOf = (file: File): string => (file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name).trim() || "Untitled";

function base64Of(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function save(kind: FileKind, name: string, ext: string, data: string, colors?: unknown): Promise<UserFile> {
  const r = await invoke<UserFile>("user_files_add", { kind, name, ext, data, colors: colors ?? null });
  files = [...files, r];
  publish();
  diag.log("files:add", { id: r.id, kind, kb: Math.round(r.bytes / 1024) });
  return r;
}

/** Resize, read the colors and save a picture the user chose. Resolves to its record. */
export async function addPicture(file: File): Promise<UserFile | null> {
  try {
    const p = await readPicture(file);
    const data = p.dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    diag.log("wallpaper:picture", { w: p.w, h: p.h });
    return await save("picture", nameOf(file), "jpg", data, p.colors);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    diag.warn("files:refused", { kind: "picture", why });
    toast({ kind: "warn", text: why === "not-an-image" ? `“${file.name}” is not an image DeetsMusic can read.` : "Couldn't save the picture." });
    return null;
  }
}

/** Check and save a sound clip the user chose (5 s and 2 MB at most). Resolves to its record. */
export async function addSound(file: File): Promise<UserFile | null> {
  if (file.size > MAX_SOUND_BYTES) {
    toast({ kind: "warn", text: `“${file.name}” is too large. A sound can be 2 MB at most.` });
    return null;
  }
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await decodeClip(bytes.slice(0));
    if (buffer.duration > MAX_CLIP_S) {
      toast({ kind: "warn", text: `“${file.name}” is ${Math.round(buffer.duration)} s long. A sound can be ${MAX_CLIP_S} s at most.` });
      diag.warn("files:refused", { kind: "sound", why: "long", s: Math.round(buffer.duration) });
      return null;
    }
    return await save("sound", nameOf(file), extOf(file) || "bin", base64Of(bytes));
  } catch (e) {
    diag.warn("files:refused", { kind: "sound", why: e instanceof Error ? e.message : String(e) });
    toast({ kind: "warn", text: `“${file.name}” is not a sound DeetsMusic can play.` });
    return null;
  }
}

export async function renameFile(id: string, name: string): Promise<void> {
  files = await invoke<UserFile[]>("user_files_rename", { id, name });
  publish();
}

export async function deleteFile(id: string): Promise<void> {
  files = await invoke<UserFile[]>("user_files_delete", { id });
  publish();
  diag.log("files:delete", { id });
}

// DevTools, telemetry builds only (like `__rules`, `__sound`): the desk tests add a file without
// the native picker (a File made on the page), and read the list.
if (TELEMETRY) (window as unknown as { __files: unknown }).__files = { list: () => userFiles(), addPicture, addSound, rename: renameFile, delete: deleteFile };

/** The picker: choose a file of one kind from the PC; resolves to the record, or null. */
export function pickFile(kind: FileKind): Promise<UserFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "picture" ? "image/*" : "audio/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      void (kind === "picture" ? addPicture(file) : addSound(file)).then(resolve);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
