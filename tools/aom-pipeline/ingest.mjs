#!/usr/bin/env node
// Age of Mythology → Age of AI asset pipeline (stage 2).
//
// Stage 1 happens with community tools on YOUR copy of the game (see
// tools/aom-pipeline/README.md): extract the .bar archives and convert
//   textures (DDT → PNG), models + animations (TMM/TMA or BRG/GRN → GLB/glTF),
//   data (XMB → XML) and scenarios (.mythscn → XML).
// Stage 2 (this script) turns that folder into a browser asset pack:
//
//   node tools/aom-pipeline/ingest.mjs --extract <folder> [--out client/public/aom]
//        [--models models.json] [--data] [--no-bake] [--chromium path] [--ppm 40] [--frame 128]
//
//   • icons    → <out>/icons/*.png            (unit icons, matched via proto <icon>)
//   • sprites  → <out>/sprites/*.png|json     (GLB baked to 8-direction sheets)
//   • techtree → <out>/techtree.json          (original tech tree, reference)
//   • --data   → shared/src/aom-overrides.ts  (original unit stats, see docs/AOM_DATA.md)
//   • <out>/manifest.json (loaded by the game) + <out>/import-report.json
//
// models.json (optional) overrides the automatic model match:
//   { "swordsman:greek": "art/greek/units/hoplite.glb", "minotaur": "…/minotaur.glb" }
//
// Nothing here is redistributable: keep <out> out of git (it is .gitignored).

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTO_NAMES, indexProto, extractUnit, buildOverrides, loadTrees, parseXml, decompressIfNeeded } from '../../scripts/aom_import.mjs';
import { bakeModel } from './bake-sprites.mjs';
import { launchBrowser } from './lib/browser.mjs';
import { tgaToPng } from './lib/tga.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Index files by normalized basename (without extension, size suffixes). */
function indexByName(files, exts) {
  const m = new Map();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!exts.includes(ext)) continue;
    const base = norm(path.basename(f, ext).replace(/\.xml$/i, ''));
    if (!m.has(base)) m.set(base, f);
  }
  return m;
}

/** Find a file for a game path or name: exact normalized basename, then
 *  "contains" match (longest name wins). */
function findAsset(index, wanted) {
  const w = norm(path.basename(String(wanted).replace(/\\/g, '/')));
  if (!w) return undefined;
  if (index.has(w)) return index.get(w);
  let best;
  for (const [k, f] of index) if ((k.includes(w) || w.includes(k)) && k.length >= 4 && (!best || k.length > best[0].length)) best = [k, f];
  return best?.[1];
}

/** Original tech tree (reference). Field names are best-known; tolerant. */
export function extractTechtree(tree) {
  const out = [];
  const walk = (n) => {
    if (n.name.toLowerCase() === 'tech' && n.attrs.name) {
      const k = (nm) => n.children.filter((c) => c.name.toLowerCase() === nm);
      const cost = {};
      for (const c of k('cost')) cost[(c.attrs.resourcetype ?? c.attrs.ResourceType ?? '').toLowerCase()] = Number(c.text);
      const prereqs = [];
      let age;
      for (const p of k('prereqs')) {
        for (const c of p.children) {
          if (c.name.toLowerCase() === 'techstatus' && c.text) prereqs.push(c.text);
          if (c.name.toLowerCase() === 'specificage' && c.text) age = c.text;
        }
      }
      out.push({
        name: n.attrs.name,
        type: n.attrs.type,
        cost,
        time: Number(k('researchpoints')[0]?.text ?? 0) || undefined,
        icon: k('icon')[0]?.text,
        age,
        prereqs,
        effects: k('effects')[0]?.children.length ?? 0,
        flags: k('flag').map((f) => f.text),
      });
    }
    for (const c of n.children) walk(c);
  };
  walk(tree);
  return out;
}

export async function ingest(opts) {
  const files = listFiles(opts.extract);
  const report = { icons: [], sprites: [], missingIcons: [], missingModels: [], warnings: [], techs: 0, data: null };
  const manifest = { version: 1, generatedAt: new Date().toISOString(), icons: { unit: {} }, sprites: {} };
  const out = opts.out;
  mkdirSync(path.join(out, 'icons'), { recursive: true });
  mkdirSync(path.join(out, 'sprites'), { recursive: true });

  // ---- data files
  const xmlFiles = files.filter((f) => /(^|[\\/])(proto|protox|techtree|techtreex)\.xml(\.xmb)?$/i.test(f));
  const protoFiles = xmlFiles.filter((f) => /proto/i.test(path.basename(f))).sort((a, b) => a.length - b.length);
  const ttFiles = xmlFiles.filter((f) => /techtree/i.test(path.basename(f))).sort((a, b) => a.length - b.length);
  const protoIndex = new Map();
  for (const f of protoFiles) for (const { tree } of loadTrees(f)) for (const [k, v] of indexProto(tree)) protoIndex.set(k, v);
  if (!protoIndex.size) report.warnings.push('no proto.xml found — icons/models can only be matched through models.json');

  // ---- targets: every Age of AI unit with a proto counterpart (per civ when civ-specific)
  const targets = [];
  for (const [type, cands] of Object.entries(PROTO_NAMES.units)) targets.push({ key: type, type, civ: '*', cands });
  for (const [civ, units] of Object.entries(PROTO_NAMES.civUnits)) {
    for (const [type, cands] of Object.entries(units)) targets.push({ key: `${type}:${civ}`, type, civ, cands });
  }
  const pngIndex = indexByName(files, ['.png', '.tga']);
  const modelIndex = indexByName(files, ['.glb', '.gltf']);
  const explicit = opts.models ? JSON.parse(readFileSync(opts.models, 'utf8')) : {};

  let browser;
  const needBake = opts.bake !== false && (modelIndex.size > 0 || Object.keys(explicit).length > 0);
  if (needBake) browser = await launchBrowser(opts.chromium);
  try {
    for (const t of targets) {
      const proto = t.cands.map((c) => protoIndex.get(norm(c))).find(Boolean);
      const fileId = t.civ === '*' ? t.type : `${t.type}_${t.civ}`;
      // icon
      const iconPath = proto ? extractUnit(proto).icon : undefined;
      const png = iconPath ? findAsset(pngIndex, iconPath) : (proto ? undefined : findAsset(pngIndex, `${t.cands[0]}icon`));
      let iconOk = false;
      if (png) {
        const dest = path.join(out, 'icons', `${fileId}.png`);
        try {
          if (/\.tga$/i.test(png)) writeFileSync(dest, tgaToPng(readFileSync(png)));
          else copyFileSync(png, dest);
          iconOk = true;
        } catch (e) { report.warnings.push(`icon ${path.basename(png)}: ${e.message}`); }
      }
      if (iconOk) {
        (manifest.icons.unit[t.type] ??= {})[t.civ] = `icons/${fileId}.png`;
        report.icons.push(`${t.key} ← ${path.relative(opts.extract, png)}`);
      } else report.missingIcons.push(`${t.key}${iconPath ? ` (proto icon: ${iconPath})` : ''}`);
      // model
      const rel = explicit[t.key] ?? explicit[t.type];
      const model = rel ? path.resolve(opts.extract, rel) : (proto ? findAsset(modelIndex, proto.attrs.name) : undefined) ?? t.cands.map((c) => findAsset(modelIndex, c)).find(Boolean);
      if (model && existsSync(model) && needBake) {
        try {
          const r = await bakeModel(model, path.join(out, 'sprites'), fileId, { ppm: opts.ppm, frame: opts.frame }, browser);
          (manifest.sprites[t.type] ??= {})[t.civ] = `sprites/${fileId}.json`;
          report.sprites.push({ unit: t.key, model: path.relative(opts.extract, model), anims: r.used, warnings: r.warnings });
        } catch (e) {
          report.warnings.push(`bake failed for ${t.key}: ${e.message}`);
        }
      } else if (!model) report.missingModels.push(t.key);
    }
  } finally {
    if (browser) await browser.close();
  }

  // ---- techtree (reference)
  for (const f of ttFiles) {
    for (const { tree } of loadTrees(f)) {
      const techs = extractTechtree(tree);
      if (techs.length) {
        writeFileSync(path.join(out, 'techtree.json'), JSON.stringify({ source: path.basename(f), techs }));
        manifest.techtree = 'techtree.json';
        report.techs = techs.length;
      }
    }
  }

  // ---- gameplay data (optional)
  if (opts.data && protoIndex.size) {
    const { overrides, report: dr } = buildOverrides(protoIndex);
    overrides.meta = { importedAt: manifest.generatedAt, files: protoFiles.map((f) => path.basename(f)) };
    writeFileSync(path.join(ROOT, 'shared/src/aom-overrides.ts'), `// ORIGINAL Age of Mythology values imported from the game files you own.
// Generated by tools/aom-pipeline/ingest.mjs --data. Do not commit to a public repository.
import type { AomOverrides } from './mythology';

export const AOM_OVERRIDES: AomOverrides = ${JSON.stringify(overrides, null, 2)};
`);
    report.data = { matched: dr.matched.length, missing: dr.missing };
  }

  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(out, 'import-report.json'), JSON.stringify(report, null, 2));
  return { manifest, report };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const extract = opt('--extract');
  if (!extract) {
    console.log('usage: node tools/aom-pipeline/ingest.mjs --extract <folder> [--out client/public/aom] [--models models.json] [--data] [--no-bake] [--chromium path]');
    process.exit(1);
  }
  const { report } = await ingest({
    extract: path.resolve(extract), out: path.resolve(opt('--out') ?? path.join(ROOT, 'client/public/aom')),
    models: opt('--models'), data: args.includes('--data'), bake: !args.includes('--no-bake'), chromium: opt('--chromium'),
    ppm: opt('--ppm') ? Number(opt('--ppm')) : undefined, frame: opt('--frame') ? Number(opt('--frame')) : undefined,
  });
  console.log(`icons: ${report.icons.length} imported, ${report.missingIcons.length} missing`);
  console.log(`sprites: ${report.sprites.length} baked, ${report.missingModels.length} without a model`);
  for (const s of report.sprites) for (const w of s.warnings) console.log(`  ⚠ ${s.unit}: ${w}`);
  if (report.techs) console.log(`techtree: ${report.techs} technologies exported (reference)`);
  if (report.data) console.log(`gameplay data: ${report.data.matched} units imported`);
  for (const w of report.warnings) console.log(`⚠ ${w}`);
  console.log('Full report: import-report.json next to manifest.json. Reload the game to use the assets.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
void parseXml; void decompressIfNeeded;
