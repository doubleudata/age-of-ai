// Map registry: built-in random-map definitions + extra ones from disk.
//   data/rms/*.json  — RmDef (e.g. adapted from an AoM .xs by tools/aom-pipeline)
//   data/maps/*.json — ScenarioMap (e.g. converted from a Retold .mythscn)
// Override the folder with AGE_DATA_DIR. Bad files are skipped with a log line.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_RMS, validateScenarioMap } from '@age/shared';
import type { MapListEntry, RmDef, ScenarioMap } from '@age/shared';

const DATA_DIR = process.env.AGE_DATA_DIR
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

export type MapSource = { rm: RmDef } | { scenario: ScenarioMap };

let rms = new Map<string, RmDef>();
let scenarios = new Map<string, ScenarioMap>();

function readJsonDir(dir: string): { id: string; data: unknown }[] {
  if (!existsSync(dir)) return [];
  const out: { id: string; data: unknown }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push({ id: f.replace(/\.json$/, ''), data: JSON.parse(readFileSync(path.join(dir, f), 'utf8')) });
    } catch (e) {
      console.warn(`[maps] skipping ${f}: ${(e as Error).message}`);
    }
  }
  return out;
}

function validRm(d: unknown): d is RmDef {
  const r = d as RmDef;
  return !!r && typeof r.name === 'string' && typeof r.tilesPerPlayer === 'number' && typeof r.playerRing === 'number'
    && Array.isArray(r.perPlayer) && Array.isArray(r.scattered) && !!r.forests;
}

/** (Re)load everything. Called at startup; cheap enough to call again. */
export function loadMaps(dir = DATA_DIR): void {
  rms = new Map(BUILTIN_RMS.map((r) => [r.id, r]));
  scenarios = new Map();
  for (const { id, data } of readJsonDir(path.join(dir, 'rms'))) {
    if (validRm(data)) rms.set(id, { ...data, id, origin: data.origin ?? 'adapted' });
    else console.warn(`[maps] data/rms/${id}.json is not a valid random-map definition`);
  }
  for (const { id, data } of readJsonDir(path.join(dir, 'maps'))) {
    const err = validateScenarioMap(data);
    if (err) console.warn(`[maps] data/maps/${id}.json: ${err}`);
    else scenarios.set(id, data as ScenarioMap);
  }
  console.log(`[maps] ${rms.size} random maps, ${scenarios.size} scenario maps`);
}

export function mapList(): MapListEntry[] {
  return [
    ...[...rms.values()].map((r): MapListEntry => ({ id: `rm:${r.id}`, name: r.name, desc: r.desc, kind: 'rm', origin: r.origin })),
    ...[...scenarios.entries()].map(([id, s]): MapListEntry => ({ id: `scn:${id}`, name: s.name, desc: s.desc ?? '', kind: 'scenario', maxPlayers: s.starts.length, origin: s.source?.tool })),
  ];
}

/** Resolve a map id ('rm:x' / 'scn:x'). Undefined = built-in terrain. */
export function resolveMap(mapId: string | undefined): MapSource | undefined {
  if (!mapId) return undefined;
  if (mapId.startsWith('rm:')) {
    const r = rms.get(mapId.slice(3));
    return r ? { rm: r } : undefined;
  }
  if (mapId.startsWith('scn:')) {
    const s = scenarios.get(mapId.slice(4));
    return s ? { scenario: s } : undefined;
  }
  return undefined;
}

export function mapExists(mapId: string): boolean {
  return mapId === '' || resolveMap(mapId) !== undefined;
}

// Load at import time so every consumer (server, tests) sees the registry.
loadMaps();
