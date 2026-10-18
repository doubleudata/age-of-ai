// Headless load test: N bots play a full-speed match. Measures server tick
// cost and snapshot size, the two things that grow with 6 players.
// Roda: npx tsx scripts/perf_6p_test.ts [players=6] [minutes=20] [difficulty=hard]
import { Game } from '../server/src/game/room.ts';
import { TICK_MS } from '@age/shared';
import { deflateRawSync } from 'node:zlib';

const players = Number(process.argv[2] ?? 6);
const minutes = Number(process.argv[3] ?? 20);
const difficulty = (process.argv[4] ?? 'hard') as 'easy' | 'normal' | 'hard' | 'expert';
const members = Array.from({ length: players }, (_, i) => ({
  id: i + 1, name: `Bot${i + 1}`, color: '#fff', isBot: true, difficulty,
}));
let lastSnap = '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = new Game(members, (_to: number, msg: { type: string }) => {
  if (msg.type === 'snapshot') lastSnap = JSON.stringify(msg);
}, () => {}, 'normal', 'classic');

const ticks = Math.round((minutes * 60 * 1000) / TICK_MS);
const samples: number[] = [];
let worst = 0;
const report = (tick: number): void => {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const pops = [...g.players.values()].map((p: { id: number }) => g.popOf(p.id));
  const ages = [...g.players.values()].map((p: { age: number }) => p.age);
  console.log(
    `t=${(tick * TICK_MS / 60000).toFixed(0).padStart(2)}min units=${String(g.units.size).padStart(3)} ` +
    `pop=[${pops.join(',')}] ages=[${ages.join(',')}] tick p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms ` +
    `worst=${worst.toFixed(1)}ms snapshot=${(lastSnap.length / 1024).toFixed(0)}KB (deflated ${(deflateRawSync(lastSnap, { level: 1, memLevel: 7 }).length / 1024).toFixed(1)}KB)`,
  );
  samples.length = 0;
};
for (let t = 1; t <= ticks; t++) {
  const t0 = performance.now();
  g.step();
  const dt = performance.now() - t0;
  samples.push(dt);
  worst = Math.max(worst, dt);
  if (t % Math.round(120000 / TICK_MS) === 0) report(t);
}
const budget = TICK_MS;
console.log(`\nworst tick ${worst.toFixed(1)}ms vs ${budget}ms budget (${players} players, ${difficulty})`);
process.exit(0);
