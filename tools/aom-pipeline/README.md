# Age of Mythology → Age of AI content pipeline

Import content **from your own copy** of Age of Mythology into the browser game.
Nothing from the game ships with this repo; generated output goes to `.gitignored`
folders (`client/public/aom/`, `shared/src/aom-overrides.ts`). Don't commit it
to a public repository.

AoM assets can't be rendered directly. The browser needs PNG, JSON and our own sprite
sheets, so there are two stages:

| Stage | Tool | Runs where | Output |
|---|---|---|---|
| 1. Extract | CryBar (Retold) or ptasev/ModHQ tools (Original/EE) | your PC | plain XML, TGA/PNG, GLB/glTF, scenario XML, `.xs` |
| 2. Convert | `tools/aom-pipeline/*.mjs` (this folder) | Node 20 + Chromium | asset pack + map JSON the game loads |

---

## Stage 1a: Age of Mythology: Retold (recommended, mostly automatic)

Install [CryBarEditor](https://github.com/CryShana/CryBarEditor) (MIT). It has a GUI
and a `crybar` CLI (.NET 10). The game folder is usually
`…/steamapps/common/Age of Mythology Retold/game`.

```sh
# data (XMB → XML): proto, techtree, god powers
crybar bar export game/data/Data.bar --all --decompress --convert -o extract/
# UI icons (DDT → TGA; stage 2 converts TGA → PNG)
crybar bar export game/art/ArtUI.bar --filter "*icons*" --decompress --convert -o extract/
# scenarios (.mythscn → XML)
crybar convert scenario-to-xml path/to/map.mythscn -o extract/scenarios/map.xml
# random-map scripts are plain .xs inside the game folder/BARs
crybar bar export game/data/Data.bar --filter "*random_maps*" --decompress -o extract/
```

**Models + animations:** use the **CryBarEditor app**, not the CLI. The CLI's
`convert tmm-to-glb` writes geometry only. In the app, select the unit `.tmm`
files and choose *Export* with **Export TMM materials** and **Export animations** on.
That gives one GLB per unit with its textures and TMA animation clips. Put the GLBs
anywhere under `extract/`. (Exact BAR names vary between patches; `crybar bar list`
shows them.)

## Stage 1b: Original (2002) / Extended Edition (manual steps)

* **Data / textures / BARs:** ptasev's *AoM File Converter* (drag and drop; .NET 6):
  `.bar` → folder, `.xmb` → `.xml`, `.ddt` → image. Weesals' ModHQ can also export DDT/BTX.
* **Models:** ptasev's *AoM Model Editor* (Windows/WPF) exports `.brg` (original)
  and `.grn` (EE) to glTF. Animations are separate files (one per anim), so
  export each unit with its idle/walk/attack/death animations into one glTF, or
  merge them in Blender. This is manual per unit.
* **Scenarios** (`.scn/.scx`): the tools can only decompress them; no one has
  documented the format. Rebuild these by hand (see "Maps" below).

---

## Stage 2: convert into a browser pack

```sh
npm install                      # brings three + playwright-core (dev)
node tools/aom-pipeline/ingest.mjs --extract extract/ [--models models.json] [--data]
```

* **icons:** each unit's proto `<icon>` path is matched to a PNG/TGA (TGA is converted).
* **sprites:** each GLB is rendered in headless Chromium (three.js, orthographic
  camera at the game's dimetric angle) into **8-direction sprite sheets** with
  idle/walk/attack/gather/death rows, plus a **player-colour mask** from the materials
  whose name matches `--mask` (default `player|team|pcolor|pc`). Models that mark team
  colour in their textures instead of a named material aren't detected, so check the bake warning:
  if nothing matched, units are drawn without team colours (only the selection ring)
  until you split the team-coloured parts into their own material in Blender.
  Models are matched by proto name automatically. Override with `models.json`:
  `{ "swordsman:greek": "art/greek/units/hoplite.glb", "minotaur": "…" }`.
* **techtree.json:** the original tech list (cost, time, age, prerequisites) as reference.
* **`--data`:** original unit stats → `shared/src/aom-overrides.ts`
  (see `docs/AOM_DATA.md`; the server and all clients must use the same build).
* `import-report.json` lists every match and every missing icon or model.

Then reload the game. Units with a sprite sheet use it; everything else keeps the
original procedural art. If Chromium isn't found, set `AOM_CHROMIUM=/path/to/chrome`.

One model by hand: `node tools/aom-pipeline/bake-sprites.mjs model.glb --name id --out dir
[--frame 128 --ppm 40 --dirs 8 --fps 10 --max-frames 12 --yaw 0 --mask regex --anim walk=Run_A,attack=Attack_B]`.

## Maps

```sh
# Retold scenario XML → data/maps/<id>.json (tiles, cliffs from slope, water, resources, starts)
node tools/aom-pipeline/scenario-to-map.mjs extract/scenarios/map.xml [--id my_map] [--cliff 2.2]
# random-map .xs → data/rms/<id>.json (static adaptation; review the notes it prints)
node tools/aom-pipeline/rm-from-xs.mjs extract/random_maps/mediterranean.xs
```

The server lists everything in `data/maps` and `data/rms` in the room's map picker
(`AGE_DATA_DIR` overrides the folder). Scenario maps need one start per player.
Elevation isn't rendered; steep slopes become impassable cliffs.

## Tests

```sh
AOM_CHROMIUM=… node scripts/pipeline_test.mjs     # synthetic fixtures, no game data
INSTALL_PACK=1 node scripts/pipeline_test.mjs     # also installs the synthetic pack for a visual check
npx tsx scripts/maps_test.ts
```
