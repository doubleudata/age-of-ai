// Age of Mythology layer: civilizations, major/minor gods, favor, myth units,
// heroes, god powers and the damage-type / armor / counter combat model.
//
// DATA PROVENANCE — read this before tuning numbers.
// Every table below carries `src`. Today EVERY value is 'approx': an
// approximation of Age of Mythology's DESIGN (which god gives which myth unit,
// what counters what, how each civ earns favor) expressed at THIS engine's
// scale (villager 30 hp, swordsman 60 hp, 1 tile ≈ 2 m). None of it was read
// from the original game files. `scripts/aom_import.mjs` reads the original
// proto.xml / techtree.xml (from a copy you own) and writes
// `aom-overrides.ts`; `applyOverrides` below then replaces matching values and
// flips their `src` to 'original'. See docs/AOM_DATA.md.
//
// Known deliberate deviations from AoM (kept to preserve the existing engine):
//  - Stone still exists (walls/towers/TC use it). AoM has no stone.
//  - Gods/powers are per-CIV option pairs, not the per-major-god trees of AoM.
//  - God powers are single-use for the whole game (classic AoM rule), with no
//    recharge techs.

import type { CostKey, ResourceType, Resources, UnitType } from './types';

export type DataSource = 'approx' | 'original';
export type Civ = 'greek' | 'egyptian' | 'norse';
export type MajorGodId = 'zeus' | 'poseidon' | 'hades' | 'ra' | 'isis' | 'set' | 'thor' | 'odin' | 'loki';
export type GodPick = MajorGodId | 'random';
export type MinorGodId =
  | 'athena' | 'hermes' | 'apollo' | 'dionysus' | 'hephaestus' | 'artemis'
  | 'bast' | 'anubis' | 'sekhmet' | 'osiris' | 'horus' | 'thoth'
  | 'freyja' | 'heimdall' | 'skadi' | 'njord' | 'hel' | 'tyr';
export type PowerId =
  | 'thunderbolt' | 'earthquake' | 'shades' | 'rain' | 'sacred_ward' | 'serpents'
  | 'dwarven_gold' | 'odins_call' | 'trickery'
  | 'restoration' | 'swift_winds' | 'sunbeam' | 'bounty' | 'forge_ward' | 'meteor'
  | 'prosperity' | 'ancestors' | 'sandstorm' | 'rebirth' | 'skyfire' | 'wisdom'
  | 'harvest' | 'watchful_eye' | 'frost' | 'tidal_bounty' | 'hellfire' | 'valor';

// ------------------------------------------------------------------ combat model
// AoM-style: each attack has a damage TYPE; each unit has a percentage armor per
// type; attacker classes get multipliers vs defender classes (the counters).
// damage = attack × classBonus × (1 − armor%[type]) − flatTechArmor, min 1.

export type DamageType = 'hack' | 'pierce' | 'crush';
export type UnitClass = 'villager' | 'infantry' | 'archer' | 'cavalry' | 'hero' | 'myth' | 'ship';

export interface CombatDef {
  dmg: DamageType;
  /** Percent armor (0..0.9) vs hack / pierce / crush. */
  armor: [number, number, number];
  cls: UnitClass;
  /** Damage multiplier vs defender classes (the rock-paper-scissors). */
  bonus?: Partial<Record<UnitClass, number>>;
  /** Multiplier vs buildings (default 1). */
  vsBuilding?: number;
  /** Area damage radius (tiles) around the target, at 50% damage. */
  splash?: number;
  /** HP regenerated per second. */
  regen?: number;
  src: DataSource;
}

const HUMAN_VS_MYTH = 0.6; // human soldiers are poor vs myth units (AoM design)

/** Combat profile of every unit type (civ flavor can override per civ). */
export const COMBAT: Record<UnitType, CombatDef> = {
  villager:     { dmg: 'hack', armor: [0, 0, 0], cls: 'villager', src: 'approx' },
  swordsman:    { dmg: 'hack', armor: [0.3, 0.25, 0], cls: 'infantry', bonus: { cavalry: 1.5, myth: HUMAN_VS_MYTH }, src: 'approx' },
  archer:       { dmg: 'pierce', armor: [0.1, 0.4, 0], cls: 'archer', bonus: { infantry: 1.5, myth: HUMAN_VS_MYTH }, vsBuilding: 0.5, src: 'approx' },
  knight:       { dmg: 'hack', armor: [0.25, 0.35, 0], cls: 'cavalry', bonus: { archer: 1.6, myth: HUMAN_VS_MYTH }, src: 'approx' },
  fishing_boat: { dmg: 'pierce', armor: [0.1, 0.2, 0], cls: 'ship', src: 'approx' },
  war_galley:   { dmg: 'pierce', armor: [0.2, 0.3, 0], cls: 'ship', bonus: { ship: 1.5 }, src: 'approx' },
  transport:    { dmg: 'pierce', armor: [0.2, 0.3, 0], cls: 'ship', src: 'approx' },
  hero:         { dmg: 'hack', armor: [0.4, 0.4, 0.2], cls: 'hero', bonus: { myth: 3 }, src: 'approx' },
  // Greek myth
  minotaur:     { dmg: 'hack', armor: [0.35, 0.45, 0.1], cls: 'myth', vsBuilding: 1.5, src: 'approx' },
  centaur:      { dmg: 'pierce', armor: [0.25, 0.45, 0.1], cls: 'myth', bonus: { infantry: 1.3 }, src: 'approx' },
  manticore:    { dmg: 'pierce', armor: [0.3, 0.45, 0.1], cls: 'myth', splash: 1.4, src: 'approx' },
  hydra:        { dmg: 'hack', armor: [0.35, 0.45, 0.15], cls: 'myth', regen: 3, src: 'approx' },
  colossus:     { dmg: 'crush', armor: [0.45, 0.5, 0.2], cls: 'myth', vsBuilding: 2.5, regen: 1, src: 'approx' },
  chimera:      { dmg: 'crush', armor: [0.3, 0.45, 0.1], cls: 'myth', splash: 1.3, src: 'approx' },
  // Egyptian myth
  sphinx:       { dmg: 'hack', armor: [0.35, 0.45, 0.1], cls: 'myth', vsBuilding: 2, src: 'approx' },
  anubite:      { dmg: 'hack', armor: [0.25, 0.4, 0.1], cls: 'myth', bonus: { archer: 1.5 }, src: 'approx' },
  scorpion_man: { dmg: 'hack', armor: [0.35, 0.45, 0.1], cls: 'myth', bonus: { infantry: 1.3, cavalry: 1.3 }, src: 'approx' },
  mummy:        { dmg: 'crush', armor: [0.3, 0.5, 0.1], cls: 'myth', splash: 1.0, src: 'approx' },
  avenger:      { dmg: 'hack', armor: [0.4, 0.45, 0.15], cls: 'myth', splash: 1.8, src: 'approx' },
  phoenix:      { dmg: 'crush', armor: [0.3, 0.5, 0.1], cls: 'myth', splash: 1.4, src: 'approx' },
  // Norse myth
  valkyrie:     { dmg: 'hack', armor: [0.3, 0.45, 0.1], cls: 'myth', regen: 2, bonus: { cavalry: 1.4 }, src: 'approx' },
  einherjar:    { dmg: 'hack', armor: [0.4, 0.4, 0.1], cls: 'myth', bonus: { infantry: 1.2 }, src: 'approx' },
  frost_giant:  { dmg: 'hack', armor: [0.4, 0.45, 0.15], cls: 'myth', src: 'approx' },
  mountain_giant: { dmg: 'crush', armor: [0.45, 0.5, 0.15], cls: 'myth', vsBuilding: 2, src: 'approx' },
  fire_giant:   { dmg: 'crush', armor: [0.4, 0.45, 0.15], cls: 'myth', splash: 1.6, src: 'approx' },
  fenris_wolf:  { dmg: 'hack', armor: [0.3, 0.4, 0.1], cls: 'myth', bonus: { villager: 2 }, src: 'approx' },
  // summons
  shade:        { dmg: 'hack', armor: [0.3, 0.6, 0.1], cls: 'myth', src: 'approx' },
  serpent:      { dmg: 'hack', armor: [0.2, 0.3, 0.1], cls: 'myth', bonus: { villager: 1.5 }, src: 'approx' },
};

const DMG_INDEX: Record<DamageType, number> = { hack: 0, pierce: 1, crush: 2 };
export function armorVs(def: CombatDef, type: DamageType): number {
  return def.armor[DMG_INDEX[type]] ?? 0;
}
/** Class multiplier for attacker → defender (1 when no counter applies). */
export function classBonus(att: CombatDef, def: CombatDef): number {
  return att.bonus?.[def.cls] ?? 1;
}

// ------------------------------------------------------------------ base stats
// Engine-scale base stats for the NEW units (the original 7 stay in constants.ts).
// Same shape as constants.ts UnitDef.
export interface MythUnitBase {
  hp: number; speed: number; attack: number; range: number; attackCooldown: number;
  sight: number; cost: Partial<Resources>; trainTime: number; pop: number;
}
export const MYTH_UNIT_BASE: Record<Exclude<UnitType, 'villager' | 'swordsman' | 'archer' | 'knight' | 'fishing_boat' | 'war_galley' | 'transport'>, MythUnitBase> = {
  hero:           { hp: 190, speed: 2.0, attack: 14, range: 1, attackCooldown: 1.3, sight: 7, cost: { food: 150, gold: 100 }, trainTime: 24, pop: 2 },
  minotaur:       { hp: 260, speed: 1.9, attack: 22, range: 1, attackCooldown: 1.6, sight: 6, cost: { food: 150, favor: 20 }, trainTime: 20, pop: 3 },
  centaur:        { hp: 170, speed: 2.6, attack: 12, range: 5, attackCooldown: 1.4, sight: 8, cost: { wood: 100, favor: 20 }, trainTime: 20, pop: 3 },
  manticore:      { hp: 220, speed: 1.8, attack: 14, range: 5, attackCooldown: 2.0, sight: 7, cost: { gold: 120, favor: 25 }, trainTime: 22, pop: 4 },
  hydra:          { hp: 380, speed: 1.6, attack: 20, range: 1, attackCooldown: 1.4, sight: 6, cost: { food: 200, favor: 30 }, trainTime: 26, pop: 5 },
  colossus:       { hp: 700, speed: 1.3, attack: 30, range: 1, attackCooldown: 2.0, sight: 7, cost: { gold: 300, favor: 40 }, trainTime: 32, pop: 6 },
  chimera:        { hp: 300, speed: 2.2, attack: 18, range: 4, attackCooldown: 1.6, sight: 7, cost: { gold: 200, favor: 35 }, trainTime: 28, pop: 4 },
  sphinx:         { hp: 240, speed: 2.0, attack: 18, range: 1, attackCooldown: 1.6, sight: 6, cost: { food: 120, favor: 20 }, trainTime: 20, pop: 3 },
  anubite:        { hp: 150, speed: 3.0, attack: 16, range: 1, attackCooldown: 1.0, sight: 7, cost: { gold: 80, favor: 15 }, trainTime: 16, pop: 2 },
  scorpion_man:   { hp: 300, speed: 1.8, attack: 22, range: 1, attackCooldown: 1.5, sight: 6, cost: { food: 150, gold: 50, favor: 25 }, trainTime: 24, pop: 4 },
  mummy:          { hp: 200, speed: 1.6, attack: 12, range: 5.5, attackCooldown: 2.0, sight: 8, cost: { gold: 120, favor: 30 }, trainTime: 24, pop: 4 },
  avenger:        { hp: 420, speed: 2.0, attack: 24, range: 1, attackCooldown: 1.6, sight: 6, cost: { gold: 220, favor: 35 }, trainTime: 28, pop: 5 },
  phoenix:        { hp: 320, speed: 2.6, attack: 20, range: 5, attackCooldown: 1.8, sight: 9, cost: { gold: 260, favor: 40 }, trainTime: 30, pop: 5 },
  valkyrie:       { hp: 220, speed: 2.8, attack: 15, range: 1, attackCooldown: 1.2, sight: 7, cost: { food: 120, favor: 20 }, trainTime: 20, pop: 3 },
  einherjar:      { hp: 280, speed: 2.0, attack: 20, range: 1, attackCooldown: 1.3, sight: 6, cost: { food: 140, gold: 40, favor: 20 }, trainTime: 22, pop: 3 },
  frost_giant:    { hp: 450, speed: 1.6, attack: 24, range: 1, attackCooldown: 1.8, sight: 6, cost: { food: 220, favor: 30 }, trainTime: 28, pop: 5 },
  mountain_giant: { hp: 550, speed: 1.5, attack: 26, range: 1, attackCooldown: 1.9, sight: 6, cost: { food: 260, favor: 35 }, trainTime: 30, pop: 5 },
  fire_giant:     { hp: 500, speed: 1.6, attack: 20, range: 4.5, attackCooldown: 2.0, sight: 7, cost: { gold: 280, favor: 40 }, trainTime: 32, pop: 6 },
  fenris_wolf:    { hp: 260, speed: 3.0, attack: 22, range: 1, attackCooldown: 1.2, sight: 8, cost: { food: 200, favor: 30 }, trainTime: 24, pop: 3 },
  shade:          { hp: 120, speed: 2.2, attack: 10, range: 1, attackCooldown: 1.2, sight: 6, cost: {}, trainTime: 1, pop: 0 },
  serpent:        { hp: 90,  speed: 2.6, attack: 9,  range: 1, attackCooldown: 1.0, sight: 6, cost: {}, trainTime: 1, pop: 0 },
};

/** Units only god powers create (never trainable). */
export const SUMMON_ONLY: ReadonlySet<UnitType> = new Set<UnitType>(['shade', 'serpent']);

// ------------------------------------------------------------------ civilizations

export interface CivFlavor {
  /** Display name for this civ's version of the unit. */
  name: string;
  icon?: string;
  hp?: number; attack?: number; speed?: number; range?: number; attackCooldown?: number;
  sight?: number; pop?: number;
  cost?: Partial<Resources>; trainTime?: number;
  combat?: Partial<Omit<CombatDef, 'src'>>;
}

export interface CivDef {
  id: Civ;
  name: string;
  icon: string;
  /** How this civ earns favor — shown in the UI. */
  favorHow: string;
  units: Partial<Record<UnitType, CivFlavor>>;
  src: DataSource;
}

export const CIVS: Record<Civ, CivDef> = {
  greek: {
    id: 'greek', name: 'Greek', icon: '🏛️',
    favorHow: 'Villagers worship at the Temple (right-click it with villagers).',
    units: {
      swordsman: { name: 'Hoplite', icon: '🛡️', hp: 65, cost: { food: 50, gold: 30 }, combat: { armor: [0.35, 0.25, 0], bonus: { cavalry: 1.6, myth: HUMAN_VS_MYTH } } },
      archer: { name: 'Toxotes', icon: '🏹', range: 5, cost: { food: 40, wood: 40 } },
      knight: { name: 'Hippeus', icon: '🐎', hp: 90, attack: 12, speed: 2.8, cost: { food: 60, gold: 45 } },
      hero: { name: 'Greek Hero', icon: '🦸', hp: 210, attack: 15 },
    },
    src: 'approx',
  },
  egyptian: {
    id: 'egyptian', name: 'Egyptian', icon: '𓂀',
    favorHow: 'Each Temple generates favor on its own (up to 4 Temples).',
    units: {
      swordsman: { name: 'Spearman', icon: '🔱', hp: 50, attack: 8, speed: 2.1, trainTime: 8, cost: { food: 50, gold: 15 }, combat: { bonus: { cavalry: 1.8, myth: HUMAN_VS_MYTH } } },
      archer: { name: 'Slinger', icon: '🪃', hp: 30, attack: 5, cost: { food: 50, wood: 20 }, combat: { bonus: { archer: 1.5, infantry: 1.3, myth: HUMAN_VS_MYTH } } },
      knight: { name: 'Camelry', icon: '🐪', hp: 105, attack: 11, speed: 2.5, cost: { food: 60, gold: 55 }, combat: { bonus: { cavalry: 1.5, archer: 1.3, myth: HUMAN_VS_MYTH } } },
      hero: { name: 'Priest', icon: '🧙', hp: 120, attack: 9, range: 6, attackCooldown: 1.6, cost: { food: 100, gold: 120 }, combat: { dmg: 'pierce' } },
    },
    src: 'approx',
  },
  norse: {
    id: 'norse', name: 'Norse', icon: '🪓',
    favorHow: 'Military units earn favor by fighting (damage dealt).',
    units: {
      swordsman: { name: 'Ulfsark', icon: '🪓', hp: 60, attack: 11, cost: { food: 50, gold: 30 }, combat: { armor: [0.2, 0.2, 0] } },
      archer: { name: 'Throwing Axeman', icon: '🪓', hp: 45, attack: 8, range: 3, cost: { food: 50, gold: 35 }, combat: { dmg: 'hack', bonus: { infantry: 1.4, myth: HUMAN_VS_MYTH } } },
      knight: { name: 'Raiding Cavalry', icon: '🐴', hp: 80, attack: 12, speed: 3.0, cost: { food: 65, gold: 40 } },
      hero: { name: 'Hersir', icon: '⚔️', hp: 200, attack: 14 },
    },
    src: 'approx',
  },
};

// ------------------------------------------------------------------ favor

export const FAVOR_CAP = 100;
export const FAVOR_RULES = {
  /** Greek: per villager worshipping at a Temple, per second (max counted). */
  greekPerWorshipper: 0.06,
  greekMaxWorshippers: 10,
  /** Egyptian: per completed Temple, per second (max counted). */
  egyptianPerTemple: 0.12,
  egyptianMaxTemples: 4,
  /** Norse: favor per point of damage dealt by non-villager units… */
  norsePerDamage: 0.02,
  /** …plus a trickle per completed Temple. */
  norsePerTemple: 0.03,
  src: 'approx' as DataSource,
};

// ------------------------------------------------------------------ god powers

export type PowerKind = 'strike' | 'heal' | 'summon' | 'resource' | 'gather_boost' | 'shield' | 'freeze' | 'speed' | 'reveal';

export interface PowerDef {
  id: PowerId;
  name: string;
  icon: string;
  kind: PowerKind;
  /** Needs a map target (click on the map after pressing the button). */
  targeted: boolean;
  radius?: number;
  /** Effect duration (s). Absent = instant. */
  duration?: number;
  /** strike: instant damage per enemy unit in radius. */
  damage?: number;
  /** strike over time: damage per second to each enemy in radius. */
  dps?: number;
  /** strike: multiplier for buildings. */
  buildingMul?: number;
  /** heal: hp restored to each own unit/building in radius. */
  heal?: number;
  summon?: { unit: UnitType; count: number };
  resources?: Partial<Resources>;
  gather?: { res: ResourceType; mul: number };
  /** shield: flat armor added to own units inside the radius. */
  armor?: number;
  speedMul?: number;
  /** FX color on the map. */
  color: string;
  desc: string;
  src: DataSource;
}

const P = (d: Omit<PowerDef, 'src'>): PowerDef => ({ ...d, src: 'approx' });

export const POWERS: Record<PowerId, PowerDef> = {
  // major gods
  thunderbolt:  P({ id: 'thunderbolt', name: 'Thunderbolt', icon: '⚡', kind: 'strike', targeted: true, radius: 1.5, damage: 300, buildingMul: 0.5, color: '#fde047', desc: 'A bolt from the sky obliterates the units at the target.' }),
  earthquake:   P({ id: 'earthquake', name: 'Earthquake', icon: '🌋', kind: 'strike', targeted: true, radius: 6, duration: 10, dps: 8, buildingMul: 6, color: '#a16207', desc: 'The ground shakes for 10s, wrecking buildings and units in the area.' }),
  shades:       P({ id: 'shades', name: 'Shades of the Dead', icon: '👻', kind: 'summon', targeted: true, summon: { unit: 'shade', count: 5 }, color: '#94a3b8', desc: 'Summons 5 Shades (no population) at the target.' }),
  rain:         P({ id: 'rain', name: 'Rain', icon: '🌧️', kind: 'gather_boost', targeted: false, duration: 90, gather: { res: 'food', mul: 1.5 }, color: '#38bdf8', desc: 'Food gathering +50% for 90s.' }),
  sacred_ward:  P({ id: 'sacred_ward', name: 'Sacred Ward', icon: '🛡️', kind: 'shield', targeted: true, radius: 9, duration: 45, armor: 4, color: '#facc15', desc: 'Your units inside the ward take 4 less damage per hit for 45s.' }),
  serpents:     P({ id: 'serpents', name: 'Plague of Serpents', icon: '🐍', kind: 'summon', targeted: true, summon: { unit: 'serpent', count: 6 }, color: '#65a30d', desc: 'Summons 6 Serpents (no population) at the target.' }),
  dwarven_gold: P({ id: 'dwarven_gold', name: 'Dwarven Gold', icon: '💰', kind: 'resource', targeted: false, resources: { gold: 350 }, color: '#eab308', desc: 'Instantly gain 350 gold.' }),
  odins_call:   P({ id: 'odins_call', name: "Odin's Call", icon: '🦅', kind: 'heal', targeted: true, radius: 10, heal: 400, color: '#4ade80', desc: 'Heals your units and buildings in the area by 400.' }),
  trickery:     P({ id: 'trickery', name: 'Trickery', icon: '🌀', kind: 'freeze', targeted: true, radius: 7, duration: 12, color: '#c084fc', desc: 'Enemy units in the area are frozen for 12s.' }),
  // Greek minor gods
  restoration:  P({ id: 'restoration', name: 'Restoration', icon: '✨', kind: 'heal', targeted: true, radius: 12, heal: 500, color: '#86efac', desc: 'Heals your units and buildings in a wide area by 500.' }),
  swift_winds:  P({ id: 'swift_winds', name: 'Swift Winds', icon: '💨', kind: 'speed', targeted: false, duration: 30, speedMul: 1.4, color: '#e0f2fe', desc: 'All your units move 40% faster for 30s.' }),
  sunbeam:      P({ id: 'sunbeam', name: 'Sunbeam', icon: '☀️', kind: 'strike', targeted: true, radius: 5, duration: 8, dps: 22, buildingMul: 1, color: '#fb923c', desc: 'Searing light burns enemies in the area for 8s.' }),
  bounty:       P({ id: 'bounty', name: 'Bounty', icon: '🍇', kind: 'resource', targeted: false, resources: { food: 300, wood: 300 }, color: '#a855f7', desc: 'Instantly gain 300 food and 300 wood.' }),
  forge_ward:   P({ id: 'forge_ward', name: 'Forge Ward', icon: '⚒️', kind: 'shield', targeted: true, radius: 12, duration: 45, armor: 6, color: '#f97316', desc: 'Your units inside the ward take 6 less damage per hit for 45s.' }),
  meteor:       P({ id: 'meteor', name: 'Meteor', icon: '☄️', kind: 'strike', targeted: true, radius: 6, damage: 160, buildingMul: 3, color: '#ef4444', desc: 'A meteor crashes down, heavily damaging everything in the area.' }),
  // Egyptian minor gods
  prosperity:   P({ id: 'prosperity', name: 'Prosperity', icon: '🪙', kind: 'gather_boost', targeted: false, duration: 90, gather: { res: 'gold', mul: 1.6 }, color: '#fde047', desc: 'Gold gathering +60% for 90s.' }),
  ancestors:    P({ id: 'ancestors', name: 'Ancestors', icon: '💀', kind: 'summon', targeted: true, summon: { unit: 'shade', count: 4 }, color: '#94a3b8', desc: 'Raises 4 Shades (no population) at the target.' }),
  sandstorm:    P({ id: 'sandstorm', name: 'Sandstorm', icon: '🌪️', kind: 'strike', targeted: true, radius: 7, duration: 15, dps: 10, buildingMul: 1, color: '#d6b36a', desc: 'A sandstorm grinds enemies in the area for 15s.' }),
  rebirth:      P({ id: 'rebirth', name: 'Rebirth', icon: '🌿', kind: 'heal', targeted: true, radius: 12, heal: 600, color: '#4ade80', desc: 'Heals your units and buildings in a wide area by 600.' }),
  skyfire:      P({ id: 'skyfire', name: 'Skyfire', icon: '🔥', kind: 'strike', targeted: true, radius: 6, damage: 180, buildingMul: 3, color: '#f97316', desc: 'Fire rains on the area, heavily damaging everything in it.' }),
  wisdom:       P({ id: 'wisdom', name: 'Wisdom', icon: '📜', kind: 'resource', targeted: false, resources: { gold: 400, favor: 40 }, color: '#60a5fa', desc: 'Instantly gain 400 gold and 40 favor.' }),
  // Norse minor gods
  harvest:      P({ id: 'harvest', name: 'Harvest', icon: '🌲', kind: 'gather_boost', targeted: false, duration: 90, gather: { res: 'wood', mul: 1.6 }, color: '#22c55e', desc: 'Wood gathering +60% for 90s.' }),
  watchful_eye: P({ id: 'watchful_eye', name: 'Watchful Eye', icon: '👁️', kind: 'reveal', targeted: true, radius: 28, duration: 90, color: '#bae6fd', desc: 'Reveals a huge area of the map for 90s.' }),
  frost:        P({ id: 'frost', name: 'Frost', icon: '❄️', kind: 'freeze', targeted: true, radius: 8, duration: 15, color: '#7dd3fc', desc: 'Enemy units in the area are frozen solid for 15s.' }),
  tidal_bounty: P({ id: 'tidal_bounty', name: 'Tidal Bounty', icon: '🌊', kind: 'resource', targeted: false, resources: { food: 450 }, color: '#0ea5e9', desc: 'Instantly gain 450 food.' }),
  hellfire:     P({ id: 'hellfire', name: 'Hellfire', icon: '🔥', kind: 'strike', targeted: true, radius: 7, duration: 10, dps: 26, buildingMul: 1.5, color: '#dc2626', desc: 'Flames of Helheim burn the area for 10s.' }),
  valor:        P({ id: 'valor', name: 'Valor', icon: '🗡️', kind: 'shield', targeted: true, radius: 12, duration: 45, armor: 6, color: '#e5e7eb', desc: 'Your units inside the area take 6 less damage per hit for 45s.' }),
};

// ------------------------------------------------------------------ gods

export interface GodBonus {
  startFavor?: number;
  /** Flat attack added to a class. */
  attack?: { cls: UnitClass; add: number };
  /** Flat armor (damage reduction per hit) for a class. */
  flatArmor?: { cls: UnitClass; add: number };
  speed?: { cls: UnitClass; mul: number };
  /** Villager gather multiplier for one resource. */
  gather?: { res: ResourceType; mul: number };
  /** Fraction off technology costs. */
  techDiscount?: number;
  /** Fraction off the favor cost of myth units. */
  mythFavorDiscount?: number;
  /** Fraction off hero costs. */
  heroDiscount?: number;
  /** HP/s regenerated by human military units. */
  regen?: number;
  text: string;
}

export interface MajorGodDef {
  id: MajorGodId; civ: Civ; name: string; icon: string; power: PowerId; bonus: GodBonus; src: DataSource;
}
export interface MinorGodDef {
  id: MinorGodId; civ: Civ; age: 2 | 3 | 4; name: string; icon: string; myth: UnitType; power: PowerId; src: DataSource;
}

export const MAJOR_GODS: Record<MajorGodId, MajorGodDef> = {
  zeus:     { id: 'zeus', civ: 'greek', name: 'Zeus', icon: '⚡', power: 'thunderbolt', bonus: { startFavor: 25, attack: { cls: 'infantry', add: 1 }, text: 'Starts with 25 favor; infantry +1 attack.' }, src: 'approx' },
  poseidon: { id: 'poseidon', civ: 'greek', name: 'Poseidon', icon: '🔱', power: 'earthquake', bonus: { speed: { cls: 'cavalry', mul: 1.15 }, text: 'Cavalry move 15% faster.' }, src: 'approx' },
  hades:    { id: 'hades', civ: 'greek', name: 'Hades', icon: '💀', power: 'shades', bonus: { attack: { cls: 'archer', add: 1 }, text: 'Archers +1 attack.' }, src: 'approx' },
  ra:       { id: 'ra', civ: 'egyptian', name: 'Ra', icon: '☀️', power: 'rain', bonus: { gather: { res: 'food', mul: 1.1 }, text: 'Villagers gather food 10% faster.' }, src: 'approx' },
  isis:     { id: 'isis', civ: 'egyptian', name: 'Isis', icon: '🌙', power: 'sacred_ward', bonus: { techDiscount: 0.15, text: 'Technologies cost 15% less.' }, src: 'approx' },
  set:      { id: 'set', civ: 'egyptian', name: 'Set', icon: '🐍', power: 'serpents', bonus: { mythFavorDiscount: 0.2, text: 'Myth units cost 20% less favor.' }, src: 'approx' },
  thor:     { id: 'thor', civ: 'norse', name: 'Thor', icon: '🔨', power: 'dwarven_gold', bonus: { flatArmor: { cls: 'infantry', add: 1 }, text: 'Infantry +1 armor.' }, src: 'approx' },
  odin:     { id: 'odin', civ: 'norse', name: 'Odin', icon: '🦅', power: 'odins_call', bonus: { regen: 0.4, text: 'Human soldiers regenerate 0.4 HP/s.' }, src: 'approx' },
  loki:     { id: 'loki', civ: 'norse', name: 'Loki', icon: '🌀', power: 'trickery', bonus: { heroDiscount: 0.25, text: 'Heroes cost 25% less.' }, src: 'approx' },
};

export const MINOR_GODS: Record<MinorGodId, MinorGodDef> = {
  athena:     { id: 'athena', civ: 'greek', age: 2, name: 'Athena', icon: '🦉', myth: 'minotaur', power: 'restoration', src: 'approx' },
  hermes:     { id: 'hermes', civ: 'greek', age: 2, name: 'Hermes', icon: '🪽', myth: 'centaur', power: 'swift_winds', src: 'approx' },
  apollo:     { id: 'apollo', civ: 'greek', age: 3, name: 'Apollo', icon: '☀️', myth: 'manticore', power: 'sunbeam', src: 'approx' },
  dionysus:   { id: 'dionysus', civ: 'greek', age: 3, name: 'Dionysus', icon: '🍇', myth: 'hydra', power: 'bounty', src: 'approx' },
  hephaestus: { id: 'hephaestus', civ: 'greek', age: 4, name: 'Hephaestus', icon: '⚒️', myth: 'colossus', power: 'forge_ward', src: 'approx' },
  artemis:    { id: 'artemis', civ: 'greek', age: 4, name: 'Artemis', icon: '🏹', myth: 'chimera', power: 'meteor', src: 'approx' },
  bast:       { id: 'bast', civ: 'egyptian', age: 2, name: 'Bast', icon: '🐈', myth: 'sphinx', power: 'prosperity', src: 'approx' },
  anubis:     { id: 'anubis', civ: 'egyptian', age: 2, name: 'Anubis', icon: '🐺', myth: 'anubite', power: 'ancestors', src: 'approx' },
  sekhmet:    { id: 'sekhmet', civ: 'egyptian', age: 3, name: 'Sekhmet', icon: '🦁', myth: 'scorpion_man', power: 'sandstorm', src: 'approx' },
  osiris:     { id: 'osiris', civ: 'egyptian', age: 3, name: 'Osiris', icon: '🌿', myth: 'mummy', power: 'rebirth', src: 'approx' },
  horus:      { id: 'horus', civ: 'egyptian', age: 4, name: 'Horus', icon: '🦅', myth: 'avenger', power: 'skyfire', src: 'approx' },
  thoth:      { id: 'thoth', civ: 'egyptian', age: 4, name: 'Thoth', icon: '📜', myth: 'phoenix', power: 'wisdom', src: 'approx' },
  freyja:     { id: 'freyja', civ: 'norse', age: 2, name: 'Freyja', icon: '🌸', myth: 'valkyrie', power: 'harvest', src: 'approx' },
  heimdall:   { id: 'heimdall', civ: 'norse', age: 2, name: 'Heimdall', icon: '📯', myth: 'einherjar', power: 'watchful_eye', src: 'approx' },
  skadi:      { id: 'skadi', civ: 'norse', age: 3, name: 'Skadi', icon: '❄️', myth: 'frost_giant', power: 'frost', src: 'approx' },
  njord:      { id: 'njord', civ: 'norse', age: 3, name: 'Njord', icon: '🌊', myth: 'mountain_giant', power: 'tidal_bounty', src: 'approx' },
  hel:        { id: 'hel', civ: 'norse', age: 4, name: 'Hel', icon: '🔥', myth: 'fire_giant', power: 'hellfire', src: 'approx' },
  tyr:        { id: 'tyr', civ: 'norse', age: 4, name: 'Tyr', icon: '🐺', myth: 'fenris_wolf', power: 'valor', src: 'approx' },
};

export const MAJOR_GOD_IDS = Object.keys(MAJOR_GODS) as MajorGodId[];

/** The two minor gods a civ chooses between when reaching `age` (2..4). */
export function minorGodOptions(civ: Civ, age: number): MinorGodDef[] {
  return Object.values(MINOR_GODS).filter((g) => g.civ === civ && g.age === age);
}

/** Resolve 'random' (or junk) to a real major god. `rnd` in [0,1). */
export function resolveGod(pick: GodPick | string | undefined, rnd: number): MajorGodId {
  if (pick && pick !== 'random' && (MAJOR_GODS as Record<string, MajorGodDef>)[pick]) return pick as MajorGodId;
  return MAJOR_GOD_IDS[Math.floor(rnd * MAJOR_GOD_IDS.length) % MAJOR_GOD_IDS.length];
}

// ------------------------------------------------------------------ myth unit look (placeholder art)
/** Visual placeholder spec for myth units/heroes (procedural, original art). */
export const MYTH_LOOK: Partial<Record<UnitType, { glyph: string; scale: number; body: string; quadruped?: boolean; flying?: boolean }>> = {
  hero:           { glyph: '★', scale: 1.05, body: '#d4af37' },
  minotaur:       { glyph: '🐂', scale: 1.35, body: '#7c4a2d' },
  centaur:        { glyph: '🏹', scale: 1.3, body: '#a0703c', quadruped: true },
  manticore:      { glyph: '🦂', scale: 1.4, body: '#b45309', quadruped: true },
  hydra:          { glyph: '🐉', scale: 1.55, body: '#166534', quadruped: true },
  colossus:       { glyph: '🗿', scale: 2.0, body: '#a8a29e' },
  chimera:        { glyph: '🔥', scale: 1.5, body: '#9a3412', quadruped: true },
  sphinx:         { glyph: '🦁', scale: 1.45, body: '#d6b36a', quadruped: true },
  anubite:        { glyph: '🐺', scale: 1.15, body: '#1f2937' },
  scorpion_man:   { glyph: '🦂', scale: 1.4, body: '#78350f' },
  mummy:          { glyph: '🧟', scale: 1.15, body: '#e7e5e4' },
  avenger:        { glyph: '🦅', scale: 1.55, body: '#1e3a8a' },
  phoenix:        { glyph: '🔥', scale: 1.5, body: '#ea580c', flying: true },
  valkyrie:       { glyph: '🪽', scale: 1.25, body: '#e2e8f0', quadruped: true },
  einherjar:      { glyph: '⚔️', scale: 1.2, body: '#fbbf24' },
  frost_giant:    { glyph: '❄️', scale: 1.85, body: '#7dd3fc' },
  mountain_giant: { glyph: '⛰️', scale: 1.95, body: '#57534e' },
  fire_giant:     { glyph: '🔥', scale: 1.95, body: '#b91c1c' },
  fenris_wolf:    { glyph: '🐺', scale: 1.3, body: '#4b5563', quadruped: true },
  shade:          { glyph: '👻', scale: 1.0, body: '#94a3b8' },
  serpent:        { glyph: '🐍', scale: 0.95, body: '#4d7c0f', quadruped: true },
};

/** Display name for each new unit type (civ heroes are renamed via CIVS). */
export const MYTH_NAMES: Partial<Record<UnitType, string>> = {
  hero: 'Hero', minotaur: 'Minotaur', centaur: 'Centaur', manticore: 'Manticore', hydra: 'Hydra',
  colossus: 'Colossus', chimera: 'Chimera', sphinx: 'Sphinx', anubite: 'Anubite',
  scorpion_man: 'Scorpion Man', mummy: 'Mummy', avenger: 'Avenger', phoenix: 'Phoenix',
  valkyrie: 'Valkyrie', einherjar: 'Einherjar', frost_giant: 'Frost Giant',
  mountain_giant: 'Mountain Giant', fire_giant: 'Fire Giant', fenris_wolf: 'Fenris Wolf Brood',
  shade: 'Shade', serpent: 'Serpent',
};

export const MYTH_DESCS: Partial<Record<UnitType, string>> = {
  hero: 'Hero: strong vs myth units (x3 damage). Trained at the Temple.',
  minotaur: 'Bruiser that also batters buildings.',
  centaur: 'Fast ranged myth cavalry; good vs infantry.',
  manticore: 'Ranged volleys that splash nearby enemies.',
  hydra: 'Regenerates constantly; hard to wear down.',
  colossus: 'Huge, slow and devastating vs buildings.',
  chimera: 'Fire breath that splashes groups.',
  sphinx: 'Tough myth unit; strong vs buildings.',
  anubite: 'Very fast, hits hard; hunts archers.',
  scorpion_man: 'Heavy melee; strong vs infantry and cavalry.',
  mummy: 'Ranged curse with splash.',
  avenger: 'Whirling blades hit everything around it.',
  phoenix: 'Long-range fire with splash.',
  valkyrie: 'Fast myth cavalry that regenerates; strong vs cavalry.',
  einherjar: 'Elite warrior; strong vs infantry.',
  frost_giant: 'Massive melee brawler.',
  mountain_giant: 'Massive; smashes buildings.',
  fire_giant: 'Massive ranged fire with splash.',
  fenris_wolf: 'Fast pack hunter; savages villagers.',
  shade: 'Summoned spirit. Costs no population.',
  serpent: 'Summoned serpent. Costs no population.',
};

// ------------------------------------------------------------------ effective stats

export interface EffectiveUnitDef extends MythUnitBase {
  combat: CombatDef;
  name: string;
  icon?: string;
}

/** Overrides imported from original data: unit type → partial base stats/combat. */
export interface AomOverrides {
  units?: Partial<Record<UnitType, Partial<MythUnitBase> & { combat?: Partial<CombatDef> }>>;
  civUnits?: Partial<Record<Civ, Partial<Record<UnitType, Partial<CivFlavor>>>>>;
  powers?: Partial<Record<PowerId, Partial<PowerDef>>>;
  favor?: Partial<typeof FAVOR_RULES>;
  meta?: { edition?: string; importedAt?: string; files?: string[] };
}

/** Apply imported ORIGINAL data on top of the approximations (mutates tables,
 *  flips `src` to 'original' where values were replaced). Called once at load. */
export function applyOverrides(o: AomOverrides, base: Record<UnitType, MythUnitBase>): string[] {
  const touched: string[] = [];
  for (const [type, ov] of Object.entries(o.units ?? {}) as [UnitType, NonNullable<AomOverrides['units']>[UnitType]][]) {
    if (!ov) continue;
    const { combat, ...stats } = ov;
    if (base[type]) Object.assign(base[type], stats);
    if (combat) Object.assign(COMBAT[type], combat, { src: 'original' });
    touched.push(`unit:${type}`);
  }
  for (const [civ, units] of Object.entries(o.civUnits ?? {}) as [Civ, Partial<Record<UnitType, Partial<CivFlavor>>>][]) {
    for (const [type, fl] of Object.entries(units ?? {}) as [UnitType, Partial<CivFlavor>][]) {
      const cur = CIVS[civ].units[type];
      CIVS[civ].units[type] = { ...(cur ?? { name: type }), ...fl };
      touched.push(`civ:${civ}:${type}`);
    }
    CIVS[civ].src = 'original';
  }
  for (const [id, pd] of Object.entries(o.powers ?? {}) as [PowerId, Partial<PowerDef>][]) {
    Object.assign(POWERS[id], pd, { src: 'original' });
    touched.push(`power:${id}`);
  }
  if (o.favor) {
    Object.assign(FAVOR_RULES, o.favor, { src: 'original' });
    touched.push('favor');
  }
  return touched;
}

/** Cost keys in display order. */
export const COST_ORDER: CostKey[] = ['food', 'wood', 'gold', 'stone', 'favor'];
