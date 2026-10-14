// M2: ground height along lines on the real park collision (light, no browser), to place feature-clip runs.
//   node tools/sim/build_src.mjs tools/sim/.build-m2 && node tools/realtime/media_scan.mjs x0 z0 x1 z1 [step=0.5] [...more lines]
globalThis.location = { search: '' };
const { Vector3 } = await import('three');
const { buildPark } = await import('../sim/.build-m2/world/park.js');
const { CollisionWorld } = await import('../sim/.build-m2/world/collision.js');

const a = process.argv.slice(2).map(Number);
const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
for (let k = 0; k + 4 <= a.length; k += 5) {
  const [x0, z0, x1, z1, step = 0.5] = a.slice(k, k + 5);
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / (step || 0.5)));
  const out = [];
  let flat0 = null;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
    const h = world.raycast(new Vector3(x, 4, z), new Vector3(0, -1, 0), 8);
    const y = h ? h.point.y : NaN, ny = h ? h.normal.y : NaN;
    out.push(`${x.toFixed(1)},${z.toFixed(1)}:${Number.isFinite(y) ? y.toFixed(2) : '-'}${ny < 0.99 ? '/n' + ny.toFixed(2) : ''}`);
    if (flat0 === null && !(Math.abs(y) < 0.02 && ny > 0.99)) flat0 = i;
  }
  console.log(`line ${x0},${z0} -> ${x1},${z1}: flat for ${flat0 === null ? L.toFixed(1) : ((flat0 * L) / n).toFixed(1)} m`);
  console.log(out.join('  '));
}
console.log('grind lines:', park.grindLines.filter((g) => /long ledge|nw curb/.test(g.name)).map((g) => `${g.name} ${g.pts.map((p) => p.toArray().map((v) => +v.toFixed(2)).join(',')).join(' -> ')}`).join(' | '));
