// Headless checks for A2 batch 2 (light, no browser):
//   node tools/sim/build_src.mjs tools/sim/.build-A2 && node tools/realtime/batch2_sim.mjs
// carve radius on the main bowl wall at 7.5 m/s, pumping to vert airs in the half pipe (drop-in and push start),
// a fakie kickturn on the north quarter pipe, the drop-in pivot timeline and its hand-over.
globalThis.location = { search: '' };
const B = '../sim/.build-A2';
const { Vector3 } = await import('three');
const { buildPark } = await import(`${B}/world/park.js`);
const { CollisionWorld } = await import(`${B}/world/collision.js`);
const { SkatePhysics, emptyInput } = await import(`${B}/player/physics.js`);
const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120, G = 9.81;
const mk = (x, y, z, hdg, v) => { const ph = new SkatePhysics(world); ph.reset(new Vector3(x, y, z), (hdg * Math.PI) / 180); ph.vel.copy(ph.fwd).multiplyScalar(v); return ph; };

// ---- carve on the bowl wall: board on the south wall of the main bowl, moving horizontally along it at 7.5 m/s
{
  for (const y of [-1.6, -1.0]) {
    const h = world.raycast(new Vector3(-24, y, 0), new Vector3(0, 0, -1), 10);
    const ph = new SkatePhysics(world);
    ph.reset(new Vector3(-24, 0, 0), 0);
    ph.pos.copy(h.point); ph.up.copy(h.normal);
    ph.fwd.set(1, 0, 0).addScaledVector(ph.up, -ph.up.x).normalize();
    ph.vel.copy(ph.fwd).multiplyScalar(7.5);
    const inp = emptyInput(); inp.steer = 1;
    let w = 0, sp = 0;
    for (let i = 0; i < 30; i++) {
      const f0 = ph.fwd.clone();
      ph.step(STEP, inp);
      const c = new Vector3().crossVectors(f0, ph.fwd);
      if (i >= 20) { w = Math.atan2(c.dot(ph.up), f0.dot(ph.fwd)) / STEP; sp = ph.speed; }
    }
    const bank = Math.acos(h.normal.y) * 57.3;
    const before = sp / Math.min(2.4, 7.6 / sp), pass3 = sp / (2.9 - 1.3 * Math.min(sp / 10, 1));
    console.log(`carve on the bowl wall (bank ${bank.toFixed(0)} deg) @ ${sp.toFixed(2)} m/s: radius ${(sp / Math.abs(w)).toFixed(2)} m (batch 1: ${before.toFixed(2)} m, pass 3: ${pass3.toFixed(2)} m), flat @7.5: ${(7.5 * 7.5 / 7.6).toFixed(2)} m`);
  }
}

// ---- pumping in the half pipe: W while descending a transition (and on the flat bottom), released while climbing
const pumpRun = (label, at, pump, secs = 14) => {
  const ph = mk(...at);
  const inp = emptyInput();
  const passes = [];
  let onTrans = false, airs = 0, vertAirs = 0, maxH = -9, wasAir = false, lastBottom = null;
  for (let i = 0; i < 120 * secs; i++) {
    const gT = new Vector3(0, -G, 0).addScaledVector(ph.up, G * ph.up.y);
    const downhill = ph.vel.dot(gT) > 0.3;
    inp.push = pump && ph.mode === 'ride' && !ph.dropin && (ph.up.y >= 0.97 || (ph.up.y > 0.2 && downhill));
    ph.step(STEP, inp);
    if (ph.mode === 'ride' && ph.up.y > 0.995 && onTrans) { onTrans = false; lastBottom = ph.speed; passes.push(+ph.speed.toFixed(2)); }
    if (ph.mode === 'ride' && ph.up.y < 0.9) onTrans = true;
    if (ph.mode === 'air') { if (!wasAir) { airs++; if (ph.vert) vertAirs++; } maxH = Math.max(maxH, ph.pos.y - 3.02); }
    wasAir = ph.mode === 'air';
    if (ph.mode === 'bail') { passes.push('BAIL'); break; }
  }
  console.log(`${label}: bottom speed per pass ${passes.join(', ')} | airs ${airs} (vert ${vertAirs}), best height over the coping ${maxH.toFixed(2)} m`);
};
pumpRun('half pipe, drop-in, no pumping', [17.6, 3.1, -9, 90, 3.0], false);
pumpRun('half pipe, drop-in, pumping', [17.6, 3.1, -9, 90, 3.0], true);
pumpRun('half pipe, push start at the bottom, pumping', [21.5, 0, -9, 90, 0.5], true, 20);
pumpRun('half pipe, push start at the bottom, no pumping (W on the flat only)', [21.5, 0, -9, 90, 0.5], false, 20);

// ---- fakie kickturn on the north quarter pipe (rides up it tail first and runs out of speed)
{
  const ph = mk(-3, 0, -15.5, 0, 0);
  ph.vel.copy(ph.fwd).multiplyScalar(-4.8); // moving toward the quarter pipe tail first
  const inp = emptyInput();
  const ev = [];
  for (let i = 0; i < 120 * 3.5; i++) {
    ph.events.length = 0;
    ph.step(STEP, inp);
    for (const e of ph.events) if (/kickturn|land|bail|leave/i.test(e.type)) ev.push(`${e.type}@${(i * STEP).toFixed(2)} fakie ${ph.fakie}`);
  }
  console.log(`fakie up the north QP at 4.8 m/s: ${ev.join(' | ') || 'no kickturn'} | end fakie ${ph.fakie} speed ${ph.speed.toFixed(2)} mode ${ph.mode}`);
  const pf = mk(-8, 0, -15.5, 180, 4.8), e2 = [];
  for (let i = 0; i < 120 * 3.5; i++) { pf.events.length = 0; pf.step(STEP, inp); for (const e of pf.events) if (/kickturn/i.test(e.type)) e2.push(`${e.type}@${(i * STEP).toFixed(2)}`); }
  console.log(`forward up the north QP at 4.8 m/s (unchanged path): ${e2.join(' | ')} | end fakie ${pf.fakie}`);
}

// ---- drop-in timeline + hand-over
const dropin = (name, at) => {
  const ph = mk(...at);
  const inp = emptyInput();
  const ev = [];
  let last = null, prevV = null, maxDv = 0, endT = null;
  for (let i = 0; i < 120 * 3; i++) {
    const t = i * STEP;
    const p0 = ph.pos.clone();
    ph.events.length = 0;
    ph.step(STEP, inp);
    const v = ph.pos.clone().sub(p0).divideScalar(STEP);
    if (prevV && (ph.dropin || (endT !== null && t < endT + 0.3))) maxDv = Math.max(maxDv, v.distanceTo(prevV) / STEP);
    prevV = v;
    const d = ph.dropin;
    for (const e of ph.events) if (e.type === 'dropIn') { ev.push(`wheels on the wall @${t.toFixed(3)} (step ${(ph.pos.distanceTo(p0) * 1000).toFixed(1)} mm)`); endT = t; }
    if (prevV && v.distanceTo(prevV) / STEP > 150) ev.push(`jolt ${(v.distanceTo(prevV) / STEP).toFixed(0)} @${t.toFixed(3)} ${d ? d.phase : 'ride'}`);
    if (d && d.phase !== last) { ev.push(`${d.phase}@${t.toFixed(3)}`); last = d.phase; }
    if (endT !== null && t > endT + 0.3) { ev.push(`+0.3 s speed ${ph.speed.toFixed(2)}`); break; }
    if (ph.mode !== 'ride') { ev.push(`MODE ${ph.mode}@${t.toFixed(3)}`); break; }
  }
  console.log(`drop-in ${name}: ${ev.join(' | ')} | max board accel ${maxDv.toFixed(1)} m/s^2 (step-to-step, incl. the pivot)`);
};
dropin('bowl 4.5', [-12.5, 0, 0.6, -90, 4.5]);
dropin('half pipe 3.0', [17.6, 3.1, -9, 90, 3.0]);
