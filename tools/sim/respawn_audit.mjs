// Audit of the places the rider is put down without a bail: the spawn (R respawn) and the landmark teleports.
// Each must be flat open ground he can stand on with the board under him.
//   node tools/sim/build_src.mjs tools/sim/.build-d && node tools/sim/respawn_audit.mjs
globalThis.location = { search: '' };
const B = new URL('./.build-d/', import.meta.url).href;
const { Vector3 } = await import('three');
const { buildPark } = await import(B + 'world/park.js');
const { CollisionWorld } = await import(B + 'world/collision.js');
const R = await import(B + 'player/recovery.js');

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const spots = [['spawn', park.spawn.pos, park.spawn.heading]];
let ok = 0;
for (const [name, p, hd] of spots) {
  const g = world.raycast(p.clone().add(new Vector3(0, 1.5, 0)), new Vector3(0, -1, 0), 4);
  const fwd = new Vector3(Math.sin(hd), 0, Math.cos(hd));
  const stand = g && R.standable(world, g.point), open = g && R.boardSpotOK(world, g.point, g.normal);
  const run = g ? R.bestHeading(world, g.point, fwd) : null;
  const good = !!(g && stand && g.normal.y > 0.98);
  if (good) ok++;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${name} (${p.x}, ${p.y}, ${p.z}) ground ny ${g?.normal.y.toFixed(3)} standable ${!!stand} open flat ${!!open} grind line ${R.grindDist(world, g.point).toFixed(2)} m, longest open run along ${run && Math.round(Math.atan2(run.x, run.z) * 57.3)} deg (spawn faces ${Math.round(hd * 57.3)})`);
}
console.log(`respawn audit: ${ok}/${spots.length}`);
