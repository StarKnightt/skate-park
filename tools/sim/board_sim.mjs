// Headless check of the bail board rigid body on the real park collision: does it separate, travel 1-2 m and come to rest
// on the ground (wheels down or upside down) without hovering?  node tools/sim/build_src.mjs && node tools/sim/board_sim.mjs
globalThis.location = { search: '' };
const { Vector3 } = await import('three');
const { buildPark } = await import('./.build/world/park.js');
const { CollisionWorld } = await import('./.build/world/collision.js');
const { SkatePhysics, emptyInput } = await import('./.build/player/physics.js');

const park = buildPark();
const b = park.builder;
const world = new CollisionWorld(b.collisionGeometry(), b.cSurf, park.grindLines);
const cases = [
  { name: 'wall ride-in 7.5', pos: [12, 0, -9], heading: 90, speed: 7.5, kind: null, t: 0 },
  { name: 'bowl bail 5', pos: [-24, -2.3, 0], heading: 90, speed: 5, kind: 'face', t: 0.3 },
  { name: 'east seat step trip 7.5', pos: [33, 0, 0], heading: 90, speed: 7.5, kind: null, t: 0 },
  { name: 'east seat step trip 5', pos: [35, 0, 6], heading: 90, speed: 5, kind: null, t: 0 },
];
// many seeds (the kick-out is randomised from the bail time)
for (const [i, t] of [0.3, 0.37, 0.45, 0.52, 0.61, 0.7, 0.77, 0.86].entries()) {
  const kind = ['face', 'back', 'knock', 'roll'][i % 4];
  cases.push({ name: `${kind} bail flat ${(4 + i * 0.4).toFixed(1)} @${t}`, pos: [30, 0, 20], heading: 180, speed: 4 + i * 0.4, kind, t });
}
const quiet = !!process.env.QUIET;
const STEP = 1 / 120;
for (const c of cases) {
  const ph = new SkatePhysics(world);
  ph.reset(new Vector3(...c.pos), (c.heading * Math.PI) / 180);
  ph.vel.copy(ph.fwd).multiplyScalar(c.speed);
  const inp = emptyInput();
  let t = 0, bailed = false, start = null;
  const rows = [];
  for (let i = 0; i < 120 * 10; i++) {
    if (!bailed && c.kind && t >= c.t) { ph.toBail(c.kind, 'test'); }
    if (ph.mode === 'bail' && !bailed) { bailed = true; start = ph.bail.board.rootPos(new Vector3()); }
    ph.step(STEP, inp);
    t += STEP;
    if (bailed && i % 30 === 0) {
      const bb = ph.bail.board;
      const r = bb.rootPos(new Vector3());
      const up = new Vector3(0, 1, 0).applyQuaternion(bb.q);
      const g = world.raycast(r.clone().add(new Vector3(0, 0.5, 0)), new Vector3(0, -1, 0), 3);
      rows.push(`${t.toFixed(2)}s root(${r.x.toFixed(2)},${r.y.toFixed(3)},${r.z.toFixed(2)}) gnd${g ? g.point.y.toFixed(3) : '-'} upY${up.y.toFixed(2)} v${bb.v.length().toFixed(2)} w${bb.w.length().toFixed(1)} c${bb.contacts}${bb.asleep ? ' SLEEP' : ''}`);
    }
    if (bailed && ph.bail.board.asleep && rows.length > 2) break;
  }
  if (!bailed) { console.log(`${c.name}: no bail (mode ${ph.mode})`); continue; }
  const bb = ph.bail.board;
  const r = bb.rootPos(new Vector3());
  const up = new Vector3(0, 1, 0).applyQuaternion(bb.q);
  // lowest point of the deck/wheels vs the ground under it
  const g = world.raycast(r.clone().add(new Vector3(0, 0.5, 0)), new Vector3(0, -1, 0), 3);
  console.log(`\n${c.name}: asleep=${bb.asleep} at ${bb.t.toFixed(2)} s, travelled ${start.distanceTo(r).toFixed(2)} m, upY ${up.y.toFixed(2)} (${up.y > 0.8 ? 'wheels down' : up.y < -0.8 ? 'upside down' : 'ON EDGE'}), root y ${r.y.toFixed(3)} vs ground ${g ? g.point.y.toFixed(3) : '?'}`);
  if (!quiet) console.log('  ' + rows.join('\n  '));
}
