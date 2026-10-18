// Runtime loader for assets converted from YOUR copy of Age of Mythology by
// tools/aom-pipeline (never shipped with the game). Everything is optional:
// with no /aom/manifest.json the game uses its original placeholder art.
//
// Manifest (written by tools/aom-pipeline/ingest.mjs):
// {
//   "version": 1,
//   "icons":   { "unit": { "swordsman": { "greek": "icons/…png", "*": "…" } }, "building": {…}, "tech": {…} },
//   "sprites": { "minotaur": { "*": "sprites/minotaur.json" }, "swordsman": { "greek": "…" } }
// }
// Sprite sheet JSON: see SpriteSheetMeta.

import type { UnitType } from '@age/shared';

export type AnimName = 'idle' | 'walk' | 'attack' | 'gather' | 'death';

export interface SpriteAnim {
  /** Row index of direction 0; directions follow in consecutive rows. */
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
}

export interface SpriteSheetMeta {
  image: string;
  /** Grayscale player-color mask, same layout as `image` (optional). */
  mask?: string;
  frameW: number;
  frameH: number;
  /** Ground contact point inside a frame, in px. */
  anchorX: number;
  anchorY: number;
  /** Directions per animation (8 = every 45°, starting facing screen-down, clockwise). */
  dirs: number;
  /** World height the frame represents, in tiles (for scaling to the zoom). */
  tilesTall: number;
  anims: Partial<Record<AnimName, SpriteAnim>>;
}

export interface LoadedSheet {
  meta: SpriteSheetMeta;
  img: HTMLImageElement;
  mask?: HTMLImageElement;
  /** Tinted mask per player color (lazy). */
  tinted: Map<string, HTMLCanvasElement>;
}

interface Manifest {
  version: number;
  icons?: Record<string, Record<string, Record<string, string>>>;
  sprites?: Record<string, Record<string, string>>;
}

const BASE = '/aom/';
let manifest: Manifest | null = null;
const sheets = new Map<string, LoadedSheet | 'loading' | 'failed'>();

/** Fetch the manifest once at boot. Missing = no imported assets (normal). */
export async function loadAomAssets(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return false;
    const m = (await res.json()) as Manifest;
    if (!m || m.version !== 1) return false;
    manifest = m;
    return true;
  } catch {
    return false;
  }
}

export function hasAomAssets(): boolean {
  return manifest !== null;
}

function pick(table: Record<string, string> | undefined, civ?: string): string | undefined {
  if (!table) return undefined;
  return (civ && table[civ]) || table['*'];
}

/** URL of an imported icon, or undefined (use the emoji placeholder). */
export function aomIcon(kind: 'unit' | 'building' | 'tech' | 'god' | 'power', id: string, civ?: string): string | undefined {
  const rel = pick(manifest?.icons?.[kind]?.[id], civ);
  return rel ? BASE + rel : undefined;
}

/** Loaded sprite sheet for a unit (kicks off loading on first request). */
export function aomSprite(type: UnitType, civ?: string): LoadedSheet | undefined {
  const rel = pick(manifest?.sprites?.[type], civ);
  if (!rel) return undefined;
  const cached = sheets.get(rel);
  if (cached === 'loading' || cached === 'failed') return undefined;
  if (cached) return cached;
  sheets.set(rel, 'loading');
  void (async () => {
    try {
      const meta = (await (await fetch(BASE + rel)).json()) as SpriteSheetMeta;
      const dir = rel.slice(0, rel.lastIndexOf('/') + 1);
      const img = await loadImg(BASE + dir + meta.image);
      const mask = meta.mask ? await loadImg(BASE + dir + meta.mask) : undefined;
      sheets.set(rel, { meta, img, mask, tinted: new Map() });
    } catch {
      sheets.set(rel, 'failed');
    }
  })();
  return undefined;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = src;
  });
}

/** Mask tinted with a player color (cached per color). */
export function tintedMask(s: LoadedSheet, color: string): HTMLCanvasElement | undefined {
  if (!s.mask) return undefined;
  let c = s.tinted.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = s.mask.width;
  c.height = s.mask.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(s.mask, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(s.mask, 0, 0);
  s.tinted.set(color, c);
  return c;
}

/** 8-way direction index from a movement/facing vector in WORLD tiles.
 *  0 = toward the camera (screen-down), increasing clockwise on screen. */
export function dirIndex(dx: number, dy: number, dirs: number): number {
  // world -> screen (dimetric 2:1): sx = dx - dy, sy = (dx + dy) / 2
  const sx = dx - dy;
  const sy = (dx + dy) / 2;
  if (Math.abs(sx) + Math.abs(sy) < 1e-6) return 0;
  const ang = Math.atan2(-sx, sy); // 0 = screen-down, clockwise
  const step = (Math.PI * 2) / dirs;
  return ((Math.round(ang / step) % dirs) + dirs) % dirs;
}
