// Live multiplayer check against a RUNNING server (does not spawn one).
// N real WebSocket clients join one room, ready up, start, issue commands,
// and confirm everyone sees every player's units moving.
// Usage: node scripts/live_mp_test.mjs [N=4] [url=ws://127.0.0.1:5199/ws]
import WebSocket from 'ws';

const N = Number(process.argv[2] ?? 4);
const URL = process.argv[3] ?? 'ws://127.0.0.1:5199/ws';
let pass = 0, fail = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, id: 0, inbox: [], snaps: 0, last: null, start: null, roomState: null, errors: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.inbox.push(m);
    if (m.type === 'welcome') c.id = m.playerId;
    if (m.type === 'snapshot') { c.snaps++; c.last = m; }
    if (m.type === 'gameStart') c.start = m;
    if (m.type === 'roomState') c.roomState = m;
    if (m.type === 'error') c.errors.push(m.code);
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return c;
}
async function until(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
  console.log(`  (timeout: ${label})`); return false;
}

const cs = Array.from({ length: N }, (_, i) => client(`LiveP${i + 1}_${Date.now() % 10000}`));
await Promise.all(cs.map((c) => c.open));
for (const c of cs) c.send({ type: 'setName', name: c.name, clientId: `cid-${c.name}` });
check(`${N} clients connected + welcomed`, await until(() => cs.every((c) => c.id), 4000, 'welcome'));

const host = cs[0];
host.send({ type: 'createRoom' });
await until(() => host.roomState, 3000, 'room');
const roomId = host.roomState.roomId;
host.send({ type: 'removeBot' }); // room spawns with 1 easy bot by default
await sleep(200);
for (const c of cs.slice(1)) c.send({ type: 'joinRoom', roomId });
await until(() => host.roomState.players.length === N, 3000, 'joins');
check(`all ${N} humans in room ${roomId} (got ${host.roomState.players.length})`, host.roomState.players.length === N);
const rejected = cs.filter((c) => c.errors.includes('err.room_full')).length;
if (rejected) console.log(`  note: ${rejected} client(s) rejected with err.room_full`);
for (const c of cs.slice(1)) c.send({ type: 'setReady', ready: true });
await sleep(300);
host.send({ type: 'startGame' });
const joined = cs.filter((c) => !c.errors.includes('err.room_full'));
check('gameStart received by every seated player', await until(() => joined.every((c) => c.start), 5000, 'gameStart'));
check('snapshots streaming to every player', await until(() => joined.every((c) => c.snaps >= 5), 5000, 'snaps'));

const s0 = host.last;
check(`snapshot lists ${joined.length} players`, s0.players.length === joined.length);
const owners = new Set(s0.units.map((u) => u.owner));
check('every player has starting units', joined.every((c) => owners.has(c.id)));

// Each player moves its villagers; every client should observe ALL of them move.
const startPos = new Map(s0.units.map((u) => [u.id, [u.x, u.y]]));
for (const c of joined) {
  const mine = c.last.units.filter((u) => u.owner === c.id && u.type === 'villager');
  const tc = c.last.buildings.find((b) => b.owner === c.id && b.type === 'town_center');
  c.send({ type: 'cmd', cmd: { kind: 'move', unitIds: mine.map((u) => u.id), x: tc.tileX + 6, y: tc.tileY + 6 } });
  c.send({ type: 'cmd', cmd: { kind: 'train', buildingId: tc.id, unit: 'villager' } });
}
await sleep(3000);
for (const viewer of [joined[0], joined[joined.length - 1]]) {
  const moved = new Set(viewer.last.units.filter((u) => {
    const p = startPos.get(u.id); return p && Math.hypot(u.x - p[0], u.y - p[1]) > 0.5;
  }).map((u) => u.owner));
  check(`${viewer.name} sees units of all ${joined.length} players moving`, joined.every((c) => moved.has(c.id)));
}
const anyTraining = joined.every((c) => c.last.buildings.some((b) => b.owner === c.id && b.queue.length > 0) ||
  c.last.units.filter((u) => u.owner === c.id && u.type === 'villager').length > 3);
check('train command accepted for every player', anyTraining);
const spawns = joined.map((c) => c.last.buildings.find((b) => b.owner === c.id && b.type === 'town_center')).map((b) => [b.tileX, b.tileY]);
let minD = Infinity;
for (let i = 0; i < spawns.length; i++) for (let j = i + 1; j < spawns.length; j++) minD = Math.min(minD, Math.hypot(spawns[i][0] - spawns[j][0], spawns[i][1] - spawns[j][1]));
console.log(`  town centers: ${JSON.stringify(spawns)}  min distance=${minD.toFixed(1)} tiles`);
check('town centers are well separated (>= 30 tiles)', minD >= 30);
const gods = joined[0].start.players.map((p) => `${p.name}:${p.god}/${p.civ}`);
console.log(`  gods: ${gods.join(' ')}`);
check('every player got a major god + civ at game start', joined[0].start.players.every((p) => p.god && p.civ));
const favorKnown = joined.every((c) => typeof c.last.players.find((p) => p.id === c.id)?.resources?.favor === 'number');
check('snapshots carry favor for every player', favorKnown);
const colors = new Set(joined[0].start.players.map((p) => p.color));
check(`each player has a distinct color (${colors.size}/${joined.length})`, colors.size === joined.length);

for (const c of cs) c.ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
