// Random-map definitions, scenario maps, the converters that produce them, and
// lobby map selection. Roda: npx tsx scripts/maps_test.ts
import { generateFromRm, buildScenarioMap } from '../server/src/game/mapgen.ts';
import { nearestWalkableTile, isWalkable } from '../server/src/game/path.ts';
import { Game } from '../server/src/game/room.ts';
import { Lobby } from '../server/src/lobby.ts';
import { mapList, resolveMap } from '../server/src/maps.ts';
import { BUILTIN_RMS, TILE_CLIFF, TILE_WATER, validateScenarioMap } from '@age/shared';
import type { RmDef, ScenarioMap, ServerMessage } from '@age/shared';
// @ts-expect-error plain .mjs tools
import { convertScenarioXml } from '../tools/aom-pipeline/scenario-to-map.mjs';
// @ts-expect-error plain .mjs tools
import { adaptXs } from '../tools/aom-pipeline/rm-from-xs.mjs';
// @ts-expect-error plain .mjs tools
import { makeHighlandPassXml } from '../tools/aom-pipeline/fixtures/make-scenario-fixture.mjs';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };
const quiet = console.log;

function flood(g: { size: number; tiles: number[]; blocked: Uint8Array }, sx: number, sy: number): Uint8Array {
  const n = g.size; const seen = new Uint8Array(n * n); const q = [sx + sy * n]; seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!; const x = i % n; const y = (i / n) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = nx + ny * n;
      if (!seen[j] && isWalkable(g as never, nx, ny)) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}

// ---------------------------------------------------------------- built-in RMs
console.log = () => {};
const rmResults: string[] = [];
let rmOk = true;
for (const def of BUILTIN_RMS) {
  for (const players of [2, 4, 6]) {
    for (const seed of [11, 222, 3333]) {
      const g = generateFromRm(def, players, seed);
      const tcs = g.buildings.filter((b) => b.type === 'town_center');
      let minSep = Infinity;
      for (let i = 0; i < tcs.length; i++) for (let j = i + 1; j < tcs.length; j++) minSep = Math.min(minSep, Math.hypot(tcs[i].tileX - tcs[j].tileX, tcs[i].tileY - tcs[j].tileY));
      const entries = tcs.map((tc) => nearestWalkableTile(g.grid, tc.tileX + 1, tc.tileY + 1)!);
      const f = flood(g.grid, entries[0].x, entries[0].y);
      const reachable = entries.every((e) => f[e.x + e.y * g.grid.size]);
      const goldNear = tcs.every((tc) => g.nodes.some((n) => n.type === 'gold_mine' && Math.hypot(n.tileX - tc.tileX, n.tileY - tc.tileY) < 16));
      const vils = tcs.every((_, p) => g.units.filter((u) => u.owner === p).length >= 3);
      const ok = tcs.length === players && reachable && goldNear && vils && minSep > 24;
      if (!ok) { rmOk = false; rmResults.push(`${def.id} ${players}p seed ${seed}: tcs=${tcs.length} sep=${minSep.toFixed(0)} reach=${reachable} gold=${goldNear} vils=${vils}`); }
    }
  }
}
console.log = quiet;
for (const r of rmResults) console.log(`  ${r}`);
check(`all ${BUILTIN_RMS.length} built-in random maps generate valid 2/4/6-player maps (9 seeds each)`, rmOk);
{
  console.log = () => {};
  const sea = generateFromRm(BUILTIN_RMS.find((d) => d.id === 'inland_sea')!, 6, 5);
  const forest = generateFromRm(BUILTIN_RMS.find((d) => d.id === 'great_forest')!, 6, 5);
  console.log = quiet;
  const c = Math.floor(sea.grid.size / 2);
  check('Inland Sea has water in the middle and fish', sea.grid.tiles[c * sea.grid.size + c] === TILE_WATER && sea.nodes.some((n) => n.type === 'fish'));
  const fc = Math.floor(forest.grid.size / 2);
  const treesNearCenter = forest.nodes.filter((n) => n.type === 'tree' && Math.hypot(n.tileX - fc, n.tileY - fc) < 10).length;
  check(`Great Forest has a dense center (${treesNearCenter} trees within 10 tiles)`, treesNearCenter > 60);
  check('map size scales with players', generateFromRm(BUILTIN_RMS[0], 6, 1).grid.size > generateFromRm(BUILTIN_RMS[0], 2, 1).grid.size);
}

// ---------------------------------------------------------------- scenario conversion
const map: ScenarioMap = convertScenarioXml(makeHighlandPassXml(), { name: 'Highland Pass', file: 'fixture.xml' });
check('converted scenario passes validation', validateScenarioMap(map) === null);
check(`6 player starts from player Town Centers (${map.starts.length})`, map.starts.length === 6);
check('river became water, ridges became cliffs', map.tiles.includes('~') && map.tiles.includes('^'));
check('trees/gold/berries/fish/animals mapped', ['tree', 'gold_mine', 'berry_bush', 'fish', 'sheep'].every((t) => map.objects.some((o) => o.type === t)));
check('stone added per start (AoM has no stone)', map.objects.filter((o) => o.type === 'stone_mine').length === 24);
check('player units kept (villagers + a Hoplite → swordsman)', (map.units ?? []).filter((u) => u.type === 'villager').length === 18 && (map.units ?? []).some((u) => u.type === 'swordsman'));
check('decorative object reported as dropped', (map.source?.notes ?? []).some((n) => /Statue Of Zeus/.test(n)));
{
  console.log = () => {};
  const g = buildScenarioMap(map, 6);
  console.log = quiet;
  const tcs = g.buildings.filter((b) => b.type === 'town_center');
  check('scenario builds: 6 TCs at the converted starts', tcs.length === 6 && tcs.every((tc, i) => Math.hypot(tc.tileX + 1.5 - map.starts[i].x, tc.tileY + 1.5 - map.starts[i].y) < 3));
  check('cliffs are impassable', g.grid.tiles.some((t, i) => t === TILE_CLIFF && g.grid.blocked[i] === 1));
  const entries = tcs.map((tc) => nearestWalkableTile(g.grid, tc.tileX + 1, tc.tileY + 1)!);
  const f = flood(g.grid, entries[0].x, entries[0].y);
  check('all 6 bases connected by land (passes + fords)', entries.every((e) => f[e.x + e.y * g.grid.size]));
  let threw = false; try { buildScenarioMap(map, 7); } catch { threw = true; }
  check('more players than starts is refused', threw);
  console.log = () => {};
  const g2 = buildScenarioMap(map, 3);
  console.log = quiet;
  check('fewer players use the first starts only', g2.buildings.filter((b) => b.type === 'town_center').length === 3);
}

// ---------------------------------------------------------------- .xs adaptation
const xs = `
void main(void) {
  int playerTiles = 9000;
  int size = 2.0 * sqrt(cNumberNonGaiaPlayers*playerTiles);
  rmSetMapSize(size, size);
  rmPlacePlayersCircular(0.35, 0.4, rmDegreesToRadians(5.0));
  int seaID = rmCreateArea("sea"); rmSetAreaSize(seaID, 0.18, 0.2); rmSetAreaWaterType(seaID, "sea"); rmSetAreaLocation(seaID, 0.5, 0.5);
  int goldID = rmCreateObjectDef("gold"); rmAddObjectDefItem(goldID, "Gold mine small", 1, 0.0);
  rmSetObjectDefMinDistance(goldID, 20.0); rmSetObjectDefMaxDistance(goldID, 25.0); rmPlaceObjectDefPerPlayer(goldID, false, 2);
  int relic = rmCreateObjectDef("relic"); rmAddObjectDefItem(relic, "relic", 1, 0.0);
  rmSetLightingSet("x");
}`;
const adapted: RmDef = adaptXs(xs, { id: 'sample', name: 'Sample (adapted)', file: 'sample.xs' });
check('xs: central sea area → center water', adapted.water?.some((w) => w.kind === 'center') ?? false);
check('xs: per-player gold (distance in meters → tiles, 1 mine → 4 nodes)', adapted.perPlayer.some((p) => p.type === 'gold_mine' && p.clusters === 2 && p.count === 4 && p.minDist === 10));
check('xs: size formula with a variable resolved', adapted.tilesPerPlayer === 3600);
check('xs: unsupported calls and items are reported', (adapted.notes ?? []).some((n) => /relic/.test(n)) && (adapted.notes ?? []).some((n) => /rmSetLightingSet/.test(n)));
{
  console.log = () => {};
  const g = generateFromRm(adapted, 4, 9);
  console.log = quiet;
  check('adapted definition generates a playable 4-player map', g.buildings.filter((b) => b.type === 'town_center').length === 4);
}

// ---------------------------------------------------------------- registry + lobby
check('registry lists built-in RMs and the shipped scenario', mapList().some((m) => m.id === 'rm:inland_sea') && mapList().some((m) => m.id === 'scn:highland_pass' && m.maxPlayers === 6));
check('resolveMap rejects unknown ids', resolveMap('rm:nope') === undefined && resolveMap('scn:nope') === undefined && resolveMap('') === undefined);
{
  const lobby = new Lobby();
  const out: Record<number, ServerMessage[]> = {};
  const host = lobby.connect((m) => (out[1] ??= []).push(m));
  const guest = lobby.connect((m) => (out[2] ??= []).push(m));
  lobby.handleMessage(host.id, { type: 'setName', name: 'H' });
  lobby.handleMessage(guest.id, { type: 'setName', name: 'G' });
  lobby.handleMessage(host.id, { type: 'createRoom' });
  const rs = () => [...out[1]].reverse().find((m) => m.type === 'roomState') as Extract<ServerMessage, { type: 'roomState' }>;
  lobby.handleMessage(guest.id, { type: 'joinRoom', roomId: rs().roomId });
  check('roomState carries the map list', (rs().maps ?? []).length >= BUILTIN_RMS.length + 1);
  lobby.handleMessage(guest.id, { type: 'setMap', mapId: 'rm:savanna' });
  check('only the host can pick the map', rs().mapId === '');
  lobby.handleMessage(host.id, { type: 'setMap', mapId: 'rm:nope' });
  check('unknown map ids are ignored', rs().mapId === '');
  lobby.handleMessage(host.id, { type: 'setMap', mapId: 'scn:highland_pass' });
  check('host picks the scenario map', rs().mapId === 'scn:highland_pass');
  lobby.handleMessage(guest.id, { type: 'setReady', ready: true });
  console.log = () => {};
  lobby.handleMessage(host.id, { type: 'startGame' });
  console.log = quiet;
  const gs = out[2].find((m) => m.type === 'gameStart') as Extract<ServerMessage, { type: 'gameStart' }> | undefined;
  check('game starts on the scenario map (128x128 with cliffs)', !!gs && gs.map.size === 128 && gs.map.tiles.includes(TILE_CLIFF));
  lobby.disconnect(host); lobby.disconnect(guest);
}

// ---------------------------------------------------------------- bots play each map type
for (const src of [{ rm: BUILTIN_RMS[0] }, { rm: BUILTIN_RMS[1] }, { scenario: map }] as const) {
  const members = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `B${i}`, color: '#fff', isBot: true, difficulty: 'hard' as const, god: (['zeus', 'ra', 'odin', 'isis', 'loki', 'hades'] as const)[i] }));
  console.log = () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = new Game(members, () => {}, () => {}, 'normal', 'classic', src);
  let err = '';
  try { for (let t = 0; t < 3000; t++) g.step(); } catch (e) { err = (e as Error).message; }
  console.log = quiet;
  const name = 'rm' in src ? src.rm.name : src.scenario.name;
  const pops = [...g.players.values()].map((p: { id: number }) => g.popOf(p.id));
  check(`6 bots play 5 minutes on ${name} without errors (pops ${pops.join(',')})`, !err && pops.every((p: number) => p >= 8));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
