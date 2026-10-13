// Headless search for a high carve on a steep, sunlit wall of the main bowl (pass-3 media, clip31). No browser.
// node tools/capture/media3_carve_sim.mjs
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const src = path.join(root, 'src'), out = path.join(root, 'node_modules/.cache/media-sim');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(src).filter((f) => f.endsWith('.ts'))) {
  let js = ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true } }).outputText;
  js = js.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (m, a, p, b) => a + (p.endsWith('.js') ? p : p + '.js') + b).replace(/import\.meta\.env\.BASE_URL/g, "'/'");
  const o = path.join(out, path.relative(src, f)).replace(/\.ts$/, '.js');
  fs.mkdirSync(path.dirname(o), { recursive: true });
  fs.writeFileSync(o, js);
}
globalThis.location = { search: '' };
const imp = (p) => import(pathToFileURL(path.join(out, p)).href);
const { Vector3 } = await import('three');
const { buildPark } = await imp('world/park.js');
const { CollisionWorld } = await imp('world/collision.js');
const { SkatePhysics, emptyInput } = await imp('player/physics.js');

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120;
const FLOOR = -2.3;

function ride(r) {
  const ph = new SkatePhysics(world);
  ph.reset(new Vector3(...r.pos), (r.heading * Math.PI) / 180);
  ph.vel.copy(ph.fwd).multiplyScalar(r.speed);
  const ev = [];
  let steep = 0, bestRun = 0, run = 0, runStart = -1, best = null, maxH = -9;
  const trace = [];
  for (let i = 0; i < 120 * r.dur; i++) {
    const t = i * STEP;
    const inp = emptyInput();
    for (const s of r.steer) if (t >= s[0] && t < s[1]) inp.steer = s[2];
    ph.events.length = 0;
    ph.step(STEP, inp);
    for (const e of ph.events) if (!['boardClack', 'leaveGround'].includes(e.type)) ev.push(`${t.toFixed(2)}:${e.type}`);
    const h = ph.pos.y - FLOOR;
    maxH = Math.max(maxH, h);
    // steep = riding (not air) with the board at > 60 deg from level, 1.2 m+ above the floor
    const ok = ph.mode === 'ride' && ph.up.y < 0.5 && h > 1.2;
    if (ok) { steep += STEP; if (run === 0) runStart = t; run += STEP; if (run > bestRun) { bestRun = run; best = { t0: +runStart.toFixed(2), t1: +t.toFixed(2), x: +ph.pos.x.toFixed(2), z: +ph.pos.z.toFixed(2) }; } } else run = 0;
    if (i % 24 === 0) trace.push(`${t.toFixed(1)}:${ph.mode[0]}(${ph.pos.x.toFixed(1)},${h.toFixed(1)},${ph.pos.z.toFixed(1)}|${ph.up.y.toFixed(2)})`);
  }
  return { steep: +steep.toFixed(2), bestRun: +bestRun.toFixed(2), best, maxH: +maxH.toFixed(2), ev, trace };
}

const cands = [];
for (const z of [3.6, 4.2, 4.6]) for (const speed of [6.5, 7.0, 7.5, 8.0]) for (const t1 of [1.0, 1.3, 1.6, 1.9]) {
  cands.push({ name: `S z${z} v${speed} D0.2-${t1}`, pos: [-24, FLOOR, z], heading: 90, speed, dur: 4.5, steer: [[0.2, t1, 1]] });
}
// along the east wall towards the SE corner (heading east-south-east, steer right onto the south wall)
for (const speed of [6.5, 7.5]) for (const h of [60, 75]) for (const t1 of [0.9, 1.4]) {
  cands.push({ name: `E h${h} v${speed} D0.1-${t1}`, pos: [-24, FLOOR, -1], heading: h, speed, dur: 4.5, steer: [[0.1, t1, 1]] });
}
const res = cands.map((c) => ({ c, r: ride(c) })).filter((x) => !x.r.ev.some((e) => e.includes('bail')));
res.sort((a, b) => b.r.bestRun - a.r.bestRun);
for (const { c, r } of res.slice(0, 8)) {
  console.log(`${c.name}: steep ${r.steep}s, longest steep run ${r.bestRun}s ${JSON.stringify(r.best)}, maxH ${r.maxH}`);
  console.log('   ', r.ev.join(' ') || '-');
  console.log('   ', r.trace.join(' '));
}
