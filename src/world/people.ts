import {
  AnimationAction, AnimationClip, AnimationMixer, BackSide, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide,
  FrontSide, Group, LOD, Mesh, MeshDepthMaterial, MeshLambertMaterial, Object3D, SkinnedMesh, Sphere, SRGBColorSpace, Texture, Vector3,
  type Material, type Skeleton,
} from 'three';
import type { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { toonMaterial } from '../render/materials';
import { boardProp } from '../player/board';

/** baked distance levels: index lists[level - 1][part] for the part sizes they were baked from */
interface LodLists { parts: { vertices: number; indices: number }[]; lists: Uint16Array[][] }
/** what the crowd is built from: the skater's own mesh (cloned before he is dressed and posed), the crowd's clips and the
 *  distance levels baked offline (tools/assets/bake_people_lods.mjs) */
export interface CrowdSource { scene: Object3D; animations: AnimationClip[]; lods: LodLists | null }

/** people.glb carries only the crowd's clips and baked levels. Call at t=0, before anything else awaits the skater's GLB:
 *  the clone is taken from the untouched, unposed GLB scene. The fetch waits for `start` (the game: playable), so the
 *  crowd never takes bandwidth or CPU from the start. */
export function loadCrowd(loader: GLTFLoader, url: string, skater: Promise<GLTF>, start: Promise<void>): Promise<CrowdSource> {
  const scene = skater.then((g) => skeletonClone(g.scene));
  return Promise.all([scene, Promise.all([skater, start]).then(() => loader.loadAsync(url))]).then(async ([scene, gltf]) => {
    const meta = gltf.userData?.lods as { parts: LodLists['parts']; levels: number[][] } | undefined;
    const lists = meta && await Promise.all(meta.levels.map((lv) => Promise.all(lv.map(async (a) =>
      (await gltf.parser.getDependency('accessor', a) as BufferAttribute).array as Uint16Array))));
    return { scene, animations: gltf.animations, lods: meta && lists ? { parts: meta.parts, lists } : null };
  });
}

/** crowd cost: people shown and animated (nearest the park first), LOD switch distance factor, animation rate (Hz, 0 =
 *  every frame), sun / lamp shadow casting, nearest distance level drawn, one animation phase per person (kept off the
 *  frames that render the sun shadow, see `busy`) */
export interface PeopleProfile { count: number; lodScale: number; mixerHz: number; castShadow: boolean; minLod: number; stagger: boolean }

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
function compactMerge(parts: [BufferGeometry, Uint16Array][]): BufferGeometry {
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

interface Person {
  holder: Group; mixer: AnimationMixer; spot: Spot; s: number; dir: 1 | -1; turn: number; len: number; cum: number[];
  board: Object3D | null; lod: LOD | null; casters: Mesh[]; rank: number;
  /** stagger: own mixer clock; moved: bones posed since the last matrix walk; ver: matrix walks so far */
  acc: number; moved: boolean; ver: number;
}

/** Small, simple, gently moving people: clones of our own rig (the skater's mesh, people.glb clips), recoloured per instance. */
export class People {
  group = new Group();
  /** the built people; joins `group` on show(), once the game has compiled its shaders */
  crowd = new Group();
  /** resolves when the crowd is built (false: no people) */
  loaded: Promise<boolean> = Promise.resolve(false);
  private items: Person[] = [];
  private acc = 0;
  private refs: Color[] = [];
  private refNames: string[] = [];
  private faceMap: Texture | null = null;
  private profile: PeopleProfile = { count: Infinity, lodScale: 1, mixerHz: 30, castShadow: true, minLod: 0, stagger: false };
  /** set by the game: the coming frame renders the sun shadow (staggered mixers wait a frame) */
  busy = false;
  /** the baked distance levels (index lists per part of the skater's mesh), once built */
  baked: LodLists | null = null;

  constructor(private ground: (x: number, z: number) => number) {
    this.group.name = 'people'; this.crowd.name = 'crowd';
    // static containers at the origin: their matrices never force a walk through every person
    this.group.matrixAutoUpdate = false; this.crowd.matrixAutoUpdate = false;
  }

  load(src: Promise<CrowdSource>) { return (this.loaded = this.build(src)); }

  get shown() { return this.crowd.parent === this.group; }
  show() { if (!this.shown) this.group.add(this.crowd); }

  setProfile(p: Partial<PeopleProfile>) { Object.assign(this.profile, p); this.applyProfile(); }

  /** stand-ins drawn with three's shadow depth material the way the sun / lamp passes draw the crowd (same program
   *  variants: skinning, side, map), so those programs can be compiled before the crowd is shown */
  shadowStandIns() {
    const g = new Group(), seen = new Set<string>(), flip = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };
    this.crowd.traverse((o) => {
      const m = o as Mesh, mat = m.material as Material & { map?: Texture | null };
      if (!m.isMesh || Array.isArray(mat)) return;
      const skinned = (m as SkinnedMesh).isSkinnedMesh === true, side = mat.shadowSide ?? flip[mat.side];
      const key = `${skinned}|${side}|${!!mat.map}`;
      if (seen.has(key)) return;
      seen.add(key);
      const d = new MeshDepthMaterial({ side, map: mat.map ?? null });
      if (!skinned) { g.add(new Mesh(m.geometry, d)); return; }
      const s = new SkinnedMesh(m.geometry, d);
      s.bind((m as SkinnedMesh).skeleton, (m as SkinnedMesh).bindMatrix);
      g.add(s);
    });
    return g;
  }

  /** textures the crowd's first draw would upload */
  textures() {
    const t = new Set<Texture>();
    this.crowd.traverse((o) => { const map = ((o as Mesh).material as MeshLambertMaterial | undefined)?.map; if (map) t.add(map); });
    return [...t];
  }

  private async build(src: Promise<CrowdSource>) {
    let s: CrowdSource;
    try { s = await src; } catch (e) { console.warn('people: not loaded', e); return false; }
    if (!s.animations?.length) return false;
    this.analyse(s.scene);
    s.scene.traverse((o) => {
      const map = ((o as SkinnedMesh).material as MeshLambertMaterial | undefined)?.map;
      if (map && !this.faceMap) {
        try { this.faceMap = crowdFace(map); } catch (e) { console.warn('people: crowd face skipped', e); }
        if (!this.faceMap) { map.anisotropy = 8; this.faceMap = map; }
      }
    });
    try { this.buildLods(s.scene, s.lods); } catch (e) { console.warn('people: distance levels skipped', e); }
    this.setup(s);
    this.applyProfile();
    return true;
  }

  /** Simplified distance levels (index-only over the shared vertex buffers; far levels are one merged draw). */
  private buildLods(scene: Object3D, baked: LodLists | null) {
    const parts: SkinnedMesh[] = [];
    scene.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) parts.push(o as SkinnedMesh); });
    if (!parts.length || !baked) return;
    if (baked.parts.length !== parts.length || baked.lists.length !== LODS.length - 1
      || parts.some((m, k) => m.geometry.getAttribute('position').count !== baked.parts[k].vertices || m.geometry.index!.count !== baked.parts[k].indices)) {
      throw new Error('baked levels were made for another mesh (re-run tools/assets/slim_glb.sh)');
    }
    this.baked = baked;
    const body = parts.find((m) => !(m.material as MeshLambertMaterial).map) ?? parts[0];
    const mesh = (g: BufferGeometry, from: SkinnedMesh, name: string) => {
      const sm = new SkinnedMesh(g, from.material);
      sm.name = name;
      sm.position.copy(from.position); sm.quaternion.copy(from.quaternion); sm.scale.copy(from.scale);
      sm.bind(from.skeleton, from.bindMatrix);
      return sm;
    };
    const levels: Object3D[][] = [parts];
    for (let l = 1; l < LODS.length; l++) {
      const lists = baked.lists[l - 1];
      if (LODS[l].merge) levels.push([mesh(compactMerge(parts.map((m, k) => [m.geometry, lists[k]])), body, `${body.name}_lod${l}`)]);
      else {
        levels.push(parts.map((m, k) => {
          const g = new BufferGeometry();
          for (const [name, a] of Object.entries(m.geometry.attributes)) g.setAttribute(name, a);
          g.setIndex(new BufferAttribute(lists[k], 1));
          return mesh(g, m, `${m.name}_lod${l}`);
        }));
      }
    }
    const parent = parts[0].parent!, lod = new LOD();
    lod.name = 'personLod';
    levels.forEach((objs, l) => { const grp = new Group(); objs.forEach((o) => grp.add(o)); lod.addLevel(grp, LODS[l].d, 0.1); });
    parent.add(lod);
  }

  private applyProfile() {
    const { count, lodScale, castShadow, minLod, stagger, mixerHz } = this.profile;
    for (const p of this.items) {
      const on = p.rank < count;
      p.holder.visible = on;
      if (p.board) p.board.visible = on;
      // hidden people leave the scene graph: no traversal at all
      for (const o of [p.holder, p.board]) if (o && on !== (o.parent === this.crowd)) { if (on) this.crowd.add(o); else this.crowd.remove(o); }
      p.lod?.levels.forEach((lv, l) => { lv.distance = l > 0 && l <= minLod ? 0 : LODS[l].d * lodScale; });
      for (const m of p.casters) m.castShadow = castShadow;
      if (stagger && mixerHz > 0) p.acc = ((p.rank * 0.618034) % 1) / mixerHz;
    }
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

  private setup(src: CrowdSource) {
    const clips = new Map<string, AnimationClip>();
    for (const c of src.animations) clips.set(c.name, c);
    const fallback = clips.get('stand_idle') ?? src.animations[0];
    // with fewer people (setProfile count) the ones nearest the park stay
    const near = PEOPLE_SPOTS.map((s, i) => [Math.hypot(s.at[0], s.at[2]), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    PEOPLE_SPOTS.forEach((spot, i) => {
      const model = skeletonClone(src.scene);
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
      this.crowd.add(holder);
      let board: Object3D | null = null;
      if (spot.board) {
        const bm = boardProp();
        bm.position.set(...spot.board.at);
        bm.rotation.y = spot.board.yaw;
        if (spot.board.kind === 'lean') { bm.rotation.order = 'YXZ'; bm.rotation.x = -1.32; bm.position.y += 0.31; }
        this.crowd.add(bm);
        board = bm;
      }
      const casters: Mesh[] = [];
      for (const o of [holder, board]) o?.traverse((m) => { if ((m as Mesh).isMesh && m.castShadow) casters.push(m as Mesh); });
      const lod = (model.getObjectByName('personLod') as LOD | undefined) ?? null;
      const cum = [0];
      if (spot.path) for (let k = 1; k < spot.path.length; k++) cum.push(cum[k - 1] + Math.hypot(spot.path[k][0] - spot.path[k - 1][0], spot.path[k][1] - spot.path[k - 1][1]));
      const it: Person = {
        holder, mixer, spot, s: spot.path ? (i * 7.3) % cum[cum.length - 1] : 0, dir: i % 2 ? -1 : 1, turn: 0, len: cum[cum.length - 1], cum,
        board, lod, casters, rank: near.indexOf(i), acc: 0, moved: true, ver: 0,
      };
      this.items.push(it);
      board?.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
      if (!spot.path) {
        // someone standing or sitting only changes when its mixer runs: no matrix walk and no skin upload in between
        holder.updateMatrix(); holder.matrixAutoUpdate = false;
        model.updateMatrix(); model.matrixAutoUpdate = false;
        const walk = model.updateMatrixWorld.bind(model);
        model.updateMatrixWorld = (force?: boolean) => { if (force || it.moved) { it.moved = false; it.ver++; walk(force); } };
        const skels = new Set<Skeleton>();
        model.traverse((o) => { const sm = o as SkinnedMesh; if (sm.isSkinnedMesh) skels.add(sm.skeleton); });
        for (const sk of skels) {
          const upd = sk.update.bind(sk);
          let seen = -1;
          sk.update = () => { if (seen !== it.ver) { seen = it.ver; upd(); } };
        }
      }
    });
  }

  update(dt: number) {
    if (!this.items.length) return;
    for (const p of this.items) {
      const path = p.spot.path;
      if (!path || !p.holder.visible) continue;
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
    const hz = this.profile.mixerHz;
    if (this.profile.stagger && hz > 0) {
      // each person on its own phase (a flat cost per frame), none on a frame that renders the sun shadow
      for (const p of this.items) {
        if (!p.holder.visible) continue;
        p.acc += dt;
        if (p.acc < 1 / hz - 1e-4 || (this.busy && p.acc < 2 / hz - 1e-4)) continue;
        p.mixer.update(p.acc); p.acc = 0; p.moved = true;
      }
      return;
    }
    this.acc += dt;
    if (hz > 0 && this.acc < 1 / hz - 1e-4) return;
    for (const p of this.items) if (p.holder.visible) { p.mixer.update(this.acc); p.moved = true; }
    this.acc = 0;
  }
}
