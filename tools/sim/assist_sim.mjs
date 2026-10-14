// Headless check of the Easy-mode physics assists (SkatePhysics.assist): auto-grind without the grind button and the
// landing assist. Each case runs with the assist off (Pro) and on.
//   node tools/sim/build_src.mjs tools/sim/.build-d && node tools/sim/assist_sim.mjs
globalThis.location = { search: '' };
const B = new URL(process.env.SIMB ?? './.build-d/', import.meta.url).href;
const { Vector3, Quaternion } = await import('three');
const { buildPark } = await import(B + 'world/park.js');
const { CollisionWorld } = await import(B + 'world/collision.js');
const { SkatePhysics, emptyInput } = await import(B + 'player/physics.js');

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120;

/** run: start pos/heading/speed, input script (t, ph) -> partial input, hook(ph, t) each step; returns events */
function run(c, assistOn) {
  const ph = new SkatePhysics(world);
  Object.assign(ph.assist, { landing: assistOn, autoGrind: assistOn, fastRecover: false });
  ph.reset(new Vector3(...c.pos), (c.heading * Math.PI) / 180);
  ph.vel.copy(ph.fwd).multiplyScalar(c.speed);
  const ev = [];
  for (let i = 0, t = 0; i < 120 * (c.T ?? 2.5); i++, t += STEP) {
    const inp = Object.assign(emptyInput(), c.input ? c.input(t, ph) : {});
    c.hook?.(ph, t);
    ph.step(STEP, inp);
    for (const e of ph.events) ev.push({ t: +t.toFixed(3), ...e });
    ph.events.length = 0;
  }
  return { ev, ph };
}
const has = (r, type, f = () => true) => r.ev.some((e) => e.type === type && f(e));
const land = (r) => r.ev.find((e) => e.type === 'land');

const ollieAt = (axis, v, dir = 1) => (t, ph) => {
  const p = ph.pos[axis] * dir;
  return { ollie: p >= v * dir && !ph.popped && ph.mode === 'ride' && t > 0.05, popCharge: 0.7 };
};
let pass = 0, n = 0;
const expect = (name, cond, detail) => { n++; if (cond) pass++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };

// ---- auto-grind
{
  const c = { pos: [-12, 0, -11.75], heading: 90, speed: 5, input: ollieAt('x', -10.6) };
  const off = run(c, false), on = run(c, true);
  expect('ledge: ollie along it, no E, Pro: no grind', !has(off, 'grindStart'));
  expect('ledge: ollie along it, no E, Easy: grinds', has(on, 'grindStart'), JSON.stringify(on.ev.find((e) => e.type === 'grindStart') ?? {}));
}
{
  const c = { pos: [1.5, 0, -12.1], heading: 90, speed: 5, input: ollieAt('x', 3.2) };
  const off = run(c, false), on = run(c, true);
  expect('flat rail: ollie along it, Pro: no grind', !has(off, 'grindStart'));
  expect('flat rail: ollie along it, Easy: grinds', has(on, 'grindStart'), JSON.stringify(on.ev.find((e) => e.type === 'grindStart') ?? {}));
}
{
  const c = { pos: [-5, 0, -8.5], heading: 180, speed: 5.5, input: ollieAt('z', -11.2, -1) };
  const on = run(c, true);
  expect('long ledge: ollie straight over it, Easy: no grind', !has(on, 'grindStart'), on.ev.filter((e) => /grind|land|bail/.test(e.type)).map((e) => e.type + '@' + e.t).join(' '));
}
{
  const c = { pos: [-11, 0, 4.8], heading: 90, speed: 4 };
  const off = run(c, false), on = run(c, true);
  expect('manual pad: rolling along its edge, Pro: no grind', !has(off, 'grindStart'));
  expect('manual pad: rolling along its edge, Easy: grinds', has(on, 'grindStart'), JSON.stringify(on.ev.find((e) => e.type === 'grindStart') ?? {}));
}
{
  // straight up the main bowl's east wall and out over the coping (vert air): never a coping grind
  for (const sp of [6.5, 7.5, 8.5]) {
    const c = { pos: [-21, -2.3, 0.5], heading: 90, speed: sp, T: 3 };
    const on = run(c, true);
    expect(`bowl: straight up the wall at ${sp} m/s, Easy: no coping grind`, !has(on, 'grindStart'), on.ev.filter((e) => /vertAir|grind|land|bail/.test(e.type)).map((e) => e.type + '@' + e.t).join(' '));
  }
  // carving across the bowl wall (diagonal, steering): no coping grind
  for (const [hd, st] of [[60, -0.6], [120, 0.6], [45, -0.8]]) {
    const c = { pos: [-21, -2.3, 0], heading: hd, speed: 6.5, T: 3, input: () => ({ steer: st }) };
    const on = run(c, true);
    expect(`bowl: carving h${hd} steer ${st}, Easy: no coping grind`, !has(on, 'grindStart'), on.ev.filter((e) => /vertAir|grind|bail/.test(e.type)).map((e) => e.type + '@' + e.t).join(' '));
  }
  // riding along the deck right beside the coping (along it): a coping grind is fine
  const c = { pos: [-15.0 + 0.3, 0, -3.5], heading: 0, speed: 4.5, T: 1.5 };
  const on = run(c, true);
  expect('bowl deck along the coping, Easy: coping 50-50 (approach runs along it)', has(on, 'grindStart'), on.ev.filter((e) => /grind|dropIn|bail/.test(e.type)).map((e) => e.type + '@' + e.t).join(' '));
}

// ---- regression (E2, batch 1): on top of the long ledge at its end after a recovery, auto-grind caught the line end while
// moving off it and looped grindStart / grindEnd every 0.3 s. Easy cruise is emulated by pushing below 3.8 m/s.
{
  const cruise = (t, ph) => ({ push: ph.speed < 3.8 });
  let worst = 0, shortCatch = 0, cases = 0;
  for (const [x, z, hd] of [[-10, -12.6, 270], [-9.9, -12.55, 270], [-9.8, -12.3, 270], [-10, -12.05, 250], [-9.85, -12.58, 290], [-0.1, -12.3, 90], [-0.15, -12.55, 80], [-0.05, -12.05, 100]]) {
    for (const sp of [0, 1.6, 2.2, 3.0]) {
      const c = { pos: [x, 0.6, z], heading: hd, speed: sp, T: 4, input: cruise };
      const r = run(c, true);
      cases++;
      const n = r.ev.filter((e) => e.type === 'grindStart').length;
      worst = Math.max(worst, n);
      // a grind that ends within 0.15 s of starting was caught at an end
      const st = r.ev.filter((e) => e.type === 'grindStart'), en = r.ev.filter((e) => e.type === 'grindEnd');
      for (const s of st) { const e = en.find((q) => q.t >= s.t); if (e && e.t - s.t < 0.15) shortCatch++; }
    }
  }
  expect(`long ledge end, on top, Easy (${cases} starts): no grind loop (most grind starts in 4 s: ${worst})`, worst <= 1);
  expect(`long ledge end: no catch that ends at once (${shortCatch})`, shortCatch === 0);
}

// ---- landing assist
{
  // ollie on flat, spin the board ~70 degrees off the travel in the air
  const c = { pos: [28, 0, 18], heading: 180, speed: 4, input: (t, ph) => ({ ollie: t > 0.05 && t < 0.07, popCharge: 1, steer: ph.mode === 'air' && ph.airTime < 0.17 ? 1 : 0 }) };
  const off = run(c, false), on = run(c, true);
  const lo = land(off), la = land(on);
  expect('crooked landing (~70 deg), Pro: bails', has(off, 'bail'), lo ? `yawErr ${lo.yawErr}` : off.ev.filter((e) => e.type === 'bail').map((e) => e.reason).join());
  expect('crooked landing, Easy: wobble, no bail, heading straightened', !has(on, 'bail') && la?.quality === 'wobble' && Math.abs(on.ph.fwd.dot(on.ph.vel.clone().normalize())) > 0.98, la ? `quality ${la.quality} yawErr ${la.yawErr}` : '');
  // unfinished flip
  const f = { pos: [28, 0, 18], heading: 180, speed: 4, input: (t, ph) => ({ ollie: t > 0.05 && t < 0.07, popCharge: 0.2, flip: 'up' }), hook: (ph) => { if (ph.flip && ph.mode === 'air') ph.flip.dur = Math.max(ph.flip.dur, 2); } };
  const foff = run(f, false), fon = run(f, true);
  expect('unfinished flip, Pro: bails', has(foff, 'bail'));
  expect('unfinished flip, Easy: rides away', !has(fon, 'bail') && fon.ph.mode === 'ride');
  // head-first: board upside down at touchdown
  const h = { pos: [28, 0, 18], heading: 180, speed: 4, input: (t) => ({ ollie: t > 0.05 && t < 0.07, popCharge: 1 }),
    hook: (ph) => {
      if (h.done || ph.mode !== 'air' || ph.vel.y > 0 || ph.airTime < 0.1) return;
      const g = world.raycast(ph.pos.clone(), new Vector3(0, -1, 0), 0.25);
      if (g) { h.done = true; ph.boardQ.premultiply(new Quaternion().setFromAxisAngle(ph.fwd, Math.PI)); ph.up.set(0, 1, 0).applyQuaternion(ph.boardQ); }
    } };
  const hon = run(h, true);
  expect('landing upside down, Easy: still bails', has(hon, 'bail'), land(hon) ? `land ${land(hon).quality}` : hon.ev.filter((e) => e.type === 'bail').map((e) => e.kind).join());
}
console.log(`\nassist sim: ${pass}/${n} pass`);
