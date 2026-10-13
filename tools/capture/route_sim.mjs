// Headless route check for capture scripts (no browser): teleport + key script on the real park collision.
// node tools/sim/build_src.mjs && node tools/capture/route_sim.mjs '<json>'
//   json: { "tp": [x,y,z,headingDeg,speed], "script": [{at,down,up}], "dur": seconds, "every": 0.25 }
globalThis.location = { search: '' };
const { Vector3 } = await import('three');
const { buildPark } = await import('../sim/.build/world/park.js');
const { CollisionWorld } = await import('../sim/.build/world/collision.js');
const { SkatePhysics, emptyInput } = await import('../sim/.build/player/physics.js');

const park = buildPark();
const b = park.builder;
const world = new CollisionWorld(b.collisionGeometry(), b.cSurf, park.grindLines);
const STEP = 1 / 120;

function inputMapper() {
  let wasCrouch = false, prevSpace = false, prevE = false, latch = null;
  return (keys, airborne) => {
    const inp = emptyInput();
    const down = (c) => keys.has(c);
    inp.steer = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0);
    inp.push = down('KeyW'); inp.brake = down('KeyS');
    inp.lean = (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0);
    const crouch = down('Space');
    inp.grind = down('KeyE'); inp.grindPressed = down('KeyE') && !prevE; prevE = down('KeyE');
    inp.manual = down('ShiftLeft');
    const flip = down('ArrowLeft') ? 'left' : down('ArrowRight') ? 'right' : down('ArrowDown') ? 'down' : down('ArrowUp') ? 'up' : null;
    const spacePressed = down('Space') && !prevSpace; prevSpace = down('Space');
    inp.crouch = crouch;
    const released = wasCrouch && !crouch;
    if (!airborne) { if (released) { inp.ollie = true; inp.flip = flip; } }
    else { if (spacePressed && flip) latch = flip; if (latch) { inp.airTrick = latch; latch = null; } }
    wasCrouch = crouch;
    return inp;
  };
}

export function run(spec) {
  const ph = new SkatePhysics(world);
  const [x, y, z, hd, sp] = spec.tp;
  ph.reset(new Vector3(x, y, z), (hd * Math.PI) / 180);
  if (sp) ph.vel.copy(ph.fwd).multiplyScalar(sp);
  const steps = [...(spec.script ?? [])].sort((a, b) => a.at - b.at);
  const keys = new Set();
  const map = inputMapper();
  const every = spec.every ?? 0.25;
  const trace = [], events = [];
  let t = 0, nextLog = 0;
  for (let i = 0; i < Math.round((spec.dur ?? 6) * 120); i++) {
    while (steps.length && steps[0].at <= t) { const s = steps.shift(); s.down?.forEach((k) => keys.add(k)); s.up?.forEach((k) => keys.delete(k)); }
    ph.events.length = 0;
    ph.step(STEP, map(keys, ph.mode === 'air'));
    t += STEP;
    for (const e of ph.events) events.push(`${t.toFixed(2)}:${e.type}${e.quality ? ':' + e.quality : ''}${e.kind ? '<' + e.kind + '>' : ''}${e.name ? '[' + e.name + ']' : ''}${e.reason ? '{' + e.reason + '}' : ''}`);
    if (t >= nextLog - 1e-9) {
      nextLog += every;
      const hd = Math.round((Math.atan2(ph.vel.x, ph.vel.z) * 180) / Math.PI);
      trace.push(`${t.toFixed(2)} ${ph.mode[0]} ${ph.pos.x.toFixed(1)},${ph.pos.y.toFixed(1)},${ph.pos.z.toFixed(1)} v${ph.vel.length().toFixed(1)}${spec.slope ? ` u${ph.up.y.toFixed(2)} h${hd}` : ''}`);
    }
  }
  return { trace, events, end: { mode: ph.mode, pos: ph.pos.toArray().map((v) => +v.toFixed(2)), speed: +ph.vel.length().toFixed(2) } };
}

if (process.argv[2]) {
  const r = run(JSON.parse(process.argv[2]));
  console.log('events:', r.events.join(' '));
  console.log('trace:', r.trace.join(' | '));
  console.log('end:', JSON.stringify(r.end));
}
