// Importer test with SYNTHETIC files (no original game data in this repo):
// writes XMB + BAR to the documented formats, then imports them.
// Proves the readers and the mapping; real files are still unverified.
// Roda: npx tsx scripts/aom_import_test.ts
import { deflateSync } from 'node:zlib';
// @ts-expect-error plain .mjs script
import { buildOverrides, decompressIfNeeded, extractUnit, indexProto, parseXml, parseXmb, readBar, METERS_PER_TILE } from './aom_import.mjs';
import { applyOverrides, COMBAT, CIVS, UNIT_DEFS, unitStats } from '@age/shared';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };

const PROTO = `<?xml version="1.0"?>
<!-- synthetic sample, NOT original data -->
<proto version="4">
  <unit id="1" name="Hoplite">
    <maxhitpoints>120</maxhitpoints><maxvelocity>4.4</maxvelocity><los>16</los>
    <trainpoints>11</trainpoints><populationcount>1</populationcount>
    <cost resourcetype="Food">55</cost><cost resourcetype="Gold">35</cost>
    <armor type="Hack" value="0.4"/><armor type="Pierce" value="0.3"/><armor type="Crush" value="0.05"/>
    <unittype>Infantry</unittype>
    <protoaction><name>HandAttack</name><damage type="Hack">9</damage><maxrange>0</maxrange><rof>1.5</rof>
      <damagebonus type="Cavalry">2.5</damagebonus></protoaction>
  </unit>
  <unit id="2" name="Minotaur">
    <maxhitpoints>480</maxhitpoints><maxvelocity>3.5</maxvelocity>
    <cost resourcetype="Food">160</cost><cost resourcetype="Favor">16</cost>
    <unittype>MythUnit</unittype>
    <protoaction><name>HandAttack</name><damage type="Hack">17</damage><rof>2</rof></protoaction>
  </unit>
</proto>`;

// ---- XMB writer (test only) ----
function writeXmb(tree: { name: string; text: string; attrs: Record<string, string>; children: unknown[] }): Buffer {
  const nodeNames: string[] = []; const attrNames: string[] = [];
  const collect = (n: typeof tree): void => {
    if (!nodeNames.includes(n.name)) nodeNames.push(n.name);
    for (const a of Object.keys(n.attrs)) if (!attrNames.includes(a)) attrNames.push(a);
    for (const c of n.children as (typeof tree)[]) collect(c);
  };
  collect(tree);
  const i32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
  const ustr = (s: string): Buffer => Buffer.concat([i32(s.length), Buffer.from(s, 'utf16le')]);
  const chunk = (tag: string, body: Buffer): Buffer => {
    const h = Buffer.alloc(6); h.writeUInt16LE(tag.charCodeAt(0) | (tag.charCodeAt(1) << 8)); h.writeInt32LE(body.length, 2);
    return Buffer.concat([h, body]);
  };
  const node = (n: typeof tree): Buffer => chunk('XN', Buffer.concat([
    ustr(n.text), i32(nodeNames.indexOf(n.name)), i32(0), i32(Object.keys(n.attrs).length),
    ...Object.entries(n.attrs).flatMap(([k, v]) => [i32(attrNames.indexOf(k)), ustr(v)]),
    i32(n.children.length), ...(n.children as (typeof tree)[]).map(node),
  ]));
  const ver = Buffer.alloc(4); ver.writeUInt32LE(8);
  return chunk('X1', Buffer.concat([chunk('XR', ver), i32(nodeNames.length), ...nodeNames.map(ustr), i32(attrNames.length), ...attrNames.map(ustr), node(tree)]));
}
function l33t(b: Buffer): Buffer {
  const h = Buffer.alloc(8); h.write('l33t', 0, 'latin1'); h.writeInt32LE(b.length, 4);
  return Buffer.concat([h, deflateSync(b)]);
}
// ---- BAR writer (original/EE layout, test only) ----
function writeBar(entries: { path: string; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(28);
  let dataOff = 28;
  const datas = entries.map((e) => { const o = dataOff; dataOff += e.data.length; return o; });
  const recs = entries.map((e, i) => {
    const r = Buffer.alloc(20);
    r.writeInt32LE(datas[i], 0); r.writeInt32LE(e.data.length, 4); r.writeInt32LE(e.data.length, 8);
    r.writeUInt16LE(2004, 12); r[14] = 1; r[15] = 1;
    return Buffer.concat([r, Buffer.from(e.path.replace(/\//g, '\\') + '\0', 'utf8')]);
  });
  const offsetsAt = dataOff;
  let rel = 0;
  const offsets = Buffer.concat(recs.map((r) => { const b = Buffer.alloc(4); b.writeInt32LE(rel); rel += r.length; return b; }));
  header.writeInt32LE(entries.length, 12); header.writeInt32LE(recs.reduce((a, r) => a + r.length, 0), 16);
  header.writeInt32LE(offsetsAt, 20); header.writeInt32LE(8, 24);
  return Buffer.concat([header, ...entries.map((e) => e.data), offsets, ...recs]);
}

const xmlTree = parseXml(PROTO);
check('XML parser reads <proto> with 2 units', xmlTree.name === 'proto' && indexProto(xmlTree).size === 2);
const xmb = writeXmb(xmlTree);
const fromXmb = parseXmb(xmb);
check('XMB round-trip preserves the tree', JSON.stringify(fromXmb) === JSON.stringify(xmlTree));
check('l33t-compressed XMB decodes', JSON.stringify(parseXmb(l33t(xmb))) === JSON.stringify(xmlTree));
check('decompressIfNeeded passes plain data through', decompressIfNeeded(Buffer.from('abc')).toString() === 'abc');
const bar = writeBar([{ path: 'data/readme.txt', data: Buffer.from('hi') }, { path: 'data/proto.xml.xmb', data: l33t(xmb) }]);
const entries = readBar(bar);
check('BAR lists entries with paths', entries.length === 2 && entries[1].path === 'data/proto.xml.xmb');
check('BAR entry data decodes to the proto', indexProto(parseXmb(entries[1].data)).has('minotaur'));
let threw = false; try { readBar(Buffer.from('BARX'.repeat(10))); } catch { threw = true; }
check('unknown BAR layout is rejected with a clear error', threw);

const hop = extractUnit(indexProto(xmlTree).get('hoplite'));
check(`speed/LOS converted meters→tiles (÷${METERS_PER_TILE})`, hop.speed === 2.2 && hop.sight === 8);
check('cost, train time, HP, attack, rof read', hop.cost.food === 55 && hop.cost.gold === 35 && hop.trainTime === 11 && hop.hp === 120 && hop.attack === 9 && hop.attackCooldown === 1.5);
check('armor % per damage type + damage bonus vs cavalry', JSON.stringify(hop.combat.armor) === '[0.4,0.3,0.05]' && hop.combat.bonus.cavalry === 2.5 && hop.combat.dmg === 'hack');
check('melee range clamps to 1 tile', hop.range === 1);

const { overrides, report } = buildOverrides(indexProto(xmlTree));
check('report lists matches and misses', report.matched.includes('greek.swordsman ← Hoplite') && report.matched.includes('minotaur ← Minotaur') && report.missing.length > 10);
check('approx before applying', COMBAT.minotaur.src === 'approx' && CIVS.greek.src === 'approx');
applyOverrides(overrides, UNIT_DEFS);
check('applied: Minotaur takes original HP/favor and flips to src=original', UNIT_DEFS.minotaur.hp === 480 && UNIT_DEFS.minotaur.cost.favor === 16 && COMBAT.minotaur.src === 'original');
const s = unitStats('swordsman', 'greek');
check(`applied: Greek Hoplite uses original stats (hp ${s.hp}, bonus vs cav ${s.combat.bonus?.cavalry})`, s.hp === 120 && s.combat.bonus?.cavalry === 2.5 && CIVS.greek.src === 'original');
check('unmatched units keep their approximations', COMBAT.hydra.src === 'approx');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
