// Headless check of the north quarter pipe -> bank hip (#62) on the real collision mesh: surface continuity across both
// seams and a few rides over the join (no bail, no launch).  node tools/capture/world_hip_sim.mjs
// Transpiles src into node_modules/.cache/world-sim (git-ignored, separate from tools/sim/.build).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const src = path.join(root, 'src'), out = path.join(root, 'node_modules/.cache/world-sim');
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
const down = new Vector3(0, -1, 0);
const hit = (x, z) => world.raycast(new Vector3(x, 3, z), down, 6);

// 1) continuity: along x across the seams (x -4 .. -0.5) at several distances from the coping
let worstDy = 0, worstAng = 0, holes = 0, where = '';
for (const z of [-20.25, -20.1, -19.9, -19.6, -19.3, -19.0, -18.7, -18.45, -18.3]) {
  let prev = null;
  for (let x = -4; x <= 1.0 + 1e-9; x += 0.02) {
    const h = hit(x, z);
    if (!h) { holes++; continue; }
    if (prev) {
      worstDy = Math.max(worstDy, Math.abs(h.point.y - prev.point.y) / 0.02);
      const a = (h.normal.angleTo(prev.normal) * 180) / Math.PI;
      if (a > worstAng) { worstAng = a; where = `x ${x.toFixed(2)} z ${z} y ${h.point.y.toFixed(3)} n ${h.normal.toArray().map((v) => v.toFixed(2))} prev n ${prev.normal.toArray().map((v) => v.toFixed(2))} (${prev.point.y.toFixed(3)})`; }
    }
    prev = h;
  }
}
console.log(`continuity: holes ${holes}, steepest cross-slope ${Math.atan(worstDy) * 57.3 | 0} deg, max normal change per 2 cm ${worstAng.toFixed(2)} deg at ${where}`);
// the same along z (down the slope) in the hip, where rows meet
let worstZ = 0, whereZ = '';
for (const x of [-3.0, -2.6, -2.2, -1.8, -1.4, -1.0, -0.6, -0.2, 0.2]) {
  let prev = null;
  for (let z = -20.29; z <= -17.9; z += 0.01) {
    const h = hit(x, z);
    if (!h) continue;
    if (prev) { const a = (h.normal.angleTo(prev.normal) * 180) / Math.PI; if (a > worstZ) { worstZ = a; whereZ = `x ${x} z ${z.toFixed(2)} y ${h.point.y.toFixed(3)}`; } }
    prev = h;
  }
}
console.log(`down the slope: max normal change per 1 cm ${worstZ.toFixed(2)} deg at ${whereZ}`);
// a step/wall would show as a near-vertical normal on the riding side: none in the gap
let walls = 0;
for (let x = -3.2; x <= 0.2; x += 0.05) for (let z = -20.28; z < -18.0; z += 0.05) { const h = hit(x, z); if (h && h.normal.y < 0.2) walls++; }
console.log('near-vertical hits in the join:', walls);
console.log('profile rows (y at z):', [-20.2, -19.8, -19.2, -18.8].map((z) => `${z}: ` + [-4, -3, -2.25, -1.5, -0.75, 0, 1].map((x) => hit(x, z)?.point.y.toFixed(3)).join(' ')).join(' | '));

// 2) rides over the join
const STEP = 1 / 120;
const rides = [
  { name: 'along the QP at mid height, east, 5.5 m/s', pos: [-7, 0, -19.1], heading: 90, speed: 5.5, steer: 0 },
  { name: 'along the QP high, east, 6.5 m/s', pos: [-6, 0, -19.6], heading: 90, speed: 6.5, steer: 0 },
  { name: 'along the bank, west onto the QP, 5.5 m/s', pos: [3, 0, -19.3], heading: -90, speed: 5.5, steer: 0 },
  { name: 'straight up the hip, 4.5 m/s', pos: [-2.25, 0, -16], heading: 180, speed: 4.5, steer: 0 },
  // (with no steering a fast diagonal vert air re-enters badly on the plain quarter pipe too: compare the REF line)
  { name: 'REF diagonal up into the QP end, 6 m/s', pos: [-5.5, 0, -15.5], heading: 150, speed: 6, steer: 0 },
  { name: 'carve along the QP foot, east, 4 m/s', pos: [-8, 0, -18.4], heading: 90, speed: 4, steer: 0.15 },
  // references on the plain quarter pipe (far from the join): the same diagonal and straight lines
  { name: 'REF diagonal up the plain QP, 6 m/s', pos: [-9.5, 0, -15.5], heading: 150, speed: 6, steer: 0 },
  { name: 'REF straight up the plain QP, 6 m/s', pos: [-8, 0, -15.5], heading: 180, speed: 6, steer: 0 },
  { name: 'straight up the hip middle, 6 m/s', pos: [-1.5, 0, -15.5], heading: 180, speed: 6, steer: 0 },
  { name: 'diagonal up into the hip from the bank side, 6 m/s', pos: [1.5, 0, -15.5], heading: 210, speed: 6, steer: 0 },
];
let fails = 0;
for (const r of rides) {
  const ph = new SkatePhysics(world);
  ph.reset(new Vector3(...r.pos), (r.heading * Math.PI) / 180);
  ph.vel.copy(ph.fwd).multiplyScalar(r.speed);
  const inp = emptyInput();
  inp.steer = r.steer;
  const ev = [], trace = [];
  let air = 0, maxAir = 0, crossed = false;
  for (let i = 0; i < 120 * 3.5; i++) {
    ph.events.length = 0;
    ph.step(STEP, inp);
    for (const e of ph.events) if (!['boardClack', 'leaveGround'].includes(e.type)) ev.push(e.type + (e.reason ? `{${e.reason}}` : '') + (e.quality ? `(${e.quality})` : ''));
    if (ph.mode === 'air') { air += STEP; maxAir = Math.max(maxAir, air); } else air = 0;
    if (ph.pos.x > -3.1 && ph.pos.x < 0.1 && ph.pos.z < -18.0) crossed = true;
    if (i % 30 === 0) trace.push(`${ph.mode[0]}(${ph.pos.x.toFixed(1)},${ph.pos.y.toFixed(2)},${ph.pos.z.toFixed(1)})`);
  }
  // airing out over the coping onto the deck is fine; slamming is not
  const bail = ev.some((e) => e.startsWith('bail') || e.includes('(bail)'));
  const ref = r.name.startsWith('REF'), ok = !bail;
  if (!ok && !ref) fails++;
  console.log(`\n${ref ? (ok ? 'ref ' : 'ref bail') : ok ? 'OK  ' : 'FAIL'} ${r.name}: crossed the join ${crossed}, end ${ph.mode} speed ${ph.vel.length().toFixed(1)}, longest air ${maxAir.toFixed(2)} s`);
  console.log('   events:', ev.join(' ') || '-');
  console.log('   trace:', trace.join(' '));
}
console.log(`\n${fails ? fails + ' FAILED' : 'all rides OK'}`);
