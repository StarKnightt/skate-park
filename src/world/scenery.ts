import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Matrix4, Mesh, Object3D, PlaneGeometry, Quaternion, SphereGeometry, SRGBColorSpace, Vector3, MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/materials';
import { rng } from '../core/util';

const R = rng(1234);
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** vertex-colour every vertex of a geometry */
function paint(g: BufferGeometry, c: Color | string, jitter = 0) {
  const col = new Color(c as any);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (R() - 0.5) * jitter;
    arr[i * 3] = col.r * j; arr[i * 3 + 1] = col.g * j; arr[i * 3 + 2] = col.b * j;
  }
  g.setAttribute('color', new BufferAttribute(arr, 3));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}
const at = (g: BufferGeometry, x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) =>
  g.applyMatrix4(new Matrix4().compose(V(x, y, z), new Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(sx, sy, sz)));
const ni = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);

export function terrainHeight(x: number, z: number) {
  // beach slopes down to the water towards -Z; flat town ground to the south
  let h = -0.14;
  if (z < -27.4) h -= (-27.4 - z) * 0.026;
  const away = Math.min(1, Math.max(0, (Math.abs(x) - 45) / 30) + Math.max(0, (-z - 34) / 20));
  h += (Math.sin(x * 0.05 + z * 0.03) * 0.5 + Math.sin(x * 0.11 - z * 0.07) * 0.3) * 0.35 * away * (z < -27 ? 1 : 0.4);
  return h;
}

export interface Scenery {
  group: Group;
  windows: MeshLambertMaterial;
  lampHeads: MeshLambertMaterial;
  lampLights: Vector3[];
  lighthouseLamp: MeshLambertMaterial;
  update(t: number, dt: number): void;
}

export function buildScenery(lampPositions: Vector3[]): Scenery {
  const group = new Group();
  const vc = (o: Partial<Parameters<typeof toonMaterial>[0]> = {}) => toonMaterial({ vertexColors: true, bands: 0.35, wrap: 0.4, rim: 0.35, ...o });

  // ------------------------------------------------------------------ terrain (sand + town ground)
  {
    const W = 560, D = 300, nx = 140, nz = 75;
    const g = new PlaneGeometry(W, D, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, 10);
    const p = g.getAttribute('position') as BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const sand = new Color('#efd3a2'), wet = new Color('#c9a77e'), grass = new Color('#a8c070'), path = new Color('#d9c4a0');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = terrainHeight(x, z);
      p.setY(i, y);
      let c = sand.clone();
      if (z > 32 && Math.abs(x) < 120) c.lerp(grass, Math.min(1, (z - 32) / 8) * (0.6 + 0.4 * Math.sin(x * 0.2) * Math.sin(z * 0.3)));
      if (z > 30 && z < 36) c.lerp(path, 0.6);
      if (y < -1.15) c.lerp(wet, Math.min(1, (-1.15 - y) / 0.25));
      const j = 0.96 + R() * 0.06;
      col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * j;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    // no terrain under the park pad (it would show through the bowl openings)
    const idx = g.index!.array;
    const keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += p.getX(idx[t + k]); cz += p.getZ(idx[t + k]); }
      cx /= 3; cz /= 3;
      if (Math.abs(cx) < 36.5 && cz > -21.5 && cz < 24) continue;
      keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    g.setIndex(keep);
    g.computeVertexNormals();
    const m = new Mesh(g, toonMaterial({ vertexColors: true, detail: 'sand', bands: 0.2, wrap: 0.45, rim: 0.2, name: 'sand' }));
    m.receiveShadow = true;
    group.add(m);
  }

  // ------------------------------------------------------------------ boardwalk railing, posts, benches
  const woodParts: BufferGeometry[] = [];
  const woodDark = new Color('#a77a52'), woodLight = new Color('#c99b6c');
  for (let x = -70; x <= 70; x += 2.5) {
    woodParts.push(paint(ni(at(new BoxGeometry(0.12, 1.0, 0.12), x, 0.5, -27.3)), woodDark, 0.1));
    woodParts.push(paint(ni(at(new CylinderGeometry(0.14, 0.14, 1.4, 6), x, -0.7, -27.1)), woodDark, 0.1));
  }
  woodParts.push(paint(ni(at(new BoxGeometry(140, 0.08, 0.16), 0, 1.0, -27.3)), woodLight));
  woodParts.push(paint(ni(at(new BoxGeometry(140, 0.06, 0.08), 0, 0.55, -27.3)), woodLight));
  // fascia board along the beach side
  woodParts.push(paint(ni(at(new BoxGeometry(140, 0.3, 0.05), 0, -0.15, -27.42)), woodDark));
  // benches on the boardwalk
  for (const x of [-30, -12, 14, 30]) {
    woodParts.push(paint(ni(at(new BoxGeometry(1.8, 0.06, 0.45), x, 0.45, -26.6)), woodLight));
    woodParts.push(paint(ni(at(new BoxGeometry(1.8, 0.4, 0.06), x, 0.75, -26.85)), woodLight));
    for (const dx of [-0.8, 0.8]) woodParts.push(paint(ni(at(new BoxGeometry(0.08, 0.45, 0.4), x + dx, 0.22, -26.6)), woodDark));
  }
  const woodMesh = new Mesh(mergeGeometries(woodParts), vc({ name: 'woodProps' }));
  woodMesh.castShadow = true; woodMesh.receiveShadow = true;
  group.add(woodMesh);

  // ------------------------------------------------------------------ lamp posts (park + boardwalk)
  const poleParts: BufferGeometry[] = [];
  const headParts: BufferGeometry[] = [];
  const lampLights: Vector3[] = [];
  const allLamps = [...lampPositions];
  for (let x = -66; x <= 66; x += 16.5) allLamps.push(V(x, 0, -27.0));
  const poleCol = new Color('#3f6f74');
  for (const lp of allLamps) {
    const y0 = lp.y;
    poleParts.push(paint(ni(at(new CylinderGeometry(0.07, 0.1, 4.4, 8), lp.x, y0 + 2.2, lp.z)), poleCol));
    poleParts.push(paint(ni(at(new CylinderGeometry(0.16, 0.16, 0.25, 8), lp.x, y0 + 0.12, lp.z)), poleCol));
    poleParts.push(paint(ni(at(new ConeGeometry(0.42, 0.32, 10), lp.x, y0 + 4.75, lp.z)), poleCol));
    headParts.push(paint(ni(at(new SphereGeometry(0.2, 10, 8), lp.x, y0 + 4.48, lp.z)), new Color('#fff1d6')));
    lampLights.push(V(lp.x, y0 + 4.4, lp.z));
  }
  const poles = new Mesh(mergeGeometries(poleParts), vc({ spec: 0.4, name: 'poles' }));
  poles.castShadow = true;
  group.add(poles);
  const lampHeads = toonMaterial({ vertexColors: true, emissive: 0xffc27a, emissiveIntensity: 0, bands: 0.2, lamps: false, name: 'lampHeads' });
  group.add(new Mesh(mergeGeometries(headParts), lampHeads));

  // ------------------------------------------------------------------ beach houses
  const walls: BufferGeometry[] = [], roofs: BufferGeometry[] = [], trims: BufferGeometry[] = [], wins: BufferGeometry[] = [];
  const houseCols = ['#9fd8c6', '#f4a68c', '#f7d98b', '#a8c8f0', '#d5b8e8', '#f2c0c8', '#bfe3a6'];
  const roofCols = ['#c4664e', '#5f7fa8', '#d98b55', '#7a6aa8', '#bf5a5a', '#4f8a8a', '#c9873f'];
  const houses: [number, number, number, number][] = [
    [-58, -40, 0.15, 1], [-76, -36, -0.1, 0.9], [-95, -43, 0.2, 1.1], [-118, -38, 0.05, 1],
    [60, -38, -0.2, 1], [79, -34, 0.1, 0.95], [98, -42, -0.05, 1.1], [120, -37, 0.15, 1],
    [-24, 46, 3.14, 1.05], [2, 49, 3.1, 0.95], [28, 45, 3.2, 1.1], [52, 50, 3.0, 1], [-50, 48, 3.25, 0.9],
  ];
  houses.forEach(([x, z, ry, s], i) => {
    const beach = z < 0;
    const w = 8 * s, d = 6.5 * s, h = 3.6 * s;
    const y0 = terrainHeight(x, z) + (beach ? 1.6 : 0);
    const col = new Color(houseCols[i % houseCols.length]);
    const rc = new Color(roofCols[i % roofCols.length]);
    const T = new Matrix4().compose(V(x, 0, z), new Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1));
    const add = (arr: BufferGeometry[], g: BufferGeometry, c: Color, j = 0.04) => arr.push(paint(ni(g.applyMatrix4(T)), c, j));
    add(walls, at(new BoxGeometry(w, h, d), 0, y0 + h / 2, 0), col);
    // gable roof (prism)
    const roof = new CylinderGeometry(0.01, d * 0.72, w * 1.12, 3, 1);
    roof.rotateZ(Math.PI / 2); roof.rotateX(Math.PI / 6);
    roof.scale(1, 0.55, 1);
    add(roofs, at(roof, 0, y0 + h + d * 0.18, 0), rc, 0.06);
    // trim + porch
    add(trims, at(new BoxGeometry(w + 0.2, 0.18, d + 0.2), 0, y0 + 0.09, 0), new Color('#fbf6ec'));
    add(trims, at(new BoxGeometry(w + 0.25, 0.14, d + 0.25), 0, y0 + h, 0), new Color('#fbf6ec'));
    if (beach) {
      add(trims, at(new BoxGeometry(w, 0.15, 2.2), 0, y0 + 0.07, -d / 2 - 1.1), new Color('#e8dccb'));
      for (const sx of [-w / 2 + 0.2, 0, w / 2 - 0.2]) for (const sz of [-d / 2 - 2.0, d / 2 - 0.2, -d / 2 + 0.2])
        add(trims, at(new BoxGeometry(0.22, y0 - terrainHeight(x, z) + 0.2, 0.22), sx, (y0 + terrainHeight(x, z)) / 2, sz), new Color('#c8b79e'));
      for (let k = 0; k <= 6; k++) add(trims, at(new BoxGeometry(0.07, 0.9, 0.07), -w / 2 + (w * k) / 6, y0 + 0.55, -d / 2 - 2.15), new Color('#fbf6ec'));
      add(trims, at(new BoxGeometry(w, 0.07, 0.09), 0, y0 + 1.0, -d / 2 - 2.15), new Color('#fbf6ec'));
    }
    // windows (front & sides) + door
    const front = beach ? -d / 2 - 0.01 : d / 2 + 0.01;
    for (const wx of [-w * 0.3, w * 0.3]) add(wins, at(new BoxGeometry(1.3 * s, 1.2 * s, 0.06), wx, y0 + h * 0.55, front), new Color('#ffffff'), 0);
    add(wins, at(new BoxGeometry(0.06, 1.1 * s, 1.4 * s), w / 2 + 0.01, y0 + h * 0.55, 0), new Color('#ffffff'), 0);
    add(wins, at(new BoxGeometry(0.06, 1.1 * s, 1.4 * s), -w / 2 - 0.01, y0 + h * 0.55, 0), new Color('#ffffff'), 0);
    add(trims, at(new BoxGeometry(1.1 * s, 2.1 * s, 0.08), 0, y0 + 1.05 * s, front), new Color(roofCols[(i + 3) % roofCols.length]));
  });
  const wallMesh = new Mesh(mergeGeometries(walls), vc({ detail: 'wall', name: 'houseWalls' }));
  const roofMesh = new Mesh(mergeGeometries(roofs), vc({ name: 'roofs' }));
  const trimMesh = new Mesh(mergeGeometries(trims), vc({ name: 'trim' }));
  for (const m of [wallMesh, roofMesh, trimMesh]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  const windows = toonMaterial({ color: 0x48618f, emissive: 0xffc070, emissiveIntensity: 0, bands: 0.2, spec: 0.8, shininess: 30, lamps: false, name: 'windows' });
  group.add(new Mesh(mergeGeometries(wins), windows));

  // ------------------------------------------------------------------ distant headland + lighthouse + island
  {
    const g = new PlaneGeometry(900, 520, 90, 52);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position') as BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const lo = new Color('#c9b48a'), mid = new Color('#7f9a5c'), hi = new Color('#5f7d52'), rock = new Color('#b89a86');
    const bumps: [number, number, number, number][] = [[330, -330, 95, 70], [430, -260, 70, 52], [240, -420, 80, 44], [520, -380, 110, 64],
      [-430, -520, 140, 40], [-330, -560, 90, 30], [120, -560, 60, 16]];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 100, z = p.getZ(i) - 380;
      let hgt = 0;
      for (const [bx, bz, r, hh] of bumps) hgt += hh * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (r * r));
      hgt += Math.sin(x * 0.03) * Math.cos(z * 0.04) * 3;
      hgt = hgt - 4;
      p.setXYZ(i, x, hgt, z);
      const c = lo.clone().lerp(mid, Math.min(1, Math.max(0, (hgt - 4) / 14))).lerp(hi, Math.min(1, Math.max(0, (hgt - 25) / 30)));
      if (hgt > 2 && hgt < 9) c.lerp(rock, 0.45);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new Mesh(g, toonMaterial({ vertexColors: true, bands: 0.55, wrap: 0.3, rim: 0.3, lamps: false, name: 'hills' }));
    group.add(m);
  }
  const lhParts: BufferGeometry[] = [];
  const lhX = 300, lhZ = -300;
  const lhBase = 64;
  for (let k = 0; k < 6; k++) {
    const g = new CylinderGeometry(2.6 - k * 0.18, 2.8 - k * 0.18, 3, 14);
    lhParts.push(paint(ni(at(g, lhX, lhBase + 1.5 + k * 3, lhZ)), k % 2 ? '#d94d43' : '#fbf6ef'));
  }
  lhParts.push(paint(ni(at(new CylinderGeometry(2.2, 2.2, 0.5, 14), lhX, lhBase + 18.3, lhZ)), '#3e4a56'));
  lhParts.push(paint(ni(at(new ConeGeometry(2.0, 2.4, 14), lhX, lhBase + 21.8, lhZ)), '#d94d43'));
  group.add(new Mesh(mergeGeometries(lhParts), vc({ lamps: false, name: 'lighthouse' })));
  const lighthouseLamp = toonMaterial({ color: 0xfff0c8, emissive: 0xffe6a8, emissiveIntensity: 0.3, lamps: false, name: 'lhLamp' });
  const lamp = new Mesh(new CylinderGeometry(1.5, 1.5, 2.2, 12), lighthouseLamp);
  lamp.position.set(lhX, lhBase + 19.6, lhZ);
  group.add(lamp);

  // ------------------------------------------------------------------ lifeguard tower, umbrellas, surfboards
  const propParts: BufferGeometry[] = [];
  {
    const x = -8, z = -52, y = terrainHeight(x, z);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) propParts.push(paint(ni(at(new BoxGeometry(0.18, 2.6, 0.18), x + dx * 1.1, y + 1.3, z + dz * 1.1)), '#f4efe6'));
    propParts.push(paint(ni(at(new BoxGeometry(3.0, 0.2, 3.0), x, y + 2.6, z)), '#f4efe6'));
    propParts.push(paint(ni(at(new BoxGeometry(2.4, 1.6, 2.2), x, y + 3.5, z)), '#4fb3c9'));
    propParts.push(paint(ni(at(new BoxGeometry(2.8, 0.18, 2.8), x, y + 4.4, z)), '#e24f45'));
    propParts.push(paint(ni(at(new BoxGeometry(2.2, 0.08, 4.0), x, y + 1.3, z + 2.9, 0).applyMatrix4(new Matrix4().makeRotationX(0))), '#f4efe6'));
    // ramp
    const ramp = new BoxGeometry(1.0, 0.08, 3.6); ramp.rotateX(-0.75); at(ramp, x, y + 1.3, z + 2.6);
    propParts.push(paint(ni(ramp), '#e7ddcb'));
    // surfboards leaning
    const boardCols = ['#f08a5d', '#6cc3b8', '#f7d06b'];
    boardCols.forEach((c, k) => {
      const s = new SphereGeometry(1, 12, 6); s.scale(0.28, 1.1, 0.06); s.rotateX(-0.25); at(s, x + 1.6 + k * 0.6, y + 1.05, z - 1.3 - k * 0.1);
      propParts.push(paint(ni(s), c));
    });
  }
  const umbrellaSpots: [number, number, string, string][] = [[-30, -48, '#f26b5b', '#fff4e4'], [-40, -56, '#4bb3c4', '#fff4e4'], [22, -50, '#f7c95a', '#f26b5b'], [36, -58, '#8f7ad1', '#fff4e4'], [-58, -60, '#f26b5b', '#4bb3c4']];
  for (const [x, z, c1, c2] of umbrellaSpots) {
    const y = terrainHeight(x, z);
    propParts.push(paint(ni(at(new CylinderGeometry(0.04, 0.04, 2.4, 6), x, y + 1.2, z)), '#f4efe6'));
    for (let k = 0; k < 8; k++) {
      const seg = new ConeGeometry(1.4, 0.55, 8, 1, true, (k * Math.PI) / 4, Math.PI / 4);
      propParts.push(paint(ni(at(seg, x, y + 2.45, z)), k % 2 ? c1 : c2));
    }
    // towel
    propParts.push(paint(ni(at(new BoxGeometry(1.0, 0.02, 1.8), x + 1.4, y + 0.02, z + 0.6, 0.3)), c1));
  }
  const propMesh = new Mesh(mergeGeometries(propParts), vc({ side: DoubleSide, name: 'beachProps' }));
  propMesh.castShadow = true; propMesh.receiveShadow = true;
  group.add(propMesh);

  // ------------------------------------------------------------------ planters + shrubs along the park's south edge
  const shrubParts: BufferGeometry[] = [];
  for (let x = -34; x <= 34; x += 6.8) {
    if (Math.abs(x - 25) < 6) continue;
    shrubParts.push(paint(ni(at(new BoxGeometry(2.2, 0.55, 0.9), x, 0.27, 27.2)), '#d8cfc0'));
    for (let k = 0; k < 4; k++) {
      const s = new SphereGeometry(0.45 + R() * 0.25, 8, 6); at(s, x - 0.75 + k * 0.5, 0.75 + R() * 0.15, 27.2 + (R() - 0.5) * 0.3);
      shrubParts.push(paint(ni(s), k % 2 ? '#7fae5a' : '#93bf63', 0.12));
    }
    if (k3(x)) {
      const f = new SphereGeometry(0.16, 6, 4); at(f, x + 0.2, 1.15, 27.0);
      shrubParts.push(paint(ni(f), '#f58fb0'));
    }
  }
  function k3(x: number) { return Math.round(x) % 3 === 0; }
  const shrubs = new Mesh(mergeGeometries(shrubParts), vc({ name: 'shrubs' }));
  shrubs.castShadow = true; shrubs.receiveShadow = true;
  group.add(shrubs);

  // ------------------------------------------------------------------ palms
  const palms = buildPalms();
  group.add(palms);

  // ------------------------------------------------------------------ seagulls
  const gulls = new Group();
  const gullMat = vc({ name: 'gulls', side: DoubleSide });
  const birds: { o: Object3D; wl: Mesh; wr: Mesh; r: number; h: number; c: Vector3; ph: number; sp: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const o = new Group();
    const body = new Mesh(paint(new SphereGeometry(0.16, 8, 6).scale(1, 0.75, 2.2), '#f6f3ee'), gullMat);
    const wingG = paint(new BoxGeometry(0.85, 0.02, 0.28).translate(0.42, 0, 0), '#e4e1dc');
    const tip = paint(new BoxGeometry(0.25, 0.021, 0.22).translate(0.95, 0, 0.02), '#3b3f48');
    const wl = new Mesh(mergeGeometries([wingG, tip]), gullMat);
    const wr = wl.clone(); wr.scale.x = -1;
    o.add(body, wl, wr);
    o.scale.setScalar(1.3);
    gulls.add(o);
    birds.push({ o, wl, wr, r: 14 + R() * 26, h: 9 + R() * 14, c: V(-30 + R() * 70, 0, -50 - R() * 30), ph: R() * 6.28, sp: 0.12 + R() * 0.12 });
  }
  group.add(gulls);

  return {
    group, windows, lampHeads, lampLights, lighthouseLamp,
    update(t: number) {
      for (const b of birds) {
        const a = b.ph + t * b.sp;
        b.o.position.set(b.c.x + Math.cos(a) * b.r, b.h + Math.sin(t * 0.5 + b.ph) * 1.5, b.c.z + Math.sin(a) * b.r * 0.6);
        b.o.rotation.y = -a - Math.PI / 2 * 0 + Math.atan2(Math.cos(a) * 0.6, -Math.sin(a)) * 0 ;
        const dx = -Math.sin(a) * b.r, dz = Math.cos(a) * b.r * 0.6;
        b.o.rotation.y = Math.atan2(dx, dz);
        b.o.rotation.z = -0.25;
        const flap = Math.sin(t * 7 + b.ph * 3) * 0.55 * (0.6 + 0.4 * Math.sin(t * 0.7 + b.ph));
        b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
      }
      lamp.rotation.y = t * 1.2;
    },
  };
}

/** Procedural palms: tapered curved trunks with ring bands, drooping alpha-cut fronds; wind in the vertex shader. */
function buildPalms() {
  const spots: [number, number, number][] = [];
  for (let x = -62; x <= 62; x += 10.5) if (Math.abs(x) > 4) spots.push([x + (R() - 0.5) * 2, -29.6 - R() * 1.5, 8 + R() * 3]);
  for (const [x, z] of [[-39.5, -20], [-39.5, 4], [-39.5, 21], [39.5, -20], [39.5, 2], [39.5, 18], [-12, 27.9], [12, 28.2], [33, 28]])
    spots.push([x, z, 7 + R() * 3.5]);
  for (const [x, z] of [[-50, -34], [48, -33], [-70, -46], [70, -45], [-16, 40], [40, 40], [-88, -32], [90, -30], [6, -45], [-22, -40]])
    spots.push([x, z, 7.5 + R() * 3]);

  const trunkPos: number[] = [], trunkCol: number[] = [], trunkWind: number[] = [], trunkIdx: number[] = [];
  const frondGeos: BufferGeometry[] = [];
  const bark1 = new Color('#9b7b5b'), bark2 = new Color('#c4a27c');
  for (const [px, pz, hgt] of spots) {
    const py = terrainHeight(px, pz) - 0.1;
    const lean = V(R() - 0.5, 0, R() - 0.5).normalize().multiplyScalar(0.8 + R() * 1.4);
    const ph = R() * 6.28;
    const segs = 14, radial = 8;
    const base = trunkPos.length / 3;
    const pt = (t: number) => V(px + lean.x * t * t, py + hgt * t, pz + lean.z * t * t);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const c = pt(t);
      const r = 0.24 - 0.11 * t + (i === 0 ? 0.08 : 0);
      const ringC = (i % 2 ? bark1 : bark2);
      for (let k = 0; k < radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        trunkPos.push(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
        trunkCol.push(ringC.r, ringC.g, ringC.b);
        trunkWind.push(ph, t, 0);
      }
    }
    for (let i = 0; i < segs; i++) for (let k = 0; k < radial; k++) {
      const a = base + i * radial + k, b = base + i * radial + ((k + 1) % radial), c = a + radial, d = b + radial;
      trunkIdx.push(a, c, b, b, c, d);
    }
    // crown
    const top = pt(1);
    const nF = 11;
    for (let f = 0; f < nF; f++) {
      const az = (f / nF) * Math.PI * 2 + R() * 0.3;
      const len = 3.2 + R() * 1.2, droop = 0.9 + R() * 0.6, rise = 0.4 + R() * 0.5;
      const g = frond(len, 1.0 + R() * 0.2, droop, rise, ph, f);
      g.applyMatrix4(new Matrix4().compose(top, new Quaternion().setFromAxisAngle(V(0, 1, 0), az), V(1, 1, 1)));
      frondGeos.push(g);
    }
    // coconuts
    for (let k = 0; k < 3; k++) {
      const s = paint(new SphereGeometry(0.13, 6, 5), '#6f5a3a');
      s.translate(top.x + Math.cos(k * 2.1) * 0.22, top.y - 0.25, top.z + Math.sin(k * 2.1) * 0.22);
      const n = s.getAttribute('position').count;
      s.setAttribute('windData', new Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [ph, 1, 0]), 3));
      s.setAttribute('uv', new Float32BufferAttribute(new Array(n * 2).fill(0), 2));
      frondGeos.push(s.index ? s.toNonIndexed() : s);
    }
  }
  const tg = new BufferGeometry();
  tg.setAttribute('position', new Float32BufferAttribute(trunkPos, 3));
  tg.setAttribute('color', new Float32BufferAttribute(trunkCol, 3));
  tg.setAttribute('windData', new Float32BufferAttribute(trunkWind, 3));
  tg.setIndex(trunkIdx);
  tg.computeVertexNormals();
  const group = new Group();
  const trunk = new Mesh(tg, toonMaterial({ vertexColors: true, wind: true, bands: 0.45, rim: 0.4, name: 'palmTrunk' }));
  trunk.castShadow = true; trunk.receiveShadow = true;
  group.add(trunk);
  const fg = mergeGeometries(frondGeos.map((g) => (g.index ? g.toNonIndexed() : g)));
  const fronds = new Mesh(fg, toonMaterial({ vertexColors: true, map: frondTexture(), alphaTest: 0.45, side: DoubleSide, wind: true, bands: 0.45, wrap: 0.6, rim: 0.5, name: 'palmFronds' }));
  fronds.castShadow = true; fronds.receiveShadow = true;
  group.add(fronds);
  return group;
}

function frond(len: number, width: number, droop: number, rise: number, ph: number, seed: number) {
  const nu = 10;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], wind: number[] = [], idx: number[] = [];
  const c0 = new Color('#5f9a45'), c1 = new Color('#8cc25a'), c2 = new Color('#b9d36a');
  for (let i = 0; i <= nu; i++) {
    const t = i / nu;
    const x = len * t;
    const y = rise * Math.sin(t * Math.PI * 0.6) - droop * t * t * 1.4;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - 0.25 * t);
    for (const s of [-1, 1]) {
      pos.push(x, y - Math.abs(s) * w * 0.12, s * w * 0.5);
      uv.push(s < 0 ? 0 : 1, t);
      const c = c0.clone().lerp(c1, t).lerp(c2, s > 0 ? 0.25 : 0);
      col.push(c.r, c.g, c.b);
      wind.push(ph + seed * 0.7, 1, t);
    }
  }
  // spine row for a folded look
  for (let i = 0; i < nu; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('windData', new Float32BufferAttribute(wind, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // bend normals upward a bit for nicer shading on both sides
  const n = g.getAttribute('normal') as BufferAttribute;
  for (let i = 0; i < n.count; i++) { n.setY(i, Math.abs(n.getY(i)) * 0.6 + 0.4); }
  return g.toNonIndexed();
}

function frondTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 128, 512);
  x.strokeStyle = '#fff'; x.lineCap = 'round';
  // central rib
  x.lineWidth = 6; x.beginPath(); x.moveTo(64, 0); x.lineTo(64, 512); x.stroke();
  // leaflets
  for (let i = 0; i < 46; i++) {
    const y = 8 + i * 11;
    const l = 58 * Math.sin(Math.PI * Math.min(1, (y / 512) * 1.05) + 0.15);
    x.lineWidth = 5.5;
    for (const s of [-1, 1]) {
      x.beginPath(); x.moveTo(64, y); x.quadraticCurveTo(64 + s * l * 0.5, y + 6, 64 + s * l, y + 22); x.stroke();
    }
  }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}
