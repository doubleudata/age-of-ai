// Headless-Chromium harness for the asset pipeline: serves three.js + the
// files being processed over a local HTTP server and runs page code in a real
// WebGL context. Needs `playwright-core` (devDependency) and a Chromium:
//   npx playwright install chromium     (or pass --chromium /path/to/chrome)

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const THREE = path.join(ROOT, 'node_modules/three');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg' };

/** Serve /three/* from node_modules/three, /files/* from `filesDir`, / = `html`. */
export async function startServer(html, filesDir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = null;
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
    if (url.startsWith('/three/')) file = path.join(THREE, url.slice(7));
    else if (url.startsWith('/files/') && filesDir) file = path.join(filesDir, url.slice(7));
    const base = url.startsWith('/three/') ? THREE : filesDir;
    if (!file || !base || !path.resolve(file).startsWith(path.resolve(base)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((ok) => server.close(ok)) };
}

export async function launchBrowser(chromiumPath) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('playwright-core is missing: run `npm install` in the repo root');
  }
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const exe = chromiumPath ?? process.env.AOM_CHROMIUM;
  return chromium.launch({ args, ...(exe ? { executablePath: exe } : {}) });
}

export const IMPORT_MAP = `<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>`;

/** data:image/png;base64,… → Buffer */
export function dataUrlToBuffer(u) {
  return Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
}
