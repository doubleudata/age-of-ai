// Map sources beyond the built-in terrains:
//  - RANDOM-MAP DEFINITIONS (RmDef): data-driven generators. Built-ins below
//    are ORIGINAL layouts written for Age of AI (inspired by the kinds of maps
//    AoM ships — inland seas, central forests, lake lands — not copies).
//    `tools/aom-pipeline/rm-from-xs.mjs` adapts an AoM random-map .xs script
//    into one of these (partially; see its report).
//  - SCENARIO MAPS (ScenarioMap): a fixed map, e.g. converted from a Retold
//    .mythscn by `tools/aom-pipeline/scenario-to-map.mjs`.
// The server loads extra ones from data/rms/*.json and data/maps/*.json.

import type { NodeType } from './types';

/** Impassable rock (steep slopes of converted AoM heightmaps). */
export const TILE_CLIFF = 3;

export type RmResource = NodeType | 'sheep';

export interface RmPerPlayer {
  type: RmResource;
  /** Clusters per player, items per cluster. */
  clusters: number;
  count: number;
  /** Distance from the Town Center (tiles). */
  minDist: number;
  maxDist: number;
}

export interface RmScattered {
  type: RmResource;
  clusters: number;
  count: number;
  /** Keep this far from any Town Center (tiles). */
  avoidPlayers: number;
}

export type RmWater =
  | { kind: 'center'; radius: number; fish?: number }                 // radius = fraction of half the map
  | { kind: 'lakes'; count: number; minSize: number; maxSize: number; avoidPlayers: number; fish?: number }
  | { kind: 'river'; fords: boolean; fish?: number };

export interface RmDef {
  id: string;
  name: string;
  desc: string;
  /** 'builtin' = shipped with the game; 'adapted' = converted from an AoM .xs. */
  origin: 'builtin' | 'adapted';
  /** Map side = sqrt(players × tilesPerPlayer), clamped to [minSize, maxSize]. */
  tilesPerPlayer: number;
  minSize: number;
  maxSize: number;
  /** Player ring radius as a fraction of half the map side. */
  playerRing: number;
  water?: RmWater[];
  /** A dense forest disc in the middle (radius fraction of half the side). */
  centerForest?: { radius: number; density: number };
  forests: { clusters: number; minSize: number; maxSize: number; avoidPlayers: number };
  perPlayer: RmPerPlayer[];
  scattered: RmScattered[];
  /** Notes from adaptation (what the .xs asked for that isn't supported). */
  notes?: string[];
}

const STD_PLAYER: RmPerPlayer[] = [
  { type: 'berry_bush', clusters: 1, count: 6, minDist: 5, maxDist: 8 },
  { type: 'tree', clusters: 2, count: 8, minDist: 6, maxDist: 10 },
  { type: 'gold_mine', clusters: 1, count: 4, minDist: 7, maxDist: 12 },
  { type: 'stone_mine', clusters: 1, count: 4, minDist: 8, maxDist: 13 },
  { type: 'sheep', clusters: 1, count: 4, minDist: 4, maxDist: 7 },
  { type: 'gold_mine', clusters: 1, count: 3, minDist: 18, maxDist: 26 },
];

export const BUILTIN_RMS: RmDef[] = [
  {
    id: 'inland_sea', name: 'Inland Sea', origin: 'builtin',
    desc: 'A great sea fills the middle of the map, rich in fish; players ring its shores. Land routes run around it.',
    tilesPerPlayer: 3800, minSize: 112, maxSize: 176, playerRing: 0.74,
    water: [{ kind: 'center', radius: 0.42, fish: 14 }],
    forests: { clusters: 16, minSize: 8, maxSize: 14, avoidPlayers: 12 },
    perPlayer: STD_PLAYER,
    scattered: [{ type: 'gold_mine', clusters: 3, count: 3, avoidPlayers: 22 }, { type: 'sheep', clusters: 3, count: 2, avoidPlayers: 14 }],
  },
  {
    id: 'great_forest', name: 'Great Forest', origin: 'builtin',
    desc: 'An old forest grows in the center. Endless wood, but armies must go around it.',
    tilesPerPlayer: 3600, minSize: 104, maxSize: 168, playerRing: 0.72,
    centerForest: { radius: 0.32, density: 0.55 },
    forests: { clusters: 10, minSize: 6, maxSize: 10, avoidPlayers: 12 },
    perPlayer: STD_PLAYER,
    scattered: [{ type: 'gold_mine', clusters: 4, count: 3, avoidPlayers: 20 }, { type: 'stone_mine', clusters: 2, count: 3, avoidPlayers: 20 }],
  },
  {
    id: 'lake_lands', name: 'Lake Lands', origin: 'builtin',
    desc: 'Many small lakes break up the land, with extra gold between the bases.',
    tilesPerPlayer: 3600, minSize: 104, maxSize: 168, playerRing: 0.7,
    water: [{ kind: 'lakes', count: 9, minSize: 12, maxSize: 34, avoidPlayers: 13, fish: 6 }],
    forests: { clusters: 18, minSize: 7, maxSize: 12, avoidPlayers: 12 },
    perPlayer: STD_PLAYER,
    scattered: [{ type: 'gold_mine', clusters: 6, count: 3, avoidPlayers: 18 }, { type: 'sheep', clusters: 4, count: 2, avoidPlayers: 12 }],
  },
  {
    id: 'savanna', name: 'Savanna', origin: 'builtin',
    desc: 'Open grassland with few trees and a watering hole in the middle. Herds roam everywhere.',
    tilesPerPlayer: 3400, minSize: 100, maxSize: 164, playerRing: 0.7,
    water: [{ kind: 'center', radius: 0.14 }],
    forests: { clusters: 7, minSize: 5, maxSize: 9, avoidPlayers: 12 },
    perPlayer: [...STD_PLAYER, { type: 'sheep', clusters: 1, count: 3, minDist: 10, maxDist: 16 }],
    scattered: [{ type: 'sheep', clusters: 8, count: 3, avoidPlayers: 14 }, { type: 'gold_mine', clusters: 4, count: 3, avoidPlayers: 18 }],
  },
];

/** A fixed map (converted scenario or hand-made). */
export interface ScenarioMap {
  format: 'ageofai-map';
  version: 1;
  name: string;
  desc?: string;
  size: number;
  /** One char per tile, row-major: '.' grass, '~' water, '_' shallow, '^' cliff. */
  tiles: string;
  /** Player start positions (tiles). The lobby can't start with more players. */
  starts: { x: number; y: number }[];
  /** Resources/decor. */
  objects: { type: RmResource; x: number; y: number }[];
  /** Optional pre-placed player buildings/units (start index = player slot). */
  buildings?: { start: number; type: string; x: number; y: number }[];
  units?: { start: number; type: string; x: number; y: number }[];
  /** Where it came from + what the converter dropped. */
  source?: { tool?: string; file?: string; notes?: string[] };
}

export const TILE_CHARS: Record<string, number> = { '.': 0, '~': 1, '_': 2, '^': 3 };
export const CHAR_OF_TILE = ['.', '~', '_', '^'];

/** Entry shown in the room's map picker. */
export interface MapListEntry {
  /** 'rm:<id>' or 'scn:<id>'. Built-in terrains are chosen separately. */
  id: string;
  name: string;
  desc: string;
  kind: 'rm' | 'scenario';
  /** Scenario maps: maximum players (start positions). */
  maxPlayers?: number;
  origin?: string;
}

/** Validate an untrusted scenario map (from disk). Returns an error or null. */
export function validateScenarioMap(m: unknown): string | null {
  const s = m as ScenarioMap;
  if (!s || s.format !== 'ageofai-map' || s.version !== 1) return 'not an ageofai-map v1';
  if (!Number.isInteger(s.size) || s.size < 32 || s.size > 256) return 'size must be 32..256';
  if (typeof s.tiles !== 'string' || s.tiles.length !== s.size * s.size) return 'tiles length != size²';
  if (/[^._~^]/.test(s.tiles)) return 'tiles contain unknown characters';
  if (!Array.isArray(s.starts) || s.starts.length < 1 || s.starts.length > 12) return 'starts must list 1..12 positions';
  for (const p of s.starts) if (!(p.x >= 2 && p.y >= 2 && p.x < s.size - 2 && p.y < s.size - 2)) return 'start outside the map';
  if (!Array.isArray(s.objects)) return 'objects missing';
  return null;
}
