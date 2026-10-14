// Pass-4 media (M1): headless replay of the media4.mjs key timelines through the game physics (Pro input, no assists),
// to check that each scripted timing still produces the intended move before spending browser time. No browser, no lock.
//   node tools/sim/build_src.mjs tools/sim/.build-m1 && node tools/capture/media4_sim.mjs [case ...]
// Frame numbers are 30 fps frames counted like media4.mjs record() (2 preroll frames after the teleport, then the script).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const B = path.join(root, "tools/sim/.build-m1");
globalThis.location = { search: '' };
const imp = (p) => import(pathToFileURL(path.join(B, p)).href);
const { Vector3 } = await import('three');
const { buildPark } = await imp('world/park.js');
const { CollisionWorld } = await imp('world/collision.js');
const { SkatePhysics, emptyInput } = await imp('player/physics.js');
const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120;
const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

/** the Pro branch of src/core/input.ts player() for keyboard keys only */
function proInput() {
  const st = { prev: {}, order: {}, n: 0, wasCrouch: false, swallow: false, airLatch: null, airLatchT: 0 };
  return (sc, ph) => {
    const inp = emptyInput(), air = ph.mode === 'air', ground = ph.mode === 'ride';
    const down = (c) => !!sc[c], pressed = (c) => !!sc[c] && !st.prev[c];
    for (const c of WASD) if (pressed(c)) st.order[c] = ++st.n;
    const W = down('KeyW'), A = down('KeyA'), S = down('KeyS'), D = down('KeyD');
    let crouch = down('Space'), crouchPress = pressed('Space');
    let best = '';
    for (const c of WASD) if (down(c) && (!best || (st.order[c] ?? 0) > (st.order[best] ?? 0))) best = c;
    const dir = best === 'KeyW' ? 'up' : best === 'KeyS' ? 'down' : best === 'KeyD' ? 'right' : 'left';
    const flip = pressed('KeyF') ? dir : null;
    if (st.swallow) { if (crouch) crouch = crouchPress = false; else st.swallow = false; }
    if (flip && (ground || air || ph.mode === 'grind')) {
      if (air) { if (!ph.flip) { st.airLatch = flip; st.airLatchT = 0.08; } }
      else {
        inp.ollie = true; inp.flip = flip;
        if (ground) { if (crouch || st.wasCrouch) { if (crouch) st.swallow = true; crouch = false; } else inp.popCharge = 0.35; }
      }
    }
    inp.crouch = crouch;
    if (!inp.ollie && !air && st.wasCrouch && !crouch) inp.ollie = true;
    if (air && st.airLatch) { if (ph.flip) st.airLatch = null; else { inp.airTrick = st.airLatch; if ((st.airLatchT -= STEP) <= 0) st.airLatch = null; } }
    if (!air) st.airLatch = null;
    inp.steer = (D ? 1 : 0) - (A ? 1 : 0); inp.push = W; inp.brake = S; inp.lean = (W ? 1 : 0) - (S ? 1 : 0);
    inp.grind = down('KeyE'); inp.grindPressed = pressed('KeyE'); inp.manual = down('ShiftLeft');
    st.wasCrouch = crouch; st.prev = { ...sc };
    return inp;
  };
}

/** one clip segment: teleport [x,y,z,heading,speed], key steps [{at, down, up}], frames; returns events per frame */
export { world, SkatePhysics, Vector3 };
export function replay({ tp, script = [], frames = 120, skip = 0, fakie = false, trace = 0, preroll = 2, onFrame = null }) {
  const ph = new SkatePhysics(world);
  ph.assist = { landing: false, autoGrind: false, fastRecover: false };
  ph.reset(new Vector3(tp[0], tp[1], tp[2]), (tp[3] * Math.PI) / 180);
  if (tp[4]) { ph.vel.copy(ph.fwd).multiplyScalar(tp[4]); ph.speed = tp[4]; }
  if (fakie) { ph.fwd.negate(); ph.fakie = true; }
  const map = proInput();
  for (let k = 0; k < preroll * 4; k++) { ph.events.length = 0; ph.step(STEP, map({}, ph)); }
  const steps = [...script].sort((a, b) => a.at - b.at), held = new Set();
  const ev = [], tr = [];
  let j = 0, dph = null;
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < 4; k++, j++) {
      const rel = j * STEP;
      while (steps.length && steps[0].at <= rel + 1e-9) { const s = steps.shift(); s.down?.forEach((c) => held.add(c)); s.up?.forEach((c) => held.delete(c)); }
      const sc = {}; held.forEach((c) => (sc[c] = true));
      ph.events.length = 0;
      ph.step(STEP, map(sc, ph));
      const dp = ph.dropin ? ph.dropin.phase : null;
      if (dp !== dph) { if (f >= skip) ev.push(`${f - skip}:dropin=${dp}`); dph = dp; }
      for (const e of ph.events) if (!['boardClack', 'leaveGround', 'push'].includes(e.type) && f >= skip) {
        ev.push(`${f - skip}:${e.type}${e.quality ? '=' + e.quality : ''}${e.flip ? '(' + e.flip + ')' : ''}${e.style ? '(' + e.style + ')' : ''}${e.kind && e.type === 'flip' ? '(' + e.kind + ')' : ''}${e.reason ? '[' + e.reason + ']' : ''}`);
      }
      if (ph.mode === 'bail') break;
    }
    if (onFrame) onFrame(ph, f);
    if (trace && f % trace === 0 && f >= skip) tr.push(`${f - skip}:${ph.mode[0]}(${ph.pos.x.toFixed(1)},${ph.pos.y.toFixed(1)},${ph.pos.z.toFixed(1)})${ph.speed.toFixed(1)}`);
    if (ph.mode === 'bail') { ev.push(`${f - skip}:BAIL-STOP`); break; }
  }
  return { ev, tr, end: { mode: ph.mode, pos: ph.pos.toArray().map((v) => +v.toFixed(2)), speed: +ph.speed.toFixed(2) } };
}

// ------------------------------------------------------------------ the media4 timelines (keep in sync with media4.mjs)
const { CASES } = await import(pathToFileURL(path.join(root, 'tools/capture/media4_cases.mjs')).href);
const sel = process.argv.slice(2);
const main = (process.argv[1] ?? '').endsWith('media4_sim.mjs');
for (const [name, segs] of main ? Object.entries(CASES) : []) {
  if (sel.length && !sel.some((s) => name.startsWith(s))) continue;
  for (const [i, seg] of segs.entries()) {
    const r = replay({ ...seg, trace: Number(process.env.TRACE || 0) });
    console.log(`${name}${segs.length > 1 ? '#' + i : ''}: ${r.ev.join(' ') || '-'} | end ${r.end.mode} ${r.end.pos} ${r.end.speed}`);
    if (r.tr.length) console.log('   ', r.tr.join(' '));
  }
}
