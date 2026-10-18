#!/usr/bin/env node
// Import ORIGINAL Age of Mythology unit data into Age of AI.
//
//   node scripts/aom_import.mjs <proto.xml|proto.xml.xmb|Data.bar> [more files…] [--dry-run]
//
// Accepts plain XML (any edition — e.g. exported by a resource manager with
// "convert .xmb to .xml"), raw .xmb binary XML, or a .bar archive (the format
// used by the original game / Extended Edition; Retold's .bar may differ — if
// it's rejected, export to .xml and pass that).
//
// What it does: finds each Age of AI unit's counterpart in proto.xml (see
// PROTO_NAMES), reads HP, speed, line of sight, attack, damage type, range,
// rate of fire, armor, damage bonuses, cost, train time and pop, converts
// distances (meters → tiles) and writes shared/src/aom-overrides.ts. At load the
// game replaces those approximations with these values and tags them
// src:'original'. Everything NOT matched stays 'approx' and is reported.
//
// The .bar/.xmb readers are an independent implementation of the formats
// documented by github.com/ptasev/Age-of-Mythology (BarFile.cs, XmbFile.cs).
//
// ⚠ Don't commit a filled-in aom-overrides.ts to a public repo. See docs/AOM_DATA.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shared/src/aom-overrides.ts');

/** 1 AoM meter → tiles. This engine's tile is ~2 m (villager 2 tiles/s ≈ AoM ~4 m/s). */
export const METERS_PER_TILE = 2;

// ---------------------------------------------------------------- binary formats

/** zlib-wrapped file: "l33t" + uint32 length + zlib stream. */
export function decompressIfNeeded(buf) {
  if (buf.length >= 8 && buf.toString('latin1', 0, 4) === 'l33t') {
    return inflateSync(buf.subarray(8));
  }
  return buf;
}

/** XMB (binary XML) → { name, text, attrs, children } tree. */
export function parseXmb(input) {
  const buf = decompressIfNeeded(input);
  let o = 0;
  const u16 = () => { const v = buf.readUInt16LE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32LE(o); o += 4; return v; };
  const tag = (want) => {
    const t = u16();
    const s = String.fromCharCode(t & 0xff, t >> 8);
    const size = i32();
    if (s !== want) throw new Error(`XMB: expected chunk '${want}', got '${s}' at ${o - 6}`);
    return { start: o, size };
  };
  const ustr = () => { const n = i32(); const s = buf.toString('utf16le', o, o + n * 2); o += n * 2; return s; };
  const x1 = tag('X1');
  const xr = tag('XR');
  const version = buf.readUInt32LE(o); o += 4;
  void xr;
  let nodeNames = null;
  let attrNames = null;
  if (version >= 2) { const n = i32(); nodeNames = Array.from({ length: n }, ustr); }
  if (version >= 3) { const n = i32(); attrNames = Array.from({ length: n }, ustr); }
  const readNode = () => {
    const xn = tag('XN');
    const text = ustr();
    const name = version === 0 ? ustr() : nodeNames[i32()];
    if (version === 0) i32();
    if (version >= 8) i32(); // line number
    const attrs = {};
    const na = i32();
    for (let i = 0; i < na; i++) {
      const an = version === 0 ? ustr() : attrNames[i32()];
      attrs[an] = ustr();
    }
    const nc = i32();
    const children = [];
    for (let i = 0; i < nc; i++) children.push(readNode());
    if (o - xn.start !== xn.size) throw new Error(`XMB: node '${name}' size mismatch`);
    return { name, text, attrs, children };
  };
  const root = readNode();
  if (o - x1.start !== x1.size) throw new Error('XMB: file size mismatch');
  return root;
}

/** BAR archive (original/EE layout) → [{ path, data }]. */
export function readBar(buf) {
  if (buf.length < 28 || buf.readUInt32LE(0) !== 0 || buf.readUInt32LE(4) !== 0) {
    throw new Error('BAR: unrecognized header (Retold archives may use a newer layout — export to .xml instead)');
  }
  const count = buf.readInt32LE(12);
  const offsetsAt = buf.readInt32LE(20);
  if (count < 0 || count > 1e6 || offsetsAt <= 0 || offsetsAt >= buf.length) throw new Error('BAR: corrupt header');
  const headersAt = offsetsAt + count * 4;
  const out = [];
  for (let i = 0; i < count; i++) {
    let p = headersAt + buf.readInt32LE(offsetsAt + i * 4);
    const offset = buf.readInt32LE(p); p += 4;
    const size = buf.readInt32LE(p); p += 4;
    const size2 = buf.readInt32LE(p); p += 4;
    if (size2 !== size) p -= 4; // alpha-era archives have no 2nd size
    p += 8; // modified date (year u16, month, day, h, m, s, ms)
    let end = p;
    while (buf[end] !== 0) end++;
    const name = buf.toString('utf8', p, end);
    out.push({ path: name.replace(/\\/g, '/'), data: buf.subarray(offset, offset + size) });
  }
  return out;
}

// ---------------------------------------------------------------- tiny XML parser
/** Enough XML for AoM data files: elements, attributes, text, comments, CDATA. */
export function parseXml(src) {
  let i = 0;
  const root = { name: '#doc', text: '', attrs: {}, children: [] };
  const stack = [root];
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  while (i < src.length) {
    if (src[i] === '<') {
      if (src.startsWith('<!--', i)) { i = src.indexOf('-->', i) + 3; continue; }
      if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i); stack.at(-1).text += src.slice(i + 9, e); i = e + 3; continue; }
      if (src[i + 1] === '?' || src[i + 1] === '!') { i = src.indexOf('>', i) + 1; continue; }
      if (src[i + 1] === '/') { stack.pop(); i = src.indexOf('>', i) + 1; continue; }
      const end = src.indexOf('>', i);
      const raw = src.slice(i + 1, end);
      const selfClose = raw.endsWith('/');
      const body = selfClose ? raw.slice(0, -1) : raw;
      const m = /^([^\s/>]+)/.exec(body);
      const node = { name: m[1], text: '', attrs: {}, children: [] };
      for (const a of body.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decode(a[3] ?? a[4] ?? '');
      stack.at(-1).children.push(node);
      if (!selfClose) stack.push(node);
      i = end + 1;
    } else {
      const e = src.indexOf('<', i);
      const t = src.slice(i, e < 0 ? src.length : e);
      if (t.trim()) stack.at(-1).text += decode(t.trim());
      i = e < 0 ? src.length : e;
    }
  }
  return root.children.length === 1 ? root.children[0] : root;
}

// ---------------------------------------------------------------- proto mapping

/** Age of AI unit → candidate proto names (first found wins). Candidates are
 *  best-known AoM proto names; adjust if your edition's names differ — the
 *  report lists every miss. Civ units map per civ. */
export const PROTO_NAMES = {
  units: {
    minotaur: ['Minotaur'], centaur: ['Centaur'], manticore: ['Manticore'], hydra: ['Hydra'],
    colossus: ['Colossus'], chimera: ['Chimera'], sphinx: ['Sphinx'], anubite: ['Anubite'],
    scorpion_man: ['ScorpionMan', 'Scorpion Man'], mummy: ['Mummy'], avenger: ['Avenger'], phoenix: ['Phoenix'],
    valkyrie: ['Valkyrie'], einherjar: ['Einheriar', 'Einherjar'], frost_giant: ['FrostGiant', 'Frost Giant'],
    mountain_giant: ['MountainGiant', 'Mountain Giant'], fire_giant: ['FireGiant', 'Fire Giant'],
    fenris_wolf: ['FenrisWolfBrood', 'Fenris Wolf Brood', 'FenrisWolf'], shade: ['Shade'], serpent: ['Serpent'],
  },
  civUnits: {
    greek: { villager: ['VillagerGreek'], swordsman: ['Hoplite'], archer: ['Toxotes'], knight: ['Hippikon', 'Hippeus'], hero: ['HeroGreekJason', 'HeroGreekAjax', 'HeroGreekAchilles'] },
    egyptian: { villager: ['VillagerEgyptian'], swordsman: ['Spearman'], archer: ['Slinger'], knight: ['Camelry', 'CamelRider'], hero: ['Priest'] },
    norse: { villager: ['VillagerNorse'], swordsman: ['Ulfsark'], archer: ['ThrowingAxeman', 'Throwing Axeman'], knight: ['RaidingCavalry', 'Raiding Cavalry'], hero: ['HeroNorse', 'Hersir'] },
  },
};

const norm = (s) => String(s).toLowerCase().replace(/[\s_-]/g, '');
const kids = (n, name) => n.children.filter((c) => norm(c.name) === norm(name));
const kid = (n, name) => kids(n, name)[0];
const num = (n) => (n ? Number(n.text) : undefined);
const CLASS_MAP = { infantry: 'infantry', archer: 'archer', cavalry: 'cavalry', mythunit: 'myth', hero: 'hero', abstractvillager: 'villager', ship: 'ship' };
const RES_MAP = { food: 'food', wood: 'wood', gold: 'gold', favor: 'favor' };
const DMG = { hack: 0, pierce: 1, crush: 2 };

/** Extract our stat shape from one proto <unit>. Only fields present are set. */
export function extractUnit(u) {
  const out = {};
  const combat = {};
  const hp = num(kid(u, 'maxhitpoints'));
  if (hp) out.hp = hp;
  const v = num(kid(u, 'maxvelocity'));
  if (v) out.speed = +(v / METERS_PER_TILE).toFixed(3);
  const los = num(kid(u, 'los'));
  if (los) out.sight = +(los / METERS_PER_TILE).toFixed(2);
  const tp = num(kid(u, 'trainpoints'));
  if (tp) out.trainTime = tp;
  const pop = num(kid(u, 'populationcount'));
  if (pop !== undefined && !Number.isNaN(pop)) out.pop = pop;
  const cost = {};
  for (const c of kids(u, 'cost')) {
    const r = RES_MAP[norm(c.attrs.resourcetype ?? c.attrs.ResourceType ?? '')];
    if (r) cost[r] = Number(c.text);
  }
  if (Object.keys(cost).length) out.cost = cost;
  const armor = [0, 0, 0];
  let armorSeen = false;
  for (const a of kids(u, 'armor')) {
    const t = DMG[norm(a.attrs.type ?? '')];
    if (t !== undefined) { armor[t] = Number(a.attrs.value ?? a.text); armorSeen = true; }
  }
  if (armorSeen) combat.armor = armor;
  // first attack action with damage — Retold/EE style: <protoaction><name>…</name><damage>…
  const action = kids(u, 'protoaction').find((a) => kid(a, 'damage') && /attack/i.test(kid(a, 'name')?.text ?? ''));
  // original-game style (layout confirmed from Weesals/ModHQ):
  //   <action name="HandAttack"><param name="Damage" type="Hack" value1="9"/>
  //     <param name="DamageBonus" type="Cavalry" value1="2"/><param name="MaximumRange" value1="0"/></action>
  const classic = !action && kids(u, 'action').find((a) => /attack/i.test(a.attrs.name ?? '') && kids(a, 'param').some((pp) => norm(pp.attrs.name) === 'damage'));
  if (classic) {
    const params = kids(classic, 'param');
    const pv = (pp) => Number(pp.attrs.value1 ?? pp.text);
    const dmg = params.filter((pp) => norm(pp.attrs.name) === 'damage').map((pp) => ({ t: norm(pp.attrs.type ?? 'hack'), v: pv(pp) })).sort((a, b) => b.v - a.v)[0];
    if (dmg) { out.attack = dmg.v; if (dmg.t in DMG) combat.dmg = dmg.t; }
    const range = params.find((pp) => norm(pp.attrs.name) === 'maximumrange');
    if (range) out.range = Math.max(1, +(pv(range) / METERS_PER_TILE).toFixed(2));
    const rof = params.find((pp) => norm(pp.attrs.name) === 'rof');
    if (rof) out.attackCooldown = pv(rof);
    const bonus = {};
    for (const b of params.filter((pp) => norm(pp.attrs.name) === 'damagebonus')) {
      const cls = CLASS_MAP[norm(b.attrs.type ?? '')];
      if (cls) bonus[cls] = pv(b);
    }
    if (Object.keys(bonus).length) combat.bonus = bonus;
  }
  if (action) {
    const dmgNodes = kids(action, 'damage');
    const best = dmgNodes.map((d) => ({ t: norm(d.attrs.type ?? kid(action, 'damagetype')?.text ?? 'hack'), v: Number(d.text) }))
      .sort((a, b) => b.v - a.v)[0];
    if (best) { out.attack = best.v; if (best.t in DMG) combat.dmg = best.t; }
    const range = num(kid(action, 'maxrange'));
    if (range !== undefined) out.range = Math.max(1, +(range / METERS_PER_TILE).toFixed(2));
    const rof = num(kid(action, 'rof'));
    if (rof) out.attackCooldown = rof;
    const bonus = {};
    for (const b of kids(action, 'damagebonus')) {
      const cls = CLASS_MAP[norm(b.attrs.type ?? '')];
      if (cls) bonus[cls] = Number(b.text);
    }
    if (Object.keys(bonus).length) combat.bonus = bonus;
  }
  // icon paths (used by the asset pipeline to find converted PNGs)
  const icon = kid(u, 'icon')?.text;
  if (icon) out.icon = icon;
  const cls = kids(u, 'unittype').map((t) => CLASS_MAP[norm(t.text)]).find(Boolean);
  if (cls) combat.cls = cls;
  if (Object.keys(combat).length) out.combat = combat;
  return out;
}

/** Find every <unit> in a parsed proto tree, by name. */
export function indexProto(tree) {
  const map = new Map();
  const walk = (n) => {
    if (norm(n.name) === 'unit' && n.attrs.name) map.set(norm(n.attrs.name), n);
    for (const c of n.children) walk(c);
  };
  walk(tree);
  return map;
}

export function buildOverrides(protoIndex) {
  const o = { units: {}, civUnits: {} };
  const report = { matched: [], missing: [] };
  const find = (cands) => cands.map((c) => protoIndex.get(norm(c))).find(Boolean);
  for (const [ours, cands] of Object.entries(PROTO_NAMES.units)) {
    const u = find(cands);
    if (u) { const { icon: _icon, ...stats } = extractUnit(u); o.units[ours] = stats; report.matched.push(`${ours} ← ${u.attrs.name}`); } else report.missing.push(`${ours} (${cands.join('/')})`);
  }
  for (const [civ, units] of Object.entries(PROTO_NAMES.civUnits)) {
    for (const [ours, cands] of Object.entries(units)) {
      const u = find(cands);
      if (!u) { report.missing.push(`${civ}.${ours} (${cands.join('/')})`); continue; }
      const st = extractUnit(u);
      // civ flavor uses the same field names, plus the original display name
      o.civUnits[civ] ??= {};
      const { icon: _icon, ...stats } = st;
      o.civUnits[civ][ours] = { name: u.attrs.name.replace(/([a-z])([A-Z])/g, '$1 $2'), ...stats };
      report.matched.push(`${civ}.${ours} ← ${u.attrs.name}`);
    }
  }
  return { overrides: o, report };
}

// ---------------------------------------------------------------- CLI

export function loadTrees(file) {
  const buf = readFileSync(file);
  const lower = file.toLowerCase();
  if (lower.endsWith('.bar')) {
    return readBar(buf)
      .filter((e) => /(^|\/)(proto|protox|techtree|techtreex)\.xml(\.xmb)?$/i.test(e.path))
      .map((e) => ({ name: e.path, tree: e.path.toLowerCase().endsWith('.xmb') ? parseXmb(e.data) : parseXml(decompressIfNeeded(e.data).toString('utf8')) }));
  }
  if (lower.endsWith('.xmb')) return [{ name: file, tree: parseXmb(buf) }];
  return [{ name: file, tree: parseXml(decompressIfNeeded(buf).toString('utf8')) }];
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.log('usage: node scripts/aom_import.mjs <proto.xml|.xmb|Data.bar> [protox.xml …] [--dry-run]');
    process.exit(1);
  }
  const index = new Map();
  const used = [];
  for (const f of files) {
    for (const { name, tree } of loadTrees(f)) {
      const before = index.size;
      for (const [k, v] of indexProto(tree)) index.set(k, v); // later files (protox) override
      used.push(`${name} (${index.size - before} new units)`);
    }
  }
  if (index.size === 0) { console.error('No <unit> entries found — is this proto.xml?'); process.exit(2); }
  const { overrides, report } = buildOverrides(index);
  overrides.meta = { importedAt: new Date().toISOString(), files: used };
  console.log(`Read ${index.size} proto units from: ${used.join(', ')}`);
  console.log(`\nMatched ${report.matched.length}:\n  ${report.matched.join('\n  ')}`);
  if (report.missing.length) console.log(`\nNOT found (stay approximations — edit PROTO_NAMES if your edition names them differently):\n  ${report.missing.join('\n  ')}`);
  if (dry) { console.log('\n--dry-run: nothing written.'); return; }
  const body = `// ORIGINAL Age of Mythology values imported from the game files you own.
// Generated by \`node scripts/aom_import.mjs\` on ${overrides.meta.importedAt}.
// Do not commit this filled-in file to a public repository (see docs/AOM_DATA.md).
import type { AomOverrides } from './mythology';

export const AOM_OVERRIDES: AomOverrides = ${JSON.stringify(overrides, null, 2)};
`;
  writeFileSync(OUT, body);
  console.log(`\nWrote ${path.relative(ROOT, OUT)} — restart the server and rebuild the client.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
