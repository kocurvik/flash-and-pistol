// Downloads the Three.js add-ons the renderer uses (plus everything they import)
// into vendor/addons, matching the vendored three.module.min.js version.
// Usage: node tools/vendor-three-addons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.170.0';
const BASE = `https://cdn.jsdelivr.net/npm/three@${VERSION}/examples/jsm/`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'addons');
const ENTRY = [
  'geometries/RoundedBoxGeometry.js',
  'environments/RoomEnvironment.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/GTAOPass.js',
  'utils/BufferGeometryUtils.js',
];

const done = new Set();
async function fetchFile(rel) {
  if (done.has(rel)) return;
  done.add(rel);
  const res = await fetch(BASE + rel);
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  const src = await res.text();
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, src);
  console.log('vendored', rel);
  for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    await fetchFile(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
}
for (const e of ENTRY) await fetchFile(e);
