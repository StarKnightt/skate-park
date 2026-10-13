// Node-only check of the procedural park (no browser): bundles src/world/park.ts, builds the collision BVH and verifies
// that the test/capture corridors stay flat and unobstructed, capture cameras are not inside geometry, and lists surfaces.
// node tools/capture/world_check.mjs
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../..');
const pnpm = path.join(root, 'node_modules/.pnpm');
const rdDir = fs.readdirSync(pnpm).find((d) => d.startsWith('rolldown@'));
const rd = await import(pathToFileURL(path.join(pnpm, rdDir, 'node_modules/rolldown/dist/index.mjs')).href);
const outDir = path.join(root, 'node_modules/.cache/world_check');
fs.mkdirSync(outDir, { recursive: true });
const bundle = await rd.rolldown({ input: path.join(root, 'src/world/park.ts'), external: [/^three/], platform: 'node', logLevel: 'silent' });
await bundle.write({ file: path.join(outDir, 'park.mjs'), format: 'esm' });
const { buildPark } = await import(pathToFileURL(path.join(outDir, 'park.mjs')).href + '?t=' + Date.now());
const { Vector3, Ray, FrontSide } = await import('three');
const { MeshBVH } = await import('three-mesh-bvh');

const t0 = performance.now();
const park = buildPark();
const geo = park.builder.collisionGeometry();
const surf = park.builder.cSurf;
const bvh = new MeshBVH(geo, { targetLeafSize: 8 });
console.log(`park built in ${(performance.now() - t0).toFixed(0)} ms: ${geo.index.count / 3} collision tris, ${park.grindLines.length} grind lines, ${park.detail.props.length} props`);
const counts = {};
for (const s of surf) counts[s] = (counts[s] ?? 0) + 1;
console.log('collision vertices by surface id:', counts);

const down = new Vector3(0, -1, 0);
const ray = new Ray();
const groundAt = (x, z, from = 3) => {
  ray.origin.set(x, from, z); ray.direction.copy(down);
  const h = bvh.raycastFirst(ray, FrontSide, 0, from + 2);
  return h ? h.point.y : null;
};
const bodyHit = (p) => {
  for (const hgt of [0.42, 0.95, 1.42]) {
    const c = new Vector3(p.x, p.y + hgt, p.z);
    const t = { point: new Vector3(), distance: 0, faceIndex: 0 };
    const r = bvh.closestPointToPoint(c, t, 0, 0.24);
    if (!r || t.distance > 0.24) continue;
    const sep = c.clone().sub(t.point);
    if (sep.length() > 1e-5 && sep.normalize().y > 0.55) continue;
    return { h: hgt, at: t.point.toArray().map((v) => +v.toFixed(2)) };
  }
  return null;
};
const corridors = [
  ['spawn line (ollie/flip/manual/push tests)', [9, 3], [0, -1], 10.5],
  ['ledge test approach', [5, -12.95], [-1, 0], 17],
  ['ledge run-out past the nw curb', [-12, -12.95], [-1, 0], 13],
  ['bowl drop-in approach', [-11, 0], [-1, 0], 3.9],
  ['wall bail approach', [12, -9], [1, 0], 4.0],
  ['funbox flat bar approach', [0, 4], [0, -1], 2.6],
  ['b_ trick close-ups', [30, 20], [0, -1], 9],
  ['clip01 push', [-2, 1.5], [-1, 0], 13],
  ['clip02 flatground flips', [-16, 10.5], [1, 0], 53],
  ['clip03 start', [11, -0.6], [-1, 0], 6.5],
  ['clip03 return', [-8, -5.4], [1, 0], 20],
  ['clip05/06 manual + wobble', [34, 18], [0, -1], 33],
  ['clip07 wall bail', [9.5, -9], [1, 0], 6.5],
  ['stairs run-out', [7, 12.2], [0, -1], 8],
];
let bad = 0;
for (const [name, [x, z], [dx, dz], len] of corridors) {
  const issues = [];
  for (let s = 0; s <= len; s += 0.25) {
    const px = x + dx * s, pz = z + dz * s;
    const g = groundAt(px, pz);
    if (g === null || Math.abs(g) > 0.002) { issues.push(`ground ${g?.toFixed(3)} at ${px.toFixed(2)},${pz.toFixed(2)}`); continue; }
    const hit = bodyHit(new Vector3(px, 0, pz));
    if (hit) issues.push(`body@${hit.h} hits ${hit.at} at ${px.toFixed(2)},${pz.toFixed(2)}`);
  }
  if (issues.length) bad++;
  console.log(`${issues.length ? 'FAIL' : 'ok  '} ${name}${issues.length ? ': ' + issues.slice(0, 3).join(' | ') + (issues.length > 3 ? ` (+${issues.length - 3})` : '') : ''}`);
}
// capture cameras must not sit inside geometry
const cams = {
  c_bowl_main: [-15.5, 1.8, 8], c_bowl_pocket: [-16.5, 1.7, 21], c_halfpipe: [24, 4.6, 6.5], c_halfpipe_inside: [23.2, 0.9, -4.5],
  c_quarterpipe_terrace: [-9.5, 4.2, 14.5], c_quarterpipe_and_bank_north: [-5, 2.4, -11], c_stairs_handrail: [11.5, 2.2, 7.5],
  c_funbox_flatbar: [7.5, 2.4, 5.5], c_banks_terrace: [-9, 2.2, 7], c_ledges_rail: [-3, 1.9, -6.5], c_curb_and_manualpad: [-1, 1.8, 10],
  c_mural_sunwaves: [8.5, 1.8, -9], c_mural_koi: [-27, 1.9, 0.5], c_mural_patchwork: [25, 1.8, 15.5], d_boardwalk: [-20, 2.0, -21],
  d_palms: [-30, 1.6, -18], clip08_cam: [24, 3.4, 4.5],
};
for (const [k, l] of Object.entries(park.landmarks)) cams['landmark ' + k] = l.pos.toArray();
for (const [name, p] of Object.entries(cams)) {
  const t = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const r = bvh.closestPointToPoint(new Vector3(...p), t, 0, 0.25);
  if (r && t.distance < 0.25) { bad++; console.log(`FAIL camera ${name} at ${p} is ${t.distance.toFixed(2)} m from geometry`); }
}
// degenerate collision triangles
const pos = geo.getAttribute('position'), idx = geo.index.array;
let degen = 0;
const a = new Vector3(), b2 = new Vector3(), c = new Vector3();
for (let i = 0; i < idx.length; i += 3) {
  a.fromBufferAttribute(pos, idx[i]); b2.fromBufferAttribute(pos, idx[i + 1]); c.fromBufferAttribute(pos, idx[i + 2]);
  if (b2.sub(a).cross(c.sub(a)).length() < 1e-9) degen++;
}
console.log(`degenerate collision triangles: ${degen}`);
console.log(bad ? `${bad} corridor/camera problems` : 'all corridors clear');
