// Half-pipe pumping probe: A2's protocol (W on the flat and on descents, released on climbs, steer 0) vs variants.
// node tools/sim/build_src.mjs tools/sim/.build-e2 && node tools/sim/auto_hp_probe.mjs
globalThis.location = { search: '' };
const B = './.build-e2';
const { Vector3 } = await import('three');
const { buildPark } = await import(`${B}/world/park.js`);
const { CollisionWorld } = await import(`${B}/world/collision.js`);
const { SkatePhysics, emptyInput } = await import(`${B}/player/physics.js`);
const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);

function run(name, { steerWall = 0, kickPump = true, x = 21.5, z = -9, v = 0 } = {}) {
  const ph = new SkatePhysics(world);
  if (ph.assist) Object.assign(ph.assist, { landing: true, autoGrind: true, fastRecover: true });
  ph.reset(new Vector3(x, 0, z), Math.PI / 2);
  ph.vel.copy(ph.fwd).multiplyScalar(v);
  const bottoms = [], peaks = [];
  let peak = 0, airs = 0, lastSide = 0;
  for (let i = 0; i < 120 * 30; i++) {
    const inp = emptyInput();
    const flat = ph.up.y > 0.95, down = ph.vel.y < -0.05 && ph.up.y > 0.2 && ph.up.y < 0.97;
    inp.push = flat || down || (kickPump && ph.kickturn.t >= 0);
    if (!flat && steerWall) inp.steer = steerWall * Math.sin(i * 0.37);
    ph.events.length = 0;
    ph.step(1 / 120, inp);
    for (const e of ph.events) if (e.type === 'vertAir') airs++;
    if (ph.mode === 'ride' && !flat) peak = Math.max(peak, ph.pos.y);
    const side = Math.sign(ph.pos.x - 24);
    if (side !== lastSide && ph.mode === 'ride') { if (lastSide) { bottoms.push(+ph.speed.toFixed(2)); peaks.push(+peak.toFixed(2)); peak = 0; } lastSide = side; }
    if (ph.mode === 'bail') return console.log(name, 'BAIL at', i / 120);
  }
  console.log(`${name}: bottoms ${bottoms.slice(0, 10).join(' ')} | peaks ${peaks.slice(0, 10).join(' ')} | vert airs ${airs} | z ${ph.pos.z.toFixed(1)}`);
}
run('A2 protocol (push start at 21.5,-9)');
run('no W in kickturn', { kickPump: false });
run('entering at 6.5 m/s', { x: 22.2, v: 6.5 });
run('steering wobble on walls', { steerWall: 0.3 });
