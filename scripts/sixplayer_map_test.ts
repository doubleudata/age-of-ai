// 5-6 player map generation: spawns well separated, every base on enough land,
// bases mutually reachable on land maps. Roda: npx tsx scripts/sixplayer_map_test.ts
import { generateMap } from '../server/src/game/mapgen.ts';
import { isWalkable, nearestWalkableTile } from '../server/src/game/path.ts';
import type { TerrainKind } from '@age/shared';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

function flood(grid: { size: number; tiles: number[]; blocked: Uint8Array }, sx: number, sy: number): Uint8Array {
  const n = grid.size;
  const seen = new Uint8Array(n * n);
  const q = [sx + sy * n];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % n, y = (i / n) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = nx + ny * n;
      if (seen[j] || !isWalkable(grid as never, nx, ny)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

for (const terrain of ['classic', 'river', 'strait'] as TerrainKind[]) {
  for (const players of (process.env.P ? process.env.P.split(",").map(Number) : [5, 6])) {
    let minSep = Infinity, minLand = Infinity, unreachable = 0, tcCount = true, vilCount = true;
    for (let seed = 1; seed <= 12; seed++) {
      const g = generateMap(players, seed * 7919, terrain);
      const tcs = g.buildings.filter((b) => b.type === 'town_center');
      if (tcs.length !== players) tcCount = false;
      for (let p = 0; p < players; p++) {
        if (g.units.filter((u) => u.owner === p && u.type === 'villager').length < 3) vilCount = false;
      }
      for (let i = 0; i < tcs.length; i++) for (let j = i + 1; j < tcs.length; j++) {
        minSep = Math.min(minSep, Math.hypot(tcs[i].tileX - tcs[j].tileX, tcs[i].tileY - tcs[j].tileY));
      }
      // walkable land each base can reach (start from a villager)
      // start where the engine does: the walkable tile nearest the TC center
      const entries = tcs.map((tc) => nearestWalkableTile(g.grid, tc.tileX + 1, tc.tileY + 1)!);
      const floods = entries.map((e) => flood(g.grid, e.x, e.y));
      for (const f of floods) minLand = Math.min(minLand, f.reduce((a, b) => a + b, 0));
      if (terrain !== 'strait') {
        for (let p = 1; p < players; p++) {
          if (!floods[0][entries[p].x + entries[p].y * g.grid.size]) unreachable++;
        }
      }
    }
    console.log(`  ${terrain} ${players}p: min TC separation=${minSep.toFixed(1)} tiles, min reachable land=${minLand} tiles`);
    check(`${terrain} ${players}p: one TC + 3 villagers per player`, tcCount && vilCount);
    check(`${terrain} ${players}p: TCs >= 45 tiles apart`, minSep >= 45);
    check(`${terrain} ${players}p: every base has >= 2500 tiles of land`, minLand >= 2500);
    if (terrain !== 'strait') check(`${terrain} ${players}p: all bases reachable by land`, unreachable === 0);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
