import {
  AnimationAction, AnimationClip, AnimationMixer, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, Group, LOD,
  Mesh, MeshLambertMaterial, Object3D, SkinnedMesh, Sphere, SRGBColorSpace, Texture, Vector3,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/materials';

/** Part colours of our skater pipeline (tools/character parts, sRGB) used to recognise each part in people.glb. */
const PARTS: Record<string, string> = {
  skin: '#e9b48f', hair: '#4a2e1c', cap: '#e5b03b', tee: '#2f8f86', cream: '#f1e6cc', shorts: '#d2bd8e', shortscuff: '#c4ad7c',
  socks: '#f6f3ec', stripes: '#d2463a', shoes: '#2d4a86', soles: '#f0e6cf', laces: '#fbfaf5',
};
type Look = { tee: string; trim: string; shorts: string; cap: string; hair: string; skin: string; socks: string; stripes: string; shoes: string; soles: string };

const SKIN = ['#f3cfb1', '#e6b08c', '#cf9670', '#b07650', '#8d5b3c', '#6a4330'];
const HAIR = ['#1e1612', '#3b2618', '#6b4a2b', '#a87c46', '#dcb36c', '#2a2a2c', '#8a3b22'];
const TEES = ['#e8463a', '#2a9d8f', '#f4a261', '#3a86ff', '#fbf8f2', '#22262e', '#ffd23f', '#8ac926', '#ff70a6', '#6a4c93', '#e9e2d0', '#1f6f8b'];
const SHORTS = ['#2b3a55', '#c8b28a', '#4a4e54', '#6b8f71', '#1f1f24', '#b34d3c', '#d9d3c7', '#3d5a80'];
const SHOES = ['#232323', '#f2f2f2', '#c0392b', '#2d4a86', '#8b6b4a', '#e9c46a'];

interface Spot {
  clip: string;
  /** root position (standing / walking) or the seat point the hips are anchored to */
  at: [number, number, number];
  heading: number; // degrees, forward = (sin, 0, cos)
  sit?: 'seat' | 'floor';
  /** `at[1]` is relative to the ground under the spot (beach) */
  rel?: boolean;
  path?: [number, number][];
  y?: number; // fixed ground height for a path (else terrain)
  speed?: number;
  board?: { kind: 'lean' | 'flat'; at: [number, number, number]; yaw: number };
  look?: Partial<Look>;
  scale?: number;
  phone?: boolean;
}

/** Where people are: skaters waiting on decks, friends on the seat steps, walkers, a couple on the beach, the lifeguard. */
export const PEOPLE_SPOTS: Spot[] = [
  { clip: 'stand_idle', at: [30.75, 3.0, -10.6], heading: -90, board: { kind: 'lean', at: [31.18, 3.0, -10.05], yaw: Math.PI / 2 }, look: { cap: '#22262e' } },
  { clip: 'stand_idle', at: [-11.0, 1.2, -21.15], heading: 0, board: { kind: 'flat', at: [-10.45, 1.2, -21.2], yaw: 0 }, scale: 0.96 },
  { clip: 'sit_idle', at: [-38.25, 0.45, 9.1], heading: 90, sit: 'seat', board: { kind: 'flat', at: [-38.25, 0.45, 8.25], yaw: 0 } },
  { clip: 'sit_laugh', at: [-38.25, 0.45, 10.05], heading: 90, sit: 'seat', scale: 0.97 },
  { clip: 'clap_sit', at: [-23.0, 0.45, 25.35], heading: 180, sit: 'seat' },
  { clip: 'stand_phone', at: [36.4, 0, 23.0], heading: -140, phone: true },
  { clip: 'wave', at: [-44.5, 0, -24.8], heading: 90 },
  { clip: 'walk', at: [41.5, 0, -24.4], heading: 90, path: [[41.5, -24.4], [67, -24.4]], y: 0, speed: 1.25 },
  { clip: 'walk', at: [-67, 0, -25.9], heading: 90, path: [[-67, -25.9], [-41.8, -25.9]], y: 0, speed: 1.12, scale: 0.94 },
  { clip: 'walk', at: [-34, 0, -64], heading: 90, path: [[-34, -64], [34, -66.5]], speed: 1.05 },
  { clip: 'walk', at: [-34, 0, 33], heading: 90, path: [[-34, 33.2], [34, 32.6]], speed: 1.2, scale: 1.03 },
  { clip: 'recline', at: [-28.47, 0.03, -46.97], heading: 197, sit: 'floor', rel: true, look: { tee: '#ff70a6', shorts: '#1f6f8b' } },
  { clip: 'sit_laugh', at: [-30.4, 0.38, -47.1], heading: 180, sit: 'seat', rel: true, look: { tee: '#fbf8f2', shorts: '#e8463a' } },
  { clip: 'sit_idle', at: [-8.0, 3.15, -53.35], heading: 180, sit: 'seat', rel: true, look: { tee: '#e8463a', shorts: '#e8463a', cap: '#ffd23f', socks: '#e6b08c' } },
  // the snack kiosk's vendor behind the service window (town side)
  { clip: 'stand_idle', at: [24.25, 0, 28.7], heading: 0, look: { tee: '#fbf8f2', trim: '#e8463a', cap: '#e8463a', shorts: '#2b3a55' } },
];

const lin = (h: string) => new Color(h);

function boardProp(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const paint = (g: BufferGeometry, hexc: string) => {
    const gg = g.index ? g.toNonIndexed() : g;
    if (gg.getAttribute('uv')) gg.deleteAttribute('uv');
    const c = lin(hexc), n = gg.getAttribute('position').count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    gg.setAttribute('color', new BufferAttribute(a, 3));
    parts.push(gg);
  };
  // deck along +Z, wheels on the ground (y = 0)
  paint(new BoxGeometry(0.205, 0.014, 0.62).translate(0, 0.098, 0), '#2b2b2b');
  for (const s of [-1, 1]) {
    paint(new CylinderGeometry(0.1025, 0.1025, 0.014, 14, 1, false, 0, Math.PI).rotateY(s > 0 ? 0 : Math.PI).translate(0, 0.098, s * 0.31), '#2b2b2b');
    paint(new BoxGeometry(0.16, 0.035, 0.05).translate(0, 0.072, s * 0.21), '#b8bec6');
    for (const x of [-0.085, 0.085]) paint(new CylinderGeometry(0.027, 0.027, 0.032, 10).rotateZ(Math.PI / 2).translate(x, 0.027, s * 0.21), '#f1e7cf');
  }
  paint(new BoxGeometry(0.19, 0.004, 0.6).translate(0, 0.091, 0), '#d9573f');
  return mergeGeometries(parts);
}

/**
 * Distance levels of a person: switch distance (m), share of body triangles kept, max relative error, share of face
 * triangles kept (simplified with its UVs so the painted features stay in place), merge the face into the one
 * vertex-coloured draw (only once a face is a few pixels tall). Errors stay under a pixel at each switch distance (1080p).
 */
const LODS: { d: number; keep: number; err: number; face: number; merge: boolean }[] = [
  { d: 0, keep: 1, err: 0, face: 1, merge: false },
  { d: 9, keep: 0.14, err: 0.02, face: 0.4, merge: false },
  { d: 22, keep: 0.05, err: 0.05, face: 0.14, merge: false },
  { d: 45, keep: 0.025, err: 0.1, face: 0.025, merge: true },
];

/**
 * The painted face with its features drawn bolder: every dark feature (brows, lash lines, irises, mouth) is found as a
 * connected region well below the skin tone and grown and deepened, thin ones more than round ones, so a face a few
 * dozen pixels tall still shows eyes, brows and a mouth. Freckles and specks are too small to count. Works from the
 * texture alone (any face painted in the same style keeps working).
 */
function crowdFace(src: Texture): Texture | null {
  const img = src.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width) return null;
  const W = img.width, H = img.height, n = W * H;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, W, H), d = id.data;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i += 5) hist[Math.min(255, L[i] | 0)]++;
  let skinL = 1;
  for (let v = 1; v < 256; v++) if (hist[v] > hist[skinL]) skinL = v;
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) dark[i] = L[i] < skinL * 0.6 ? 1 : 0;
  const lab = new Int32Array(n).fill(-1);
  const comps: { grow: number; c: [number, number, number] }[] = [];
  const stack: number[] = [];
  const minArea = (W * H) / 9000;
  for (let i = 0; i < n; i++) {
    if (!dark[i] || lab[i] >= 0) continue;
    const k = comps.length;
    let cnt = 0, r = 0, g = 0, b = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    lab[i] = k; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p / W) | 0;
      cnt++; r += d[p * 4]; g += d[p * 4 + 1]; b += d[p * 4 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && dark[p - 1] && lab[p - 1] < 0) { lab[p - 1] = k; stack.push(p - 1); }
      if (x < W - 1 && dark[p + 1] && lab[p + 1] < 0) { lab[p + 1] = k; stack.push(p + 1); }
      if (y > 0 && dark[p - W] && lab[p - W] < 0) { lab[p - W] = k; stack.push(p - W); }
      if (y < H - 1 && dark[p + W] && lab[p + W] < 0) { lab[p + W] = k; stack.push(p + W); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, thin = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) > 3;
    comps.push({ grow: cnt < minArea ? 0 : (thin ? 6 : 2.5) * (W / 1024), c: [r / cnt * 0.82, g / cnt * 0.78, b / cnt * 0.78] });
  }
  // coverage of the grown features (max over the stamps), one colour per texel
  const cover = new Float32Array(n), owner = new Int32Array(n).fill(-1);
  for (let p = 0; p < n; p++) {
    const k = lab[p];
    if (k < 0 || !comps[k].grow) continue;
    const x = p % W, y = (p / W) | 0;
    const edge = x === 0 || x === W - 1 || y === 0 || y === H - 1 || lab[p - 1] !== k || lab[p + 1] !== k || lab[p - W] !== k || lab[p + W] !== k;
    cover[p] = 1; owner[p] = k;
    if (!edge) continue;
    const R = comps[k].grow, ri = Math.ceil(R + 1);
    for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const q = yy * W + xx, c = Math.min(1, Math.max(0, R + 0.5 - Math.hypot(dx, dy)));
      if (c > cover[q]) { cover[q] = c; owner[q] = k; }
    }
  }
  for (let p = 0; p < n; p++) {
    const k = owner[p];
    if (k < 0) continue;
    // the feature itself only deepens (iris, pupil and lash detail stay); eye whites and catchlights are never covered
    if (lab[p] === k) { for (let q = 0; q < 3; q++) d[p * 4 + q] *= 0.86; continue; }
    if (L[p] > skinL * 1.08) continue;
    const c = comps[k].c, a = cover[p] * 0.92;
    for (let q = 0; q < 3; q++) d[p * 4 + q] = d[p * 4 + q] * (1 - a) + c[q] * a;
  }
  cx.putImageData(id, 0, 0);
  const t = new CanvasTexture(cv);
  t.flipY = src.flipY;
  t.colorSpace = SRGBColorSpace;
  t.wrapS = src.wrapS; t.wrapT = src.wrapT;
  t.anisotropy = 8;
  t.name = 'crowdFace';
  return t;
}

/** one compact geometry from simplified index lists of several part meshes (same skin and bind space) */
function compactMerge(parts: [BufferGeometry, Uint32Array][]): BufferGeometry {
  const names = ['position', 'normal', 'color', 'skinIndex', 'skinWeight'];
  const remap = parts.map(([g]) => new Int32Array(g.getAttribute('position').count).fill(-1));
  let nv = 0;
  parts.forEach(([, ix], p) => { for (const v of ix) if (remap[p][v] < 0) remap[p][v] = nv++; });
  const out = new BufferGeometry();
  for (const name of names) {
    const size = parts[0][0].getAttribute(name).itemSize;
    const arr = name === 'skinIndex' ? new Uint16Array(nv * size) : new Float32Array(nv * size);
    parts.forEach(([g], p) => {
      const a = g.getAttribute(name), r = remap[p];
      for (let v = 0; v < r.length; v++) if (r[v] >= 0) for (let k = 0; k < size; k++) arr[r[v] * size + k] = a.getComponent(v, k);
    });
    out.setAttribute(name, new BufferAttribute(arr, size));
  }
  const index = new Uint16Array(parts.reduce((s, [, ix]) => s + ix.length, 0));
  let o = 0;
  parts.forEach(([, ix], p) => { for (const v of ix) index[o++] = remap[p][v]; });
  out.setIndex(new BufferAttribute(index, 1));
  return out;
}

/** bounds of the posed body (sampled), padded for the clip's motion; shared by every level of a person */
function poseSphere(sm: SkinnedMesh): Sphere {
  const p = sm.geometry.getAttribute('position'), v = new Vector3(), box = new Box3(), pts: Vector3[] = [];
  for (let i = 0; i < p.count; i += 5) { sm.getVertexPosition(i, v); box.expandByPoint(v); pts.push(v.clone()); }
  const s = new Sphere();
  box.getCenter(s.center);
  let r2 = 0;
  for (const q of pts) r2 = Math.max(r2, s.center.distanceToSquared(q));
  s.radius = Math.sqrt(r2) * 1.1 + 0.08;
  return s;
}

interface Person { holder: Group; mixer: AnimationMixer; spot: Spot; s: number; dir: 1 | -1; turn: number; len: number; cum: number[] }

/** Small, simple, gently moving people: clones of our own rig (people.glb), recoloured per instance. */
export class People {
  group = new Group();
  private items: Person[] = [];
  private acc = 0;
  private refs: Color[] = [];
  private refNames: string[] = [];
  private faceMap: Texture | null = null;

  constructor(private ground: (x: number, z: number) => number) { this.group.name = 'people'; }

  async load(url: string, loader: { loadAsync(u: string): Promise<GLTF> }) {
    let gltf: GLTF;
    try { gltf = await loader.loadAsync(url); } catch { return false; }
    if (!gltf.animations?.length) return false;
    this.analyse(gltf.scene);
    gltf.scene.traverse((o) => {
      const map = ((o as SkinnedMesh).material as MeshLambertMaterial | undefined)?.map;
      if (map && !this.faceMap) {
        try { this.faceMap = crowdFace(map); } catch (e) { console.warn('people: crowd face skipped', e); }
        if (!this.faceMap) { map.anisotropy = 8; this.faceMap = map; }
      }
    });
    try { await this.buildLods(gltf.scene); } catch (e) { console.warn('people: distance levels skipped', e); }
    this.setup(gltf);
    return true;
  }

  /** Simplified distance levels (index-only over the shared vertex buffers; far levels are one merged draw). */
  private async buildLods(scene: Object3D) {
    const { MeshoptSimplifier: S } = await import('three/examples/jsm/libs/meshopt_simplifier.module.js');
    await S.ready;
    const parts: SkinnedMesh[] = [];
    scene.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) parts.push(o as SkinnedMesh); });
    if (!parts.length) return;
    const body = parts.find((m) => !(m.material as MeshLambertMaterial).map) ?? parts[0];
    const src = parts.map((m) => {
      const g = m.geometry, p = g.getAttribute('position'), nm = g.getAttribute('normal'), c = g.getAttribute('color'), uv = g.getAttribute('uv');
      // the textured part (face) also carries its UVs into the error metric, so the painted features stay where they are
      const face = !!(m.material as MeshLambertMaterial).map && !!uv;
      const n = p.count, pos = new Float32Array(n * 3), att = new Float32Array(n * 8);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = p.getX(i); pos[i * 3 + 1] = p.getY(i); pos[i * 3 + 2] = p.getZ(i);
        if (c) { att[i * 8] = c.getX(i); att[i * 8 + 1] = c.getY(i); att[i * 8 + 2] = c.getZ(i); }
        att[i * 8 + 3] = nm.getX(i); att[i * 8 + 4] = nm.getY(i); att[i * 8 + 5] = nm.getZ(i);
        if (face) { att[i * 8 + 6] = uv.getX(i); att[i * 8 + 7] = uv.getY(i); }
      }
      return { m, pos, att, face, idx: new Uint32Array(g.index!.array) };
    });
    const mesh = (g: BufferGeometry, from: SkinnedMesh, name: string) => {
      const sm = new SkinnedMesh(g, from.material);
      sm.name = name;
      sm.position.copy(from.position); sm.quaternion.copy(from.quaternion); sm.scale.copy(from.scale);
      sm.bind(from.skeleton, from.bindMatrix);
      return sm;
    };
    const levels: Object3D[][] = [parts];
    for (let l = 1; l < LODS.length; l++) {
      const { keep, err, face, merge } = LODS[l];
      // part colour keeps the part borders, the normal keeps the shading, the UVs keep the face drawing in place
      const lists = src.map((s) => S.simplifyWithAttributes(s.idx, s.pos, 3, s.att, 8, [1, 1, 1, 0.35, 0.35, 0.35, s.face ? 3 : 0, s.face ? 3 : 0], null,
        Math.floor((s.idx.length * (s.face ? face : keep)) / 3) * 3, err, [])[0]);
      if (merge) levels.push([mesh(compactMerge(src.map((s, k) => [s.m.geometry, lists[k]])), body, `${body.name}_lod${l}`)]);
      else {
        levels.push(src.map((s, k) => {
          const g = new BufferGeometry();
          for (const [name, a] of Object.entries(s.m.geometry.attributes)) g.setAttribute(name, a);
          g.setIndex(new BufferAttribute(new Uint16Array(lists[k]), 1));
          return mesh(g, s.m, `${s.m.name}_lod${l}`);
        }));
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    const parent = parts[0].parent!, lod = new LOD();
    lod.name = 'personLod';
    levels.forEach((objs, l) => { const grp = new Group(); objs.forEach((o) => grp.add(o)); lod.addLevel(grp, LODS[l].d, 0.1); });
    parent.add(lod);
  }

  private analyse(scene: Object3D) {
    // unique vertex colours of the vertex-coloured parts -> nearest pipeline part
    const seen = new Map<string, Color>();
    scene.traverse((o) => {
      const sm = o as SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const col = sm.geometry.getAttribute('color');
      if (!col) return;
      for (let i = 0; i < col.count; i++) {
        const c = new Color(col.getX(i), col.getY(i), col.getZ(i));
        const k = `${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}`;
        if (!seen.has(k)) seen.set(k, c);
        if (seen.size > 64) return;
      }
    });
    const parts = Object.entries(PARTS).map(([name, h]) => ({ name, c: lin(h) }));
    for (const c of seen.values()) {
      let best = parts[0], bd = 1e9;
      for (const p of parts) { const d = (p.c.r - c.r) ** 2 + (p.c.g - c.g) ** 2 + (p.c.b - c.b) ** 2; if (d < bd) { bd = d; best = p; } }
      if (bd > 0.05) continue;
      this.refs.push(c); this.refNames.push(best.name);
      if (this.refs.length >= 24) break;
    }
  }

  private look(i: number, over: Partial<Look> = {}): Look {
    let a = (i * 2654435761) >>> 0;
    const r = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return (a % 10000) / 10000; };
    const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
    const hair = pick(HAIR);
    const capOn = r() < 0.6;
    const tee = pick(TEES);
    return {
      tee, trim: r() < 0.5 ? '#f4efe4' : tee, shorts: pick(SHORTS), cap: capOn ? pick(TEES) : hair, hair, skin: pick(SKIN),
      socks: r() < 0.6 ? '#f4f1ea' : '#26272b', stripes: pick(TEES), shoes: pick(SHOES), soles: '#efe8d8', ...over,
    };
  }

  /** one body + one face material per person, shared by all of its distance levels */
  private materialsFor(model: Object3D, look: Look) {
    const skinRef = lin(PARTS.skin), skin = lin(look.skin);
    let face: MeshLambertMaterial | null = null, body: MeshLambertMaterial | null = null;
    model.traverse((o) => {
      const sm = o as SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      sm.castShadow = true; sm.receiveShadow = true;
      const map = (sm.material as MeshLambertMaterial).map as Texture | null;
      if (map) {
        if (!face) {
          // softer terminator and rim than the skater's close-up face: at a few metres a hard band or a lit edge across
          // a 30-pixel face reads as a smear or a pale sheet; the drawing is sampled a little sharper than its mip
          face = toonMaterial({ map: this.faceMap ?? map, bands: 0.3, wrap: 0.68, rim: 0.25, name: 'personFace' });
          face.color.setRGB(skin.r / skinRef.r, skin.g / skinRef.g, skin.b / skinRef.b);
          const prev = face.onBeforeCompile, key = face.customProgramCacheKey();
          face.onBeforeCompile = (sh, r) => {
            prev.call(face, sh, r);
            sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
              diffuseColor *= texture2D( map, vMapUv, -0.6 );
            #endif`);
          };
          face.customProgramCacheKey = () => `${key}-crowdFace`;
        }
        sm.material = face;
      } else {
        if (!body) {
          body = toonMaterial({ vertexColors: true, bands: 0.8, wrap: 0.45, rim: 0.55, name: 'personVC' });
          this.recolour(body, look);
        }
        sm.material = body;
      }
    });
  }

  /** swap part colours in the vertex shader (shared program, per-instance uniforms) */
  private recolour(m: MeshLambertMaterial, look: Look) {
    const N = Math.max(1, this.refs.length);
    const target: Record<string, string> = {
      skin: look.skin, hair: look.hair, cap: look.cap, tee: look.tee, cream: look.trim, shorts: look.shorts, shortscuff: look.shorts,
      socks: look.socks, stripes: look.stripes, shoes: look.shoes, soles: look.soles, laces: look.soles,
    };
    const ref = Array.from({ length: N }, (_, i) => { const c = this.refs[i] ?? new Color(-9, -9, -9); return new Vector3(c.r, c.g, c.b); });
    const nw = Array.from({ length: N }, (_, i) => {
      const name = this.refNames[i];
      const c = lin(target[name] ?? '#ffffff');
      if (name === 'shortscuff') c.multiplyScalar(0.86);
      return new Vector3(c.r, c.g, c.b);
    });
    const uRef = { value: ref }, uNew = { value: nw };
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      sh.uniforms.uPRef = uRef; sh.uniforms.uPNew = uNew;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        uniform vec3 uPRef[${N}]; uniform vec3 uPNew[${N}];`).replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_COLOR
        {
          vec3 c0 = color.rgb; float best = 1e9; vec3 oc = vColor.rgb;
          for (int i = 0; i < ${N}; i++) { vec3 d = c0 - uPRef[i]; float e = dot(d, d); if (e < best) { best = e; oc = uPNew[i]; } }
          if (best < 0.0025) vColor.rgb = oc;
        }
        #endif`);
    };
    const key = m.customProgramCacheKey();
    m.customProgramCacheKey = () => `${key}-ppl${N}`;
  }

  private setup(gltf: GLTF) {
    const clips = new Map<string, AnimationClip>();
    for (const c of gltf.animations) clips.set(c.name, c);
    const fallback = clips.get('stand_idle') ?? gltf.animations[0];
    const boardGeo = boardProp();
    const boardMat = toonMaterial({ vertexColors: true, spec: 0.3, bands: 0.4, rim: 0.3, name: 'boardProp' });
    PEOPLE_SPOTS.forEach((spot, i) => {
      const model = skeletonClone(gltf.scene);
      const look = this.look(i + 3, spot.look);
      this.materialsFor(model, look);
      const holder = new Group();
      holder.add(model);
      const sc = spot.scale ?? 1;
      model.scale.setScalar(sc);
      const mixer = new AnimationMixer(model);
      const clip = clips.get(spot.clip) ?? fallback;
      const action: AnimationAction = mixer.clipAction(clip);
      action.play();
      action.time = (i * 0.37) % Math.max(0.1, clip.duration);
      action.timeScale = spot.path ? (spot.speed ?? 1.2) / 1.25 : 0.9 + ((i * 0.13) % 0.2);
      mixer.update(0);
      const h = (spot.heading * Math.PI) / 180;
      const gy = spot.rel ? this.ground(spot.at[0], spot.at[2]) : 0;
      const p = new Vector3(spot.at[0], spot.at[1] + gy, spot.at[2]);
      if (spot.path && spot.y === undefined) p.y = this.ground(p.x, p.z);
      holder.position.copy(p);
      holder.rotation.y = h;
      if (spot.sit) {
        // anchor the hips onto the seat point (whatever height/offset the clip sits at)
        holder.updateMatrixWorld(true);
        const hips = model.getObjectByName('mixamorigHips');
        if (hips) {
          const hp = hips.getWorldPosition(new Vector3());
          const target = p.clone().setY(p.y + (spot.sit === 'seat' ? 0.1 : 0.12));
          holder.position.add(target.sub(hp));
        }
      }
      // one posed bound for all levels (three's default skins every vertex of every level to find it)
      holder.updateMatrixWorld(true);
      const skinned: SkinnedMesh[] = [];
      model.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh); });
      const full = skinned.reduce((a, b) => (b.geometry.index!.count > a.geometry.index!.count ? b : a));
      const bound = poseSphere(full);
      for (const sm of skinned) sm.boundingSphere = bound;
      if (spot.phone) {
        const hand = model.getObjectByName('mixamorigRightHand');
        if (hand) {
          const ph = new Mesh(new BoxGeometry(0.075, 0.15, 0.012), toonMaterial({ color: 0x1b1d22, spec: 0.8, name: 'phone' }));
          ph.position.set(0, 0.09 / sc, 0.03 / sc); ph.scale.setScalar(1 / sc);
          hand.add(ph);
        }
      }
      this.group.add(holder);
      if (spot.board) {
        const bm = new Mesh(boardGeo, boardMat);
        bm.castShadow = true; bm.receiveShadow = true;
        bm.position.set(...spot.board.at);
        bm.rotation.y = spot.board.yaw;
        if (spot.board.kind === 'lean') { bm.rotation.order = 'YXZ'; bm.rotation.x = -1.32; bm.position.y += 0.31; }
        this.group.add(bm);
      }
      const cum = [0];
      if (spot.path) for (let k = 1; k < spot.path.length; k++) cum.push(cum[k - 1] + Math.hypot(spot.path[k][0] - spot.path[k - 1][0], spot.path[k][1] - spot.path[k - 1][1]));
      this.items.push({ holder, mixer, spot, s: spot.path ? (i * 7.3) % cum[cum.length - 1] : 0, dir: i % 2 ? -1 : 1, turn: 0, len: cum[cum.length - 1], cum });
    });
  }

  update(dt: number) {
    if (!this.items.length) return;
    for (const p of this.items) {
      const path = p.spot.path;
      if (!path) continue;
      if (p.turn > 0) {
        // turning round at the end of the walk
        p.turn = Math.max(0, p.turn - dt);
        p.holder.rotation.y += (Math.PI / 0.9) * dt;
        continue;
      }
      p.s += p.dir * (p.spot.speed ?? 1.2) * dt;
      if (p.s >= p.len || p.s <= 0) { p.s = Math.min(p.len, Math.max(0, p.s)); p.dir = p.dir > 0 ? -1 : 1; p.turn = 0.9; }
      let k = 0;
      while (k < path.length - 2 && p.cum[k + 1] < p.s) k++;
      const a = path[k], b = path[k + 1];
      const t = (p.s - p.cum[k]) / Math.max(1e-6, p.cum[k + 1] - p.cum[k]);
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      p.holder.position.set(x, p.spot.y ?? this.ground(x, z), z);
      if (p.turn === 0) p.holder.rotation.y = Math.atan2((b[0] - a[0]) * p.dir, (b[1] - a[1]) * p.dir);
    }
    this.acc += dt;
    if (this.acc < 1 / 30 - 1e-4) return;
    for (const p of this.items) p.mixer.update(this.acc);
    this.acc = 0;
  }
}
