// Bot AI for the Age of Mythology layer: Greek worship, myth units, heroes and
// god powers. Uses the same commands as a human (validated by the server).

import { COMBAT, MINOR_GODS, POWERS, unitStats } from '@age/shared';
import type { CostKey, PowerId } from '@age/shared';
import type { DifficultySettings } from './ai';
import type { Game } from './room';
import type { Building, Unit } from './state';

interface MythCtx {
  villagers: Unit[];
  military: Unit[];
  buildings: Building[];
  base: { x: number; y: number };
  afford: (cost: Partial<Record<CostKey, number>>) => boolean;
  diff: DifficultySettings;
  /** Saving resources for the next age: don't spend them at the Temple. */
  savingForAge: boolean;
}

export function runMythAI(game: Game, botId: number, ctx: MythCtx): void {
  const p = game.players.get(botId);
  if (!p || !p.civ || p.defeated) return;
  const temple = ctx.buildings.find((b) => b.type === 'temple' && b.progress >= 1);

  // Greek: keep a few villagers worshipping (favor)
  if (temple && p.civ === 'greek' && ctx.villagers.length >= 8) {
    const want = Math.min(p.age + 1, Math.floor(ctx.villagers.length / 5));
    const worshipping = ctx.villagers.filter((v) => v.gatherTargetId === temple.id).length;
    if (worshipping < want) {
      const pick = ctx.villagers.find((v) => v.state === 'idle')
        ?? ctx.villagers.find((v) => v.state === 'gathering' && v.gatherResource === 'wood');
      if (pick) game.enqueueCommand(botId, { kind: 'gather', unitIds: [pick.id], targetId: temple.id });
    }
  }

  // Temple production: myth units when favor allows, a hero per age
  if (temple && temple.queue.length < 2 && !ctx.savingForAge) {
    const myth = p.minorGods.map((g) => MINOR_GODS[g].myth)
      .map((t) => ({ t, s: unitStats(t, p.civ, p.god) }))
      .filter((o) => ctx.afford(o.s.cost))
      .sort((a, b) => b.s.hp - a.s.hp)[0];
    const heroes = ctx.military.filter((u) => u.type === 'hero').length;
    if (myth) {
      game.enqueueCommand(botId, { kind: 'train', buildingId: temple.id, unit: myth.t });
    } else if (p.age >= 2 && heroes < p.age - 1 && ctx.afford(unitStats('hero', p.civ, p.god).cost)) {
      game.enqueueCommand(botId, { kind: 'train', buildingId: temple.id, unit: 'hero' });
    }
  }

  // God powers (at most one per AI tick). The enemy scan is shared by every
  // power this tick and capped, so 6 bots stay cheap.
  const unused = game.powersOf(p).filter((pw) => !p.powersUsed.has(pw));
  if (unused.length === 0) return;
  const scan = new EnemyScan(game, botId, ctx);
  for (const power of unused) {
    if (castIfUseful(game, botId, power, ctx, scan)) break;
  }
}

/** Enemies near our base/army, computed once per bot tick. */
class EnemyScan {
  readonly near: Unit[];
  private memo = new Map<number, { x: number; y: number; n: number } | null>();
  constructor(game: Game, botId: number, ctx: MythCtx) {
    const army = ctx.military.length > 40 ? ctx.military.filter((_, i) => i % 2 === 0) : ctx.military;
    const out: Unit[] = [];
    for (const u of game.units.values()) {
      if (game.allied(u.owner, botId) || COMBAT[u.type].cls === 'ship') continue;
      if (Math.hypot(u.x - ctx.base.x, u.y - ctx.base.y) < 18 || army.some((m) => Math.abs(m.x - u.x) < 10 && Math.abs(m.y - u.y) < 10)) {
        out.push(u);
        if (out.length >= 60) break;
      }
    }
    this.near = out;
  }
  /** Densest enemy spot (count within `radius`). */
  cluster(radius: number): { x: number; y: number; n: number } | null {
    const key = Math.round(radius * 10);
    if (this.memo.has(key)) return this.memo.get(key)!;
    let best: { x: number; y: number; n: number } | null = null;
    for (const e of this.near) {
      let n = 0;
      for (const o of this.near) if (Math.hypot(o.x - e.x, o.y - e.y) <= radius) n++;
      if (!best || n > best.n) best = { x: e.x, y: e.y, n };
    }
    this.memo.set(key, best);
    return best;
  }
}

function castIfUseful(game: Game, botId: number, power: PowerId, ctx: MythCtx, scan: EnemyScan): boolean {
  const def = POWERS[power];
  const cast = (x?: number, y?: number): boolean => {
    game.enqueueCommand(botId, { kind: 'castPower', power, x, y });
    return true;
  };
  const cluster = (radius: number) => scan.cluster(radius);
  const passive = !ctx.diff.initiatesAttacks;
  switch (def.kind) {
    case 'resource':
      return cast();
    case 'gather_boost':
      return ctx.villagers.filter((v) => v.gatherResource === def.gather?.res).length >= 5 ? cast() : false;
    case 'speed':
      return !passive && ctx.military.filter((m) => m.state === 'movingToAttack').length >= 6 ? cast() : false;
    case 'strike':
    case 'freeze': {
      const c = cluster(def.radius ?? 4);
      const need = def.kind === 'strike' && def.damage && (def.radius ?? 0) < 2 ? 1 : 4;
      if (c && c.n >= need && (!passive || Math.hypot(c.x - ctx.base.x, c.y - ctx.base.y) < 18)) return cast(c.x, c.y);
      return false;
    }
    case 'summon': {
      const c = cluster(6);
      return c && c.n >= 3 ? cast(c.x, c.y) : false;
    }
    case 'heal':
    case 'shield': {
      const hurt = ctx.military.filter((m) => def.kind === 'shield' ? m.state === 'attacking' : m.hp < unitStats(m.type).hp * 0.6);
      if (hurt.length < 4) return false;
      const x = hurt.reduce((a, m) => a + m.x, 0) / hurt.length;
      const y = hurt.reduce((a, m) => a + m.y, 0) / hurt.length;
      return cast(x, y);
    }
    case 'reveal': {
      const target = [...game.buildings.values()].find((b) => b.type === 'town_center' && !game.allied(b.owner, botId));
      return target ? cast(target.tileX + 1.5, target.tileY + 1.5) : false;
    }
  }
  return false;
}
