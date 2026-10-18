#!/usr/bin/env node
// Convert an AoM Retold scenario (exported to XML by CryBar:
//   crybar convert scenario-to-xml MyMap.mythscn -o MyMap.xml)
// into an Age of AI map: data/maps/<name>.json (ScenarioMap).
//
//   node tools/aom-pipeline/scenario-to-map.mjs MyMap.xml [--name "My Map"] [--cliff 2.2] [--no-stone] [--out data/maps]
//
// What converts automatically:
//   map size · water (WT water-type layer) · cliffs (steep slopes of the
//   heightmap → impassable rock; this renderer is flat) · player start
//   positions (each player's Town Center, else the centroid of its units) ·
//   trees, gold mines, berries, fish, herdable/huntable animals (→ sheep) ·
//   player villagers and Town Centers.
// What doesn't (reported): triggers, cinematics, decorative objects, AoM-only
// units/buildings without an Age of AI counterpart, terrain textures, elevation.
// AoM has no stone, so a small stone mine is added near each start (--no-stone
// to skip).
//
// Original-game .scn/.scx scenarios are NOT supported: the public tools only
// decompress them; their internal format isn't documented.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXml, decompressIfNeeded } from '../../scripts/aom_import.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** AoM proto name → Age of AI object (resources) — by pattern, first match wins. */
export const OBJECT_RULES = [
  [/^(tree|.*tree$|tree[a-z])/i, 'tree'],
  [/gold ?mine/i, 'gold_mine'],
  [/berr(y|ies)/i, 'berry_bush'],
  [/^fish|salmon|perch|mahi|herring|tuna|shark/i, 'fish'],
  [/^(goat|pig|cow|chicken|sheep|deer|gazelle|boar|elk|caribou|aurochs|giraffe|zebra|hippo|rhino|elephant|walrus|bear|monkey|crowned ?crane)/i, 'sheep'],
];
/** AoM proto name → Age of AI player unit/building. */
export const PLAYER_RULES = [
  [/^(town ?center|settlementlevel)/i, 'building', 'town_center'],
  [/^villager|^gatherer|^laborer|^ox ?cart/i, 'unit', 'villager'],
  [/^(hoplite|spearman|ulfsark)/i, 'unit', 'swordsman'],
  [/^(toxotes|slinger|throwing ?axeman)/i, 'unit', 'archer'],
  [/^(hippikon|hippeus|camelry|camel ?rider|raiding ?cavalry)/i, 'unit', 'knight'],
  [/^house/i, 'building', 'house'],
  [/^temple/i, 'building', 'temple'],
];

const b64floats = (s) => {
  const buf = Buffer.from((s ?? '').trim(), 'base64');
  const out = new Float32Array(Math.floor(buf.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
};

function walk(n, fn) { fn(n); for (const c of n.children ?? []) walk(c, fn); }
function find(n, pred) { let r = null; walk(n, (x) => { if (!r && pred(x)) r = x; }); return r; }

export function convertScenarioXml(xml, opts = {}) {
  const tree = typeof xml === 'string' ? parseXml(xml) : xml;
  const notes = [];
  const sizeEl = find(tree, (n) => n.name === 'MapSize');
  if (!sizeEl) throw new Error('No <MapSize> — is this a CryBar scenario-to-xml export?');
  const W = Number(sizeEl.attrs.x);
  const H = Number(sizeEl.attrs.z);
  if (!(W > 0 && H > 0)) throw new Error('bad MapSize');
  const size = Math.max(W, H);
  if (size > 256) throw new Error(`map is ${W}x${H}; Age of AI supports up to 256x256`);
  if (W !== H) notes.push(`non-square map ${W}x${H} padded to ${size}x${size}`);

  // heights per vertex ((W+1) x (H+1)) → slope per tile
  const heights = b64floats(find(tree, (n) => n.name === 'Heights')?.text);
  const tiles = new Array(size * size).fill('.');
  const cliffSlope = opts.cliff ?? 2.2;
  let cliffs = 0;
  if (heights.length >= (W + 1) * (H + 1)) {
    const hv = (x, z) => heights[z * (W + 1) + x];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const c = [hv(x, z), hv(x + 1, z), hv(x, z + 1), hv(x + 1, z + 1)];
      if (Math.max(...c) - Math.min(...c) > cliffSlope) { tiles[z * size + x] = '^'; cliffs++; }
    }
  } else {
    notes.push('no usable heightmap: map converted flat (no cliffs)');
  }
  // water type per tile (u32 count + u8[]; 255 = no water)
  const wt = find(tree, (n) => n.name === 'WT');
  let water = 0;
  if (wt?.text) {
    const buf = Buffer.from(wt.text.trim(), 'base64');
    const count = buf.length >= 4 ? buf.readUInt32LE(0) : 0;
    const types = buf.subarray(4, 4 + count);
    if (types.length >= W * H) {
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
        if (types[z * W + x] !== 255) { tiles[z * size + x] = '~'; water++; }
      }
    } else notes.push(`water layer has ${types.length} entries for ${W * H} tiles — ignored`);
  } else {
    notes.push('no water layer found');
  }

  // proto name table: the first TM/PT list of <E> names
  const tm = find(tree, (n) => (n.name === 'TM' || n.name === 'PT') && n.children.some((c) => c.name === 'E'));
  const protoNames = tm ? tm.children.filter((c) => c.name === 'E').map((c) => c.text) : [];
  if (!protoNames.length) notes.push('no proto name table (TM/PT) — objects cannot be identified');

  const objects = [];
  const playerEnts = new Map(); // player -> {tcs:[], units:[]}
  const dropped = new Map();
  const ents = [];
  walk(tree, (n) => { if (n.attrs && 'protoIndex' in n.attrs && 'x' in n.attrs && 'z' in n.attrs) ents.push(n); });
  for (const e of ents) {
    const name = protoNames[Number(e.attrs.protoIndex)] ?? '?';
    const x = Number(e.attrs.x) / 2; // AoMR stores half-tile units
    const y = Number(e.attrs.z) / 2;
    const player = Number(e.attrs.player ?? 0);
    if (!(x >= 0 && y >= 0 && x < size && y < size)) continue;
    if (player > 0) {
      const rule = PLAYER_RULES.find(([re]) => re.test(name));
      const pe = playerEnts.get(player) ?? { tcs: [], units: [], buildings: [] };
      playerEnts.set(player, pe);
      pe.units.push({ x, y, type: rule?.[1] === 'unit' ? rule[2] : null });
      if (rule?.[2] === 'town_center') pe.tcs.push({ x, y });
      else if (rule?.[1] === 'building') pe.buildings.push({ x, y, type: rule[2] });
      if (!rule) dropped.set(name, (dropped.get(name) ?? 0) + 1);
      continue;
    }
    const rule = OBJECT_RULES.find(([re]) => re.test(name));
    if (rule) objects.push({ type: rule[1], x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    else dropped.set(name, (dropped.get(name) ?? 0) + 1);
  }

  // starts: each player's TC (or centroid of its entities), ordered by player id
  const starts = [];
  const buildings = [];
  const units = [];
  for (const [pid, pe] of [...playerEnts.entries()].sort((a, b) => a[0] - b[0])) {
    const s = pe.tcs[0] ?? { x: pe.units.reduce((a, u) => a + u.x, 0) / pe.units.length, y: pe.units.reduce((a, u) => a + u.y, 0) / pe.units.length };
    const idx = starts.length;
    starts.push({ x: Math.round(Math.min(size - 4, Math.max(3, s.x))), y: Math.round(Math.min(size - 4, Math.max(3, s.y))) });
    if (pe.tcs[0]) buildings.push({ start: idx, type: 'town_center', x: pe.tcs[0].x, y: pe.tcs[0].y });
    for (const b of pe.buildings) buildings.push({ start: idx, ...b });
    for (const u of pe.units) if (u.type) units.push({ start: idx, type: u.type, x: u.x, y: u.y });
    void pid;
  }
  if (!starts.length) throw new Error('no player-owned entities: cannot find start positions');
  if (opts.stone !== false) {
    for (const s of starts) {
      const a = Math.atan2(size / 2 - s.y, size / 2 - s.x) + 0.9;
      for (let k = 0; k < 4; k++) objects.push({ type: 'stone_mine', x: Math.round(s.x + Math.cos(a) * 9) + (k % 2), y: Math.round(s.y + Math.sin(a) * 9) + (k >> 1) });
    }
    notes.push('added 4 stone mines per start (AoM has no stone)');
  }
  // keep start areas dry/passable
  for (const s of starts) for (let y = s.y - 3; y <= s.y + 3; y++) for (let x = s.x - 3; x <= s.x + 3; x++) {
    if (x >= 0 && y >= 0 && x < size && y < size) tiles[y * size + x] = '.';
  }
  if (dropped.size) notes.push(`dropped ${[...dropped.values()].reduce((a, b) => a + b, 0)} objects without a counterpart: ${[...dropped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}×${c}`).join(', ')}`);
  notes.push(`${water} water tiles, ${cliffs} cliff tiles, ${objects.length} resources, ${starts.length} starts`);

  return {
    format: 'ageofai-map', version: 1,
    name: opts.name ?? 'Imported scenario',
    desc: `Converted from an Age of Mythology scenario (${starts.length} players).`,
    size, tiles: tiles.join(''), starts, objects, buildings, units,
    source: { tool: 'scenario-to-map', file: opts.file, notes },
  };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && !/^\d/.test(a) && args[args.indexOf(a) - 1] !== '--name' && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--cliff');
  if (!file) {
    console.log('usage: node tools/aom-pipeline/scenario-to-map.mjs <scenario.xml> [--name "Name"] [--cliff 2.2] [--no-stone] [--out data/maps]');
    process.exit(1);
  }
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const name = opt('--name') ?? path.basename(file).replace(/\.(xml|mythscn)$/i, '');
  const out = opt('--out') ?? path.join(ROOT, 'data/maps');
  const map = convertScenarioXml(decompressIfNeeded(readFileSync(file)).toString('utf8'), {
    name, file: path.basename(file), cliff: opt('--cliff') ? Number(opt('--cliff')) : undefined, stone: !args.includes('--no-stone'),
  });
  mkdirSync(out, { recursive: true });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'scenario';
  const dest = path.join(out, `${id}.json`);
  writeFileSync(dest, JSON.stringify(map));
  console.log(`Wrote ${path.relative(process.cwd(), dest)} (${map.size}x${map.size}, ${map.starts.length} players)`);
  for (const n of map.source.notes) console.log(`  • ${n}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
