#!/usr/bin/env node
// Builds an ORIGINAL animated test model as GLB: a box-figure soldier (legs,
// torso, arms, head, spear) with a player-color sash and four clips — Idle,
// Walk, Attack, Death — like the GLBs CryBar's `tmm-to-glb` produces from AoM
// models. No AoM data involved. Used to test the sprite baker end to end.
//
//   node tools/aom-pipeline/fixtures/make-model-fixture.mjs out.glb [--chromium /path/to/chrome]

import { writeFileSync } from 'node:fs';
import { startServer, launchBrowser, IMPORT_MAP } from '../lib/browser.mjs';

const PAGE = `<!doctype html><html><body>${IMPORT_MAP}
<script type="module">
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
const mat = (name, color) => Object.assign(new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), { name });
const skin = mat('Skin', 0xd9a77a), cloth = mat('Tunic', 0x8a6a3f), metal = mat('Bronze', 0xb08d57), pc = mat('PlayerColor', 0xffffff), wood = mat('Wood', 0x6b4a2f);
const box = (w, h, d, m, name) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.name = name; return g; };
const root = new THREE.Group(); root.name = 'Soldier';
const hips = new THREE.Group(); hips.name = 'hips'; hips.position.set(0, 0.9, 0); root.add(hips);
const legL = new THREE.Group(); legL.name = 'legL'; legL.position.set(-0.13, 0, 0); hips.add(legL);
const legR = new THREE.Group(); legR.name = 'legR'; legR.position.set(0.13, 0, 0); hips.add(legR);
for (const l of [legL, legR]) { const m = box(0.16, 0.9, 0.18, cloth, l.name + 'M'); m.position.y = -0.45; l.add(m); }
const torso = box(0.5, 0.65, 0.3, metal, 'torso'); torso.position.y = 0.35; hips.add(torso);
const sash = box(0.52, 0.12, 0.32, pc, 'sash'); sash.position.y = 0.1; hips.add(sash);
const head = box(0.26, 0.28, 0.26, skin, 'head'); head.position.y = 0.85; hips.add(head);
const helm = box(0.3, 0.12, 0.3, metal, 'helm'); helm.position.y = 1.02; hips.add(helm);
const crest = box(0.06, 0.16, 0.3, pc, 'crest'); crest.position.y = 1.14; hips.add(crest);
const armL = new THREE.Group(); armL.name = 'armL'; armL.position.set(-0.32, 0.62, 0); hips.add(armL);
const armR = new THREE.Group(); armR.name = 'armR'; armR.position.set(0.32, 0.62, 0); hips.add(armR);
for (const a of [armL, armR]) { const m = box(0.13, 0.6, 0.14, skin, a.name + 'M'); m.position.y = -0.3; a.add(m); }
const spear = box(0.05, 1.6, 0.05, wood, 'spear'); spear.position.set(0, -0.5, 0.15); spear.rotation.x = Math.PI / 2; armR.add(spear);
const shield = box(0.08, 0.5, 0.42, pc, 'shield'); shield.position.set(-0.08, -0.3, 0); armL.add(shield);
const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
const rot = (node, times, eulers) => new THREE.QuaternionKeyframeTrack(node + '.quaternion', times, eulers.flatMap((e) => q(...e)));
const pos = (node, times, ps) => new THREE.VectorKeyframeTrack(node + '.position', times, ps.flat());
const clips = [
  new THREE.AnimationClip('Idle', 2, [pos('hips', [0, 1, 2], [[0, 0.9, 0], [0, 0.88, 0], [0, 0.9, 0]]), rot('armR', [0, 1, 2], [[0.1, 0, 0], [0.18, 0, 0], [0.1, 0, 0]])]),
  new THREE.AnimationClip('Walk', 0.8, [
    rot('legL', [0, 0.4, 0.8], [[0.6, 0, 0], [-0.6, 0, 0], [0.6, 0, 0]]),
    rot('legR', [0, 0.4, 0.8], [[-0.6, 0, 0], [0.6, 0, 0], [-0.6, 0, 0]]),
    rot('armL', [0, 0.4, 0.8], [[-0.4, 0, 0], [0.4, 0, 0], [-0.4, 0, 0]]),
    pos('hips', [0, 0.2, 0.4, 0.6, 0.8], [[0, 0.9, 0], [0, 0.95, 0], [0, 0.9, 0], [0, 0.95, 0], [0, 0.9, 0]]),
  ]),
  new THREE.AnimationClip('Attack', 1.0, [rot('armR', [0, 0.35, 0.55, 1.0], [[0.2, 0, 0], [-1.8, 0, 0], [0.9, 0, 0], [0.2, 0, 0]]), rot('hips', [0, 0.5, 1], [[0, 0, 0], [0.15, 0, 0], [0, 0, 0]])]),
  new THREE.AnimationClip('Death', 1.2, [rot('hips', [0, 1.2], [[0, 0, 0], [-1.45, 0, 0]]), pos('hips', [0, 1.2], [[0, 0.9, 0], [0, 0.25, -0.4]])]),
];
const exporter = new GLTFExporter();
exporter.parse(root, (glb) => {
  const bytes = new Uint8Array(glb); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  window.__result = btoa(s);
}, (e) => { window.__error = String(e); }, { binary: true, animations: clips });
</script></body></html>`;

export async function makeModelFixture(outFile, chromium) {
  const srv = await startServer(PAGE, null);
  const browser = await launchBrowser(chromium);
  try {
    const page = await browser.newPage();
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__result || window.__error, null, { timeout: 30000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error(err);
    const b64 = await page.evaluate(() => window.__result);
    writeFileSync(outFile, Buffer.from(b64, 'base64'));
  } finally {
    await browser.close();
    await srv.close();
  }
}

if (process.argv[2] && process.argv[1].endsWith('make-model-fixture.mjs')) {
  const i = process.argv.indexOf('--chromium');
  makeModelFixture(process.argv[2], i > 0 ? process.argv[i + 1] : undefined)
    .then(() => console.log(`wrote ${process.argv[2]}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
