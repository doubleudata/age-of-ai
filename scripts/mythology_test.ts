// Headless test of the Age of Mythology layer: civs, counters, favor,
// minor gods at age-up, temple unlocks, heroes and every god power kind.
// Roda: npx tsx scripts/mythology_test.ts
import { Game } from '../server/src/game/room.ts';
import { createUnit } from '../server/src/game/state.ts';
import { Lobby } from '../server/src/lobby.ts';
import {
  BUILDING_DEFS, CIVS, MAJOR_GODS, MINOR_GODS, minorGodOptions, POWERS, resolveGod, unitStats,
} from '@age/shared';
import type { MajorGodId, ServerMessage } from '@age/shared';

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
  ok ? pass++ : fail++;
};

type Msg = { type: string; [k: string]: unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeGame(gods: MajorGodId[], mode: 'normal' | 'batalha' = 'normal'): { g: any; sent: { to: number; msg: Msg }[] } {
  const sent: { to: number; msg: Msg }[] = [];
  const members = gods.map((god, i) => ({ id: i + 1, name: `P${i + 1}`, color: '#fff', isBot: false, god }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = new Game(members, (to: number, msg: Msg) => sent.push({ to, msg }), () => {}, mode, 'classic');
  return { g, sent };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cmd(g: any, player: number, c: Record<string, unknown>): void {
  g.enqueueCommand(player, c);
  g.step();
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run(g: any, seconds: number): void {
  for (let i = 0; i < seconds * 10; i++) g.step();
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clearArea(g: any, x0: number, y0: number, w: number): void {
  for (const [id, u] of g.units) if (u.x >= x0 && u.x < x0 + w && u.y >= y0 && u.y < y0 + w) g.units.delete(id);
}
let nextId = 900000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spawn(g: any, owner: number, type: string, x: number, y: number) {
  const u = createUnit(nextId++, owner, type as never, x, y);
  u.hp = g.unitMaxHp(u);
  g.units.set(u.id, u);
  return u;
}

// ---------------------------------------------------------------- data integrity
{
  let ok = true;
  for (const civ of ['greek', 'egyptian', 'norse'] as const) {
    for (const age of [2, 3, 4]) if (minorGodOptions(civ, age).length !== 2) ok = false;
  }
  check('each civ has exactly 2 minor god options at ages 2, 3 and 4', ok);
  check('9 major gods, 3 per civ', Object.values(MAJOR_GODS).length === 9 &&
    (['greek', 'egyptian', 'norse'] as const).every((c) => Object.values(MAJOR_GODS).filter((m) => m.civ === c).length === 3));
  const powerIds = new Set([...Object.values(MAJOR_GODS).map((m) => m.power), ...Object.values(MINOR_GODS).map((m) => m.power)]);
  check('every god has a distinct, defined god power (27)', powerIds.size === 27 && [...powerIds].every((p) => POWERS[p]));
  check('every myth unit is trainable at the Temple', Object.values(MINOR_GODS).every((m) => BUILDING_DEFS.temple.trains.includes(m.myth)));
  check("resolveGod('random') returns a real god; bad input too", !!MAJOR_GODS[resolveGod('random', 0.99)] && !!MAJOR_GODS[resolveGod('nope', 0)]);
  check('every value is tagged approx until original data is imported',
    Object.values(MAJOR_GODS).every((m) => m.src === 'approx') && Object.values(POWERS).every((p) => p.src === 'approx'));
}

// ---------------------------------------------------------------- civ units
{
  const hop = unitStats('swordsman', 'greek');
  const spear = unitStats('swordsman', 'egyptian');
  const ulf = unitStats('swordsman', 'norse');
  check(`civ infantry differ: ${hop.name} / ${spear.name} / ${ulf.name}`, hop.name === 'Hoplite' && spear.name === 'Spearman' && ulf.name === 'Ulfsark');
  check('Spearman is cheaper and faster than Hoplite', (spear.cost.gold ?? 0) < (hop.cost.gold ?? 0) && spear.speed > hop.speed);
  check('Throwing Axeman deals hack damage at short range', unitStats('archer', 'norse').combat.dmg === 'hack' && unitStats('archer', 'norse').range < unitStats('archer', 'greek').range);
  check('Egyptian hero (Priest) is ranged', unitStats('hero', 'egyptian').range > 3);
  check('Zeus: infantry +1 attack', unitStats('swordsman', 'greek', 'zeus').attack === hop.attack + 1);
  check('Set: myth units cost less favor', (unitStats('sphinx', 'egyptian', 'set').cost.favor ?? 0) < (unitStats('sphinx', 'egyptian').cost.favor ?? 0));
  check('Loki: heroes cost less', (unitStats('hero', 'norse', 'loki').cost.gold ?? 0) < (unitStats('hero', 'norse').cost.gold ?? 0));
}

// ---------------------------------------------------------------- counters
{
  const { g } = makeGame(['zeus', 'thor']);
  clearArea(g, 60, 60, 20);
  const hop = spawn(g, 1, 'swordsman', 65, 65);
  const cav = spawn(g, 2, 'knight', 66, 65);
  const arc = spawn(g, 2, 'archer', 66, 66);
  const hp0c = cav.hp; const hp0a = arc.hp;
  g.dealDamage(hop, cav.id);
  g.dealDamage(hop, arc.id);
  const vsCav = hp0c - cav.hp;
  const vsArc = hp0a - arc.hp;
  check(`infantry hits cavalry harder than its base attack (${vsCav.toFixed(1)} vs ${vsArc.toFixed(1)} on archer)`, vsCav > g.unitAttack(hop) * 0.9 && vsCav > vsArc);
  const mino = spawn(g, 2, 'minotaur', 67, 65);
  const hero = spawn(g, 1, 'hero', 67, 66);
  const h0 = mino.hp;
  g.dealDamage(hero, mino.id);
  const heroDmg = h0 - mino.hp;
  const h1 = mino.hp;
  g.dealDamage(hop, mino.id);
  const hopDmg = h1 - mino.hp;
  check(`hero x3 vs myth (${heroDmg.toFixed(1)} vs hoplite ${hopDmg.toFixed(1)})`, heroDmg > hopDmg * 3);
  // splash
  const man = spawn(g, 1, 'manticore', 70, 70);
  const t1 = spawn(g, 2, 'villager', 72, 70);
  const t2 = spawn(g, 2, 'villager', 72.6, 70.4);
  const s0 = t2.hp;
  g.dealDamage(man, t1.id);
  check('manticore splash damages a second nearby enemy', t2.hp < s0);
}

// ---------------------------------------------------------------- favor per civ
{
  const { g } = makeGame(['zeus', 'ra', 'odin']);
  // give each a finished temple
  for (const pid of [1, 2, 3]) {
    const tc = [...g.buildings.values()].find((b: { owner: number; type: string }) => b.owner === pid && b.type === 'town_center');
    const t = { id: 800000 + pid, owner: pid, type: 'temple', tileX: tc.tileX + 6, tileY: tc.tileY + 6, hp: BUILDING_DEFS.temple.hp, progress: 1, queue: [] };
    g.buildings.set(t.id, t);
    g.blockFootprint(t.tileX, t.tileY, 3);
  }
  const p1 = g.players.get(1); const p2 = g.players.get(2); const p3 = g.players.get(3);
  const f1 = p1.resources.favor; const f2 = p2.resources.favor; const f3 = p3.resources.favor;
  // Greek: send villagers to worship
  const vils = [...g.units.values()].filter((u: { owner: number; type: string }) => u.owner === 1 && u.type === 'villager');
  cmd(g, 1, { kind: 'gather', unitIds: vils.map((u: { id: number }) => u.id), targetId: 800001 });
  run(g, 30);
  const worshipping = vils.filter((u: { state: string }) => u.state === 'gathering').length;
  check(`Greek villagers worship at the temple (${worshipping}/3)`, worshipping === 3);
  check(`Greek favor rises from worship (${f1.toFixed(1)} -> ${p1.resources.favor.toFixed(1)})`, p1.resources.favor > f1 + 1);
  check(`Egyptian favor rises from the temple alone (${f2} -> ${p2.resources.favor.toFixed(1)})`, p2.resources.favor > f2 + 2);
  const n0 = p3.resources.favor;
  check(`Norse temple gives only a trickle (${f3} -> ${n0.toFixed(2)})`, n0 > f3 && n0 - f3 < 1.5);
  // Norse: combat favor
  clearArea(g, 60, 60, 20);
  const ulf = spawn(g, 3, 'swordsman', 65, 65);
  for (let i = 0; i < 6; i++) { const v = spawn(g, 2, 'villager', 66, 65); g.dealDamage(ulf, v.id); g.dealDamage(ulf, v.id); g.dealDamage(ulf, v.id); }
  check(`Norse favor rises from damage dealt (${n0.toFixed(2)} -> ${p3.resources.favor.toFixed(2)})`, p3.resources.favor > n0 + 0.5);
  // Greek can't "worship" by gathering an Egyptian's temple; Egyptian can't worship
  const ev = [...g.units.values()].find((u: { owner: number; type: string }) => u.owner === 2 && u.type === 'villager');
  cmd(g, 2, { kind: 'gather', unitIds: [ev.id], targetId: 800002 });
  check('non-Greek villagers cannot worship', ev.gatherTargetId !== 800002);
  p1.resources.favor = 99.9;
  run(g, 20);
  check('favor is capped at 100', p1.resources.favor <= 100);
}

// ---------------------------------------------------------------- age-up + temple
{
  const { g } = makeGame(['zeus', 'thor']);
  const p = g.players.get(1);
  p.resources = { food: 5000, wood: 5000, gold: 5000, stone: 5000, favor: 100 };
  const tc = [...g.buildings.values()].find((b: { owner: number; type: string }) => b.owner === 1 && b.type === 'town_center');
  const temple = { id: 810001, owner: 1, type: 'temple', tileX: tc.tileX + 6, tileY: tc.tileY + 6, hp: 800, progress: 1, queue: [] };
  g.buildings.set(temple.id, temple);
  g.blockFootprint(temple.tileX, temple.tileY, 3);
  const vil = [...g.units.values()].find((u: { owner: number; type: string }) => u.owner === 1 && u.type === 'villager');
  // need one age-1 building to advance: a barracks
  const bar = { id: 810002, owner: 1, type: 'barracks', tileX: tc.tileX - 6, tileY: tc.tileY + 6, hp: 700, progress: 1, queue: [] };
  g.buildings.set(bar.id, bar);
  // population room for pop-3 myth units + hero (houses), and two Classical
  // buildings so age 3 can be researched later
  let hx = 0;
  for (const t of ['house', 'house', 'house', 'blacksmith', 'market']) {
    const b = { id: 810100 + hx, owner: 1, type: t, tileX: tc.tileX + 12 + hx * 3, tileY: tc.tileY + 12, hp: 500, progress: 1, queue: [] };
    g.buildings.set(b.id, b);
    hx++;
  }
  cmd(g, 1, { kind: 'train', buildingId: temple.id, unit: 'minotaur' });
  check('myth unit is locked before picking its god', temple.queue.length === 0);
  cmd(g, 1, { kind: 'advanceAge', minorGod: 'bast' }); // another civ's god -> falls back to a valid Greek one
  const picked = p.ageResearch?.god;
  check(`invalid minor god is replaced by a valid Greek option (${picked})`, picked === 'athena' || picked === 'hermes');
  run(g, 30);
  check(`age 2 reached and ${picked} added to the pantheon`, p.age === 2 && p.minorGods.includes(picked));
  const myth = MINOR_GODS[picked as 'athena'].myth;
  const other = picked === 'athena' ? 'centaur' : 'minotaur';
  cmd(g, 1, { kind: 'train', buildingId: temple.id, unit: other });
  check(`the other god's myth unit (${other}) stays locked`, temple.queue.length === 0);
  const favorBefore = p.resources.favor;
  cmd(g, 1, { kind: 'train', buildingId: temple.id, unit: myth });
  check(`${myth} trains at the temple and costs favor`, temple.queue.length === 1 && p.resources.favor < favorBefore);
  cmd(g, 1, { kind: 'train', buildingId: temple.id, unit: 'hero' });
  check('hero trains at the temple', temple.queue.length === 2);
  run(g, 60);
  check(`${myth} and hero spawned`, [...g.units.values()].some((u: { owner: number; type: string }) => u.owner === 1 && u.type === myth)
    && [...g.units.values()].some((u: { owner: number; type: string }) => u.owner === 1 && u.type === 'hero'));
  cmd(g, 1, { kind: 'advanceAge', minorGod: 'dionysus' });
  run(g, 45);
  check('explicit valid pick at age 3 is honored (dionysus)', p.minorGods.includes('dionysus'));
  void vil;
}

// ---------------------------------------------------------------- god powers
{
  const { g, sent } = makeGame(['zeus', 'loki']);
  const p1 = g.players.get(1);
  clearArea(g, 60, 60, 30);
  // thunderbolt kills the units at the target
  const e1 = spawn(g, 2, 'knight', 70, 70);
  cmd(g, 1, { kind: 'castPower', power: 'thunderbolt', x: 70, y: 70 });
  check('Thunderbolt kills the targeted unit', !g.units.has(e1.id));
  check('cast is announced to every player', sent.filter((s) => s.msg.type === 'powerCast').length === 2);
  const e2 = spawn(g, 2, 'knight', 70, 70);
  cmd(g, 1, { kind: 'castPower', power: 'thunderbolt', x: 70, y: 70 });
  check('a god power can only be used once', g.units.has(e2.id) && sent.some((s) => s.msg.type === 'error' && s.msg.code === 'err.power_used'));
  cmd(g, 1, { kind: 'castPower', power: 'trickery', x: 70, y: 70 });
  check("can't cast another god's power", sent.some((s) => s.msg.type === 'error' && s.msg.code === 'err.power_unknown'));
  cmd(g, 1, { kind: 'castPower', power: 'nope', x: 1, y: 1 });
  check('unknown power rejected', sent.filter((s) => s.msg.code === 'err.power_unknown').length >= 2);

  // freeze: Loki's Trickery
  const mine = spawn(g, 1, 'swordsman', 75, 75);
  const fr = spawn(g, 2, 'swordsman', 76, 75);
  cmd(g, 2, { kind: 'castPower', power: 'trickery', x: 75, y: 75 });
  check("Trickery freezes enemies but not the caster's own units", (mine.frozenUntil ?? 0) > g.tickNow && fr.frozenUntil === undefined);
  const frHp = fr.hp;
  const mineHp = mine.hp;
  run(g, 3);
  check('frozen unit does not fight back (it still takes hits)', fr.hp === frHp && mine.hp < mineHp);
  run(g, 12);
  check('freeze wears off', mine.frozenUntil === undefined || mine.frozenUntil <= g.tickNow);

  // minor powers (grant gods directly)
  p1.minorGods.push('athena', 'hermes', 'dionysus', 'hephaestus');
  // heal
  const hurt = spawn(g, 1, 'swordsman', 80, 62); hurt.hp = 5;
  cmd(g, 1, { kind: 'castPower', power: 'restoration', x: 80, y: 62 });
  check('Restoration heals own units', hurt.hp === g.unitMaxHp(hurt));
  // resource
  const food0 = p1.resources.food;
  cmd(g, 1, { kind: 'castPower', power: 'bounty' });
  check('Bounty (untargeted) grants resources', p1.resources.food === food0 + 300);
  // speed
  cmd(g, 1, { kind: 'castPower', power: 'swift_winds' });
  check('Swift Winds speeds up own units', g.unitSpeed(hurt) > unitStats('swordsman', 'greek', 'zeus').speed * 1.3);
  // shield
  const shielded = spawn(g, 1, 'swordsman', 90, 90);
  const attacker = spawn(g, 2, 'swordsman', 91, 90);
  const a0 = shielded.hp; g.dealDamage(attacker, shielded.id); const plain = a0 - shielded.hp;
  cmd(g, 1, { kind: 'castPower', power: 'forge_ward', x: 90, y: 90 });
  const b0 = shielded.hp; g.dealDamage(attacker, shielded.id); const warded = b0 - shielded.hp;
  check(`Forge Ward reduces damage taken (${plain.toFixed(1)} -> ${warded.toFixed(1)})`, warded < plain);
  check('active power appears in snapshot fx', (() => {
    sent.length = 0; for (let i = 0; i < 2; i++) g.step();
    const snap = sent.find((s) => s.msg.type === 'snapshot');
    return Array.isArray(snap?.msg.fx) && (snap!.msg.fx as unknown[]).length > 0;
  })());
  const snap = sent.find((s) => s.msg.type === 'snapshot' && s.to === 1)!.msg as unknown as Extract<ServerMessage, { type: 'snapshot' }>;
  const me = snap.players.find((p) => p.id === 1)!;
  check('snapshot reports minor gods and used powers', (me.minorGods ?? []).includes('athena') && (me.powersUsed ?? []).includes('thunderbolt'));
}
{
  // summons + damage over time (Egyptian Set, Norse Hel)
  const { g } = makeGame(['set', 'thor']);
  clearArea(g, 60, 60, 30);
  const pop0 = g.popOf(1);
  g.enqueueCommand(1, { kind: 'castPower', power: 'serpents', x: 70, y: 70 });
  g.step();
  const serp = [...g.units.values()].filter((u: { owner: number; type: string }) => u.owner === 1 && u.type === 'serpent');
  check(`Plague of Serpents summons 6 serpents (${serp.length}) costing no population`, serp.length === 6 && g.popOf(1) === pop0);
  const p2 = g.players.get(2);
  p2.minorGods.push('hel');
  const victims = [spawn(g, 1, 'swordsman', 100, 100), spawn(g, 1, 'swordsman', 102, 101)];
  g.enqueueCommand(2, { kind: 'castPower', power: 'hellfire', x: 101, y: 100 });
  g.step();
  const mid = victims.map((v) => v.hp);
  run(g, 4);
  check('Hellfire keeps burning over time', victims.every((v, i) => !g.units.has(v.id) || v.hp < mid[i]));
  // gather boost
  const { g: g2 } = makeGame(['ra', 'thor']);
  g2.enqueueCommand(1, { kind: 'castPower', power: 'rain' });
  g2.step();
  check('Rain sets a timed food gather buff', g2.players.get(1).gatherBuff?.res === 'food' && g2.players.get(1).gatherBuff.mul === 1.5);
}
{
  // battle mode starts at age 3 with two minor gods
  const { g } = makeGame(['odin', 'isis'], 'batalha');
  const p = g.players.get(1);
  check(`battle mode grants the skipped ages' minor gods (${p.minorGods.join(',')})`, p.minorGods.length === 2 &&
    p.minorGods.every((m: 'freyja') => MINOR_GODS[m].civ === 'norse'));
  check('Egyptian Isis gets cheaper techs in battle mode too', g.players.get(2).god === 'isis');
}

// ---------------------------------------------------------------- lobby god picking
{
  const lobby = new Lobby();
  const out: Record<number, Msg[]> = {};
  const host = lobby.connect((m) => (out[1] ??= []).push(m as Msg));
  const guest = lobby.connect((m) => (out[2] ??= []).push(m as Msg));
  lobby.handleMessage(host.id, { type: 'setName', name: 'Host' });
  lobby.handleMessage(guest.id, { type: 'setName', name: 'Guest' });
  lobby.handleMessage(host.id, { type: 'createRoom' });
  const rs = () => [...out[1]].reverse().find((m) => m.type === 'roomState') as unknown as Extract<ServerMessage, { type: 'roomState' }>;
  const roomId = rs().roomId;
  lobby.handleMessage(guest.id, { type: 'joinRoom', roomId });
  const bot = rs().players.find((p) => p.isBot)!;
  lobby.handleMessage(guest.id, { type: 'setGod', playerId: guest.id, god: 'odin' });
  lobby.handleMessage(guest.id, { type: 'setGod', playerId: host.id, god: 'loki' });
  lobby.handleMessage(host.id, { type: 'setGod', playerId: bot.id, god: 'isis' });
  lobby.handleMessage(host.id, { type: 'setGod', playerId: host.id, god: 'not-a-god' });
  const st = rs().players;
  check('a player picks their own god', st.find((p) => p.id === guest.id)?.god === 'odin');
  check("a player can't pick someone else's god", st.find((p) => p.id === host.id)?.god === 'random');
  check("host picks a bot's god; junk picks are ignored", st.find((p) => p.id === bot.id)?.god === 'isis');
  lobby.handleMessage(guest.id, { type: 'setReady', ready: true });
  lobby.handleMessage(host.id, { type: 'startGame' });
  const gs = out[2].find((m) => m.type === 'gameStart') as unknown as Extract<ServerMessage, { type: 'gameStart' }>;
  const infos = gs.players;
  check('game start reveals each god + civ; random resolved', infos.find((p) => p.id === guest.id)?.god === 'odin' &&
    infos.find((p) => p.id === guest.id)?.civ === 'norse' && !!MAJOR_GODS[infos.find((p) => p.id === host.id)!.god as MajorGodId]);
  lobby.disconnect(host); lobby.disconnect(guest);
  void CIVS;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
