#!/usr/bin/env node
// Bake a 3D model (GLB/glTF — e.g. from CryBar `tmm-to-glb` for Retold, or
// ptasev's BRG/GRN → glTF converter for the original game) into an isometric
// SPRITE SHEET the 2D renderer can draw:
//   <name>.png       color, rows = animation × direction, columns = frames
//   <name>_mask.png  player-color mask (white where the model is player-colored)
//   <name>.json      layout (SpriteSheetMeta in client/src/game/aomAssets.ts)
//
//   node tools/aom-pipeline/bake-sprites.mjs model.glb --name hoplite --out client/public/aom/sprites
//        [--frame 128] [--ppm 40] [--dirs 8] [--fps 10] [--max-frames 12] [--yaw 0]
//        [--mask "player|team"] [--anim walk=Run_A,attack=Attack_B] [--chromium path]
//
// Camera: orthographic, 30° elevation (the game's 2:1 dimetric view). Directions
// are defined on SCREEN (0 = facing the viewer, clockwise), measured by
// projecting the model's forward axis, so the result matches the game whatever
// way the source model faces (use --yaw if its forward axis is unusual).

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launchBrowser, IMPORT_MAP, dataUrlToBuffer } from './lib/browser.mjs';

export const ANIM_PATTERNS = {
  idle: /idle|stand/i,
  walk: /walk|run|move/i,
  attack: /attack|melee|ranged|throw|bow|strike/i,
  gather: /gather|work|chop|mine|farm|build/i,
  death: /death|die|dying/i,
};

const PAGE = `<!doctype html><html><body style="margin:0;background:transparent">${IMPORT_MAP}
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const P = window.__params;
try {
  const gltf = await new GLTFLoader().loadAsync('/files/' + encodeURIComponent(P.file));
  const F = P.frame, ppm = P.ppm;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(F, F); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x403020, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-4, 8, 6); scene.add(sun);
  const holder = new THREE.Group(); scene.add(holder);
  const model = gltf.scene; holder.add(model);
  // camera: 30° elevation, 45° azimuth, ground origin at (F/2, anchorFrac*F)
  const W = F / ppm, anchorFrac = 0.8;
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, W * anchorFrac, -W * (1 - anchorFrac), 0.1, 200);
  const el = Math.PI / 6, az = Math.PI / 4;
  cam.position.set(Math.cos(el) * Math.sin(az) * 60, Math.sin(el) * 60, Math.cos(el) * Math.cos(az) * 60);
  cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  // screen direction of a world yaw: project the forward axis
  const screenAngle = (yaw) => {
    const a = new THREE.Vector3(0, 0, 0).project(cam);
    const b = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).project(cam);
    const sx = b.x - a.x, sy = -(b.y - a.y); // screen y grows downward
    return Math.atan2(-sx, sy); // 0 = screen-down, clockwise — same as dirIndex()
  };
  const yawFor = (target) => {
    let best = 0, bestErr = 9;
    for (let d = 0; d < 720; d++) {
      const yaw = (d / 720) * Math.PI * 2;
      const e = Math.abs(Math.atan2(Math.sin(screenAngle(yaw) - target), Math.cos(screenAngle(yaw) - target)));
      if (e < bestErr) { bestErr = e; best = yaw; }
    }
    return best + P.yaw;
  };
  // pick clips
  const clips = gltf.animations;
  const anims = [];
  for (const [key, src] of Object.entries(P.patterns)) {
    const forced = P.animMap[key];
    const re = new RegExp(src, 'i');
    const clip = clips.find((c) => forced ? c.name === forced : re.test(c.name));
    if (clip) anims.push({ key, clip });
  }
  if (!anims.length) anims.push({ key: 'idle', clip: null });
  const mixer = new THREE.AnimationMixer(model);
  const rows = anims.length * P.dirs;
  const frameCounts = anims.map(({ key, clip }) => clip ? Math.max(1, Math.min(P.maxFrames, Math.round(clip.duration * P.fps))) : 1);
  const cols = Math.max(...frameCounts);
  const sheet = document.createElement('canvas'); sheet.width = cols * F; sheet.height = rows * F;
  const mask = document.createElement('canvas'); mask.width = cols * F; mask.height = rows * F;
  const sctx = sheet.getContext('2d'), mctx = mask.getContext('2d');
  // material sets: color pass (player color = neutral light gray, tinted in game) and mask pass
  const maskRe = new RegExp(P.mask, 'i');
  const meshes = []; model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const orig = new Map(meshes.map((m) => [m, m.material]));
  const isPC = (mat) => (Array.isArray(mat) ? mat : [mat]).some((x) => maskRe.test(x.name || ''));
  const gray = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.8 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  let pcSeen = false;
  const useColor = () => meshes.forEach((m) => { const pc = isPC(orig.get(m)); pcSeen ||= pc; m.material = pc ? gray : orig.get(m); });
  const useMask = () => meshes.forEach((m) => { m.material = isPC(orig.get(m)) ? white : black; });
  const meta = { image: P.name + '.png', mask: P.name + '_mask.png', frameW: F, frameH: F, anchorX: F / 2, anchorY: Math.round(F * anchorFrac), dirs: P.dirs, pxPerMeter: ppm, anims: {} };
  let row = 0;
  anims.forEach(({ key, clip }, ai) => {
    const n = frameCounts[ai];
    meta.anims[key] = { row, frames: n, fps: P.fps, loop: key !== 'death' };
    const action = clip ? mixer.clipAction(clip) : null;
    mixer.stopAllAction();
    if (action) { action.reset(); action.play(); }
    for (let d = 0; d < P.dirs; d++) {
      holder.rotation.y = yawFor((d / P.dirs) * Math.PI * 2);
      for (let f = 0; f < n; f++) {
        if (clip) mixer.setTime(key === 'death' ? (n > 1 ? f / (n - 1) : 1) * clip.duration * 0.999 : (f / n) * clip.duration);
        useColor(); renderer.render(scene, cam); sctx.drawImage(renderer.domElement, f * F, (row + d) * F);
        useMask(); renderer.render(scene, cam); mctx.drawImage(renderer.domElement, f * F, (row + d) * F);
      }
    }
    row += P.dirs;
  });
  // mask: luminance -> alpha (white = player color, rest transparent)
  const img = mctx.getImageData(0, 0, mask.width, mask.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = img.data[i];
    img.data[i + 3] = img.data[i + 3] ? lum : 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
  }
  mctx.putImageData(img, 0, 0);
  // bounds sanity: how much of the frame does the model use?
  const sd = sctx.getImageData(0, 0, Math.min(sheet.width, F), F).data;
  let top = F, bottom = 0, left = F, right = 0, filled = 0;
  for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if (sd[(y * Math.min(sheet.width, F) + x) * 4 + 3] > 20) { filled++; top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
  window.__result = { meta, sheet: sheet.toDataURL('image/png'), mask: pcSeen ? mask.toDataURL('image/png') : null,
    clips: clips.map((c) => c.name), used: anims.map((a) => [a.key, a.clip?.name ?? '(static)']), bounds: { top, bottom, left, right, filled }, pcSeen };
} catch (e) { window.__error = String(e && e.stack || e); }
</script></body></html>`;

/** Bake one model. Returns a report; writes files to `outDir`. */
export async function bakeModel(file, outDir, name, opts = {}, browser) {
  const p = {
    file: path.basename(file), name, frame: opts.frame ?? 128, ppm: opts.ppm ?? 40, dirs: opts.dirs ?? 8, fps: opts.fps ?? 10,
    maxFrames: opts.maxFrames ?? 12, yaw: ((opts.yaw ?? 0) * Math.PI) / 180, mask: opts.mask ?? 'player|team|pcolor|\\bpc\\b',
    patterns: Object.fromEntries(Object.entries(ANIM_PATTERNS).map(([k, re]) => [k, re.source])), animMap: opts.animMap ?? {},
  };
  const srv = await startServer(PAGE, path.dirname(path.resolve(file)));
  const own = !browser;
  browser ??= await launchBrowser(opts.chromium);
  try {
    const page = await browser.newPage();
    await page.addInitScript((params) => { window.__params = params; }, p);
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__result || window.__error, null, { timeout: 120000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error(`${file}: ${err}`);
    const r = await page.evaluate(() => window.__result);
    await page.close();
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${name}.png`), dataUrlToBuffer(r.sheet));
    if (r.mask) writeFileSync(path.join(outDir, `${name}_mask.png`), dataUrlToBuffer(r.mask));
    else delete r.meta.mask;
    writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(r.meta, null, 2));
    const warn = [];
    if (r.bounds.filled === 0) warn.push('model rendered EMPTY — check scale (--ppm) or that the file has meshes');
    else {
      if (r.bounds.top <= 1 || r.bounds.left <= 1 || r.bounds.right >= p.frame - 2) warn.push('model touches the frame edge — lower --ppm or raise --frame');
      if (r.bounds.bottom - r.bounds.top < p.frame * 0.15) warn.push('model is tiny in the frame — raise --ppm');
    }
    if (!r.pcSeen) warn.push('no player-color material matched --mask: units will not show team colors (only the selection ring)');
    return { name, clips: r.clips, used: r.used, bounds: r.bounds, warnings: warn };
  } finally {
    if (own) await browser.close();
    await srv.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => /\.(glb|gltf)$/i.test(a));
  if (!file) {
    console.log('usage: node tools/aom-pipeline/bake-sprites.mjs model.glb --name id --out dir [--frame 128 --ppm 40 --dirs 8 --fps 10 --max-frames 12 --yaw 0 --mask regex --anim walk=Clip,attack=Clip]');
    process.exit(1);
  }
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const animMap = Object.fromEntries((opt('--anim') ?? '').split(',').filter(Boolean).map((kv) => kv.split('=')));
  const rep = await bakeModel(file, opt('--out') ?? '.', opt('--name') ?? path.basename(file).replace(/\.\w+$/, ''), {
    frame: opt('--frame') && Number(opt('--frame')), ppm: opt('--ppm') && Number(opt('--ppm')), dirs: opt('--dirs') && Number(opt('--dirs')),
    fps: opt('--fps') && Number(opt('--fps')), maxFrames: opt('--max-frames') && Number(opt('--max-frames')), yaw: opt('--yaw') && Number(opt('--yaw')),
    mask: opt('--mask'), animMap, chromium: opt('--chromium'),
  });
  console.log(`baked ${rep.name}: ${rep.used.map(([k, c]) => `${k}←${c}`).join(', ')}`);
  for (const w of rep.warnings) console.log(`  ⚠ ${w}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
