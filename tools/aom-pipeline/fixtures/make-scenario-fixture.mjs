#!/usr/bin/env node
// Writes a SYNTHETIC scenario in the same XML shape CryBar exports from a Retold
// .mythscn (MapSize, Heights, WT water layer, TM proto table, H1 entities).
// Everything here is original content ("Highland Pass": two ridges, a river,
// six player starts) — no AoM data. Used to test scenario-to-map and as a
// sample map.
//
//   node tools/aom-pipeline/fixtures/make-scenario-fixture.mjs out.xml

import { writeFileSync } from 'node:fs';

export function makeHighlandPassXml() {
  const W = 128;
  const H = 128;
  // heights per vertex: two ridges (steep) crossing the map diagonally with gaps
  const verts = new Float32Array((W + 1) * (H + 1));
  for (let z = 0; z <= H; z++) for (let x = 0; x <= W; x++) {
    const d1 = Math.abs((x - z) - 34) ;           // ridge 1
    const d2 = Math.abs((x - z) + 34);            // ridge 2
    const gap = (v) => Math.abs(((x + z) % 64) - 32) < 7; // passes through the ridges
    let h = 2 + Math.sin(x / 9) * 0.6 + Math.cos(z / 11) * 0.6;
    if (d1 < 4 && !gap()) h += (4 - d1) * 3.2;
    if (d2 < 4 && !gap()) h += (4 - d2) * 3.2;
    verts[z * (W + 1) + x] = h;
  }
  // water: a river along the main diagonal (x ≈ z), with 3 fords
  const wt = Buffer.alloc(4 + W * H, 255);
  wt.writeUInt32LE(W * H, 0);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const onRiver = Math.abs(x - z) < 3;
    const ford = [32, 64, 96].some((f) => Math.abs(x - f) < 3 && Math.abs(z - f) < 3);
    if (onRiver && !ford) wt[4 + z * W + x] = 0;
  }
  const protos = ['TownCenter', 'VillagerGreek', 'TreeOak', 'Gold Mine', 'BerryBush', 'Goat', 'Fish - Salmon', 'Statue Of Zeus', 'Hoplite'];
  const P = Object.fromEntries(protos.map((n, i) => [n, i]));
  const ents = [];
  const ent = (player, proto, tx, tz) => ents.push(`<Entity id="${ents.length}"><S m="H1" player="${player}" protoIndex="${P[proto]}" x="${(tx * 2).toFixed(2)}" y="2" z="${(tz * 2).toFixed(2)}" rot="0,0,1"/></Entity>`);
  // six starts: three on each side of the river
  const starts = [[22, 70], [40, 104], [72, 112], [106, 58], [88, 24], [56, 16]];
  starts.forEach(([x, z], i) => {
    ent(i + 1, 'TownCenter', x, z);
    for (let v = 0; v < 3; v++) ent(i + 1, 'VillagerGreek', x + 3 + v, z + 3);
    for (let b = 0; b < 5; b++) ent(0, 'BerryBush', x - 6 + (b % 3), z + 5 + (b >> 1));
    for (let g = 0; g < 3; g++) ent(0, 'Gold Mine', x + 8 + g, z - 6);
    for (let s = 0; s < 4; s++) ent(0, 'Goat', x - 4 + s, z - 5);
    for (let t = 0; t < 10; t++) ent(0, 'TreeOak', x - 10 - (t % 4), z - 10 + Math.floor(t / 4));
  });
  ent(1, 'Hoplite', 25, 73);
  for (let t = 0; t < 140; t++) ent(0, 'TreeOak', 10 + ((t * 37) % 108), 10 + ((t * 53) % 108));
  for (let f = 0; f < 9; f++) ent(0, 'Fish - Salmon', 16 + f * 12, 16 + f * 12 + 1);
  ent(0, 'Statue Of Zeus', 64, 64); // decorative: no counterpart (should be reported)
  const b64 = (buf) => Buffer.from(buf.buffer ?? buf).toString('base64');
  return `<?xml version="1.0" encoding="utf-8"?>
<Scenario version="1">
\t<!-- synthetic fixture in CryBar's scenario-to-xml shape; original content -->
\t<Terrain hasT3="1">
\t\t<MapSize x="${W}" z="${H}"/>
\t\t<WT>${wt.toString('base64')}</WT>
\t\t<Heights>${b64(verts)}</Heights>
\t</Terrain>
\t<Entities ver="1">
\t\t<!-- Protos -->
\t\t<TM type="1">${protos.map((n) => `<E>${n}</E>`).join('')}</TM>
\t\t${ents.join('\n\t\t')}
\t</Entities>
</Scenario>
`;
}

if (process.argv[2]) {
  writeFileSync(process.argv[2], makeHighlandPassXml());
  console.log(`wrote ${process.argv[2]}`);
}
