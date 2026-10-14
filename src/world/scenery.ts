import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DoubleSide, DynamicDrawUsage,
  Float32BufferAttribute, Group, IcosahedronGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion, RepeatWrapping,
  SphereGeometry, SRGBColorSpace, Vector2, Vector3, Euler,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shared, toonMaterial } from '../render/materials';
import { rng } from '../core/util';
import { BOARDWALK_BENCH_X, BOARDWALK_LAMP_X, EDGE_PALMS, KIOSK } from './park';
import { People, type CrowdSource } from './people';
import { FoliageBuilder, foliageMaterial, Leaf } from './foliage';

const R = rng(1234);
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const QY = (a: number) => new Quaternion().setFromAxisAngle(V(0, 1, 0), a);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const h2 = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vn2 = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return (h2(ix, iy) * (1 - ux) + h2(ix + 1, iy) * ux) * (1 - uy) + (h2(ix, iy + 1) * (1 - ux) + h2(ix + 1, iy + 1) * ux) * uy;
};
const fbm2 = (x: number, y: number) => vn2(x, y) * 0.5 + vn2(x * 2.03 + 17, y * 2.03 + 9) * 0.25 + vn2(x * 4.1 + 3, y * 4.1 + 31) * 0.125;
const ridgeN = (x: number, y: number) => { const r = (a: number, b: number) => 1 - Math.abs(vn2(a, b) * 2 - 1); return r(x, y) * 0.6 + r(x * 2.1 + 5, y * 2.1 + 3) * 0.3 + r(x * 4.3 + 1, y * 4.3 + 7) * 0.1; };

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
  g.applyMatrix4(new Matrix4().compose(V(x, y, z), QY(ry), V(sx, sy, sz)));
const ni = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);
/** axis-aligned box from min/max corners */
const bmm = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  new BoxGeometry(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
/** convex polygons (fan triangulated) with flat normals */
function polys(list: { pts: Vector3[]; n: Vector3 }[]): BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const { pts, n } of list) {
    const nn = n.clone().normalize();
    for (let i = 1; i < pts.length - 1; i++) {
      let b = pts[i], c = pts[i + 1];
      const a = pts[0];
      if (new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).dot(nn) < 0) [b, c] = [c, b];
      for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); nor.push(nn.x, nn.y, nn.z); }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  return g;
}
const GLSL_NOISE = /* glsl */ `
float wH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wN(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(wH(i), wH(i+vec2(1,0)), u.x), mix(wH(i+vec2(0,1)), wH(i+vec2(1,1)), u.x), u.y); }
float wF(vec2 p){ return wN(p)*0.5 + wN(p*2.03+17.1)*0.25 + wN(p*4.07+3.7)*0.125; }`;
/** chain an extra shader patch onto a toon material (the toon patch runs first) */
function patch(m: MeshLambertMaterial, key: string, f: (sh: any) => void) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); f(sh); };
  const k = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${k}-${key}`;
}

export function terrainHeight(x: number, z: number) {
  // beach slopes down to the water towards -Z; town ground to the south, closed by low dunes on the horizon
  let h = -0.14;
  if (z < -27.4) h -= (-27.4 - z) * 0.026;
  const away = Math.min(1, Math.max(0, (Math.abs(x) - 45) / 30) + Math.max(0, (-z - 34) / 20));
  h += (Math.sin(x * 0.05 + z * 0.03) * 0.5 + Math.sin(x * 0.11 - z * 0.07) * 0.3) * 0.35 * away * (z < -27 ? 1 : 0.4);
  if (z > 30) h += (Math.sin(x * 0.043 + z * 0.021) * 0.35 + Math.sin(x * 0.017 - z * 0.05) * 0.4) * Math.min(1, (z - 30) / 20);
  if (z > 85) { const k = Math.min(1, (z - 85) / 65); h += k * k * (7 + 4 * Math.sin(x * 0.021 + 1.1) + 2.5 * Math.sin(x * 0.057 + 0.4) + 1.5 * Math.sin(x * 0.13)); }
  return h;
}

export interface Scenery {
  group: Group;
  windows: MeshLambertMaterial;
  lampHeads: MeshLambertMaterial;
  lampLights: Vector3[];
  lighthouseLamp: MeshLambertMaterial;
  people: People;
  update(t: number, dt: number): void;
}

interface HouseSpec { x: number; z: number; ry: number; s: number; style: number }
const HOUSES: HouseSpec[] = [
  { x: -58, z: -40, ry: 0.15, s: 1, style: 0 }, { x: -76, z: -36, ry: -0.1, s: 0.9, style: 1 }, { x: -95, z: -43, ry: 0.2, s: 1.1, style: 2 },
  { x: -118, z: -38, ry: 0.05, s: 1, style: 0 }, { x: 60, z: -38, ry: -0.2, s: 1, style: 1 }, { x: 79, z: -34, ry: 0.1, s: 0.95, style: 0 },
  { x: 98, z: -42, ry: -0.05, s: 1.1, style: 2 }, { x: 120, z: -37, ry: 0.15, s: 1, style: 1 },
  { x: -24, z: 46, ry: 0.14, s: 1.05, style: 0 }, { x: 2, z: 49, ry: 0.04, s: 0.95, style: 1 }, { x: 28, z: 45, ry: -0.06, s: 1.1, style: 2 },
  { x: 52, z: 50, ry: 0.14, s: 1, style: 0 }, { x: -50, z: 48, ry: -0.11, s: 0.9, style: 1 },
  { x: -36, z: 63, ry: 0.08, s: 0.95, style: 2 }, { x: 14, z: 65, ry: -0.1, s: 1.0, style: 0 }, { x: 40, z: 67, ry: 0.05, s: 0.9, style: 1 },
  { x: -64, z: 66, ry: 0.12, s: 1.0, style: 0 }, { x: 68, z: 63, ry: -0.08, s: 1.05, style: 2 },
];

export function buildScenery(lampPositions: Vector3[], crowd?: Promise<CrowdSource>): Scenery {
  const group = new Group();
  const vc = (o: Partial<Parameters<typeof toonMaterial>[0]> = {}) => toonMaterial({ vertexColors: true, bands: 0.35, wrap: 0.4, rim: 0.35, ...o });

  // ------------------------------------------------------------------ terrain: beach sand (ripples, wet band) + town ground (soil, scrub, paths)
  const beachMat = toonMaterial({ vertexColors: true, detail: 'sand', bands: 0.2, wrap: 0.45, rim: 0.2, name: 'sand' });
  patch(beachMat, 'beachSand', (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wetEdge = vWorldPos.y + 0.035 * sin(vWorldPos.x * 0.15) + 0.02 * sin(vWorldPos.x * 0.43 + 1.0) + 0.04 * (wN(vWorldPos.xz * 0.15) - 0.5);
        float wetSand = 1.0 - smoothstep(-1.12, -1.03, wetEdge);
        {
          diffuseColor.rgb *= 1.0 - 0.1 * (1.0 - smoothstep(-1.08, -0.86, wetEdge));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.48, 0.55), wetSand);
          float tide = 1.0 - smoothstep(0.0, 0.025, abs(wetEdge + 1.03));
          diffuseColor.rgb *= 1.0 - 0.17 * tide * (0.55 + 0.45 * wN(vWorldPos.xz * 1.3));
          diffuseColor.rgb *= 0.97 + 0.06 * wF(vWorldPos.xz * 0.11);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // gentle wind ripples (max ~5 deg slope: in an 11 deg sun steeper ones turn into hard stripes): sinuous crests,
          // a slightly steeper lee side, patchy strength, faded out well before they alias
          vec2 q = vWorldPos.xz;
          float wv = q.x * 0.55 + q.y * 1.35 + sin(q.x * 0.21 + q.y * 0.13) * 2.2 + sin(q.y * 0.37 + q.x * 0.05) * 0.8 + wF(q * 0.12) * 3.0;
          float fw = fwidth(wv);
          float amp = (1.0 - smoothstep(0.18, 0.55, fw)) * smoothstep(-1.08, -0.98, vWorldPos.y) * (1.0 - smoothstep(-27.6, -26.8, vWorldPos.z));
          amp *= smoothstep(0.28, 0.72, wF(q * 0.05 + 11.0));
          float ph = wv * 6.2831;
          float dr = (cos(ph) + 0.35 * cos(2.0 * ph + 0.6)) * amp * 0.045;
          normal = normalize(normal - (viewMatrix * vec4(vec3(0.55, 0.0, 1.35) * dr, 0.0)).xyz);
        }`)
      .replace('#include <opaque_fragment>', `{
          // wet sand mirrors the sky at grazing angles (a cool sheen, not the warm rim: that matched the dry sand and hid the band)
          vec3 nS = normalize(vWorldNrm), vS = normalize(cameraPosition - vWorldPos);
          float frs = pow(1.0 - saturate(dot(nS, vS)), 5.0);
          vec3 rd = reflect(-vS, nS);
          float toSun = dot(normalize(rd.xz + vec2(1e-4)), normalize(uSunDir.xz + vec2(1e-4)));
          vec3 skyR = mix(mix(uSkyAnti, uSkySun, smoothstep(-0.6, 0.9, toSun)), uSkyTop, smoothstep(0.02, 0.5, rd.y));
          outgoingLight = mix(outgoingLight, skyR * 0.36, frs * 0.9 * wetSand);
        }
        #include <opaque_fragment>`);
  });
  const townMat = toonMaterial({ vertexColors: true, detail: 'sand', bands: 0.2, wrap: 0.45, rim: 0.15, name: 'townGround' });
  patch(townMat, 'townGround', (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 q = vWorldPos.xz;
          float g = wF(q * 0.21) + 0.35 * wN(q * 1.7);
          float patchG = smoothstep(0.6, 0.7, g) * smoothstep(27.0, 31.0, q.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.88, 0.68), patchG * 0.7);
          vec2 cq = q * 2.7, ci = floor(cq);
          vec2 co = vec2(wH(ci + 7.1), wH(ci + 3.3)) * 0.4 + 0.3;
          float tuft = step(0.955, wH(ci)) * (1.0 - smoothstep(0.08, 0.2, length(fract(cq) - co)));
          tuft *= 1.0 - smoothstep(0.12, 0.35, fwidth(cq.x) + fwidth(cq.y));
          diffuseColor.rgb *= 1.0 - tuft * 0.22 * (0.4 + patchG);
          diffuseColor.rgb *= 0.95 + 0.1 * wN(q * 0.6);
        }`);
  });
  {
    const W = 560, D = 300, nx = 140, nz = 75;
    const g = new PlaneGeometry(W, D, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, 10);
    const p = g.getAttribute('position') as BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const sand = new Color('#efd3a2'), wet = new Color('#c9a77e'), soil = new Color('#dcc192'), scrubA = new Color('#a3a964'), scrubB = new Color('#818f50');
    const dry = new Color('#c9b57b'), dune = new Color('#e6cd9b');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = terrainHeight(x, z);
      p.setY(i, y);
      const c = sand.clone();
      if (z > 26.6) {
        c.copy(soil);
        const n = fbm2(x * 0.045, z * 0.045) + 0.35 * vn2(x * 0.13 + 7, z * 0.13);
        const patchG = smooth(0.62, 0.78, n) * Math.min(1, (z - 26.6) / 6);
        c.lerp(vn2(x * 0.05 + 3, z * 0.05) > 0.5 ? scrubA : scrubB, patchG * 0.9);
        c.lerp(dry, smooth(0.5, 0.8, vn2(x * 0.09 + 11, z * 0.09)) * 0.35);
        if (z > 85) c.lerp(dune, Math.min(1, (z - 85) / 25) * (1 - patchG * 0.5));
      }
      if (y < -1.15) c.lerp(wet, Math.min(1, (-1.15 - y) / 0.25));
      const j = 0.96 + R() * 0.06;
      col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * j;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.computeVertexNormals();
    // no terrain under the park pad (it would show through the bowl openings); split beach / town
    const idx = g.index!.array;
    const beachIdx: number[] = [], townIdx: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += p.getX(idx[t + k]); cz += p.getZ(idx[t + k]); }
      cx /= 3; cz /= 3;
      if (Math.abs(cx) < 36.5 && cz > -21.5 && cz < 24) continue;
      (cz < 27.2 ? beachIdx : townIdx).push(idx[t], idx[t + 1], idx[t + 2]);
    }
    for (const [ix, mat] of [[beachIdx, beachMat], [townIdx, townMat]] as [number[], MeshLambertMaterial][]) {
      const gg = new BufferGeometry();
      for (const k of ['position', 'normal', 'color']) gg.setAttribute(k, g.getAttribute(k));
      gg.setIndex(ix);
      gg.computeBoundingSphere();
      const m = new Mesh(gg, mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ------------------------------------------------------------------ boardwalk railing, posts, benches, fascia
  const woodParts: BufferGeometry[] = [];
  const woodDark = new Color('#a77a52'), woodLight = new Color('#c99b6c');
  for (let x = -70; x <= 70; x += 2.5) {
    woodParts.push(paint(ni(at(new BoxGeometry(0.12, 1.0, 0.12), x, 0.5, -27.3)), woodDark, 0.1));
    woodParts.push(paint(ni(at(new CylinderGeometry(0.14, 0.14, 1.4, 6), x, -0.7, -27.1)), woodDark, 0.1));
  }
  woodParts.push(paint(ni(at(new BoxGeometry(140, 0.08, 0.16), 0, 1.0, -27.3)), woodLight));
  woodParts.push(paint(ni(at(new BoxGeometry(140, 0.06, 0.08), 0, 0.55, -27.3)), woodLight));
  woodParts.push(paint(ni(at(new BoxGeometry(140, 0.3, 0.05), 0, -0.15, -27.42)), woodDark));
  for (const s of [-1, 1]) woodParts.push(paint(ni(bmm(s > 0 ? 38.6 : -70, -0.32, -23.02, s > 0 ? 70 : -38.6, 0.0, -22.97)), woodDark));
  for (const x of BOARDWALK_BENCH_X) {
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
  const allLamps = [...lampPositions, ...BOARDWALK_LAMP_X.map((x) => V(x, 0, -27.0))];
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

  // ------------------------------------------------------------------ beach + town houses
  const leaves = new FoliageBuilder();
  const H = { walls: [] as BufferGeometry[], roofs: [] as BufferGeometry[], trims: [] as BufferGeometry[], wins: [] as BufferGeometry[], fabric: [] as BufferGeometry[], paths: [] as BufferGeometry[], leaves };
  buildHouses(H);
  const wallMesh = new Mesh(mergeGeometries(H.walls), vc({ detail: 'wall', name: 'houseWalls' }));
  const roofMesh = new Mesh(mergeGeometries(H.roofs), vc({ spec: 0.15, shininess: 18, name: 'roofs' }));
  const trimMesh = new Mesh(mergeGeometries(H.trims), vc({ name: 'trim' }));
  for (const m of [wallMesh, roofMesh, trimMesh]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  const windows = toonMaterial({ color: 0x48618f, emissive: 0xffc070, emissiveIntensity: 0, bands: 0.2, spec: 0.8, shininess: 30, lamps: false, name: 'windows' });
  group.add(new Mesh(mergeGeometries(H.wins), windows));
  if (H.paths.length) { const pm = new Mesh(mergeGeometries(H.paths), townMat); pm.receiveShadow = true; group.add(pm); }

  // ------------------------------------------------------------------ distant hills + rocky headland + lighthouse
  const hillsMat = toonMaterial({ vertexColors: true, bands: 0.55, wrap: 0.3, rim: 0.3, lamps: false, name: 'hills' });
  {
    const g = new PlaneGeometry(900, 520, 90, 52);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position') as BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const lo = new Color('#c9b48a'), mid = new Color('#7f9a5c'), hi = new Color('#5f7d52'), rock = new Color('#b89a86');
    const bumps: [number, number, number, number][] = [[-430, -520, 140, 40], [-330, -560, 90, 30], [120, -560, 60, 16], [-180, -600, 120, 22]];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 100, z = p.getZ(i) - 380;
      let hgt = 0;
      for (const [bx, bz, r, hh] of bumps) hgt += hh * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (r * r));
      hgt += (ridgeN(x * 0.012, z * 0.012) - 0.5) * 10 * Math.min(1, hgt / 8);
      hgt += Math.sin(x * 0.03) * Math.cos(z * 0.04) * 2.0 - 6.5;
      p.setXYZ(i, x, hgt, z);
      const c = lo.clone().lerp(mid, Math.min(1, Math.max(0, (hgt - 4) / 14))).lerp(hi, Math.min(1, Math.max(0, (hgt - 25) / 30)));
      if (hgt > 2 && hgt < 9) c.lerp(rock, 0.45);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.computeVertexNormals();
    group.add(new Mesh(g, hillsMat));
  }
  // cliff faces span tens of metres per triangle, so the rock beds are drawn per pixel
  const headMat = toonMaterial({ vertexColors: true, bands: 0.55, wrap: 0.3, rim: 0.3, lamps: false, name: 'headland' });
  patch(headMat, 'cliffStrata', (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float rocky = 1.0 - smoothstep(-0.01, 0.03, diffuseColor.g - 0.5 * (diffuseColor.r + diffuseColor.b));
          float steep = (1.0 - smoothstep(0.5, 0.78, normalize(vWorldNrm).y)) * smoothstep(-0.6, 1.5, vWorldPos.y) * rocky;
          float bed = vWorldPos.y * 0.31 + wF(vWorldPos.xz * 0.025) * 1.7;
          float f = fract(bed);
          float seam = 1.0 - smoothstep(0.0, 0.09, f) * (1.0 - smoothstep(0.85, 1.0, f));
          float tone = 0.84 + 0.22 * wH(vec2(floor(bed) * 3.7, 1.3));
          float aa = 1.0 - smoothstep(0.12, 0.4, fwidth(bed));
          float streak = 0.9 + 0.1 * wN(vec2((vWorldPos.x + vWorldPos.z) * 0.6, floor(bed) * 0.37));
          diffuseColor.rgb *= mix(1.0, mix(tone * streak, 0.6, seam), steep * aa);
        }`);
  });
  const LH = buildHeadland(group, headMat);
  const lhParts: BufferGeometry[] = [];
  {
    const [lx, ly, lz] = LH;
    const segs = 7, seg = 3.0, r0 = 3.0, r1 = 2.2;
    for (let k = 0; k < segs; k++) {
      const ra = r0 + (r1 - r0) * (k / segs), rb = r0 + (r1 - r0) * ((k + 1) / segs);
      lhParts.push(paint(ni(at(new CylinderGeometry(rb, ra, seg, 18), lx, ly + seg * (k + 0.5), lz)), k === 2 || k === 5 ? '#d94d43' : '#fbf6ef', 0.03));
    }
    const top = ly + segs * seg;
    lhParts.push(paint(ni(at(new CylinderGeometry(3.15, 2.5, 0.45, 18), lx, top + 0.22, lz)), '#3e4a56'));
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; lhParts.push(paint(ni(at(new BoxGeometry(0.08, 1.0, 0.08), lx + Math.cos(a) * 3.0, top + 0.95, lz + Math.sin(a) * 3.0)), '#2e3740')); }
    lhParts.push(paint(ni(at(new CylinderGeometry(3.05, 3.05, 0.08, 18, 1, true), lx, top + 1.45, lz)), '#2e3740'));
    lhParts.push(paint(ni(at(new CylinderGeometry(1.75, 1.75, 0.4, 16), lx, top + 0.65, lz)), '#3e4a56'));
    lhParts.push(paint(ni(at(new ConeGeometry(2.05, 1.9, 16), lx, top + 4.6, lz)), '#c9443b'));
    lhParts.push(paint(ni(at(new SphereGeometry(0.35, 10, 6), lx, top + 5.7, lz)), '#2e3740'));
    lhParts.push(paint(ni(at(new BoxGeometry(1.1, 2.0, 0.2), lx + Math.cos(0.6) * 3.0, ly + 1.0, lz + Math.sin(0.6) * 3.0, -0.6)), '#5a3a2a'));
    // keeper's cottage
    const cx = lx + 9, cz = lz + 7;
    lhParts.push(paint(ni(at(new BoxGeometry(8, 3.6, 5.5), cx, ly + 1.6, cz)), '#f4efe6', 0.03));
    lhParts.push(polysToPaint([
      { pts: [V(cx - 4.4, ly + 3.4, cz - 3.1), V(cx + 4.4, ly + 3.4, cz - 3.1), V(cx + 4.4, ly + 5.2, cz), V(cx - 4.4, ly + 5.2, cz)], n: V(0, 1, -0.6) },
      { pts: [V(cx - 4.4, ly + 3.4, cz + 3.1), V(cx + 4.4, ly + 3.4, cz + 3.1), V(cx + 4.4, ly + 5.2, cz), V(cx - 4.4, ly + 5.2, cz)], n: V(0, 1, 0.6) },
    ], '#c9443b'));
    lhParts.push(polysToPaint([
      { pts: [V(cx - 4, ly + 3.4, cz - 2.75), V(cx - 4, ly + 3.4, cz + 2.75), V(cx - 4, ly + 5.0, cz)], n: V(-1, 0, 0) },
      { pts: [V(cx + 4, ly + 3.4, cz - 2.75), V(cx + 4, ly + 3.4, cz + 2.75), V(cx + 4, ly + 5.0, cz)], n: V(1, 0, 0) },
    ], '#f4efe6'));
  }
  group.add(new Mesh(mergeGeometries(lhParts), vc({ lamps: false, name: 'lighthouse' })));
  const lighthouseLamp = toonMaterial({ color: 0xfff0c8, emissive: 0xffe6a8, emissiveIntensity: 0.3, lamps: false, name: 'lhLamp' });
  const lamp = new Mesh(new CylinderGeometry(1.5, 1.5, 2.4, 14), lighthouseLamp);
  lamp.position.set(LH[0], LH[1] + 7 * 3.0 + 2.1, LH[2]);
  lamp.userData.dynamic = true;
  group.add(lamp);

  // ------------------------------------------------------------------ lifeguard tower, umbrellas, towels, beach chair, surfboards
  const propParts: BufferGeometry[] = [];
  const pp = (g: BufferGeometry, c: string, j = 0) => propParts.push(paint(ni(g), c, j));
  {
    const x = -8, z = -52, y = terrainHeight(x, z), py = y + 2.7;
    for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1], [-1.1, -2.5], [1.1, -2.5]]) pp(bmm(x + dx - 0.09, y - 0.3, z + dz - 0.09, x + dx + 0.09, py - 0.2, z + dz + 0.09), '#f4efe6');
    for (const dz of [-1.1, 1.1]) pp(bmm(x - 1.1, y + 1.2, z + dz - 0.05, x + 1.1, y + 1.32, z + dz + 0.05), '#e7ddcb');
    pp(bmm(x - 1.5, py - 0.2, z - 2.7, x + 1.5, py, z + 1.5), '#f4efe6');
    pp(bmm(x - 1.2, py, z - 0.5, x + 1.2, py + 1.75, z + 1.4), '#4fb3c9', 0.03);
    pp(bmm(x - 0.9, py + 0.75, z - 0.53, x + 0.9, py + 1.45, z - 0.49), '#20343f');
    pp(bmm(x - 1.23, py + 0.8, z + 0.0, x - 1.19, py + 1.4, z + 0.9), '#20343f');
    pp(bmm(x - 1.5, py + 1.75, z - 0.85, x + 1.5, py + 1.93, z + 1.7), '#e24f45');
    // front deck railing + chair for the lifeguard
    for (const [x0, z0, x1, z1] of [[-1.45, -2.65, 1.45, -2.6], [-1.45, -2.65, -1.4, -0.5], [1.4, -2.65, 1.45, -0.5]]) {
      pp(bmm(x + x0, py + 0.9, z + z0, x + x1, py + 0.97, z + z1), '#f4efe6');
      pp(bmm(x + x0, py + 0.45, z + z0, x + x1, py + 0.5, z + z1), '#f4efe6');
    }
    for (const [dx, dz] of [[-1.42, -2.62], [1.42, -2.62], [-1.42, -1.5], [1.42, -1.5], [0, -2.62]]) pp(bmm(x + dx - 0.04, py, z + dz - 0.04, x + dx + 0.04, py + 0.95, z + dz + 0.04), '#f4efe6');
    const cz = -53.35;
    pp(bmm(x - 0.27, py + 0.39, cz - 0.24, x + 0.27, py + 0.45, cz + 0.24), '#e9b949');
    pp(bmm(x - 0.27, py + 0.45, cz + 0.2, x + 0.27, py + 1.05, cz + 0.25), '#e9b949');
    for (const [dx, dz] of [[-0.24, -0.21], [0.24, -0.21], [-0.24, 0.21], [0.24, 0.21]]) pp(bmm(x + dx - 0.025, py, cz + dz - 0.025, x + dx + 0.025, py + 0.4, cz + dz + 0.025), '#cfd4d8');
    // ramp to the sand, flag, rescue buoy
    const ramp = new BoxGeometry(1.0, 0.08, 3.6); ramp.rotateX(-0.75); at(ramp, x, y + 1.3, z + 2.85);
    pp(ramp, '#e7ddcb');
    pp(bmm(x + 1.0, py + 1.93, z + 1.2, x + 1.05, py + 3.6, z + 1.25), '#cfd4d8');
    pp(bmm(x + 1.05, py + 3.0, z + 1.2, x + 1.85, py + 3.55, z + 1.24), '#ffd23f');
    pp(bmm(x + 1.05, py + 3.0, z + 1.24, x + 1.85, py + 3.27, z + 1.25), '#e8463a');
    const buoy = new CylinderGeometry(0.12, 0.12, 0.85, 10); buoy.rotateZ(0.2); at(buoy, x + 1.55, py + 0.55, z - 2.75);
    pp(buoy, '#ff5a36');
    ['#f08a5d', '#6cc3b8', '#f7d06b'].forEach((c, k) => {
      const s = new SphereGeometry(1, 12, 6); s.scale(0.28, 1.1, 0.06); s.rotateX(-0.25); at(s, x + 1.6 + k * 0.6, y + 1.05, z - 1.3 - k * 0.1);
      pp(s, c);
    });
  }
  const umbrellaSpots: [number, number, string, string][] = [[-30, -48, '#f26b5b', '#fff4e4'], [-40, -56, '#4bb3c4', '#fff4e4'], [22, -50, '#f7c95a', '#f26b5b'], [44, -56, '#8f7ad1', '#fff4e4'], [-58, -60, '#f26b5b', '#4bb3c4']];
  const poleShadows: BufferGeometry[] = [];
  for (const [x, z, c1, c2] of umbrellaSpots) {
    const y = terrainHeight(x, z);
    pp(at(new CylinderGeometry(0.05, 0.05, 2.4, 8), x, y + 1.2, z), '#f4efe6');
    // the low sun throws the canopy shadow ~12 m away; a real-width pole vanishes in the shadow map and leaves that shadow ownerless
    poleShadows.push(ni(at(new CylinderGeometry(0.12, 0.12, 2.3, 6), x, y + 1.15, z)));
    for (let k = 0; k < 8; k++) pp(at(new ConeGeometry(1.4, 0.55, 8, 1, true, (k * Math.PI) / 4, Math.PI / 4), x, y + 2.45, z), k % 2 ? c1 : c2);
    // striped towel: the pale stripes keep it from reading as the umbrella's shadow
    for (let k = 0; k < 5; k++) {
      const o = (k - 2) * 0.36;
      pp(at(new BoxGeometry(1.0, 0.02, 0.36), x + 1.4 + Math.sin(0.3) * o, y + 0.02, z + 0.6 + Math.cos(0.3) * o, 0.3), k % 2 ? '#fbf3e4' : c1);
    }
  }
  {
    const shadowOnly = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, name: 'shadowOnly' });
    const ps = new Mesh(mergeGeometries(poleShadows), shadowOnly);
    ps.castShadow = true;
    group.add(ps);
  }
  {
    // low beach chair + cooler next to the first umbrella (someone sits there)
    const x = -30.4, z = -47.1, y = terrainHeight(x, z);
    pp(bmm(x - 0.3, y + 0.32, z - 0.25, x + 0.3, y + 0.38, z + 0.25), '#2a9d8f');
    const back = bmm(-0.3, 0, -0.03, 0.3, 0.65, 0.03); back.rotateX(-0.35); at(back, x, y + 0.36, z + 0.3); pp(back, '#2a9d8f');
    for (const [dx, dz] of [[-0.28, -0.22], [0.28, -0.22], [-0.28, 0.24], [0.28, 0.24]]) pp(bmm(x + dx - 0.015, y, z + dz - 0.015, x + dx + 0.015, y + 0.33, z + dz + 0.015), '#d9dde0');
    pp(bmm(x - 0.95, y, z - 0.6, x - 0.5, y + 0.34, z - 0.3), '#3a86ff');
    pp(bmm(x - 0.96, y + 0.34, z - 0.61, x - 0.49, y + 0.38, z - 0.29), '#f4efe6');
  }
  const fabricParts = H.fabric;
  const propMesh = new Mesh(mergeGeometries([...propParts, ...fabricParts]), vc({ side: DoubleSide, name: 'beachProps' }));
  propMesh.castShadow = true; propMesh.receiveShadow = true;
  group.add(propMesh);

  // ------------------------------------------------------------------ footprints + wind-blown sand on the boardwalk
  group.add(buildFootprints());
  {
    const parts: BufferGeometry[] = [];
    const sandC = new Color('#eccfa0');
    for (let x = -38; x <= 38; x += 2.5) {
      if (R() < 0.25) continue;
      parts.push(drift(x + (R() - 0.5) * 0.6, -27.12 + R() * 0.05, 0.45 + R() * 0.7, 0.14 + R() * 0.14, 0.012 + R() * 0.015, 0, R() * 0.2, sandC));
    }
    for (let k = 0; k < 14; k++) {
      const x = (R() < 0.5 ? -1 : 1) * (8 + R() * 29), z = -27.0 + R() * 3.6;
      parts.push(drift(x, z, 0.6 + R() * 1.4, 0.25 + R() * 0.5, 0.006 + R() * 0.01, 0, R() * Math.PI, sandC));
    }
    for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) parts.push(drift(sx * (33 + R() * 4.5), -22.9 + R() * 0.8, 0.5 + R() * 0.9, 0.25 + R() * 0.35, 0.008, 0, R() * Math.PI, sandC));
    const dm = new Mesh(mergeGeometries(parts), beachMat);
    dm.receiveShadow = true;
    group.add(dm);
  }

  // ------------------------------------------------------------------ town scrub, dune grass, house plants
  {
    const parts: BufferGeometry[] = [];
    const nearHouse = (x: number, z: number, pad: number) => HOUSES.some((h) => Math.abs(x - h.x) < 4.2 * h.s + pad && Math.abs(z - h.z) < 3.4 * h.s + pad + (h.z > 0 ? 2.2 : 0));
    let placed = 0;
    for (let k = 0; k < 900 && placed < 260; k++) {
      const x = (R() - 0.5) * 230, z = 28.5 + R() * 75;
      if (nearHouse(x, z, 1.2) || (z > 31 && z < 35.5) || (Math.abs(x) < 41 && z < 31)) continue;
      const n = fbm2(x * 0.045, z * 0.045) + 0.35 * vn2(x * 0.13 + 7, z * 0.13);
      if (n < 0.58 && R() > 0.2) continue;
      const y = terrainHeight(x, z);
      if (R() < 0.45) bush(leaves, x, y, z, 0.35 + R() * 0.75);
      else parts.push(tuft(x, y, z, 0.3 + R() * 0.35));
      placed++;
    }
    for (let k = 0; k < 70; k++) {
      const x = (R() < 0.5 ? -1 : 1) * (42 + R() * 90), z = -29 - R() * 18;
      if (HOUSES.some((h) => Math.abs(x - h.x) < 7 && Math.abs(z - h.z) < 7)) continue;
      parts.push(tuft(x, terrainHeight(x, z), z, 0.35 + R() * 0.3, true));
    }
    const shrubs = new Mesh(mergeGeometries(parts.map((g) => { for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(a)) g.deleteAttribute(a); return ni(g); })),
      vc({ side: DoubleSide, bands: 0.45, wrap: 0.6, rim: 0.45, name: 'shrubs' }));
    shrubs.castShadow = true; shrubs.receiveShadow = true;
    group.add(shrubs);
    const bushes = new Mesh(leaves.geometry(), foliageMaterial());
    bushes.name = 'townBushes';
    bushes.castShadow = true; bushes.receiveShadow = true;
    group.add(bushes);
  }

  // ------------------------------------------------------------------ palms
  group.add(buildPalms());

  // ------------------------------------------------------------------ seagulls
  const gulls = buildGulls();
  group.add(gulls.mesh);

  // ------------------------------------------------------------------ the snack kiosk's shop behind its service window
  const kiosk = buildKioskShop();
  group.add(kiosk.mesh);
  // the lit shop spills warm light onto the counter, stools, ground, awning, roof edge and the wall around the window
  // (the line source sits out over the counter, where that light bounces off the counter, the awning and the ground)
  {
    const { win, z1 } = KIOSK, yc = (win.y0 + win.y1) / 2 + 0.22;
    shared.uSpillA.value.set(win.x0 + 0.4, yc, z1 + 1.3, 5.5);
    shared.uSpillB.value.set(win.x1 - 0.4, yc, z1 + 1.3, 0);
    shared.uSpillPlane.value.set(0, 0, 1, z1);
  }
  const spillC = new Color('#ffc58c');

  // ------------------------------------------------------------------ people (crowd loaded by the game, loadCrowd; optional)
  const people = new People(terrainHeight);
  group.add(people.group);
  if (crowd) void people.load(crowd);

  return {
    group, windows, lampHeads, lampLights, lighthouseLamp, people,
    update(t: number, dt: number) {
      gulls.update(t);
      lamp.rotation.y = t * 1.2;
      people.update(dt);
      // the shop lights are on all day; at sunset and blue hour they glow like the lit windows
      kiosk.mat.emissiveIntensity = 0.45 + windows.emissiveIntensity * 1.05;
      const sp = Math.min(1, Math.max(0, (windows.emissiveIntensity / 1.3 - 0.25) / 0.75));
      shared.uSpillColor.value.copy(spillC).multiplyScalar(2.2 * sp);
    },
  };
}

function polysToPaint(list: { pts: Vector3[]; n: Vector3 }[], c: string) { return paint(polys(list), c, 0.03); }

/** low wind-blown sand mound */
function drift(cx: number, cz: number, rx: number, rz: number, h: number, y: number, rot: number, c: Color) {
  const n = 12, pos: number[] = [], nor: number[] = [], col: number[] = [];
  const pts: Vector3[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, f = 0.75 + h2(cx * 3.1 + k, cz) * 0.5;
    const lx = Math.cos(a) * rx * f, lz = Math.sin(a) * rz * f;
    pts.push(V(cx + lx * Math.cos(rot) - lz * Math.sin(rot), y + 0.003, cz + lx * Math.sin(rot) + lz * Math.cos(rot)));
  }
  const ctr = V(cx, y + h, cz);
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    for (const p of [ctr, b, a]) { pos.push(p.x, p.y, p.z); nor.push(0, 1, 0); col.push(c.r, c.g, c.b); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

function blobGeo(r: number, sq: number, seed: number) {
  const g = new IcosahedronGeometry(r, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (h2(p.getX(i) * 13.1 + seed, p.getZ(i) * 7.7) - 0.5) * 0.4;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * sq, p.getZ(i) * k);
  }
  return ni(g);
}
function shade(g: BufferGeometry, top: Color, bot: Color, jit = 0.12) {
  g.computeVertexNormals();
  const n = g.getAttribute('normal'), col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i += 3) {
    const j = 1 + (R() - 0.5) * jit;
    for (let k = 0; k < 3; k++) {
      const f = 0.5 + 0.5 * n.getY(i + k);
      col[(i + k) * 3] = (bot.r + (top.r - bot.r) * f) * j; col[(i + k) * 3 + 1] = (bot.g + (top.g - bot.g) * f) * j; col[(i + k) * 3 + 2] = (bot.b + (top.b - bot.b) * f) * j;
    }
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}
/** scrub tints on the painted leaves: sage, dry olive, green, grey-green */
const BUSH_TINTS: [number, number, number][] = [[1.2, 1.06, 1.02], [1.32, 1.12, 0.84], [1.02, 1.04, 0.95], [1.16, 1.1, 1.08]];
/** the shared RNG advanced exactly as the old blob shrubs did, so every later random placement stays where it was */
const skipBlob = () => { for (let t = 0; t < 80; t++) R(); };
/** low scrub: one to three overlapping mounds of fine-leaved (olive, sage) clumps */
function bush(f: FoliageBuilder, x: number, y: number, z: number, s: number) {
  const tint = BUSH_TINTS[Math.floor(R() * BUSH_TINTS.length)];
  const nb = 1 + Math.floor(R() * 3);
  for (let k = 0; k < nb; k++) {
    const r = s * (0.55 + R() * 0.45);
    const ox = (R() - 0.5) * s, oz = (R() - 0.5) * s;
    skipBlob();
    f.bush({ x: x + ox, y, z: z + oz, rx: r, rz: r * 0.92, ry: r * 0.62, cells: h2(x + k, z) < 0.75 ? [Leaf.Fine] : [Leaf.Broad], tint, seed: x * 3.1 + z * 1.7 + k, sink: 0.27 });
  }
}
/** spiky grass clump (both windings so it reads from any side) */
function tuft(x: number, y: number, z: number, s: number, dune = false) {
  const base = new Color(dune ? '#9a9a5c' : '#7d7f45'), tip = new Color(dune ? '#e2d29a' : '#c8b878');
  const pos: number[] = [], col: number[] = [];
  const nb = 9;
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + R(), len = s * (0.6 + R() * 0.6), lean = 0.3 + R() * 0.5, w = 0.025 + s * 0.02;
    const dir = V(Math.cos(a), 0, Math.sin(a)), side = V(-dir.z, 0, dir.x);
    const p0 = V(x, y, z), p2 = V(x + dir.x * lean * len, y + len, z + dir.z * lean * len);
    const a0 = p0.clone().addScaledVector(side, -w), a1 = p0.clone().addScaledVector(side, w);
    for (const [A, B] of [[a0, a1], [a1, a0]]) { pos.push(A.x, A.y, A.z, B.x, B.y, B.z, p2.x, p2.y, p2.z); col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setY(i, Math.abs(n.getY(i)) * 0.5 + 0.5);
  return g;
}

// ------------------------------------------------------------------ houses: roofs that sit on the walls, porches, steps, railings, framed windows
function buildHouses(out: { walls: BufferGeometry[]; roofs: BufferGeometry[]; trims: BufferGeometry[]; wins: BufferGeometry[]; fabric: BufferGeometry[]; paths: BufferGeometry[]; leaves: FoliageBuilder }) {
  const wallCols = ['#9fd8c6', '#f4a68c', '#f7d98b', '#a8c8f0', '#d5b8e8', '#f2c0c8', '#bfe3a6', '#f3e1b9', '#9cc9d9'];
  const roofCols = ['#c4664e', '#5f7fa8', '#d98b55', '#7a6aa8', '#bf5a5a', '#4f8a8a', '#c9873f', '#8a5a44'];
  const doorCols = ['#2f6f7a', '#e05a47', '#3a5f9e', '#f2b134', '#6a4c93', '#2a9d8f'];
  const accent = ['#2a9d8f', '#e05a47', '#3a86ff', '#f4a261', '#6a4c93', '#e9c46a'];
  const trimC = '#fbf6ec', woodC = '#b98a5e', potC = '#c4703f';
  // main town path along the park's south side
  out.paths.push(ribbon([[-78, 33], [78, 33]], 2.6, new Color('#ecdcb6')));
  HOUSES.forEach((hs, i) => {
    const { x, z, ry, s, style } = hs;
    const beach = z < 0;
    const w = 8 * s, d = 6.4 * s, h = 3.2 * s;
    const g0 = terrainHeight(x, z);
    const y0 = g0 + (beach ? 1.5 : 0.42);
    const T = new Matrix4().compose(V(x, 0, z), QY(ry), V(1, 1, 1));
    const put = (arr: BufferGeometry[], g: BufferGeometry, c: string, j = 0.04) => arr.push(paint(ni(g).applyMatrix4(T), c, j));
    const wc = wallCols[i % wallCols.length], rc = roofCols[i % roofCols.length], dc = doorCols[i % doorCols.length], ac = accent[(i + 2) % accent.length];
    const roofDark = '#' + new Color(rc).multiplyScalar(0.72).getHexString();
    type Face = { o: Vector3; t: Vector3; n: Vector3 };
    const F: Record<string, Face> = {
      f: { o: V(0, 0, -d / 2), t: V(1, 0, 0), n: V(0, 0, -1) }, b: { o: V(0, 0, d / 2), t: V(-1, 0, 0), n: V(0, 0, 1) },
      l: { o: V(-w / 2, 0, 0), t: V(0, 0, -1), n: V(-1, 0, 0) }, r: { o: V(w / 2, 0, 0), t: V(0, 0, 1), n: V(1, 0, 0) },
    };
    const fbox = (f: string, u0: number, u1: number, v0: number, v1: number, n0: number, n1: number) => {
      const fc = F[f];
      const a = fc.o.clone().addScaledVector(fc.t, u0).addScaledVector(fc.n, n0), b = fc.o.clone().addScaledVector(fc.t, u1).addScaledVector(fc.n, n1);
      return bmm(Math.min(a.x, b.x), y0 + v0, Math.min(a.z, b.z), Math.max(a.x, b.x), y0 + v1, Math.max(a.z, b.z));
    };
    const win = (f: string, u: number, v: number, ww: number, wh: number, shut?: string) => {
      const fw = 0.08;
      put(out.wins, fbox(f, u - ww / 2, u + ww / 2, v - wh / 2, v + wh / 2, -0.01, 0.015), '#ffffff', 0);
      put(out.trims, fbox(f, u - ww / 2 - fw, u + ww / 2 + fw, v + wh / 2, v + wh / 2 + fw, -0.01, 0.05), trimC);
      put(out.trims, fbox(f, u - ww / 2 - fw - 0.03, u + ww / 2 + fw + 0.03, v - wh / 2 - fw, v - wh / 2, -0.01, 0.08), trimC);
      put(out.trims, fbox(f, u - ww / 2 - fw, u - ww / 2, v - wh / 2, v + wh / 2, -0.01, 0.05), trimC);
      put(out.trims, fbox(f, u + ww / 2, u + ww / 2 + fw, v - wh / 2, v + wh / 2, -0.01, 0.05), trimC);
      put(out.trims, fbox(f, u - 0.02, u + 0.02, v - wh / 2, v + wh / 2, 0.0, 0.03), trimC);
      put(out.trims, fbox(f, u - ww / 2, u + ww / 2, v - 0.02, v + 0.02, 0.0, 0.03), trimC);
      if (shut) for (const sg of [-1, 1]) {
        const e = u + sg * (ww / 2 + fw);
        put(out.trims, fbox(f, Math.min(e, e + sg * ww * 0.45), Math.max(e, e + sg * ww * 0.45), v - wh / 2, v + wh / 2, -0.01, 0.035), shut);
      }
    };
    const door = (f: string, u: number, v = 0) => {
      const dw = 0.95, dh = 2.08;
      put(out.trims, fbox(f, u - dw / 2, u + dw / 2, v, v + dh, -0.01, 0.03), dc);
      put(out.trims, fbox(f, u - dw / 2 - 0.09, u - dw / 2, v, v + dh + 0.09, -0.01, 0.06), trimC);
      put(out.trims, fbox(f, u + dw / 2, u + dw / 2 + 0.09, v, v + dh + 0.09, -0.01, 0.06), trimC);
      put(out.trims, fbox(f, u - dw / 2 - 0.09, u + dw / 2 + 0.09, v + dh, v + dh + 0.09, -0.01, 0.06), trimC);
      put(out.wins, fbox(f, u - dw * 0.3, u + dw * 0.3, v + dh * 0.62, v + dh * 0.88, 0.0, 0.035), '#ffffff', 0);
      put(out.trims, fbox(f, u + dw * 0.3, u + dw * 0.38, v + 0.95, v + 1.05, 0.0, 0.08), '#d9c27a');
    };
    const pot = (lx: number, ly: number, lz: number) => {
      put(out.trims, at(new CylinderGeometry(0.2, 0.15, 0.34, 10), lx, ly + 0.17, lz), potC);
      skipBlob();
      const wp = V(lx, ly, lz).applyMatrix4(T);
      out.leaves.bush({ x: wp.x, y: wp.y + 0.3, z: wp.z, rx: 0.3, ry: 0.27, cells: [i % 3 ? Leaf.Broad : Leaf.Pink], seed: wp.x + wp.z * 3.7, sink: 0.25 });
    };
    const board = (lx: number, ly: number, lz: number, tilt: number, yaw: number, c: string) => {
      const sb = new SphereGeometry(1, 12, 6); sb.scale(0.27, 1.05, 0.05); sb.rotateX(tilt); sb.rotateY(yaw); sb.translate(lx, ly, lz);
      put(out.trims, sb, c, 0);
    };
    // ---- base: stilts with bracing (beach) or a foundation plinth (town)
    if (beach) {
      for (const sx of [-w / 2 + 0.25, 0, w / 2 - 0.25]) for (const sz of [-d / 2 + 0.25, d / 2 - 0.25]) put(out.trims, bmm(sx - 0.11, g0 - 0.4, sz - 0.11, sx + 0.11, y0, sz + 0.11), '#cbb89c');
      for (const sz of [-d / 2 + 0.25, d / 2 - 0.25]) put(out.trims, bmm(-w / 2 + 0.2, y0 - 0.75, sz - 0.04, w / 2 - 0.2, y0 - 0.6, sz + 0.04), '#bba88c');
    } else {
      put(out.trims, bmm(-w / 2 - 0.08, g0 - 0.3, -d / 2 - 0.08, w / 2 + 0.08, y0, d / 2 + 0.08), '#d9cdbb');
    }
    // ---- walls, floor band, corner boards, frieze
    put(out.trims, bmm(-w / 2 - 0.1, y0 - 0.05, -d / 2 - 0.1, w / 2 + 0.1, y0 + 0.14, d / 2 + 0.1), trimC);
    put(out.walls, bmm(-w / 2, y0, -d / 2, w / 2, y0 + h, d / 2), wc);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(out.trims, bmm(sx * w / 2 - 0.07, y0, sz * d / 2 - 0.07, sx * w / 2 + 0.07, y0 + h, sz * d / 2 + 0.07), trimC);
    put(out.trims, bmm(-w / 2 - 0.06, y0 + h - 0.16, -d / 2 - 0.06, w / 2 + 0.06, y0 + h, d / 2 + 0.06), trimC);
    // ---- roof (built from exact planes through the wall-top edges, so it always rests on the walls)
    const top = y0 + h, tv = 0.15;
    const roofGeo = (list: { pts: Vector3[]; n: Vector3 }[], col: string) => put(out.roofs, polys(list), col, 0.05);
    const trimGeo = (list: { pts: Vector3[]; n: Vector3 }[], col: string) => put(out.trims, polys(list), col, 0.02);
    const up = (p: Vector3) => p.clone().setY(p.y + tv);
    if (style === 0) {
      const tp = Math.tan(0.55), oe = 0.42, og = 0.36;
      const hr = (d / 2) * tp, yR = top + hr, yE = top - oe * tp;
      const xL = -w / 2 - og, xR = w / 2 + og, zE = d / 2 + oe;
      for (const sz of [-1, 1]) {
        const E1 = V(xL, yE, sz * zE), E2 = V(xR, yE, sz * zE), R2 = V(xR, yR, 0), R1 = V(xL, yR, 0);
        const nT = V(0, 1, sz * tp);
        roofGeo([{ pts: [E1, E2, R2, R1].map(up), n: nT }], rc);
        trimGeo([{ pts: [E1, E2, R2, R1], n: nT.clone().negate() }], trimC);
        trimGeo([{ pts: [E1, E2, up(E2), up(E1)], n: V(0, 0, sz) }, { pts: [E1, R1, up(R1), up(E1)], n: V(-1, 0, 0) }, { pts: [E2, R2, up(R2), up(E2)], n: V(1, 0, 0) }], trimC);
      }
      for (const sx of [-1, 1]) put(out.walls, polys([{ pts: [V(sx * w / 2, top, -d / 2), V(sx * w / 2, top, d / 2), V(sx * w / 2, yR, 0)], n: V(sx, 0, 0) }]), wc);
      put(out.roofs, bmm(xL, yR + tv - 0.04, -0.1, xR, yR + tv + 0.06, 0.1), roofDark);
      if (i % 2 === 0) put(out.trims, bmm(w * 0.22, top + hr * 0.4, -0.35, w * 0.22 + 0.65, yR + 0.75, 0.3), '#c9b8a6');
      // small gable vent
      put(out.trims, bmm(-w / 2 - 0.03, top + hr * 0.35, -0.3, -w / 2 + 0.01, top + hr * 0.62, 0.3), roofDark);
    } else if (style === 1) {
      const tp = Math.tan(0.5), o = 0.4;
      const hr = (d / 2) * tp, yR = top + hr, yE = top - o * tp;
      const ex = w / 2 + o, ez = d / 2 + o, rx = Math.max(0.1, w / 2 - d / 2);
      const C = [V(-ex, yE, -ez), V(ex, yE, -ez), V(ex, yE, ez), V(-ex, yE, ez)];
      const RA = V(-rx, yR, 0), RB = V(rx, yR, 0);
      const faces = [
        { pts: [C[0], C[1], RB, RA], n: V(0, 1, -tp) }, { pts: [C[2], C[3], RA, RB], n: V(0, 1, tp) },
        { pts: [C[3], C[0], RA], n: V(-tp, 1, 0) }, { pts: [C[1], C[2], RB], n: V(tp, 1, 0) },
      ];
      roofGeo(faces.map((f) => ({ pts: f.pts.map(up), n: f.n })), rc);
      trimGeo(faces.map((f) => ({ pts: f.pts, n: f.n.clone().negate() })), trimC);
      trimGeo([0, 1, 2, 3].map((k) => { const a = C[k], b = C[(k + 1) % 4]; return { pts: [a, b, up(b), up(a)], n: [V(0, 0, -1), V(1, 0, 0), V(0, 0, 1), V(-1, 0, 0)][k] }; }), trimC);
      put(out.roofs, bmm(-rx - 0.05, yR + tv - 0.04, -0.09, rx + 0.05, yR + tv + 0.05, 0.09), roofDark);
    } else {
      put(out.roofs, bmm(-w / 2 - 0.14, top, -d / 2 - 0.14, w / 2 + 0.14, top + 0.22, d / 2 + 0.14), '#d6cfc3');
      const ph = 0.5, pt = 0.16, y1 = top + 0.22;
      for (const [a, b, c2, e] of [[-w / 2, -d / 2, w / 2, -d / 2 + pt], [-w / 2, d / 2 - pt, w / 2, d / 2], [-w / 2, -d / 2, -w / 2 + pt, d / 2], [w / 2 - pt, -d / 2, w / 2, d / 2]]) {
        put(out.walls, bmm(a, y1, b, c2, y1 + ph, e), wc);
        put(out.trims, bmm(a - 0.04, y1 + ph, b - 0.04, c2 + 0.04, y1 + ph + 0.06, e + 0.04), trimC);
      }
      put(out.trims, bmm(w * 0.12, y1, -d * 0.12, w * 0.36, y1 + 0.85, d * 0.22), '#d5d0c8');
      put(out.trims, bmm(-w * 0.38, y1, d * 0.05, -w * 0.12, y1 + 0.08, d * 0.32), '#2f3c4c');
    }
    // ---- windows + doors
    const shut = i % 3 === 0 ? ac : undefined;
    win('f', -w * 0.28, 1.55, 1.15 * s, 1.15 * s, shut); win('f', w * 0.28, 1.55, 1.15 * s, 1.15 * s, shut);
    win('b', w * 0.25, 1.6, 1.0 * s, 1.0 * s); win('b', -w * 0.05, 1.6, 0.9 * s, 0.9 * s);
    win('l', 0, 1.6, 1.15 * s, 1.0 * s); win('r', -d * 0.12, 1.6, 1.15 * s, 1.0 * s);
    door('f', 0); door('b', -w * 0.3);
    if (!beach) {
      // ---- town house: porch with lean-to roof, steps, railing, posts; fence; path
      const pd = 1.9, px0 = -w * 0.44, px1 = w * 0.44, fy = y0 + 0.14;
      put(out.trims, bmm(px0, y0 - 0.05, -d / 2 - pd, px1, fy, -d / 2), woodC, 0.08);
      put(out.trims, bmm(px0 + 0.05, g0 - 0.2, -d / 2 - pd + 0.05, px1 - 0.05, y0 - 0.05, -d / 2), '#cdbf9f');
      const nS = Math.max(1, Math.round((fy - g0) / 0.17)), rs = (fy - g0) / nS;
      for (let k = 0; k < nS; k++) put(out.trims, bmm(-0.75, g0 - 0.1, -d / 2 - pd - (k + 1) * 0.3, 0.75, fy - (k + 1) * rs, -d / 2 - pd - k * 0.3), '#e9e1d2');
      const postX = [px0 + 0.07, -0.86, 0.86, px1 - 0.07];
      for (const px of postX) put(out.trims, bmm(px - 0.065, fy, -d / 2 - pd + 0.02, px + 0.065, top - 0.32, -d / 2 - pd + 0.15), trimC);
      const ry0 = top - 0.22, ry1 = top - 0.62, zf = -d / 2 - pd - 0.28;
      const nP = V(0, 1, -((ry0 - ry1) / (pd + 0.28)));
      roofGeo([{ pts: [V(px0 - 0.2, ry1 + 0.1, zf), V(px1 + 0.2, ry1 + 0.1, zf), V(px1 + 0.2, ry0 + 0.1, -d / 2), V(px0 - 0.2, ry0 + 0.1, -d / 2)], n: nP }], rc);
      trimGeo([{ pts: [V(px0 - 0.2, ry1, zf), V(px1 + 0.2, ry1, zf), V(px1 + 0.2, ry0, -d / 2), V(px0 - 0.2, ry0, -d / 2)], n: nP.clone().negate() },
        { pts: [V(px0 - 0.2, ry1, zf), V(px1 + 0.2, ry1, zf), V(px1 + 0.2, ry1 + 0.1, zf), V(px0 - 0.2, ry1 + 0.1, zf)], n: V(0, 0, -1) }], trimC);
      for (const [a, b] of [[px0 + 0.07, -0.86], [0.86, px1 - 0.07]]) {
        put(out.trims, bmm(a, fy + 0.86, -d / 2 - pd + 0.04, b, fy + 0.92, -d / 2 - pd + 0.12), trimC);
        for (let bx = a + 0.12; bx < b - 0.06; bx += 0.14) put(out.trims, bmm(bx - 0.02, fy, -d / 2 - pd + 0.06, bx + 0.02, fy + 0.86, -d / 2 - pd + 0.1), trimC, 0);
      }
      for (const sx of [px0 + 0.04, px1 - 0.04]) {
        put(out.trims, bmm(sx - 0.03, fy + 0.86, -d / 2 - pd + 0.08, sx + 0.03, fy + 0.92, -d / 2), trimC);
        for (let bz = -d / 2 - pd + 0.2; bz < -d / 2 - 0.05; bz += 0.14) put(out.trims, bmm(sx - 0.02, fy, bz - 0.02, sx + 0.02, fy + 0.86, bz + 0.02), trimC, 0);
      }
      pot(px0 + 0.45, fy, -d / 2 - 0.4); pot(px1 - 0.45, fy, -d / 2 - 0.45);
      if (i % 2) board(px1 - 0.25, fy + 1.0, -d / 2 - 0.2, 0.18, 0, ac);
      // picket fence around the front yard with a gate opening for the path
      const fz = -d / 2 - pd - nS * 0.3 - 2.6;
      for (const [a, b] of [[-w / 2 - 1.0, -0.8], [0.8, w / 2 + 1.0]]) {
        for (const yy of [0.32, 0.72]) put(out.trims, bmm(a, g0 + yy, fz - 0.02, b, g0 + yy + 0.05, fz + 0.02), trimC);
        for (let fx = a; fx <= b + 1e-3; fx += 0.16) put(out.trims, bmm(fx - 0.03, g0 - 0.05, fz - 0.035, fx + 0.03, g0 + 0.9 + (Math.abs(Math.round(fx / 0.16)) % 2) * 0.05, fz + 0.035), trimC, 0);
      }
      // path from the steps out to the town path
      const s0 = V(0, 0, -d / 2 - pd - nS * 0.3).applyMatrix4(T), s1 = V(0, 0, fz - 0.4).applyMatrix4(T);
      out.paths.push(ribbon([[s0.x, s0.z], [s1.x, s1.z], [s1.x, 34.2]], 1.2, new Color('#e9d6ae')));
      // a couple of shrubs by the porch, a step at the back door
      for (const sx of [-w / 2 - 0.4, w / 2 + 0.5]) { const wp = V(sx, 0, -d / 2 - 0.6).applyMatrix4(T); bush(out.leaves, wp.x, g0, wp.z, 0.55); }
      put(out.trims, bmm(w * 0.3 - 0.6, g0 - 0.1, d / 2, w * 0.3 + 0.6, (g0 + y0) / 2, d / 2 + 0.42), '#e9e1d2');
    } else {
      // ---- beach house: sea-side deck with railing and stairs to the sand; back landing + stairs towards the boardwalk; awning; boards
      const dd = 2.2, fy = y0 + 0.14;
      put(out.trims, bmm(-w / 2, y0 - 0.05, -d / 2 - dd, w / 2, fy, -d / 2), woodC, 0.08);
      for (const sx of [-w / 2 + 0.15, w / 2 - 0.15]) put(out.trims, bmm(sx - 0.1, g0 - 0.4, -d / 2 - dd + 0.05, sx + 0.1, y0, -d / 2 - dd + 0.25), '#cbb89c');
      put(out.trims, bmm(-w / 2, fy + 0.86, -d / 2 - dd, -0.8, fy + 0.93, -d / 2 - dd + 0.07), trimC);
      put(out.trims, bmm(0.8, fy + 0.86, -d / 2 - dd, w / 2, fy + 0.93, -d / 2 - dd + 0.07), trimC);
      for (const sx of [-w / 2 + 0.03, w / 2 - 0.03]) put(out.trims, bmm(sx - 0.035, fy + 0.86, -d / 2 - dd, sx + 0.035, fy + 0.93, -d / 2), trimC);
      for (let bx = -w / 2 + 0.1; bx < w / 2; bx += 0.15) if (Math.abs(bx) > 0.8) put(out.trims, bmm(bx - 0.02, fy, -d / 2 - dd + 0.01, bx + 0.02, fy + 0.86, -d / 2 - dd + 0.05), trimC, 0);
      const nS = Math.round((fy - g0) / 0.18), rs = (fy - g0) / nS;
      for (let k = 0; k < nS; k++) put(out.trims, bmm(-0.75, fy - (k + 1) * rs - 0.05, -d / 2 - dd - (k + 1) * 0.28, 0.75, fy - (k + 1) * rs, -d / 2 - dd - k * 0.28), woodC, 0.06);
      for (const sx of [-0.78, 0.78]) {
        const len = nS * 0.28, ang = Math.atan2(fy - g0, len);
        const st = new BoxGeometry(0.06, 0.24, Math.hypot(len, fy - g0)); st.rotateX(-ang); st.translate(sx, (fy + g0) / 2 + 0.05, -d / 2 - dd - len / 2);
        put(out.trims, st, '#a07a52');
        const hr = new BoxGeometry(0.05, 0.05, Math.hypot(len, fy - g0)); hr.rotateX(-ang); hr.translate(sx, (fy + g0) / 2 + 0.9, -d / 2 - dd - len / 2);
        put(out.trims, hr, trimC);
      }
      // back landing + stairs (land side), under the back door at local x = +0.3 w
      const bx0 = w * 0.3;
      put(out.trims, bmm(bx0 - 0.75, y0 - 0.05, d / 2, bx0 + 0.75, fy, d / 2 + 1.2), woodC, 0.08);
      for (let k = 0; k < nS; k++) put(out.trims, bmm(bx0 - 0.6, fy - (k + 1) * rs - 0.05, d / 2 + 1.2 + k * 0.28, bx0 + 0.6, fy - (k + 1) * rs, d / 2 + 1.2 + (k + 1) * 0.28), woodC, 0.06);
      put(out.trims, bmm(bx0 + 0.72, fy, d / 2 + 0.05, bx0 + 0.78, fy + 0.92, d / 2 + 1.2), trimC);
      for (const sx of [bx0 - 0.72, bx0 + 0.72]) put(out.trims, bmm(sx - 0.08, g0 - 0.4, d / 2 + 1.05, sx + 0.08, y0, d / 2 + 1.2), '#cbb89c');
      // striped awning over the back windows
      const aw0 = w * 0.25 - 0.85, aw1 = w * 0.25 + 0.85, nStr = 6;
      for (let k = 0; k < nStr; k++) {
        const ua = aw0 + ((aw1 - aw0) * k) / nStr, ub = aw0 + ((aw1 - aw0) * (k + 1)) / nStr;
        const q = [V(-ua, y0 + 2.45, d / 2 + 0.02), V(-ub, y0 + 2.45, d / 2 + 0.02), V(-ub, y0 + 2.1, d / 2 + 0.85), V(-ua, y0 + 2.1, d / 2 + 0.85)];
        out.fabric.push(paint(polys([{ pts: q, n: V(0, 1, 0.45) }]).applyMatrix4(T), k % 2 ? '#fbf3e4' : ac, 0.02));
      }
      board(-w / 2 + 0.5, g0 + 1.0, d / 2 + 0.42, -0.16, 0, ac);
      board(-w / 2 + 1.1, g0 + 1.0, d / 2 + 0.45, -0.18, 0.1, ['#f08a5d', '#6cc3b8', '#f7d06b'][i % 3]);
      pot(-w / 2 + 0.5, fy, -d / 2 - 0.5); pot(w / 2 - 0.6, fy, -d / 2 - dd + 0.45);
      // plank path from the back stairs to the boardwalk (where the boardwalk is)
      if (Math.abs(x) < 70) {
        const s0 = V(bx0, 0, d / 2 + 1.2 + nS * 0.28).applyMatrix4(T);
        for (let zz = s0.z + 0.2; zz < -27.5; zz += 0.3) {
          const pz = zz, px = s0.x;
          out.trims.push(paint(ni(bmm(px - 0.55, terrainHeight(px, pz) - 0.02, pz - 0.12, px + 0.55, terrainHeight(px, pz) + 0.04, pz + 0.12)), '#a98258', 0.12));
        }
      }
    }
  });
}

/** flat ribbon draped on the terrain (paths) */
function ribbon(pts: [number, number][], width: number, c: Color) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const n = Math.max(1, Math.ceil(len / 1.5));
    const sx = -(bz - az) / len, sz = (bx - ax) / len;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const P = (t: number, s: number) => {
        const x = ax + (bx - ax) * t + sx * s * width / 2, z = az + (bz - az) * t + sz * s * width / 2;
        return V(x, terrainHeight(x, z) + 0.03, z);
      };
      const q = [P(t0, -1), P(t0, 1), P(t1, 1), P(t1, -1)];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const p = q[idx]; pos.push(p.x, p.y, p.z); nor.push(0, 1, 0);
        const j = 0.95 + h2(p.x * 2.3, p.z * 1.7) * 0.08;
        col.push(c.r * j, c.g * j, c.b * j);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  // keep triangles facing up
  const p = g.getAttribute('position');
  for (let t = 0; t < p.count; t += 3) {
    const a = V(p.getX(t), p.getY(t), p.getZ(t)), b = V(p.getX(t + 1), p.getY(t + 1), p.getZ(t + 1)), cc = V(p.getX(t + 2), p.getY(t + 2), p.getZ(t + 2));
    if (b.clone().sub(a).cross(cc.clone().sub(a)).y < 0) { p.setXYZ(t + 1, cc.x, cc.y, cc.z); p.setXYZ(t + 2, b.x, b.y, b.z); }
  }
  return g;
}

// ------------------------------------------------------------------ rocky headland with cliffs, boulders and scrub; returns the lighthouse site
function buildHeadland(group: Group, mat: MeshLambertMaterial): [number, number, number] {
  const blobs: [number, number, number, number][] = [[330, -332, 112, 40], [432, -268, 84, 34], [256, -404, 70, 26], [528, -372, 126, 52], [372, -356, 64, 58], [272, -312, 42, 38]];
  const rawH = (x: number, z: number) => {
    let m = 0, hs = 0, ws = 0;
    for (const [bx, bz, r, ht] of blobs) {
      const dx = x - bx, dz = z - bz, dist = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
      const rr = r * (1 + 0.14 * Math.sin(a * 3 + bx * 0.01) + 0.07 * Math.sin(a * 7 + bz * 0.02) + 0.04 * Math.sin(a * 13 + 1.7));
      const inside = rr - dist;
      m = Math.max(m, smooth(-4, 15, inside));
      const wgt = smooth(-25, 35, inside);
      hs += ht * wgt; ws += wgt;
    }
    if (m <= 0) return { h: -8, m };
    const plateau = ws > 1e-3 ? hs / ws : 20;
    let h = -8 + (plateau + 8) * Math.pow(m, 0.62);
    h += m * ((ridgeN(x * 0.018, z * 0.018) - 0.45) * 12) + fbm2(x * 0.07, z * 0.07) * 2.5 * m;
    // broken skyline: knolls and saddles along the ridge
    h += m * m * (Math.sin(x * 0.019 + z * 0.011 + 0.7) * 8 + Math.sin(x * 0.043 - z * 0.029 + 2.1) * 4.5);
    return { h, m };
  };
  // level pad for the lighthouse + keeper's cottage
  const PX = 272, PZ = -310, PAD = rawH(PX, PZ).h;
  const headH = (x: number, z: number) => {
    const r = rawH(x, z);
    const k = smooth(24, 13, Math.hypot(x - PX, z - PZ)) * r.m;
    return { h: r.h + (PAD - r.h) * k, m: r.m };
  };
  const x0 = 180, x1 = 660, z0 = -560, z1 = -170, nx = 160, nz = 130;
  const pos: number[] = [], col: number[] = [];
  const H: number[] = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
    const { h } = headH(x, z);
    pos.push(x, h, z); H.push(h);
  }
  const idx: number[] = [];
  const row = nx + 1;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    if (Math.max(H[a], H[b], H[c], H[d]) < -2.5) continue;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure triangles face up
  const nrm = g.getAttribute('normal');
  let flip = 0;
  for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) flip++;
  if (flip > nrm.count / 2) { for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; } g.setIndex(idx); g.computeVertexNormals(); }
  const rockA = new Color('#a18a76'), rockB = new Color('#c2ab95'), rockD = new Color('#7d6a5c'), scrubA = new Color('#6f7d47'), scrubB = new Color('#8a8f55');
  const dryG = new Color('#b8a36c'), sandC = new Color('#d2bb8e'), wetR = new Color('#5f5248');
  for (let i = 0; i < nrm.count; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const slope = 1 - nrm.getY(i);
    const c = new Color();
    const strata = 0.5 + 0.5 * Math.sin(y * 0.9 + fbm2(x * 0.05, z * 0.05) * 3.0);
    const rock = rockA.clone().lerp(rockB, strata * 0.7).lerp(rockD, smooth(0.6, 0.9, fbm2(x * 0.11, z * 0.11)) * 0.5);
    const veg = scrubA.clone().lerp(scrubB, vn2(x * 0.05, z * 0.05)).lerp(dryG, smooth(0.55, 0.8, fbm2(x * 0.03 + 4, z * 0.03)) * 0.6);
    c.copy(veg).lerp(rock, smooth(0.18, 0.42, slope));
    if (y < 3) c.lerp(sandC, smooth(3, 0.5, y) * (1 - smooth(0.3, 0.6, slope)) * 0.8);
    if (y < 0.4) c.lerp(wetR, smooth(0.4, -1.2, y) * 0.7);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  const parts: BufferGeometry[] = [g.toNonIndexed()];
  // boulders along the cliff foot, scrub clumps on the plateau
  const rnd = rng(4242);
  let nb = 0, ns = 0;
  for (let k = 0; k < 6000 && (nb < 150 || ns < 260); k++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    const { h, m } = headH(x, z);
    if (nb < 150 && h > -1.6 && h < 2.5 && m > 0.02 && m < 0.5) {
      const r = 1.6 + rnd() * 3.2;
      const b = new IcosahedronGeometry(r, 1);
      const p = b.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const f = 0.75 + h2(p.getX(i) * 3.1 + x, p.getZ(i) * 2.7 + z) * 0.5; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.62, p.getZ(i) * f); }
      b.rotateY(rnd() * 6.28); b.translate(x, h - r * 0.15, z);
      parts.push(shade(ni(b), rockB, wetR, 0.15)); nb++;
    } else if (ns < 260 && h > 12 && m > 0.85) {
      const e = 2.0;
      const sl = Math.abs(headH(x + e, z).h - headH(x - e, z).h) + Math.abs(headH(x, z + e).h - headH(x, z - e).h);
      if (sl > 3.2) continue;
      const r = 1.8 + rnd() * 2.8;
      const b = blobGeo(r, 0.55, x * 0.1 + z);
      b.translate(x, h + r * 0.15, z);
      parts.push(shade(b, scrubB, new Color('#3f4a2a'), 0.15)); ns++;
    }
  }
  // sea stacks off the western point: flat-topped pillars in the water 8-22 m from the cliffs
  const stacks: [number, number][] = [];
  for (let z = -440; z <= -280 && stacks.length < 4; z += 6) for (let x = 168; x <= 262 && stacks.length < 4; x += 6) {
    if (headH(x, z).m > 0) continue;
    let near = 1e9;
    for (let k = 0; k < 16; k++) for (const d of [8, 14, 20]) {
      const a = (k / 16) * Math.PI * 2;
      if (headH(x + Math.cos(a) * d, z + Math.sin(a) * d).m > 0.3) near = Math.min(near, d);
    }
    if (near < 8 || near > 20 || stacks.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 16)) continue;
    stacks.push([x + (rnd() - 0.5) * 3, z + (rnd() - 0.5) * 3]);
  }
  for (const [x, z] of stacks) {
    const r = 2.6 + rnd() * 2.6, hgt = 7 + rnd() * 10;
    const b = ni(new IcosahedronGeometry(1, 2));
    const p = b.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), pz = p.getZ(i), t = (Math.min(p.getY(i), 0.72) + 1) / 1.72;
      const f = (0.8 + h2(px * 5.1 + x, pz * 4.3 + z) * 0.4) * (1.12 - 0.38 * t);
      p.setXYZ(i, px * r * f, -4 + t * (hgt + 4), pz * r * f * 0.85);
    }
    b.rotateY(rnd() * 6.28); b.translate(x, 0, z);
    shade(b, rockB, rockD, 0.15);
    const c = b.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      const w = smooth(0.6, -0.8, p.getY(i)) * 0.75, sc = smooth(hgt - 1.2, hgt, p.getY(i)) * 0.55;
      c.setXYZ(i, c.getX(i) + (wetR.r - c.getX(i)) * w + (scrubA.r - c.getX(i)) * sc, c.getY(i) + (wetR.g - c.getY(i)) * w + (scrubA.g - c.getY(i)) * sc,
        c.getZ(i) + (wetR.b - c.getZ(i)) * w + (scrubA.b - c.getZ(i)) * sc);
    }
    parts.push(b);
  }
  const mesh = new Mesh(mergeGeometries(parts.map((q) => { for (const a of Object.keys(q.attributes)) if (!['position', 'normal', 'color'].includes(a)) q.deleteAttribute(a); return q; })), mat);
  group.add(mesh);
  const lx = 268, lz = -314;
  return [lx, headH(lx, lz).h - 0.4, lz];
}

// ------------------------------------------------------------------ footprints in the sand
function buildFootprints() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.beginPath(); x.ellipse(32, 100, 12, 16, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(35, 60, 14, 24, 0.1, 0, Math.PI * 2); x.fill();
  for (const [tx, ty, r] of [[23, 27, 6.2], [32, 22, 5], [40, 24, 4.4], [46, 29, 3.8], [50, 35, 3.2]]) { x.beginPath(); x.arc(tx, ty, r, 0, Math.PI * 2); x.fill(); }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [];
  const trails: [number, number, number, number][] = [
    [-20, -28.6, -26, -70], [-6, -28.6, -8.5, -51.5], [8, -28.6, 18, -69], [26, -28.6, 21.5, -49], [-36, -28.6, -31, -47.5],
    [-46, -60, 30, -69.5], [-55, -66, -10, -68.8], [40, -29, 45, -55], [-62, -30, -58.5, -59], [12, -55, -6, -54.5], [30, -69, 52, -64],
  ];
  const rnd = rng(808);
  for (const [ax, az, bx, bz] of trails) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 0.68);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const ph = rnd() * 6;
    for (let k = 0; k < n; k++) {
      if (rnd() < 0.08) continue;
      const t = k / n;
      const wob = Math.sin(t * 9 + ph) * 0.6;
      const side = k % 2 ? 1 : -1;
      const cx = ax + (bx - ax) * t - dz * (wob + side * 0.09), cz = az + (bz - az) * t + dx * (wob + side * 0.09);
      const yaw = Math.atan2(dx, dz) + (rnd() - 0.5) * 0.25;
      const y = terrainHeight(cx, cz) + 0.012;
      const wet = y < -1.08;
      const f = wet ? 0.66 : 0.82;
      const cc = new Color('#e3c393').multiplyScalar(f);
      const hw = 0.055, hl = 0.135, cs = Math.cos(yaw), sn = Math.sin(yaw);
      const P = (u: number, v: number) => V(cx + u * cs + v * sn, y, cz - u * sn + v * cs);
      const flipU = side > 0;
      const q = [P(-hw, -hl), P(hw, -hl), P(hw, hl), P(-hw, hl)];
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [flipU ? 1 - u : u, v]);
      for (const i of [0, 2, 1, 0, 3, 2]) { pos.push(q[i].x, q[i].y, q[i].z); nor.push(0, 1, 0); col.push(cc.r, cc.g, cc.b); uv.push(uvs[i][0], uvs[i][1]); }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  const p = g.getAttribute('position');
  for (let t = 0; t < p.count; t += 3) {
    const a = V(p.getX(t), p.getY(t), p.getZ(t)), b = V(p.getX(t + 1), p.getY(t + 1), p.getZ(t + 1)), cc = V(p.getX(t + 2), p.getY(t + 2), p.getZ(t + 2));
    if (b.clone().sub(a).cross(cc.clone().sub(a)).y < 0) {
      p.setXYZ(t + 1, cc.x, cc.y, cc.z); p.setXYZ(t + 2, b.x, b.y, b.z);
      const u = g.getAttribute('uv'); const u1 = [u.getX(t + 1), u.getY(t + 1)]; u.setXY(t + 1, u.getX(t + 2), u.getY(t + 2)); u.setXY(t + 2, u1[0], u1[1]);
    }
  }
  const m = toonMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, detail: 'sand', bands: 0.2, wrap: 0.45, rim: 0.1, name: 'footprints' });
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
  const mesh = new Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ snack kiosk shop: shelves of goods, a picture menu, a lit drinks fridge
/**
 * Atlas (1024 x 1024, canvas y down): goods shelves (0..256), picture menu board (256..384), fridge glass (x 0..384,
 * y 384..1024); the rest is white for the vertex-coloured parts. Colour blocks and simple shapes only, never letters.
 */
function kioskAtlas() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!;
  const rnd = rng(2203);
  const pal = ['#e8463a', '#f4a261', '#ffd23f', '#2a9d8f', '#3a86ff', '#ff70a6', '#8ac926', '#6a4c93', '#f08a4b', '#1f6f8b', '#fbf8f2', '#d6457a'];
  const pick = () => pal[Math.floor(rnd() * pal.length)];
  const rr = (x0: number, y0: number, w: number, h: number, r: number) => { x.beginPath(); x.roundRect(x0, y0, w, h, r); };
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, S, S);
  // ---- shelves of goods (three boards; the board lines match the shelf geometry)
  const sg = x.createLinearGradient(0, 0, 0, 256);
  sg.addColorStop(0, '#f6ead2'); sg.addColorStop(1, '#e6d5b8');
  x.fillStyle = sg; x.fillRect(0, 0, S, 256);
  for (const top of [6, 92, 178]) {
    let px = 6;
    while (px < S - 30) {
      const kind = rnd(), w = kind < 0.35 ? 16 + rnd() * 10 : 26 + rnd() * 26, hgt = kind < 0.35 ? 46 + rnd() * 22 : 34 + rnd() * 34;
      const y1 = top + 76, y0 = y1 - hgt, col = pick();
      x.fillStyle = 'rgba(70,50,30,0.25)'; x.fillRect(px + 3, y0 + 4, w, hgt - 4);
      if (kind < 0.35) {
        // bottle: body, shoulder, cap, label band
        x.fillStyle = col; rr(px, y0 + hgt * 0.3, w, hgt * 0.7, 4); x.fill();
        x.beginPath(); x.moveTo(px + 2, y0 + hgt * 0.32); x.lineTo(px + w * 0.35, y0 + hgt * 0.1); x.lineTo(px + w * 0.65, y0 + hgt * 0.1); x.lineTo(px + w - 2, y0 + hgt * 0.32); x.fill();
        x.fillStyle = '#f4efe6'; x.fillRect(px + w * 0.3, y0, w * 0.4, hgt * 0.12);
        x.fillStyle = 'rgba(255,255,255,0.75)'; x.fillRect(px, y0 + hgt * 0.55, w, hgt * 0.18);
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(px + 3, y0 + hgt * 0.34, 3, hgt * 0.6);
      } else if (kind < 0.7) {
        // snack bag: pillowy pack with a crimped top and a round window
        x.fillStyle = col; rr(px, y0, w, hgt, 7); x.fill();
        x.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 0; k < w; k += 5) x.fillRect(px + k, y0, 3, 5);
        x.fillStyle = pick(); x.beginPath(); x.arc(px + w / 2, y0 + hgt * 0.55, Math.min(w, hgt) * 0.26, 0, Math.PI * 2); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.3)'; x.fillRect(px + 4, y0 + 8, 4, hgt - 16);
      } else {
        // box: two-tone with a stripe
        x.fillStyle = col; x.fillRect(px, y0, w, hgt);
        x.fillStyle = pick(); x.fillRect(px, y0 + hgt * 0.38, w, hgt * 0.22);
        x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(px, y0, w, 4);
      }
      px += w + 3 + rnd() * 5;
    }
    // the board edge and its shadow
    x.fillStyle = '#fdf8ee'; x.fillRect(0, top + 76, S, 7);
    x.fillStyle = 'rgba(80,60,40,0.3)'; x.fillRect(0, top + 83, S, 4);
  }
  // ---- picture menu board: dark slate, six tiles with white pictograms and price bars
  x.fillStyle = '#2b333d'; x.fillRect(0, 256, S, 128);
  for (let k = 0; k < 16; k++) { x.fillStyle = k % 2 ? '#fbf3e4' : '#2f8f86'; x.fillRect(k * 64, 256, 64, 12); }
  const tiles = ['#e8463a', '#ffd23f', '#3a86ff', '#ff70a6', '#8ac926', '#f4a261'];
  tiles.forEach((tc, k) => {
    const tx = 16 + k * 168, ty = 280;
    x.fillStyle = tc; rr(tx, ty, 92, 92, 12); x.fill();
    x.fillStyle = '#fffaf0'; x.strokeStyle = '#fffaf0'; x.lineWidth = 6; x.lineCap = 'round';
    const cx = tx + 46, cy = ty + 46;
    x.beginPath();
    if (k === 0) { x.moveTo(cx - 18, cy - 4); x.lineTo(cx, cy + 34); x.lineTo(cx + 18, cy - 4); x.fill(); x.beginPath(); x.arc(cx, cy - 12, 19, 0, Math.PI * 2); x.fill(); }
    else if (k === 1) { x.moveTo(cx - 20, cy - 22); x.lineTo(cx + 20, cy - 22); x.lineTo(cx + 14, cy + 32); x.lineTo(cx - 14, cy + 32); x.fill(); x.beginPath(); x.moveTo(cx + 4, cy - 22); x.lineTo(cx + 14, cy - 40); x.stroke(); }
    else if (k === 2) { rr(cx - 14, cy - 34, 28, 50, 12); x.fill(); x.fillRect(cx - 4, cy + 14, 8, 22); }
    else if (k === 3) { x.moveTo(cx - 22, cy - 6); x.lineTo(cx + 22, cy - 6); x.lineTo(cx + 16, cy + 32); x.lineTo(cx - 16, cy + 32); x.fill(); for (let q = -2; q <= 2; q++) { x.fillRect(cx + q * 8 - 3, cy - 34 + Math.abs(q) * 4, 6, 30); } }
    else if (k === 4) { x.ellipse(cx, cy + 6, 34, 15, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = tc; rr(cx - 30, cy - 4, 60, 12, 6); x.fill(); x.fillStyle = '#fffaf0'; }
    else { rr(cx - 18, cy - 14, 34, 40, 6); x.fill(); x.beginPath(); x.arc(cx + 18, cy + 4, 10, -1.4, 1.4); x.stroke(); for (const q of [-8, 4]) { x.beginPath(); x.moveTo(cx + q, cy - 22); x.quadraticCurveTo(cx + q + 8, cy - 32, cx + q, cy - 42); x.stroke(); } }
    // price bars, no figures
    x.fillStyle = 'rgba(255,250,240,0.85)'; rr(tx + 104, ty + 22, 44, 10, 5); x.fill();
    x.fillStyle = 'rgba(255,250,240,0.5)'; rr(tx + 104, ty + 44, 30, 8, 4); x.fill(); rr(tx + 104, ty + 62, 38, 8, 4); x.fill();
  });
  // ---- drinks fridge seen through its glass door
  const fx = 0, fy = 384, fw = 384, fh = 640;
  const fg = x.createLinearGradient(0, fy, 0, fy + fh);
  fg.addColorStop(0, '#dfe9ee'); fg.addColorStop(0.08, '#9fb3bf'); fg.addColorStop(1, '#3a4a57');
  x.fillStyle = fg; x.fillRect(fx, fy, fw, fh);
  for (let row = 0; row < 5; row++) {
    const sy = fy + 70 + row * 118;
    let bx = fx + 22;
    while (bx < fx + fw - 40) {
      const can = rnd() < 0.3, w = can ? 30 : 24 + rnd() * 8, hgt = can ? 52 : 84 + rnd() * 18, col = pick();
      const y0 = sy + 100 - hgt;
      x.fillStyle = col; rr(bx, y0 + (can ? 0 : hgt * 0.28), w, hgt * (can ? 1 : 0.72), 5); x.fill();
      if (!can) { x.fillRect(bx + w * 0.3, y0 + 6, w * 0.4, hgt * 0.3); x.fillStyle = '#f4efe6'; x.fillRect(bx + w * 0.28, y0, w * 0.44, 8); }
      else { x.fillStyle = '#c9d1d8'; x.fillRect(bx, y0, w, 6); }
      x.fillStyle = 'rgba(255,255,255,0.7)'; x.fillRect(bx, y0 + hgt * 0.55, w, hgt * 0.16);
      x.fillStyle = 'rgba(255,255,255,0.45)'; x.fillRect(bx + 4, y0 + hgt * 0.3, 4, hgt * 0.62);
      bx += w + 6 + rnd() * 4;
    }
    x.fillStyle = 'rgba(240,248,252,0.9)'; x.fillRect(fx + 12, sy + 100, fw - 24, 6);
  }
  // glass sheen + white frame with a handle
  x.fillStyle = 'rgba(255,255,255,0.14)';
  x.beginPath(); x.moveTo(fx + 40, fy + fh); x.lineTo(fx + 150, fy); x.lineTo(fx + 210, fy); x.lineTo(fx + 100, fy + fh); x.fill();
  x.strokeStyle = '#eef2f4'; x.lineWidth = 24; x.strokeRect(fx + 12, fy + 12, fw - 24, fh - 24);
  x.fillStyle = '#b9c3ca'; x.fillRect(fx + fw - 44, fy + 220, 10, 160);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** canvas pixel rectangle of the kiosk atlas -> uv rectangle (u0, v0 bottom, u1, v1 top) */
const kuv = (x0: number, y0: number, x1: number, y1: number): [number, number, number, number] => [x0 / 1024, 1 - y1 / 1024, x1 / 1024, 1 - y0 / 1024];

/**
 * The shallow shop behind the kiosk's service window: back wall with shelves, a picture menu, a glass-door drinks
 * fridge, an inner counter with a few things on it and a light strip. One draw; its light is emitted as lit albedo
 * (warm, stronger on the menu, the fridge and the strip) so the shop reads as lit from inside at any time of day.
 */
function buildKioskShop() {
  const { win, z1 } = KIOSK;
  const X0 = win.x0 - 0.35, X1 = win.x1 + 0.35, Zb = z1 - 1.05, Yc = 2.62;
  const P: number[] = [], N: number[] = [], C: number[] = [], U: number[] = [], G: number[] = [], I: number[] = [];
  const WHITE: [number, number, number, number] = kuv(700, 700, 900, 900);
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3, col: string, uv: [number, number, number, number] = WHITE, glow = 0) => {
    const base = P.length / 3, cc = new Color(col);
    const uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    // the ceiling light falls off towards the floor
    [a, b, c, d].forEach((p, k) => {
      const f = glow > 0 ? 1 : 0.7 + 0.3 * smooth(0, 2.3, p.y);
      P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); C.push(cc.r * f, cc.g * f, cc.b * f); U.push(uvs[k][0], uvs[k][1]); G.push(glow);
    });
    const front = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).dot(n) > 0;
    I.push(...(front ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  };
  /** wall-aligned rectangle on the plane z (facing +z) */
  const zr = (x0: number, y0: number, x1: number, y1: number, z: number, col: string, uv?: [number, number, number, number], glow = 0) =>
    quad(V(x0, y0, z), V(x1, y0, z), V(x1, y1, z), V(x0, y1, z), V(0, 0, 1), col, uv, glow);
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1b: number, col: string, glow = 0) => {
    zr(x0, y0, x1, y1, z1b, col, undefined, glow);
    quad(V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1b), V(x0, y1, z1b), V(0, 1, 0), col, undefined, glow);
    quad(V(x0, y0, z1b), V(x0, y0, z0), V(x0, y1, z0), V(x0, y1, z1b), V(-1, 0, 0), col, undefined, glow);
    quad(V(x1, y0, z0), V(x1, y0, z1b), V(x1, y1, z1b), V(x1, y1, z0), V(1, 0, 0), col, undefined, glow);
    quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), V(0, 0, -1), col, undefined, glow);
  };
  const wall = '#f1e3c8', fridgeX = X1 - 1.3;
  // shell: back wall (plain bands around the shelves and the menu), side walls, ceiling with a light strip, floor
  zr(X0, 0, X1, 0.88, Zb, wall);
  zr(X0, 0.88, fridgeX, 1.6, Zb, wall, kuv(0, 0, 1024, 256));
  zr(X0, 1.6, fridgeX, 1.66, Zb, wall);
  zr(X0 + 0.25, 1.66, fridgeX - 0.15, 2.06, Zb, wall, kuv(0, 256, 1024, 384), 0.9);
  zr(X0, 1.66, X0 + 0.25, 2.06, Zb, wall); zr(fridgeX - 0.15, 1.66, X1, 2.06, Zb, wall);
  zr(X0, 2.06, X1, Yc, Zb, wall);
  quad(V(X0, 0, z1), V(X0, 0, Zb), V(X0, Yc, Zb), V(X0, Yc, z1), V(1, 0, 0), '#ead9bb');
  quad(V(X1, 0, Zb), V(X1, 0, z1), V(X1, Yc, z1), V(X1, Yc, Zb), V(-1, 0, 0), '#ead9bb');
  quad(V(X0, Yc, Zb), V(X1, Yc, Zb), V(X1, Yc, z1), V(X0, Yc, z1), V(0, -1, 0), '#f6efe2');
  quad(V(X0 + 0.4, Yc - 0.01, Zb + 0.35), V(X1 - 0.4, Yc - 0.01, Zb + 0.35), V(X1 - 0.4, Yc - 0.01, Zb + 0.5), V(X0 + 0.4, Yc - 0.01, Zb + 0.5), V(0, -1, 0), '#fff6e2', undefined, 3.0);
  quad(V(X0, 0.01, z1), V(X1, 0.01, z1), V(X1, 0.01, Zb), V(X0, 0.01, Zb), V(0, 1, 0), '#8a7d70');
  // shelf boards in front of the painted shelves (their edges line up with the painted board lines)
  for (const y of [1.36, 1.12, 0.88]) box(X0, y - 0.03, Zb, fridgeX, y, Zb + 0.2, '#fbf6ec');
  // drinks fridge: white cabinet, lit glass door
  box(fridgeX, 0, Zb + 0.02, X1 - 0.05, 2.08, Zb + 0.7, '#eef2f4');
  zr(fridgeX + 0.08, 0.14, X1 - 0.13, 1.98, Zb + 0.705, '#ffffff', kuv(0, 384, 384, 1024), 1.8);
  // inner counter (steel) behind the outer one, a till, a sweet jar, a napkin box, a cup stack
  box(X0, 0, z1 - 0.52, X1, 0.86, z1 - 0.04, '#d8dde1');
  box(X0, 0.86, z1 - 0.52, X1, 0.9, z1 - 0.02, '#c3cad0');
  box(win.x0 + 0.35, 0.9, z1 - 0.4, win.x0 + 0.75, 1.08, z1 - 0.12, '#3b4a57');
  box(win.x0 + 0.42, 1.08, z1 - 0.36, win.x0 + 0.68, 1.2, z1 - 0.3, '#2a9d8f', 0.6);
  {
    const jx = win.x1 - 1.1, jz = z1 - 0.25;
    const jar = new CylinderGeometry(0.1, 0.1, 0.24, 10).translate(jx, 1.02, jz), jp = jar.getAttribute('position'), jn = jar.getAttribute('normal'), ji = jar.index!.array;
    const base = P.length / 3, jc = new Color('#cfe3ea');
    for (let i = 0; i < jp.count; i++) { P.push(jp.getX(i), jp.getY(i), jp.getZ(i)); N.push(jn.getX(i), jn.getY(i), jn.getZ(i)); C.push(jc.r, jc.g, jc.b); U.push(WHITE[0], WHITE[1]); G.push(0.3); }
    for (let i = 0; i < ji.length; i++) I.push(base + ji[i]);
    for (let k = 0; k < 9; k++) { const a = k * 2.3, r = 0.05; box(jx + Math.cos(a) * r - 0.02, 0.94 + (k % 3) * 0.06, jz + Math.sin(a) * r - 0.02, jx + Math.cos(a) * r + 0.02, 0.98 + (k % 3) * 0.06, jz + Math.sin(a) * r + 0.02, ['#e8463a', '#ffd23f', '#ff70a6', '#8ac926'][k % 4], 0.5); }
  }
  box(win.x1 - 0.55, 0.9, z1 - 0.3, win.x1 - 0.38, 1.04, z1 - 0.18, '#fbf8f2');
  for (let k = 0; k < 4; k++) box(win.x0 + 1.3 + k * 0.02, 0.9 + k * 0.07, z1 - 0.3, win.x0 + 1.42 - k * 0.02, 0.97 + k * 0.07, z1 - 0.2, k % 2 ? '#f4efe6' : '#e05a47');
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new Float32BufferAttribute(N, 3));
  g.setAttribute('color', new Float32BufferAttribute(C, 3));
  g.setAttribute('uv', new Float32BufferAttribute(U, 2));
  g.setAttribute('glow', new Float32BufferAttribute(G, 1));
  g.setIndex(I);
  g.computeBoundingSphere();
  const mat = toonMaterial({ vertexColors: true, map: kioskAtlas(), emissive: 0xffd6a0, emissiveIntensity: 0.6, bands: 0.2, wrap: 0.5, rim: 0, lamps: false, name: 'kioskShop' });
  patch(mat, 'kioskShop', (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float glow; varying float vGlow;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      vGlow = glow;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vGlow;`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= diffuseColor.rgb * (1.0 + vGlow);`);
  });
  const mesh = new Mesh(g, mat);
  mesh.name = 'kioskShop';
  mesh.receiveShadow = true;
  return { mesh, mat };
}

// ------------------------------------------------------------------ palms: ringed matte trunks, arching feathered fronds with independent tips, dead-frond skirts
function buildPalms() {
  const spots: { x: number; y: number; z: number; h: number; skirt: boolean }[] = [];
  for (let x = -62; x <= 62; x += 10.5) if (Math.abs(x) > 4) { const px = x + (R() - 0.5) * 2, pz = -29.6 - R() * 1.5; spots.push({ x: px, y: terrainHeight(px, pz) - 0.1, z: pz, h: 8 + R() * 3, skirt: R() < 0.5 }); }
  for (const [x, y, z, h] of EDGE_PALMS) spots.push({ x, y, z, h, skirt: R() < 0.45 });
  for (const [x, z] of [[-50, -34], [48, -33], [-70, -46], [70, -45], [-16, 40], [40, 40], [-88, -32], [90, -30], [6, -45], [-22, -40], [-6, 56], [22, 58], [-40, 55], [60, 57], [-72, 58], [82, 52]])
    spots.push({ x, y: terrainHeight(x, z) - 0.1, z, h: 7.5 + R() * 3.5, skirt: R() < 0.5 });

  const tP: number[] = [], tN: number[] = [], tC: number[] = [], tU: number[] = [], tW: number[] = [], tI: number[] = [];
  const fronds: BufferGeometry[] = [];
  const bark1 = new Color('#a88a6a'), bark2 = new Color('#8e7356'), boot = new Color('#5e4a35');
  spots.forEach((sp, si) => {
    const { x: px, y: py, z: pz, h: hgt } = sp;
    const lean = V(R() - 0.5, 0, R() - 0.5).normalize().multiplyScalar(0.5 + R() * 1.3);
    const ph = R() * 6.28;
    const segs = Math.ceil(hgt / 0.45), radial = 9;
    const base = tP.length / 3;
    const pt = (t: number) => V(px + lean.x * t * t + Math.sin(t * 3 + ph) * 0.07, py + hgt * t, pz + lean.z * t * t + Math.cos(t * 2.6 + ph) * 0.07);
    const rad = (t: number) => 0.2 * (1 - 0.28 * t) + 0.13 * Math.exp(-t * 14) + Math.max(0, t - 0.93) * 1.1;
    const tint = 0.9 + R() * 0.2;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, c = pt(t), r = rad(t);
      const cc = bark1.clone().lerp(bark2, h2(si, i * 0.37)).multiplyScalar(tint);
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        tP.push(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
        tN.push(Math.cos(a), 0.08, Math.sin(a));
        tC.push(cc.r, cc.g, cc.b);
        tU.push((k / radial) * 2, (hgt * t) / 0.2);
        tW.push(ph, t, 0);
      }
    }
    for (let i = 0; i < segs; i++) for (let k = 0; k < radial; k++) {
      const a = base + i * (radial + 1) + k, b = a + 1, c = a + radial + 1, d = c + 1;
      tI.push(a, c, b, b, c, d);
    }
    const top = pt(1);
    // fibrous crown boot (frond bases)
    {
      const bb = base + (segs + 1) * (radial + 1);
      const ring = (y: number, r: number) => { for (let k = 0; k <= radial; k++) { const a = (k / radial) * Math.PI * 2; tP.push(top.x + Math.cos(a) * r, y, top.z + Math.sin(a) * r); tN.push(Math.cos(a), 0.3, Math.sin(a)); tC.push(boot.r, boot.g, boot.b); tU.push((k / radial) * 2, y / 0.2); tW.push(ph, 1, 0); } };
      ring(top.y - 0.55, 0.24); ring(top.y - 0.1, 0.36); ring(top.y + 0.2, 0.12);
      for (let i = 0; i < 2; i++) for (let k = 0; k < radial; k++) { const a = bb + i * (radial + 1) + k, b = a + 1, c = a + radial + 1, d = c + 1; tI.push(a, c, b, b, c, d); }
    }
    const sc = hgt / 9.2;
    const tone = [new Color('#4f8a3c'), new Color('#7cb24f'), new Color('#bcd06a')].map((c) => c.multiplyScalar(0.92 + R() * 0.16));
    const nF = 15 + Math.floor(R() * 4);
    for (let f = 0; f < nF; f++) {
      const az = f * 2.39996 + R() * 0.25;
      const lvl = f / nF;
      const alpha = 0.95 - lvl * 1.15 + (R() - 0.5) * 0.2;
      const len = (3.0 + R() * 1.2) * sc * (0.85 + 0.25 * (1 - Math.abs(lvl - 0.45)));
      const g = frondGeo(len, alpha, 0.95 + R() * 0.55, 0.62 * sc * (0.9 + R() * 0.2), (R() - 0.5) * 1.2, 0.45, ph, R() * 6.28, tone, false);
      g.applyMatrix4(new Matrix4().compose(top.clone().setY(top.y + 0.05), QY(az), V(1, 1, 1)));
      fronds.push(g);
    }
    if (sp.skirt) {
      const nD = 5 + Math.floor(R() * 4);
      const dead = [new Color('#7a5d3e'), new Color('#9c7f58'), new Color('#b59a72')];
      for (let f = 0; f < nD; f++) {
        const az = (f / nD) * Math.PI * 2 + R() * 0.5;
        const g = frondGeo((2.0 + R() * 0.9) * sc, -1.3 + (R() - 0.5) * 0.3, 0.15, 0.42 * sc, (R() - 0.5) * 0.6, 0.85, ph, R() * 6.28, dead, true);
        g.applyMatrix4(new Matrix4().compose(top.clone().setY(top.y - 0.3), QY(az), V(1, 1, 1)));
        fronds.push(g);
      }
    }
    if (R() < 0.6) for (let k = 0; k < 3; k++) {
      const s = new SphereGeometry(0.12 * sc + 0.04, 7, 5);
      s.translate(top.x + Math.cos(k * 2.1) * 0.24, top.y - 0.22, top.z + Math.sin(k * 2.1) * 0.24);
      const n = s.getAttribute('position').count;
      s.setAttribute('color', new Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [0.36, 0.28, 0.17]), 3));
      s.setAttribute('uv', new Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [0.5, 0.01]), 2));
      s.setAttribute('windData', new Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [ph, 1, 0]), 3));
      s.setAttribute('frondData', new Float32BufferAttribute(new Array(n * 3).fill(0), 3));
      fronds.push(s);
    }
  });
  const tg = new BufferGeometry();
  tg.setAttribute('position', new Float32BufferAttribute(tP, 3));
  tg.setAttribute('normal', new Float32BufferAttribute(tN, 3));
  tg.setAttribute('color', new Float32BufferAttribute(tC, 3));
  tg.setAttribute('uv', new Float32BufferAttribute(tU, 2));
  tg.setAttribute('windData', new Float32BufferAttribute(tW, 3));
  tg.setIndex(tI);
  tg.computeVertexNormals();
  const group = new Group();
  const trunk = new Mesh(tg, toonMaterial({ vertexColors: true, map: trunkTexture(), wind: true, bands: 0.4, wrap: 0.5, rim: 0.22, name: 'palmTrunk' }));
  trunk.castShadow = true; trunk.receiveShadow = true;
  group.add(trunk);
  const fg = mergeGeometries(fronds);
  const tex = frondTexture();
  const fm = toonMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, side: DoubleSide, wind: true, bands: 0.45, wrap: 0.6, rim: 0.45, name: 'palmFronds' });
  fm.alphaToCoverage = true;
  patch(fm, 'frondA2C', (sh) => {
    sh.uniforms.uMapSize = { value: new Vector2(tex.image.width, tex.image.height) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 frondData;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        // each frond bobs and its leaflet tips flutter on their own phase
        float tw = frondData.y;
        float gust = 0.6 + 0.4 * sin(uTime * 0.37 + frondData.x * 0.5);
        float bob = sin(uTime * 2.3 + frondData.x) * 0.5 + sin(uTime * 3.7 + frondData.x * 1.7) * 0.25;
        transformed.y += bob * tw * tw * 0.17 * gust * uWind;
        float fl = sin(uTime * 7.3 + frondData.x * 2.3 + position.y * 3.0 + position.x * 1.3) * frondData.z * tw;
        transformed.y += fl * 0.035 * uWind;
        transformed.x += fl * 0.02 * uWind;
        transformed.z -= fl * 0.02 * uWind;
      }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec2 uMapSize;`).replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
      {
        // keep leaflet coverage in the small mips so far crowns stay solid
        vec2 duv = vMapUv * uMapSize;
        vec2 ddx = dFdx(duv), ddy = dFdy(duv);
        float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        diffuseColor.a *= 1.0 + lod * 0.32;
      }
      #endif`);
  });
  const frondMesh = new Mesh(fg, fm);
  frondMesh.castShadow = true; frondMesh.receiveShadow = true;
  group.add(frondMesh);
  return group;
}

/** one frond: arching rachis with drooping, feathered blade (V-folded), twisting towards the tip */
function frondGeo(len: number, alpha: number, droop: number, width: number, twist: number, fold: number, ph: number, fph: number, tone: Color[], dead: boolean) {
  const nu = 16;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], wind: number[] = [], fd: number[] = [], idx: number[] = [];
  let p = V(0, 0, 0), th = alpha;
  for (let i = 0; i <= nu; i++) {
    const t = i / nu;
    if (i > 0) {
      th = alpha - (alpha + droop) * Math.pow(t, 1.6);
      p = p.clone().add(V(Math.cos(th), Math.sin(th), 0).multiplyScalar(len / nu));
    }
    const T = V(Math.cos(th), Math.sin(th), 0);
    const side0 = V(0, 0, 1);
    const tw = twist * t * t;
    const side = side0.clone().applyAxisAngle(T, tw);
    const down = new Vector3().crossVectors(T, side).normalize();
    if (down.y > 0) down.negate();
    const w = width * (0.22 + 0.78 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08 + 0.04)), 0.8)) * (1 - 0.35 * t);
    const fl = fold * (dead ? 1 : 0.7 + 0.6 * t);
    const L = p.clone().addScaledVector(side, w * Math.cos(fl)).addScaledVector(down, w * Math.sin(fl));
    const Rr = p.clone().addScaledVector(side, -w * Math.cos(fl)).addScaledVector(down, w * Math.sin(fl));
    const cBase = tone[0].clone().lerp(tone[1], Math.min(1, t * 1.6)).lerp(tone[2], Math.max(0, t - 0.55) * 0.9);
    const rows: [Vector3, number, number][] = [[L, 0, 1], [p, 0.5, 0], [Rr, 1, 1]];
    for (const [q, u, edge] of rows) {
      pos.push(q.x, q.y, q.z);
      uv.push(u, t);
      const c = edge ? cBase.clone().multiplyScalar(1.06) : cBase.clone().multiplyScalar(0.86);
      col.push(c.r, c.g, c.b);
      wind.push(ph, 1, Math.pow(t, 1.3) * (edge ? 1 : 0.5) * (dead ? 0.3 : 1));
      fd.push(fph, t, edge ? 1 : 0.35);
    }
  }
  for (let i = 0; i < nu; i++) {
    const a = i * 3;
    idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('windData', new Float32BufferAttribute(wind, 3));
  g.setAttribute('frondData', new Float32BufferAttribute(fd, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.getAttribute('normal') as BufferAttribute;
  for (let i = 0; i < n.count; i++) { n.setY(i, Math.abs(n.getY(i)) * 0.6 + 0.4); }
  return g;
}

function frondTexture() {
  const W = 256, Hh = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, W, Hh);
  const rnd = rng(99);
  const N = 62;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const y = Hh * (1 - t);
    const L = 0.96 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.06 + 0.06)), 0.65) * (W / 2 - 4);
    for (const s of [-1, 1]) {
      if (rnd() < 0.04) continue;
      const l = L * (0.82 + rnd() * 0.22), fwd = l * (0.5 + rnd() * 0.15), wb = 4.2 + 3 * (1 - t);
      const sx = W / 2, ex = W / 2 + s * l, ey = y - fwd;
      const g = Math.round(222 + rnd() * 33);
      x.fillStyle = `rgb(${g},${g},${g})`;
      x.beginPath();
      x.moveTo(sx, y - wb);
      x.quadraticCurveTo(sx + s * l * 0.55, y - wb - fwd * 0.25 + l * 0.08, ex, ey);
      x.quadraticCurveTo(sx + s * l * 0.5, y + wb - fwd * 0.3 + l * 0.12, sx, y + wb);
      x.closePath();
      x.fill();
      x.strokeStyle = 'rgba(170,170,170,0.8)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(sx, y); x.quadraticCurveTo(sx + s * l * 0.52, y - fwd * 0.27 + l * 0.1, ex, ey); x.stroke();
    }
  }
  // rachis
  x.fillStyle = 'rgb(206,206,200)';
  x.beginPath(); x.moveTo(W / 2 - 7, Hh); x.lineTo(W / 2 + 7, Hh); x.lineTo(W / 2 + 1.5, 0); x.lineTo(W / 2 - 1.5, 0); x.closePath(); x.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function trunkTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d')!;
  const rnd = rng(17);
  x.fillStyle = 'rgb(214,198,176)'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 140; i++) { const g = 150 + rnd() * 90; x.fillStyle = `rgba(${g},${g * 0.92},${g * 0.82},0.35)`; x.fillRect(rnd() * 64, rnd() * 64, 1 + rnd() * 2, 4 + rnd() * 18); }
  const gr = x.createLinearGradient(0, 0, 0, 14);
  gr.addColorStop(0, 'rgba(70,55,42,0.95)'); gr.addColorStop(0.45, 'rgba(105,86,66,0.6)'); gr.addColorStop(1, 'rgba(150,130,105,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 14);
  x.fillStyle = 'rgba(240,228,210,0.5)'; x.fillRect(0, 14, 64, 2);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ seagulls: slim bodies, angled wings with black tips, flap + glide (one dynamic mesh)
function buildGulls() {
  type TV = { p: Vector3; n: Vector3; c: Color; part: number; side: number };
  const T: TV[] = [];
  const tri: number[] = [];
  const add = (p: Vector3, n: Vector3, c: Color, part = 0, side = 0) => { T.push({ p, n: n.clone().normalize(), c, part, side }); return T.length - 1; };
  const white = new Color('#f4f2ee'), grey = new Color('#a9b3bf'), backG = new Color('#c8d0d9'), black = new Color('#1d2024'), beak = new Color('#e9b949'), under = new Color('#e8e9ea');
  // body: spindle along +z
  const zs = [-0.25, -0.18, -0.08, 0.02, 0.1, 0.16, 0.2, 0.235], rs = [0.012, 0.03, 0.048, 0.054, 0.047, 0.038, 0.04, 0.026], ys = [0.0, 0.0, 0.0, 0.0, 0.004, 0.012, 0.024, 0.03];
  const RS = 6;
  const rings: number[][] = [];
  zs.forEach((z, k) => {
    const ring: number[] = [];
    for (let j = 0; j < RS; j++) {
      const a = (j / RS) * Math.PI * 2;
      const ny = Math.sin(a);
      ring.push(add(V(Math.cos(a) * rs[k], ys[k] + ny * rs[k] * 0.85, z), V(Math.cos(a), ny, 0), ny > 0.5 && k > 1 && k < 6 ? backG : white));
    }
    rings.push(ring);
  });
  for (let k = 0; k < rings.length - 1; k++) for (let j = 0; j < RS; j++) {
    const a = rings[k][j], b = rings[k][(j + 1) % RS], c = rings[k + 1][j], d = rings[k + 1][(j + 1) % RS];
    tri.push(a, b, c, b, d, c);
  }
  const tail = add(V(0, 0, -0.27), V(0, 0, -1), white);
  for (let j = 0; j < RS; j++) tri.push(tail, rings[0][(j + 1) % RS], rings[0][j]);
  const tip = add(V(0, 0.026, 0.31), V(0, 0, 1), beak);
  const last = rings[rings.length - 1];
  const bk = last.map((i) => add(T[i].p.clone(), T[i].n, beak));
  for (let j = 0; j < RS; j++) tri.push(bk[j], bk[(j + 1) % RS], tip);
  // tail fan
  for (const [yo, ny, c] of [[0.004, 1, white], [-0.004, -1, under]] as [number, number, Color][]) {
    const q = [add(V(-0.025, yo, -0.2), V(0, ny, 0), c), add(V(0.025, yo, -0.2), V(0, ny, 0), c), add(V(0.055, yo, -0.35), V(0, ny, 0), c), add(V(-0.055, yo, -0.35), V(0, ny, 0), c)];
    tri.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  }
  // wings: inner panel (shoulder -> wrist) + outer panel (wrist -> tip, black tips), top + bottom layers
  for (const s of [-1, 1]) {
    const LEr = V(s * 0.035, 0.03, 0.085), LEw = V(s * 0.34, 0.035, 0.07), TEw = V(s * 0.34, 0.025, -0.05), TEr = V(s * 0.035, 0.02, -0.1);
    const LEm = V(s * 0.5, 0.035, 0.035), TEm = V(s * 0.48, 0.025, -0.07), TIP = V(s * 0.68, 0.03, -0.085);
    for (const [yo, ny, cIn, cTip] of [[0.003, 1, grey, black], [-0.003, -1, under, new Color('#3a3d42')]] as [number, number, Color, Color][]) {
      const o = V(0, yo, 0), n = V(0, ny, 0);
      const a = add(LEr.clone().add(o), n, cIn, 1, s), b = add(LEw.clone().add(o), n, cIn, 1, s), c = add(TEw.clone().add(o), n, cIn, 1, s), d = add(TEr.clone().add(o), n, cIn, 1, s);
      tri.push(a, b, c, a, c, d);
      const e = add(LEw.clone().add(o), n, cIn, 1, s), f = add(TEw.clone().add(o), n, cIn, 1, s), g = add(LEm.clone().add(o), n, cIn, 2, s), hh = add(TEm.clone().add(o), n, cIn, 2, s);
      tri.push(e, g, hh, e, hh, f);
      const i2 = add(LEm.clone().add(o), n, cTip, 2, s), j2 = add(TEm.clone().add(o), n, cTip, 2, s), k2 = add(TIP.clone().add(o), n, cTip, 2, s);
      tri.push(i2, k2, j2);
    }
  }
  // orient every triangle along its vertex normals
  for (let t = 0; t < tri.length; t += 3) {
    const A = T[tri[t]], B = T[tri[t + 1]], C = T[tri[t + 2]];
    const fn = B.p.clone().sub(A.p).cross(C.p.clone().sub(A.p));
    if (fn.dot(A.n.clone().add(B.n).add(C.n)) < 0) { const tmp = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = tmp; }
  }
  const NG = 9, nv = T.length;
  const pos = new Float32Array(nv * NG * 3), nor = new Float32Array(nv * NG * 3), col = new Float32Array(nv * NG * 3);
  const index: number[] = [];
  for (let g = 0; g < NG; g++) {
    for (let i = 0; i < nv; i++) { col[(g * nv + i) * 3] = T[i].c.r; col[(g * nv + i) * 3 + 1] = T[i].c.g; col[(g * nv + i) * 3 + 2] = T[i].c.b; }
    for (const i of tri) index.push(g * nv + i);
  }
  const geo = new BufferGeometry();
  const pa = new BufferAttribute(pos, 3); pa.setUsage(DynamicDrawUsage);
  const na = new BufferAttribute(nor, 3); na.setUsage(DynamicDrawUsage);
  geo.setAttribute('position', pa); geo.setAttribute('normal', na); geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(index);
  const mesh = new Mesh(geo, toonMaterial({ vertexColors: true, bands: 0.35, wrap: 0.5, rim: 0.6, name: 'gulls' }));
  mesh.frustumCulled = false;
  const birds = Array.from({ length: NG }, () => ({
    c: V(-40 + R() * 80, 0, -46 - R() * 34), r: 14 + R() * 26, h: 10 + R() * 14, ph: R() * 6.28, sp: (0.13 + R() * 0.12) * (R() < 0.5 ? 1 : -1),
    period: 6 + R() * 5, frac: 0.3 + R() * 0.2, fp: R() * 10, wf: 16 + R() * 3,
  }));
  const m = new Matrix4(), e = new Euler(0, 0, 0, 'YXZ'), q = new Quaternion(), sc = V(1.15, 1.15, 1.15);
  const pv = new Vector3(), nvv = new Vector3();
  const rotZ = (v: Vector3, ax: number, ay: number, ang: number) => {
    const cs = Math.cos(ang), sn = Math.sin(ang), x = v.x - ax, y = v.y - ay;
    v.x = ax + x * cs - y * sn; v.y = ay + x * sn + y * cs;
  };
  const rotZn = (v: Vector3, ang: number) => { const cs = Math.cos(ang), sn = Math.sin(ang), x = v.x, y = v.y; v.x = x * cs - y * sn; v.y = x * sn + y * cs; };
  return {
    mesh,
    update(t: number) {
      birds.forEach((b, gi) => {
        const a = b.ph + t * b.sp;
        const px = b.c.x + Math.cos(a) * b.r, pz = b.c.z + Math.sin(a) * b.r * 0.6;
        const vx = -Math.sin(a) * b.r * b.sp, vz = Math.cos(a) * b.r * 0.6 * b.sp;
        const yaw = Math.atan2(vx, vz);
        // flap bursts, then long glides with the classic bent "gull wing"
        const cyc = ((t + b.fp) % b.period) / b.period;
        const flap = smooth(0, 0.05, cyc) * (1 - smooth(b.frac - 0.06, b.frac, cyc));
        const w = t * b.wf;
        const sh = (0.12 + 0.55 * Math.sin(w)) * flap + 0.17 * (1 - flap);
        const wr = (0.1 + 0.38 * Math.sin(w - 0.9)) * flap - 0.26 * (1 - flap);
        const toC = V(b.c.x - px, 0, b.c.z - pz);
        const leftV = V(Math.cos(yaw), 0, -Math.sin(yaw));
        const roll = -0.32 * Math.sign(toC.dot(leftV));
        const py = b.h + Math.sin(t * 0.5 + b.ph) * 1.5 - 0.05 * Math.sin(w) * flap;
        e.set(-0.06 + 0.05 * flap, yaw, roll);
        q.setFromEuler(e);
        m.compose(V(px, py, pz), q, sc);
        const base = gi * nv;
        for (let i = 0; i < nv; i++) {
          const tv = T[i];
          pv.copy(tv.p); nvv.copy(tv.n);
          if (tv.part >= 1) {
            const s = tv.side;
            if (tv.part === 2) { rotZ(pv, s * 0.34, 0.03, s * wr); rotZn(nvv, s * wr); }
            rotZ(pv, s * 0.035, 0.025, s * sh); rotZn(nvv, s * sh);
          }
          pv.applyMatrix4(m);
          nvv.applyQuaternion(q);
          pos[(base + i) * 3] = pv.x; pos[(base + i) * 3 + 1] = pv.y; pos[(base + i) * 3 + 2] = pv.z;
          nor[(base + i) * 3] = nvv.x; nor[(base + i) * 3 + 1] = nvv.y; nor[(base + i) * 3 + 2] = nvv.z;
        }
      });
      pa.needsUpdate = true; na.needsUpdate = true;
    },
  };
}
