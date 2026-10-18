#!/usr/bin/env node
// Adapt an Age of Mythology RANDOM-MAP script (.xs) into an Age of AI random-
// map definition (data/rms/<id>.json).
//
//   node tools/aom-pipeline/rm-from-xs.mjs Mediterranean.xs [--name "My Sea"] [--out data/rms]
//
// AoM random maps are PROGRAMS (XS, C-like) calling rmXxx() functions. This
// tool does not run them; it reads the script statically and maps the calls
// it understands onto an RmDef:
//   rmSetMapSize / sqrt(players*N)        → tilesPerPlayer
//   rmPlacePlayersCircular(min,max,…)     → playerRing
//   areas with rmSetAreaWaterType + size  → center sea / lakes
//   rmCreateObjectDef + rmAddObjectDefItem("Gold mine", n, …) + placement
//     (per player vs. anywhere, min/max distance) → perPlayer / scattered
//   forests (rmSetAreaForestType)         → forest clusters
// Everything else (loops, triggers, elevation, terrain painting, connections,
// classes/constraints) is listed in `notes` — review and hand-tune the output.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ITEM_RULES = [
  [/gold ?mine/i, 'gold_mine'],
  [/berr/i, 'berry_bush'],
  [/^(goat|pig|cow|chicken|sheep|deer|gazelle|boar|elk|caribou|aurochs|giraffe|zebra|hippo|rhino|elephant|walrus|bear)/i, 'sheep'],
  [/fish|salmon|perch|mahi|herring/i, 'fish'],
  [/tree/i, 'tree'],
];

/** One AoM object ≈ how many Age of AI nodes (an AoM gold mine is one big deposit). */
const COUNT_SCALE = { gold_mine: 4, stone_mine: 4, berry_bush: 1, sheep: 1, fish: 1, tree: 1 };

const num = (s, d = 0) => {
  const v = Number(String(s ?? '').trim().replace(/f$/, ''));
  return Number.isFinite(v) ? v : d;
};
const split = (args) => {
  const out = []; let depth = 0; let cur = ''; let q = false;
  for (const ch of args) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

export function adaptXs(src, opts = {}) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const calls = [];
  for (const m of code.matchAll(/(?:(?:int|float)\s+)?(\w+)\s*=\s*(rm\w+)\s*\(([^;]*)\)\s*;|(rm\w+)\s*\(([^;]*)\)\s*;/g)) {
    calls.push(m[2] ? { lhs: m[1], fn: m[2], args: split(m[3]) } : { lhs: null, fn: m[4], args: split(m[5]) });
  }
  const notes = [];
  const used = new Set();
  const def = {
    id: opts.id, name: opts.name, desc: `Adapted from the AoM random-map script ${opts.file ?? ''}`.trim(),
    origin: 'adapted', tilesPerPlayer: 3600, minSize: 96, maxSize: 200, playerRing: 0.7,
    water: [], forests: { clusters: 12, minSize: 7, maxSize: 12, avoidPlayers: 12 },
    perPlayer: [], scattered: [], notes,
  };
  // numeric constants declared in the script (int playerTiles = 9000;)
  const consts = new Map();
  for (const m of code.matchAll(/(?:int|float)\s+(\w+)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/g)) consts.set(m[1], num(m[2]));
  const val = (tok) => (consts.has(tok) ? consts.get(tok) : num(tok, NaN));
  // map size: size(m) = M * sqrt(cNumberNonGaiaPlayers * N); AoM rmSetMapSize is in
  // meters (2 m per tile), so tiles² per player = (M/2)² * N.
  const sizeExpr = code.match(/(?:(\d+(?:\.\d+)?)\s*\*\s*)?sqrt\s*\(\s*cNumberNonGaiaPlayers\s*\*\s*(\w+(?:\.\d+)?)\s*\)/);
  if (sizeExpr && Number.isFinite(val(sizeExpr[2]))) {
    const aomTilesPerPlayer = ((num(sizeExpr[1], 1) / 2) ** 2) * val(sizeExpr[2]);
    // AoM maps are roughly 2.5x the area per player of this game's maps
    def.tilesPerPlayer = Math.round(Math.min(5200, Math.max(2600, aomTilesPerPlayer * 0.4)));
    notes.push(`map size: ${Math.round(aomTilesPerPlayer)} AoM tiles/player scaled to ${def.tilesPerPlayer}`);
    used.add('rmSetMapSize');
  } else notes.push('map size formula not recognized — using 3600 tiles per player');

  const objs = new Map(); // var -> {items:[{type,count}], min, max}
  const areas = new Map(); // var -> {size, water, forest}
  for (const c of calls) {
    switch (c.fn) {
      case 'rmPlacePlayersCircular':
        def.playerRing = Math.min(0.85, Math.max(0.45, (num(c.args[0], 0.35) + num(c.args[1], 0.4)) / 2 * 2));
        used.add(c.fn); break;
      case 'rmCreateObjectDef':
        if (c.lhs) objs.set(c.lhs, { items: [], min: 0, max: 40 });
        used.add(c.fn); break;
      case 'rmAddObjectDefItem': {
        const o = objs.get(c.args[0]);
        const name = (c.args[1] ?? '').replace(/"/g, '');
        const rule = ITEM_RULES.find(([re]) => re.test(name));
        if (o && rule) o.items.push({ type: rule[1], count: Math.max(1, Math.round(num(c.args[2], 1) * (COUNT_SCALE[rule[1]] ?? 1))) });
        else if (o) notes.push(`object item "${name}" has no Age of AI counterpart`);
        used.add(c.fn); break;
      }
      case 'rmSetObjectDefMinDistance': { const o = objs.get(c.args[0]); if (o) o.min = num(c.args[1]) / 2; used.add(c.fn); break; }
      case 'rmSetObjectDefMaxDistance': { const o = objs.get(c.args[0]); if (o) o.max = num(c.args[1]) / 2; used.add(c.fn); break; }
      case 'rmPlaceObjectDefPerPlayer': {
        const o = objs.get(c.args[0]);
        const n = Math.max(1, Math.round(num(c.args[2], 1)));
        if (o) for (const it of o.items) {
          def.perPlayer.push({ type: it.type, clusters: n, count: it.count, minDist: Math.max(3, o.min), maxDist: Math.max(o.min + 2, Math.min(40, o.max)) });
        }
        used.add(c.fn); break;
      }
      case 'rmPlaceObjectDefAtLoc': {
        const o = objs.get(c.args[0]);
        const n = Math.max(1, Math.round(num(c.args[4], 1)));
        if (o) for (const it of o.items) def.scattered.push({ type: it.type, clusters: n, count: it.count, avoidPlayers: Math.max(10, o.min) });
        used.add(c.fn); break;
      }
      case 'rmCreateArea':
        if (c.lhs) areas.set(c.lhs, { size: 0, water: false, forest: false, loc: null });
        used.add(c.fn); break;
      case 'rmSetAreaSize': { const a = areas.get(c.args[0]); if (a) a.size = (num(c.args[1]) + num(c.args[2] ?? c.args[1])) / 2; used.add(c.fn); break; }
      case 'rmSetAreaWaterType': { const a = areas.get(c.args[0]); if (a) a.water = true; used.add(c.fn); break; }
      case 'rmSetAreaForestType': { const a = areas.get(c.args[0]); if (a) a.forest = true; used.add(c.fn); break; }
      case 'rmSetAreaLocation': { const a = areas.get(c.args[0]); if (a) a.loc = [num(c.args[1]), num(c.args[2])]; used.add(c.fn); break; }
      default: break;
    }
  }
  for (const [, a] of areas) {
    if (a.water) {
      const central = a.loc && Math.hypot(a.loc[0] - 0.5, a.loc[1] - 0.5) < 0.15;
      if (central && a.size > 0.05) def.water.push({ kind: 'center', radius: Math.min(0.6, Math.sqrt(a.size / Math.PI) * 2), fish: 10 });
      else def.water.push({ kind: 'lakes', count: 1, minSize: Math.max(10, Math.round(a.size * 4000)), maxSize: Math.max(14, Math.round(a.size * 6000)), avoidPlayers: 12 });
    }
  }
  const forestAreas = [...areas.values()].filter((a) => a.forest).length;
  if (forestAreas) def.forests.clusters = Math.min(30, Math.max(6, forestAreas));
  // merge identical lakes
  const lakes = def.water.filter((w) => w.kind === 'lakes');
  if (lakes.length > 1) {
    def.water = def.water.filter((w) => w.kind !== 'lakes');
    def.water.push({ kind: 'lakes', count: lakes.length, minSize: Math.min(...lakes.map((l) => l.minSize)), maxSize: Math.max(...lakes.map((l) => l.maxSize)), avoidPlayers: 12, fish: 4 });
  }
  if (!def.perPlayer.length) {
    notes.push('no per-player objects recognized — using a standard start (berries, gold, sheep, trees)');
    def.perPlayer = [
      { type: 'berry_bush', clusters: 1, count: 6, minDist: 5, maxDist: 8 },
      { type: 'gold_mine', clusters: 1, count: 4, minDist: 7, maxDist: 12 },
      { type: 'sheep', clusters: 1, count: 4, minDist: 4, maxDist: 7 },
      { type: 'tree', clusters: 2, count: 8, minDist: 6, maxDist: 10 },
    ];
  }
  // AoM has no stone: keep the Age of AI economy working
  def.perPlayer.push({ type: 'stone_mine', clusters: 1, count: 4, minDist: 8, maxDist: 13 });
  notes.push('added a stone mine per player (AoM has no stone)');
  const unsupported = [...new Set(calls.map((c) => c.fn).filter((f) => !used.has(f)))];
  if (unsupported.length) notes.push(`ignored ${unsupported.length} rm functions: ${unsupported.slice(0, 20).join(', ')}${unsupported.length > 20 ? '…' : ''}`);
  if (/\bfor\s*\(|\bwhile\s*\(/.test(code)) notes.push('script uses loops — repeated placements were read once; check counts');
  return def;
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => a.endsWith('.xs'));
  if (!file) { console.log('usage: node tools/aom-pipeline/rm-from-xs.mjs <map.xs> [--name "Name"] [--out data/rms]'); process.exit(1); }
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const base = path.basename(file, '.xs');
  const name = opt('--name') ?? `${base} (adapted)`;
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const def = adaptXs(readFileSync(file, 'utf8'), { id, name, file: path.basename(file) });
  const out = opt('--out') ?? path.join(ROOT, 'data/rms');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${id}.json`), JSON.stringify(def, null, 2));
  console.log(`Wrote ${path.join(path.relative(process.cwd(), out), `${id}.json`)}`);
  for (const n of def.notes) console.log(`  • ${n}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
