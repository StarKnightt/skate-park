// Ground profile along a line on the real park collision (height/surface every step).
// node tools/sim/build_src.mjs && node tools/sim/ground_scan.mjs x0 z0 x1 z1 [step=0.25]
globalThis.location = { search: '' };
const { Vector3 } = await import('three');
const { buildPark } = await import('./.build/world/park.js');
const { CollisionWorld } = await import('./.build/world/collision.js');

const [x0, z0, x1, z1, step = 0.25] = process.argv.slice(2).map(Number);
const park = buildPark();
const b = park.builder;
const world = new CollisionWorld(b.collisionGeometry(), b.cSurf, park.grindLines);
const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / step));
const out = [];
for (let i = 0; i <= n; i++) {
  const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
  const h = world.raycast(new Vector3(x, 4, z), new Vector3(0, -1, 0), 8);
  out.push(`${x.toFixed(2)},${z.toFixed(2)}:${h ? h.point.y.toFixed(3) + (h.surface ? '/s' + h.surface : '') : '-'}`);
}
console.log(out.join('  '));
