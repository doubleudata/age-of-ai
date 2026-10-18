# Age of Mythology data: what's original, what's approximate

Every Age of Mythology value in this game lives in `shared/src/mythology.ts`
and carries a `src` tag:

- **`approx`**: an approximation of AoM's *design* (which god grants which myth
  unit, what counters what, how each civilization earns favor), expressed at
  this engine's scale (villager 30 HP, 1 tile ≈ 2 m). **Nothing in the repo was
  read from the original game.** Right now every value is `approx`.
- **`original`**: a value replaced by `scripts/aom_import.mjs` from game files
  you own.

## Importing the original values

You need a copy of Age of Mythology. The tools in
[ptasev/Age-of-Mythology](https://github.com/ptasev/Age-of-Mythology) contain
no game data; they document the file formats, which the importer here
re-implements in Node, so no Windows or .NET is needed.

| File | Holds |
|---|---|
| `proto.xml` (+ `protox.xml` for The Titans) | unit HP, speed, line of sight, attacks, damage bonuses, armor, cost, train time, pop |
| `techtree.xml` (+ `techtreex.xml`) | ages, minor god choices, upgrades *(not imported yet)* |
| god power data (per-faction files in Retold) | god powers *(not imported yet)* |

Where to find them:

- **Original / Extended Edition**: the `data` folder, often packed as
  `.xml.xmb` inside `.bar` archives.
- **Retold**: inside `game\data\data.bar`. Its `.bar` layout may be newer than
  the original's. If the importer rejects it, export the files with a Retold
  resource manager using "convert .xmb to .xml" and pass the `.xml` files.

```bash
# preview what matches, write nothing
node scripts/aom_import.mjs path/to/proto.xml path/to/protox.xml --dry-run
# write shared/src/aom-overrides.ts
node scripts/aom_import.mjs path/to/proto.xml path/to/protox.xml
# keep the filled-in file out of commits
git update-index --skip-worktree shared/src/aom-overrides.ts
```

The importer prints every unit it matched and every unit it didn't. Misses keep
their approximations. If your edition names a unit differently, add the name to
`PROTO_NAMES` at the top of the script.

**Scale caveat.** Imported units arrive at AoM's scale (e.g. a Hoplite with
~100+ HP) while buildings, towers and the generic units the importer doesn't
cover stay at this engine's scale. For a fully faithful balance, buildings and
tower arrows need importing too; that's the next step for the importer.
Distances convert at `METERS_PER_TILE = 2`.

**Status.** The importer is tested against synthetic `.xml` / `.xmb` / `.bar`
files written to the documented formats (`scripts/aom_import_test.ts`). It has
**not** been run against real game files yet, and the proto field names it
reads (`maxhitpoints`, `maxvelocity`, `los`, `protoaction`/`damage`/`rof`,
`armor type=…`, `damagebonus type=…`, `cost resourcetype=…`) are best-known
names. Expect to adjust them on the first real import.

Don't commit a filled-in `aom-overrides.ts` to a public repository.

## What's modeled (all `approx` today)

- **3 civilizations × 3 major gods.** Greek: Zeus, Poseidon, Hades. Egyptian:
  Ra, Isis, Set. Norse: Thor, Odin, Loki. Each gives a passive bonus and one
  god power.
- **Minor gods.** At each age-up (Classical, Heroic, Mythic) you pick one of
  two minor gods for your civilization. Each unlocks a myth unit at the Temple
  and a god power. That's 18 myth units and 27 god powers in total.
- **Favor** (cap 100), earned differently per civ. Greek: villagers worship at
  the Temple. Egyptian: Temples generate it on their own. Norse: military units
  earn it by dealing damage.
- **Civ units.** Hoplite / Toxotes / Hippeus, Spearman / Slinger / Camelry,
  Ulfsark / Throwing Axeman / Raiding Cavalry, and a hero per civ (Greek Hero,
  Priest, Hersir).
- **Combat.** Hack / pierce / crush damage, percentage armor per type, and
  class counters: infantry > cavalry > archers > infantry, heroes ×3 vs myth,
  human soldiers weak vs myth. Plus splash, regeneration and bonus vs buildings.
- **God powers are single-use** (classic AoM). Kinds: strike (instant or over
  time), heal, summon, resource, gather boost, shield, freeze, speed, reveal.

## Known deviations from AoM

- **Stone still exists.** Walls, towers and the TC use it; AoM has no stone.
- **Minor-god options are per civilization**, not per major god.
- **No relics, titans, God-power recharge techs, or AoM-specific
  technologies.** The existing AoE2-style tech tree is kept.
- **Myth-unit names, god names and power names are English** in all three
  languages.
- **Art is original procedural placeholder art**, not AoM assets.
