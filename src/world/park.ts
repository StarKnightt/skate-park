import {
  BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, Group, Material, Matrix4, Mesh, Quaternion,
  TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ParkBuilder, Surface, transitionProfile, roundedRectPath, PathPt } from './parkBuilder';

export type GrindKind = 'rail' | 'ledge' | 'coping';
export interface GrindLine {
  name: string;
  kind: GrindKind;
  pts: Vector3[];
  closed: boolean;
  /** For copings/ledges: horizontal direction pointing towards the side you ride away into (ramp interior). */
  inward?: Vector3[];
  metal: boolean;
}

export type RGB = [number, number, number];
/** A grindable edge: `top` runs from the edge across the top face, `side` runs from the edge down the side face, `out` is the side face normal. */
export interface EdgeStrip { a: Vector3; c: Vector3; top: Vector3; side: Vector3; out: Vector3; paint: RGB }
export interface Decal { pos: Vector3; normal: Vector3; w: number; h: number; tile: number; rot: number; fade: number }
/** kind: 0 shrub, 1 ornamental grass, 2 flowering shrub, 3 agave */
export interface Plant { pos: Vector3; s: number; kind: 0 | 1 | 2 | 3 }
export interface ParkDetail {
  pool: { path: PathPt[] }[];
  wax: EdgeStrip[];
  iron: EdgeStrip[];
  tags: Decal[];
  plants: Plant[];
  sails: { c: Vector3[]; color: RGB; sag: number }[];
  /** vertex-coloured static props (position, normal, color) */
  props: BufferGeometry[];
}

export interface ParkData {
  builder: ParkBuilder;
  grindLines: GrindLine[];
  lamps: Vector3[];
  murals: { key: string; center: Vector3; normal: Vector3; w: number; h: number; tex: string }[];
  tubes: BufferGeometry[]; // metal coping / rails (visual only)
  spawn: { pos: Vector3; heading: number };
  landmarks: Record<string, { pos: Vector3; look: Vector3 }>;
  detail: ParkDetail;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const UP = V(0, 1, 0);

/** boardwalk lamp posts (z = -27.0) and benches (z = -26.6), shared with the scenery */
export const BOARDWALK_LAMP_X = [-66, -49.5, -33, -16.5, 0, 16.5, 33, 49.5, 66];
export const BOARDWALK_BENCH_X = [-30, -12, 14, 30];
/** beach snack kiosk (south edge): footprint, height and the service window in its town-side wall (z = z1) */
export const KIOSK = { x0: 19.5, x1: 30.5, z0: 24.9, z1: 29.3, h: 3.2, win: { x0: 22.5, x1: 27.5, y0: 1.0, y1: 2.15 } };
/** palms planted in the park-edge planters: x, base y, z, height */
export const EDGE_PALMS: [number, number, number, number][] = [
  [-39.1, 0.72, -19.5, 8.6], [-39.0, 0.72, 8.2, 9.8], [-39.1, 0.72, 21.0, 8.2], [39.1, 0.72, -19.8, 9.4], [39.0, 0.72, 2.2, 8.0],
  [39.1, 0.72, 17.6, 9.9], [-27.5, 0.72, 26.15, 8.8], [-12.0, 0.72, 26.2, 10.2], [5.0, 0.72, 25.6, 9.0], [34.6, 0.72, 26.15, 8.4],
  [-39.7, 0.72, -25.2, 7.6], [39.7, 0.72, -25.2, 8.1], [-43.6, -0.1, 6.4, 9.2], [31.6, -0.1, 28.9, 8.7],
];

// warm concrete tints (linear-ish multipliers applied on top of the concrete material)
const C_PLAZA: RGB = [1.0, 0.98, 0.95];
const C_BOWL: RGB = [0.97, 0.97, 0.98];
const C_RAMP: RGB = [1.0, 0.97, 0.93];
const C_WALL: RGB = [0.95, 0.92, 0.88];
const C_SEAT: RGB = [0.99, 0.96, 0.92];

const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const hex = (h: string): RGB => { const c = new Color(h); return [c.r, c.g, c.b]; };
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** vertex-colour a geometry (non-indexed, no uv) for the detail/prop meshes */
export function paintGeo(g: BufferGeometry, c: RGB, jitter = 0, rnd: () => number = Math.random) {
  const gg = g.index ? g.toNonIndexed() : g;
  if (gg.getAttribute('uv')) gg.deleteAttribute('uv');
  const n = gg.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + (rnd() - 0.5) * jitter : 1;
    arr[i * 3] = c[0] * j; arr[i * 3 + 1] = c[1] * j; arr[i * 3 + 2] = c[2] * j;
  }
  gg.setAttribute('color', new BufferAttribute(arr, 3));
  return gg;
}
const boxGeo = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: RGB) =>
  paintGeo(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), c);
const cylGeo = (x: number, y0: number, y1: number, z: number, r: number, c: RGB, seg = 10, r1 = r) =>
  paintGeo(new CylinderGeometry(r1, r, y1 - y0, seg).translate(x, (y0 + y1) / 2, z), c);

export function buildPark(): ParkData {
  const b = new ParkBuilder();
  const rnd = mulberry(7);
  const grind: GrindLine[] = [];
  const tubes: BufferGeometry[] = [];
  const murals: ParkData['murals'] = [];
  const holes: Vector3[][] = [];
  const det: ParkDetail = { pool: [], wax: [], iron: [], tags: [], plants: [], sails: [], props: [] };
  const prop = (g: BufferGeometry) => det.props.push(g);

  // ------------------------------------------------------------------ helpers
  const tube = (pts: Vector3[], r: number, closed = false, radial = 10) => {
    const curve = new CatmullRomCurve3(pts, closed, 'catmullrom', 0.0);
    const n = Math.max(8, Math.ceil(curve.getLength() / 0.12));
    tubes.push(new TubeGeometry(curve, n, r, radial, closed));
  };
  /** straight capped steel tube */
  const pipe = (a: Vector3, c: Vector3, r: number, radial = 12) => {
    const len = a.distanceTo(c);
    if (len < 1e-4) return;
    const g = new CylinderGeometry(r, r, len, radial, 1, false);
    const q = new Quaternion().setFromUnitVectors(UP, c.clone().sub(a).normalize());
    g.applyMatrix4(new Matrix4().compose(a.clone().lerp(c, 0.5), q, V(1, 1, 1)));
    tubes.push(g);
  };
  const post = (x: number, y0: number, y1: number, z: number, r = 0.022) => pipe(V(x, y0, z), V(x, y1, z), r, 10);
  const ALL = ['+x', '-x', '+y', '-y', '+z', '-z'];
  /** collision-only box; `faces` lists the faces to keep */
  const colBox = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces = ['+x', '-x', '+z', '-z'], surface = Surface.Concrete) =>
    b.box(null, V(x0, y0, z0), V(x1, y1, z1), { visual: false, surface }, ALL.filter((f) => !faces.includes(f)));
  /** dirt that collects at the foot of a wall, plus faint streaks */
  const grime = (base: RGB, y0: number, amt = 1, seed = 0) => (p: Vector3): RGB => {
    const hgt = Math.max(0, p.y - y0);
    const s = (p.x + p.z) * 0.9 + seed;
    const streak = 0.5 + 0.5 * Math.sin(s * 1.7 + Math.sin(s * 0.43) * 2.0);
    const d = amt * (0.34 * Math.exp(-hgt / 0.22) + 0.12 * streak * Math.exp(-hgt / 0.8) + 0.05 * streak);
    return [base[0] * (1 - d * 0.92), base[1] * (1 - d), base[2] * (1 - d * 1.06)];
  };
  /** thin quad 4 mm in front of a surface (seams, tie holes) */
  const thin = (key: string, c: Vector3, t: Vector3, up: Vector3, w: number, h: number, n: Vector3, col: RGB) => {
    const o = n.clone().multiplyScalar(0.004);
    const P = (sx: number, sy: number) => c.clone().addScaledVector(t, sx * w / 2).addScaledVector(up, sy * h / 2).add(o);
    b.quad(key, P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), { color: col, collide: false }, n);
  };
  const seams = (p0: Vector3, p1: Vector3, y0: number, y1: number, n: Vector3, base: RGB, every: number, ties: boolean) => {
    const t = V(p1.x - p0.x, 0, p1.z - p0.z); const len = t.length(); t.normalize();
    const dark = mul(base, 0.7);
    const k = Math.max(1, Math.round(len / every));
    for (let i = 1; i < k; i++) thin('wall', V(p0.x, (y0 + y1) / 2, p0.z).addScaledVector(t, (len * i) / k), t, UP, 0.022, y1 - y0 - 0.01, n, dark);
    if (y1 - y0 > 2.2) thin('wall', V((p0.x + p1.x) / 2, y0 + 1.25, (p0.z + p1.z) / 2), t, UP, len - 0.01, 0.016, n, dark);
    if (ties) {
      for (let i = 0; i < Math.floor(len / 0.6); i++) for (const yy of [0.32, 0.92, 1.55, 2.2, 2.78]) {
        if (y0 + yy > y1 - 0.12) continue;
        thin('wall', V(p0.x, y0 + yy, p0.z).addScaledVector(t, 0.3 + i * 0.6), t, UP, 0.028, 0.028, n, mul(base, 0.55));
      }
    }
  };
  /** vertical wall p0 -> p1 from y0 to y1: subdivided visual with grime, exact collision quad */
  const panel = (key: string, p0: Vector3, p1: Vector3, y0: number, y1: number, n: Vector3, base: RGB = C_WALL,
    o: { grime?: number; collide?: boolean; seams?: number; ties?: boolean; ground?: number } = {}) => {
    const dx = p1.x - p0.x, dz = p1.z - p0.z, len = Math.hypot(dx, dz), H = y1 - y0;
    if (len < 1e-4 || H < 1e-4) return;
    const nu = Math.max(1, Math.ceil(len / 0.8)), nv = H < 0.7 ? 2 : H < 1.6 ? 4 : 6;
    b.grid(key, nu, nv, (u, v, out) => out.set(p0.x + dx * u, y0 + H * Math.pow(v, 1.6), p0.z + dz * u), (_u, _v, out) => out.copy(n),
      { vcolor: grime(base, o.ground ?? y0, o.grime ?? 1, p0.x * 0.37 + p0.z), collide: false });
    if (o.collide !== false) b.quad(null, V(p0.x, y0, p0.z), V(p1.x, y0, p1.z), V(p1.x, y1, p1.z), V(p0.x, y1, p0.z), { visual: false }, n);
    if (o.seams) seams(p0, p1, y0, y1, n, base, o.seams, !!o.ties);
  };
  /** round steel coping: sits 2 cm proud of the deck and overhangs the transition by 2 cm */
  const COPE_R = 0.042;
  const coping = (a: Vector3, c: Vector3, m: Vector3) => {
    const off = m.clone().multiplyScalar(-(COPE_R - 0.02));
    pipe(a.clone().add(off).setY(a.y + 0.02 - COPE_R), c.clone().add(off).setY(c.y + 0.02 - COPE_R), COPE_R, 14);
  };
  /** railing along a polyline at walking level; exact thin collision boxes (axis aligned segments) */
  const railing = (pts: Vector3[], h = 1.05, every = 1.9, collide = true) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const n = Math.max(1, Math.round(a.distanceTo(c) / every));
      for (let k = 0; k <= n; k++) {
        if (i > 0 && k === 0) continue;
        const p = a.clone().lerp(c, k / n);
        post(p.x, p.y, p.y + h + 0.02, p.z, 0.026);
      }
      pipe(a.clone().setY(a.y + h), c.clone().setY(c.y + h), 0.025);
      pipe(a.clone().setY(a.y + h * 0.5), c.clone().setY(c.y + h * 0.5), 0.017);
      if (collide) colBox(Math.min(a.x, c.x) - 0.045, Math.min(a.y, c.y), Math.min(a.z, c.z) - 0.045, Math.max(a.x, c.x) + 0.045, Math.max(a.y, c.y) + h + 0.03, Math.max(a.z, c.z) + 0.045);
    }
  };
  const tag = (pos: Vector3, normal: Vector3, w: number, h: number, tile: number, rot = 0, fade = 1) =>
    det.tags.push({ pos: pos.clone().addScaledVector(normal, 0.008), normal, w, h, tile, rot, fade });
  const wax = (a: Vector3, c: Vector3, top: Vector3, out: Vector3, paint: RGB, side = V(0, -1, 0)) =>
    det.wax.push({ a, c, top, side, out, paint });

  // ------------------------------------------------------------------ stairs (exact collision + readable visual steps)
  const nosing = (x0: number, x1: number, zr: number, yt: number, dz: number) => {
    const zo = zr + dz * 0.03, zi = zr - dz * 0.05, yb = yt - 0.04;
    const nu = Math.max(4, Math.ceil((x1 - x0) / 0.09));
    const chip = (p: Vector3, edge: number): RGB => {
      const k = hash(Math.floor(p.x / 0.09) * 1.7, zr * 3.1);
      const scuff = hash(Math.floor(p.x / 0.23) * 2.3, zr * 1.3 + 4.0);
      let f = 0.97 + 0.06 * hash(p.x * 9.1, zr);
      if (k > 0.84) f *= 1.12 + 0.06 * edge; else if (scuff > 0.8) f *= 0.42 + 0.25 * (1 - edge);
      return mul(C_RAMP, f * (1.0 + 0.04 * edge));
    };
    const N = (x: number, y: number, z: number) => (_u: number, _v: number, o: Vector3) => o.set(x, y, z).normalize();
    b.grid('concrete', nu, 1, (u, v, o) => o.set(x0 + (x1 - x0) * u, yt + 0.0015, zi + (zo - dz * 0.012 - zi) * v), N(0, 1, 0), { collide: false, vcolor: (p) => chip(p, 0.3) });
    b.grid('concrete', nu, 1, (u, v, o) => o.set(x0 + (x1 - x0) * u, yt + 0.0015 - 0.0135 * v, zo - dz * 0.012 + dz * 0.012 * v), N(0, 1, dz), { collide: false, vcolor: (p) => chip(p, 1) });
    b.grid('concrete', nu, 1, (u, v, o) => o.set(x0 + (x1 - x0) * u, yt - 0.012 - 0.028 * v, zo), N(0, 0, dz), { collide: false, vcolor: (p) => chip(p, 0.6) });
    b.quad('concrete', V(x0, yb, zo), V(x1, yb, zo), V(x1, yb, zr), V(x0, yb, zr), { collide: false, color: mul(C_RAMP, 0.5) }, V(0, -1, 0));
  };
  const stairsZ = (sx0: number, sx1: number, zTop: number, yTop: number, nR: number, tread: number, dz: 1 | -1) => {
    const rise = yTop / nR, nz = V(0, 0, dz);
    for (let r = 0; r < nR; r++) {
      const zr = zTop + dz * r * tread, yt = yTop - r * rise, yb = yTop - (r + 1) * rise;
      b.quad(null, V(sx0, yb, zr), V(sx1, yb, zr), V(sx1, yt, zr), V(sx0, yt, zr), { visual: false }, nz);
      if (r < nR - 1) b.quad(null, V(sx0, yb, zr + dz * tread), V(sx1, yb, zr + dz * tread), V(sx1, yb, zr), V(sx0, yb, zr), { visual: false }, UP);
      // riser: deep shadow line under the nosing fading down to the tread
      const y1 = yt - 0.04;
      b.grid('concrete', 1, 3, (u, v, o) => o.set(sx0 + (sx1 - sx0) * u, yb + (y1 - yb) * Math.pow(v, 0.55), zr), (_u, _v, o) => o.copy(nz),
        { collide: false, vcolor: (p) => { const k = (p.y - yb) / Math.max(1e-3, y1 - yb); return mul(C_RAMP, 1 - 0.5 * Math.pow(k, 1.6) - 0.08 * Math.pow(1 - k, 4)); } });
      if (r < nR - 1) {
        const zF = zr + dz * tread;
        b.grid('concrete', Math.max(1, Math.ceil((sx1 - sx0) / 0.6)), 3, (u, v, o) => o.set(sx0 + (sx1 - sx0) * u, yb, zr + (zF - zr) * Math.pow(v, 0.7)), (_u, _v, o) => o.set(0, 1, 0),
          { collide: false, vcolor: (p) => { const k = Math.min(1, Math.abs(p.z - zr) / (tread * 0.22)); return mul(C_PLAZA, (0.64 + 0.36 * k * k * (3 - 2 * k)) * (0.97 + 0.05 * hash(p.x * 3.3, zr))); } });
      }
      nosing(sx0, sx1, zr, yt, dz);
    }
    for (const [x, s] of [[sx0, -1], [sx1, 1]] as [number, number][]) {
      const outline: Vector3[] = [V(x, 0, zTop), V(x, yTop, zTop)];
      for (let r = 0; r < nR; r++) {
        const zr = zTop + dz * r * tread, yb = yTop - (r + 1) * rise;
        outline.push(V(x, yTop - r * rise, zr), V(x, yb, zr));
        if (r < nR - 1) outline.push(V(x, yb, zr + dz * tread));
      }
      const pts = outline.filter((p, i) => i === 0 || p.distanceTo(outline[i - 1]) > 1e-4);
      b.polygon('wall', pts.reverse(), V(s, 0, 0), { color: C_WALL });
    }
    return rise;
  };

  // ------------------------------------------------------------------ bowls (sunk into the plaza)
  const bowl = (name: string, cx: number, cz: number, hx: number, hz: number, rc: number, H: number, R: number) => {
    const path = roundedRectPath(cx, cz, hx, hz, rc);
    const prof = transitionProfile(H, R, 24);
    const n = path.length;
    const P = (i: number, j: number, out: Vector3) => {
      const p = path[i % n], q = prof.pts[j];
      return out.set(p.x + p.mx * q.d, q.y, p.z + p.mz * q.d);
    };
    const N = (i: number, j: number, out: Vector3) => {
      const p = path[i % n], q = prof.pts[j];
      return out.set(p.mx * Math.sin(q.beta), Math.cos(q.beta), p.mz * Math.sin(q.beta)).normalize();
    };
    const nv = prof.pts.length - 1;
    const ao = mul(C_BOWL, 0.62);
    b.grid('concrete', n, nv, (u, v, o) => P(Math.round(u * n), Math.round(v * nv), o),
      (u, v, o) => N(Math.round(u * n), Math.round(v * nv), o), { color: C_BOWL, vcolor: (p) => (p.y > -0.004 ? ao : C_BOWL) });
    const floor = path.map((p) => V(p.x + p.mx * prof.W, -H, p.z + p.mz * prof.W));
    b.polygon('concrete', floor, UP, { color: C_BOWL });
    // coping line (top row) - grindable, and a hole in the plaza; chunky pool coping blocks are built by parkDetail
    const top = path.map((p) => V(p.x, 0, p.z));
    holes.push(top);
    grind.push({ name, kind: 'coping', pts: top.map((p) => p.clone()), closed: true, inward: path.map((p) => V(p.mx, 0, p.mz)), metal: true });
    det.pool.push({ path });
    return { path, prof };
  };
  bowl('main bowl', -24, 0, 9, 7, 5.5, 2.3, 2.1);
  bowl('pocket bowl', -24, 15, 6, 4.5, 3.6, 1.4, 1.9);

  // ------------------------------------------------------------------ quarter pipe with deck
  /** `open` leaves out the side wall at that end (a hip continues the transition there) */
  const qp = (name: string, ax: number, az: number, bx: number, bz: number, mx: number, mz: number, baseY: number,
    H: number, R: number, deck: number, groundY = 0, open?: 'A' | 'B', segs = 24) => {
    const prof = transitionProfile(H, R, segs);
    const A = V(ax, 0, az), B = V(bx, 0, bz), m = V(mx, 0, mz);
    const len = A.distanceTo(B);
    const nu = Math.max(2, Math.ceil(len / 1.5));
    const nv = prof.pts.length - 1;
    const topY = baseY + H;
    const P = (u: number, j: number, o: Vector3) => {
      const q = prof.pts[j];
      return o.copy(A).lerp(B, u).addScaledVector(m, q.d).setY(topY + q.y);
    };
    const ao = mul(C_RAMP, 0.6);
    b.grid('concrete', nu, nv, (u, v, o) => P(u, Math.round(v * nv), o), (u, v, o) => {
      const q = prof.pts[Math.round(v * nv)];
      return o.set(m.x * Math.sin(q.beta), Math.cos(q.beta), m.z * Math.sin(q.beta)).normalize();
    }, { color: C_RAMP, vcolor: (p) => (p.y > topY - 0.004 ? ao : C_RAMP) });
    // deck
    const back = m.clone().multiplyScalar(-deck);
    b.quad('concrete', V(ax, topY, az), V(bx, topY, bz), V(bx, topY, bz).add(back), V(ax, topY, az).add(back), { color: C_PLAZA }, UP);
    // back wall
    panel('wall', A.clone().add(back), B.clone().add(back), groundY, topY, m.clone().negate(), C_WALL, { seams: 3, ties: topY - groundY > 2 });
    // side walls following the profile (exact collision outline + ruled visual grid with grime)
    const t = B.clone().sub(A).normalize();
    for (const [E, sgn] of [[A, -1], [B, 1]] as [Vector3, number][]) {
      if ((open === 'A' && E === A) || (open === 'B' && E === B)) continue;
      const outline: Vector3[] = [];
      for (let j = nv; j >= 0; j--) { const q = prof.pts[j]; outline.push(E.clone().addScaledVector(m, q.d).setY(topY + q.y)); }
      outline.push(E.clone().add(back).setY(topY));
      outline.push(E.clone().add(back).setY(groundY));
      outline.push(E.clone().addScaledVector(m, prof.W).setY(groundY));
      const pts = outline.filter((p, i) => i === 0 || p.distanceTo(outline[i - 1]) > 1e-4);
      if (pts[pts.length - 1].distanceTo(pts[0]) < 1e-4) pts.pop();
      const nrm = t.clone().multiplyScalar(sgn);
      b.polygon(null, pts, nrm, { visual: false });
      const cols: { x: number; z: number; top: number }[] = [];
      const pb = E.clone().add(back);
      cols.push({ x: pb.x, z: pb.z, top: topY });
      for (const q of prof.pts) { const p = E.clone().addScaledVector(m, q.d); cols.push({ x: p.x, z: p.z, top: topY + q.y }); }
      const cu = cols.length - 1;
      b.grid('wall', cu, 4, (u, v, o) => { const c = cols[Math.round(u * cu)]; return o.set(c.x, groundY + (c.top - groundY) * Math.pow(v, 1.5), c.z); },
        (_u, _v, o) => o.copy(nrm), { vcolor: grime(C_WALL, groundY, 1, E.x + E.z), collide: false });
      if (topY - groundY > 2) {
        // pour seams on the tall side walls: vertical joints clipped to the profile + one horizontal lift line
        const topAt = (s: number) => {
          if (s <= 0) return topY;
          for (let j = 1; j < prof.pts.length; j++) {
            const p0 = prof.pts[j - 1], p1 = prof.pts[j];
            if (p1.d >= s) return topY + p0.y + (p1.y - p0.y) * ((s - p0.d) / Math.max(1e-6, p1.d - p0.d));
          }
          return groundY;
        };
        const dark = mul(C_WALL, 0.7);
        for (const s of [-deck * 0.5, 0.3, prof.W * 0.55]) {
          const hh = topAt(s) - groundY - 0.03;
          if (hh > 0.4) thin('wall', E.clone().addScaledVector(m, s).setY(groundY + hh / 2), m, UP, 0.022, hh, nrm, dark);
        }
        const yL = groundY + 1.25;
        let sEnd = 0;
        for (let s = 0; s <= prof.W; s += 0.02) if (topAt(s) > yL + 0.04) sEnd = s;
        thin('wall', E.clone().addScaledVector(m, (sEnd - deck) / 2).setY(yL), m, UP, sEnd + deck - 0.02, 0.016, nrm, dark);
      }
    }
    grind.push({ name: name + ' coping', kind: 'coping', pts: [V(ax, topY + 0.02, az), V(bx, topY + 0.02, bz)], closed: false, inward: [m.clone(), m.clone()], metal: true });
    coping(A.clone().setY(topY), B.clone().setY(topY), m);
    return { W: prof.W, topY, back, A, B, m };
  };

  /** planar bank: top edge a -> c at height h (+y0), descending along `down` at `deg`; optional back wall and coping */
  const bank = (name: string, a: Vector3, c: Vector3, down: Vector3, h: number, deg: number, o: { y0?: number; back?: boolean; cope?: boolean; iron?: boolean; sides?: boolean } = {}) => {
    const y0 = o.y0 ?? 0, run = h / Math.tan((deg * Math.PI) / 180);
    const at = a.clone().setY(y0 + h), ct = c.clone().setY(y0 + h);
    const af = a.clone().addScaledVector(down, run).setY(y0), cf = c.clone().addScaledVector(down, run).setY(y0);
    const n = V(down.x * h, run, down.z * h).normalize();
    b.quad('concrete', af, cf, ct, at, { color: C_RAMP }, n);
    const t = c.clone().sub(a).setY(0).normalize();
    if (o.sides !== false) {
      for (const [p, f, s] of [[at, af, -1], [ct, cf, 1]] as [Vector3, Vector3, number][]) {
        b.polygon('wall', [f, p, p.clone().setY(y0)], t.clone().multiplyScalar(s), { vcolor: grime(C_WALL, y0, 0.8) });
      }
    }
    if (o.back) panel('wall', c.clone(), a.clone(), y0, y0 + h, down.clone().negate(), C_WALL);
    if (o.cope) {
      grind.push({ name: name + ' coping', kind: 'coping', pts: [at.clone().setY(at.y + 0.02), ct.clone().setY(ct.y + 0.02)], closed: false, inward: [down.clone(), down.clone()], metal: true });
      coping(at, ct, down);
    }
    if (o.iron) det.iron.push({ a: at, c: ct, top: down.clone().negate(), side: V(down.x * run, -h, down.z * run).normalize(), out: n, paint: hex('#2f6f7a') });
    return run;
  };

  /** truncated pyramid (funbox style) */
  const pyramid = (name: string, tx0: number, tx1: number, tz0: number, tz1: number, h: number, o: number, ironAll: boolean, paint: RGB) => {
    const T = [V(tx0, h, tz0), V(tx1, h, tz0), V(tx1, h, tz1), V(tx0, h, tz1)];
    const O = [V(tx0 - o, 0, tz0 - o), V(tx1 + o, 0, tz0 - o), V(tx1 + o, 0, tz1 + o), V(tx0 - o, 0, tz1 + o)];
    b.polygon('concrete', T, UP, { color: C_RAMP });
    const ctr = V((tx0 + tx1) / 2, h, (tz0 + tz1) / 2);
    for (let k = 0; k < 4; k++) {
      const a = T[k], c = T[(k + 1) % 4], d = O[(k + 1) % 4], e = O[k];
      const n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(e, a)).normalize();
      if (n.y < 0) n.negate();
      b.polygon('concrete', [a, c, d, e], n, { color: C_RAMP });
      if (ironAll || k === 0 || k === 2) {
        const mid = a.clone().lerp(c, 0.5), omid = e.clone().lerp(d, 0.5);
        det.iron.push({ a: a.clone(), c: c.clone(), top: ctr.clone().sub(mid).setY(0).normalize(), side: omid.sub(mid).normalize(), out: n, paint });
      }
    }
    grind.push({ name: name + ' edge', kind: 'ledge', pts: [V(tx0, h, tz0), V(tx1, h, tz0)], closed: false, inward: [V(0, 0, -1), V(0, 0, -1)], metal: true });
    grind.push({ name: name + ' edge', kind: 'ledge', pts: [V(tx0, h, tz1), V(tx1, h, tz1)], closed: false, inward: [V(0, 0, 1), V(0, 0, 1)], metal: true });
  };

  // ------------------------------------------------------------------ half pipe (east): two quarter pipes facing each other, open ends onto the plaza
  qp('half pipe west', 19.2, -15, 19.2, -3, 1, 0, 0, 3.0, 2.8, 2.8);
  qp('half pipe east', 28.8, -3, 28.8, -15, -1, 0, 0, 3.0, 2.8, 2.8);
  murals.push({ key: 'mural_sunwaves', center: V(16.4 - 0.015, 1.5, -9), normal: V(-1, 0, 0), w: 7.6, h: 2.85, tex: 'mural_sunwaves' });
  {
    // access stairs from the west deck down to the plaza (16 risers)
    const rise = stairsZ(16.4, 17.6, -3, 3.0, 16, 0.28, 1);
    const slope = rise / 0.28;
    const yr = (z: number) => 0.92 + 3.0 - (z + 3) * slope;
    for (const x of [16.47, 17.53]) {
      const z0 = -3.25, z1 = -3 + 15 * 0.28 + 0.3;
      pipe(V(x, 3.0 + 0.92, z0), V(x, yr(-3), -3), 0.024);
      pipe(V(x, yr(-3), -3), V(x, yr(z1), z1), 0.024);
      for (const z of [-3.15, -3 + 4 * 0.28 + 0.14, -3 + 9 * 0.28 + 0.14, -3 + 14 * 0.28 + 0.14]) {
        const k = Math.min(15, Math.max(0, Math.floor((z + 3) / 0.28)));
        const ys = z < -3 ? 3.0 : 3.0 - (k + 1) * rise;
        post(x, ys, z < -3 ? 3.0 + 0.92 : yr(z), z, 0.026);
      }
    }
    // deck railings (3 m drop), stair opening on the west deck's south end
    railing([V(16.5, 3, -3.35), V(16.5, 3, -14.9), V(18.95, 3, -14.9)]);
    railing([V(17.65, 3, -3.1), V(18.95, 3, -3.1)]);
    railing([V(29.05, 3, -14.9), V(31.5, 3, -14.9), V(31.5, 3, -3.1), V(29.05, 3, -3.1)]);
    // cage ladder on the east back wall
    for (const z of [-14.42, -13.98]) pipe(V(31.67, 0, z), V(31.67, 4.0, z), 0.022);
    for (let y = 0.3; y < 3.95; y += 0.3) pipe(V(31.67, y, -14.42), V(31.67, y, -13.98), 0.016);
    for (const y of [2.3, 3.0, 3.7]) tube(Array.from({ length: 9 }, (_, k) => { const a = (k / 8) * Math.PI; return V(31.67 + Math.sin(a) * 0.38, y, -14.2 + Math.cos(a) * 0.3); }), 0.014);
    colBox(31.6, 0, -14.48, 31.72, 3.0, -13.92);
    // shade sail over the west deck for spectators
    for (const z of [-14.3, -9.0, -3.7]) { post(16.62, 3.0, 5.65, z, 0.05); colBox(16.55, 3.0, z - 0.07, 16.69, 5.6, z + 0.07); }
    for (const z of [-14.3, -9.0, -3.7]) pipe(V(16.62, 5.6, z), V(18.35, 5.28, z), 0.035);
    pipe(V(16.62, 5.6, -14.3), V(16.62, 5.6, -3.7), 0.035);
    det.sails.push({ c: [V(16.7, 5.62, -14.2), V(16.7, 5.62, -3.8), V(18.3, 5.3, -3.8), V(18.3, 5.3, -14.2)], color: hex('#e86f52'), sag: 0.16 });
    // tags on the outside walls (abstract scribbles only)
    tag(V(31.6, 1.25, -6.6), V(1, 0, 0), 1.7, 0.95, 0, 0.04);
    tag(V(31.6, 0.75, -11.4), V(1, 0, 0), 1.15, 0.7, 3, -0.06, 0.85);
    tag(V(18.6, 1.35, -3.0), V(0, 0, 1), 1.2, 0.75, 5, 0.03);
    tag(V(17.9, 1.2, -15.0), V(0, 0, -1), 1.3, 0.8, 1, -0.04, 0.8);
    tag(V(30.2, 1.6, -15.0), V(0, 0, -1), 1.1, 0.65, 6, 0.07);
    tag(V(30.6, 0.6, -3.0), V(0, 0, 1), 0.9, 0.5, 2, 0.0, 0.7);
  }

  // ------------------------------------------------------------------ north quarter pipe + bank sharing a deck (backs onto the boardwalk)
  qp('north quarter', -12, -20.3, -3, -20.3, 0, 1, 0, 1.2, 1.8, 1.5, 0, 'B', 48);
  // (the hip below must use this quarter pipe's height, radius and profile segments: its first column is the QP's edge)
  {
    // the quarter pipe flows into the 30 deg bank through a moulded hip (x -3 .. 0): every row of the grid blends
    // the transition profile into the bank line with a smoothstep across x, so both seams are tangent-continuous; the
    // same triangles and normals are the collision surface. Wide and finely cut: a steeper twist faces the low sun at a
    // grazing angle, where coarse triangles shade one by one
    const xh = -3, x0 = 0, x1 = 6, zTop = -20.3, h = 1.2, Rq = 1.8;
    const prof = transitionProfile(h, Rq, 48), nv = prof.pts.length - 1, bmax = prof.topAngle;
    const run = h / Math.tan((30 * Math.PI) / 180);
    const cols: number[] = [];
    for (let i = 0; i <= 30; i++) cols.push(xh + ((x0 - xh) * i) / 30);
    for (let i = 1; i <= 4; i++) cols.push(x0 + ((x1 - x0) * i) / 4);
    const wOf = (x: number) => { const t = Math.min(1, Math.max(0, (x - xh) / (x0 - xh))); return { w: t * t * (3 - 2 * t), dw: 6 * t * (1 - t) / (x0 - xh) }; };
    const at = (u: number, v: number, o: Vector3, n?: Vector3) => {
      const x = cols[Math.round(u * (cols.length - 1))], j = Math.round(v * nv), s = j / nv;
      const q = prof.pts[j], { w, dw } = wOf(x);
      const yB = -h * s, dB = run * s;
      o.set(x, h + q.y + (yB - q.y) * w, zTop + q.d + (dB - q.d) * w);
      if (n) {
        // d/dx and d/ds of (y, d); normal = (dx * ys - yx * ds, ds, -ys)
        const yx = (yB - q.y) * dw, dx = (dB - q.d) * dw;
        const ys = -Rq * Math.sin(q.beta) * bmax * (1 - w) - h * w, ds = Rq * Math.cos(q.beta) * bmax * (1 - w) + run * w;
        n.set(dx * ys - yx * ds, ds, -ys).normalize();
      }
      return o;
    };
    const ao = mul(C_RAMP, 0.6);
    b.grid('concrete', cols.length - 1, nv, (u, v, o) => at(u, v, o), (u, v, o) => { at(u, v, new Vector3(), o); }, { color: C_RAMP, vcolor: (p) => (p.y > h - 0.004 ? ao : C_RAMP) });
    // the bank's far side wall
    b.polygon('wall', [V(x1, 0, zTop + run), V(x1, h, zTop), V(x1, 0, zTop)], V(1, 0, 0), { vcolor: grime(C_WALL, 0, 0.8) });
    // one coping from the quarter pipe over the hip to the end of the bank
    coping(V(xh, h, zTop), V(x1, h, zTop), V(0, 0, 1));
    const qline = grind.find((l) => l.name === 'north quarter coping')!;
    qline.pts[1].setX(x1);
    // deck behind the hip and the bank, back wall
    b.quad('concrete', V(xh, h, zTop), V(x1, h, zTop), V(x1, h, -21.8), V(xh, h, -21.8), { color: C_PLAZA }, UP);
    panel('wall', V(x1, 0, -21.8), V(xh, 0, -21.8), 0, h, V(0, 0, -1), C_WALL, { seams: 3 });
    panel('wall', V(x1, 0, zTop), V(x1, 0, -21.8), 0, h, V(1, 0, 0));
    tag(V(-8.6, 0.62, -21.8), V(0, 0, -1), 1.4, 0.75, 4, 0.05);
    tag(V(2.4, 0.6, -21.8), V(0, 0, -1), 1.2, 0.68, 7, -0.03, 0.75);
  }

  // ------------------------------------------------------------------ south terrace: bank, 6-stair + handrail, quarter pipe, side banks
  {
    const y = 1.0, z0 = 14, z1 = 21;
    b.quad('concrete', V(-4, y, z0), V(14, y, z0), V(14, y, z1), V(-4, y, z1), { color: C_PLAZA }, UP);
    // bank up from the plaza (30 deg), with a coping at its top
    const run = y / Math.tan((30 * Math.PI) / 180), zB = z0 - run;
    b.quad('concrete', V(-4, 0, zB), V(3, 0, zB), V(3, y, z0), V(-4, y, z0), { color: C_RAMP }, V(0, run, -y).normalize());
    b.polygon('wall', [V(-4, 0, zB), V(-4, y, z0), V(-4, 0, z0)], V(-1, 0, 0), { vcolor: grime(C_WALL, 0, 0.8) });
    b.polygon('wall', [V(3, 0, zB), V(3, y, z0), V(3, 0, z0)], V(1, 0, 0), { vcolor: grime(C_WALL, 0, 0.8) });
    grind.push({ name: 'terrace bank coping', kind: 'coping', pts: [V(-4, y + 0.02, z0), V(3, y + 0.02, z0)], closed: false, inward: [V(0, 0, -1), V(0, 0, -1)], metal: true });
    coping(V(-4, y, z0), V(3, y, z0), V(0, 0, -1));
    // walls of the terrace front
    panel('wall', V(3, 0, z0), V(5, 0, z0), 0, y, V(0, 0, -1));
    panel('wall', V(9, 0, z0), V(14, 0, z0), 0, y, V(0, 0, -1));
    grind.push({ name: 'terrace ledge', kind: 'ledge', pts: [V(9, y, z0), V(14, y, z0)], closed: false, inward: [V(0, 0, -1), V(0, 0, -1)], metal: true });
    wax(V(9, y, z0), V(14, y, z0), V(0, 0, 1), V(0, 0, -1), C_WALL);
    tag(V(12.6, 0.42, z0), V(0, 0, -1), 0.8, 0.42, 6, 0.04, 0.7);
    // stairs: 6 risers of 1/6 m, treads 0.32 m, descending north
    const nR = 6, tread = 0.32;
    const rise = stairsZ(5, 9, z0, y, nR, tread, -1);
    // handrail centred on the stairs, parallel to the nosing line
    const slope = rise / tread;
    const yr = (z: number) => 0.8 + y - (z0 - z) * slope;
    const zTopR = z0 + 0.35, zBotR = z0 - (nR - 1) * tread - 0.55;
    const rail = [V(7, yr(zTopR), zTopR), V(7, yr(zBotR), zBotR)];
    grind.push({ name: 'stair handrail', kind: 'rail', pts: rail, closed: false, metal: true });
    tube(rail, 0.025);
    for (const z of [z0 + 0.2, z0 - 2 * tread, z0 - 4.5 * tread]) {
      const k = Math.min(nR - 1, Math.max(0, Math.floor((z0 - z) / tread)));
      const ys = z > z0 ? y : y - (k + 1) * rise;
      post(7, ys, yr(z), z);
    }
    // quarter pipe at the back of the terrace + railing on its tall deck
    const R = 1.8, H = 1.4;
    const W = transitionProfile(H, R).W;
    const tq = qp('terrace quarter', 14, z1 + W, -4, z1 + W, 0, -1, y, H, R, 1.45, 0);
    const zBack = z1 + W + 1.45;
    railing([V(-3.9, tq.topY, z1 + W + 0.2), V(-3.9, tq.topY, zBack - 0.1), V(13.9, tq.topY, zBack - 0.1), V(13.9, tq.topY, z1 + W + 0.2)]);
    // terrace side walls below the deck level (split where the side banks attach)
    panel('wall', V(-4, 0, z1), V(-4, 0, 20.4), 0, y, V(-1, 0, 0));
    panel('wall', V(-4, 0, 15.4), V(-4, 0, z0), 0, y, V(-1, 0, 0));
    panel('wall', V(14, 0, z0), V(14, 0, 15.4), 0, y, V(1, 0, 0));
    panel('wall', V(14, 0, 20.4), V(14, 0, z1), 0, y, V(1, 0, 0));
    // side banks: terrace down to the SE / SW street sections
    bank('terrace east bank', V(14, 0, 15.4), V(14, 0, 20.4), V(1, 0, 0), y, 30, { cope: true });
    bank('terrace west bank', V(-4, 0, 20.4), V(-4, 0, 15.4), V(-1, 0, 0), y, 30, { cope: true });
  }

  // ------------------------------------------------------------------ funbox (truncated pyramid) + flat bar
  {
    const h = 0.6, tx0 = -3, tx1 = 3, tz0 = -3, tz1 = 0, o = 1.2;
    const T = [V(tx0, h, tz0), V(tx1, h, tz0), V(tx1, h, tz1), V(tx0, h, tz1)];
    const O = [V(tx0 - o, 0, tz0 - o), V(tx1 + o, 0, tz0 - o), V(tx1 + o, 0, tz1 + o), V(tx0 - o, 0, tz1 + o)];
    b.polygon('concrete', T, UP, { color: C_RAMP });
    for (let k = 0; k < 4; k++) {
      const a = T[k], c = T[(k + 1) % 4], d = O[(k + 1) % 4], e = O[k];
      const n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(e, a)).normalize();
      if (n.y < 0) n.negate();
      b.polygon('concrete', [a, c, d, e], n, { color: C_RAMP });
      if (k === 0 || k === 2) det.iron.push({ a: a.clone(), c: c.clone(), top: V(0, 0, k === 0 ? 1 : -1), side: V(0, -h, k === 0 ? -o : o).normalize(), out: n, paint: hex('#c9a227') });
    }
    grind.push({ name: 'funbox edge', kind: 'ledge', pts: [V(tx0, h, tz0), V(tx1, h, tz0)], closed: false, inward: [V(0, 0, -1), V(0, 0, -1)], metal: true });
    grind.push({ name: 'funbox edge', kind: 'ledge', pts: [V(tx0, h, tz1), V(tx1, h, tz1)], closed: false, inward: [V(0, 0, 1), V(0, 0, 1)], metal: true });
    const bar = [V(-2.2, h + 0.32, -1.5), V(2.2, h + 0.32, -1.5)];
    grind.push({ name: 'flat bar', kind: 'rail', pts: bar, closed: false, metal: true });
    tube(bar, 0.026);
    post(-2.0, h, h + 0.32, -1.5, 0.03); post(2.0, h, h + 0.32, -1.5, 0.03);
  }

  // ------------------------------------------------------------------ ledges, manual pads, flat rails
  const ledge = (name: string, x0: number, x1: number, z0: number, z1: number, h: number, paint: RGB) => {
    b.box('concrete', V(x0, 0, z0), V(x1, h, z1), { color: C_PLAZA }, ['-y', '+x', '-x', '+z', '-z']);
    b.box('paint', V(x0, 0, z0), V(x1, h, z1), { color: paint }, ['-y', '+y']);
    grind.push({ name, kind: 'ledge', pts: [V(x0, h, z0), V(x1, h, z0)], closed: false, inward: [V(0, 0, -1), V(0, 0, -1)], metal: true });
    grind.push({ name, kind: 'ledge', pts: [V(x0, h, z1), V(x1, h, z1)], closed: false, inward: [V(0, 0, 1), V(0, 0, 1)], metal: true });
    wax(V(x0, h, z0), V(x1, h, z0), V(0, 0, 1), V(0, 0, -1), paint);
    wax(V(x0, h, z1), V(x1, h, z1), V(0, 0, -1), V(0, 0, 1), paint);
  };
  ledge('long ledge', -10, 0, -12.6, -12.0, 0.45, [0.98, 0.74, 0.22]);
  ledge('red curb', 18, 27, 8.0, 8.5, 0.38, [0.86, 0.32, 0.27]);
  ledge('manual pad', -9, -5, 5.0, 6.6, 0.16, [0.25, 0.55, 0.78]);
  const flatRail = (name: string, a: Vector3, c: Vector3, posts: Vector3[]) => {
    grind.push({ name, kind: 'rail', pts: [a, c], closed: false, metal: true });
    tube([a, c], 0.025);
    for (const p of posts) post(p.x, 0, a.y, p.z, 0.026);
  };
  flatRail('flat rail', V(4, 0.36, -12.3), V(10, 0.36, -12.3), [V(4.4, 0, -12.3), V(9.6, 0, -12.3)]);

  // ------------------------------------------------------------------ NEW connecting features (filling the empty flat)
  // NW: quarter pipe on the boardwalk edge -> pyramid -> main bowl
  qp('nw quarter', -35.5, -21.0, -24.5, -21.0, 0, 1, 0, 1.4, 1.9, 1.5);
  tag(V(-31.5, 0.7, -22.5), V(0, 0, -1), 1.5, 0.8, 2, 0.03);
  tag(V(-26.8, 0.55, -22.5), V(0, 0, -1), 1.0, 0.6, 5, -0.05, 0.8);
  pyramid('pyramid', -30.2, -27.8, -14.8, -12.4, 0.75, 1.6, true, hex('#2f6f7a'));
  // long ledge -> curb -> pyramid: same grind line, short pushes
  ledge('nw curb', -22.5, -17.5, -12.6, -12.0, 0.32, hex('#4aa3a2'));

  // NE: raised platform off the north deck with a 3-stair, centre handrail, ledges and a small side bank
  {
    const y = 0.5, zf = -19.4, zb = -21.8, xa = 6, xb = 15.4, s0 = 9.4, s1 = 12.4;
    b.quad('concrete', V(xa, y, zb), V(xb, y, zb), V(xb, y, zf), V(xa, y, zf), { color: C_PLAZA }, UP);
    panel('wall', V(xa, 0, zf), V(s0, 0, zf), 0, y, V(0, 0, 1));
    panel('wall', V(s1, 0, zf), V(xb, 0, zf), 0, y, V(0, 0, 1));
    panel('wall', V(xb, 0, zb), V(xa, 0, zb), 0, y, V(0, 0, -1));
    panel('wall', V(xb, 0, -19.6), V(xb, 0, zf), 0, y, V(1, 0, 0));
    panel('wall', V(xb, 0, zb), V(xb, 0, -21.6), 0, y, V(1, 0, 0));
    bank('ne platform bank', V(xb, 0, -21.6), V(xb, 0, -19.6), V(1, 0, 0), y, 25, { iron: true });
    const rise = stairsZ(s0, s1, zf, y, 3, 0.32, 1);
    const slope = rise / 0.32;
    const yr = (z: number) => 0.8 + y - (z - zf) * slope;
    const zT = zf - 0.35, zBt = zf + 2 * 0.32 + 0.55;
    const rail = [V(10.9, yr(zT), zT), V(10.9, yr(zBt), zBt)];
    grind.push({ name: 'ne stair rail', kind: 'rail', pts: rail, closed: false, metal: true });
    tube(rail, 0.025);
    post(10.9, y, yr(zf - 0.2), zf - 0.2);
    post(10.9, 0, yr(zBt - 0.18), zBt - 0.18);
    for (const [x0, x1] of [[xa, s0], [s1, xb]] as [number, number][]) {
      grind.push({ name: 'ne ledge', kind: 'ledge', pts: [V(x0, y, zf), V(x1, y, zf)], closed: false, inward: [V(0, 0, 1), V(0, 0, 1)], metal: true });
      wax(V(x0, y, zf), V(x1, y, zf), V(0, 0, -1), V(0, 0, 1), C_WALL);
    }
    tag(V(13.6, 0.26, zb), V(0, 0, -1), 0.9, 0.42, 7, 0.02, 0.8);
  }
  // NE: mini quarter facing the half pipe's north entrance
  qp('ne mini quarter', 19.5, -21.4, 28.5, -21.4, 0, 1, 0, 0.9, 1.6, 1.2);
  tag(V(21.6, 0.42, -22.6), V(0, 0, -1), 1.0, 0.5, 1, 0.05, 0.9);
  // SE: terrace east bank -> waxed ledge -> bank with a drop
  ledge('se ledge', 18.6, 25.0, 17.5, 18.1, 0.42, hex('#2f8f86'));
  bank('se bank', V(27.3, 0, 15.5), V(27.3, 0, 20.5), V(-1, 0, 0), 0.8, 25, { back: true, cope: true });
  tag(V(27.3, 0.38, 18.6), V(1, 0, 0), 0.9, 0.45, 3, -0.02, 0.85);
  // SW: terrace west bank -> manual pad -> ledge -> pocket bowl
  ledge('sw manual pad', -15.5, -9.5, 18.8, 20.4, 0.2, hex('#f08a4b'));
  ledge('sw ledge', -27.0, -20.0, 21.6, 22.15, 0.45, hex('#e45a6a'));
  // east plaza: low round rail running north-south
  flatRail('east rail', V(13.4, 0.34, 2.6), V(13.4, 0.34, 8.2), [V(13.4, 0, 2.9), V(13.4, 0, 7.9)]);

  // ------------------------------------------------------------------ mural buildings (murals live on walls of real structures)
  const roofSlab = (x0: number, z0: number, x1: number, z1: number, y: number, t: number, fascia: RGB) =>
    b.box('wall', V(x0, y, z0), V(x1, y + t, z1), { collide: false, vcolor: (_p, n) => (n.y > 0.5 ? [0.72, 0.7, 0.68] : n.y < -0.5 ? [0.93, 0.9, 0.85] : fascia) });
  const plinth = (x0: number, z0: number, x1: number, z1: number) => {
    const c: RGB = [0.42, 0.4, 0.38];
    prop(boxGeo(x0 - 0.02, 0, z0 - 0.02, x1 + 0.02, 0.17, z0 + 0.04, c)); prop(boxGeo(x0 - 0.02, 0, z1 - 0.04, x1 + 0.02, 0.17, z1 + 0.02, c));
    prop(boxGeo(x0 - 0.02, 0, z0, x0 + 0.04, 0.17, z1, c)); prop(boxGeo(x1 - 0.04, 0, z0, x1 + 0.02, 0.17, z1, c));
  };
  const C_PAV: RGB = hex('#f3dcc0'), C_KIOSK: RGB = hex('#f6e7cf');
  {
    // koi pavilion: small park building (store + toilets) whose park-facing wall carries the koi mural
    const x0 = -42.6, x1 = -36.6, z0 = -4.8, z1 = 4.8, h = 3.4;
    panel('wall', V(x1, 0, z1), V(x1, 0, z0), 0, h, V(1, 0, 0), C_WALL, { grime: 0.7 });
    panel('wall', V(x0, 0, z0), V(x1, 0, z0), 0, h, V(0, 0, -1), C_PAV, { grime: 0.8, seams: 2.4 });
    panel('wall', V(x1, 0, z1), V(x0, 0, z1), 0, h, V(0, 0, 1), C_PAV, { grime: 0.8, seams: 2.4 });
    panel('wall', V(x0, 0, z1), V(x0, 0, z0), 0, h, V(-1, 0, 0), C_PAV, { grime: 0.8, seams: 3.2 });
    murals.push({ key: 'mural_koi', center: V(x1 + 0.012, h / 2 + 0.05, 0), normal: V(1, 0, 0), w: z1 - z0 - 0.3, h: h - 0.35, tex: 'mural_koi' });
    roofSlab(x0 - 0.4, z0 - 0.45, x1 + 0.5, z1 + 0.45, h, 0.26, hex('#2e8c8a'));
    plinth(x0, z0, x1, z1);
    // doors / windows / services on the outside
    prop(boxGeo(-42.25, 0, z0 - 0.06, -41.2, 2.15, z0 - 0.01, hex('#2e7f86'))); prop(boxGeo(-42.37, 0, z0 - 0.05, -41.08, 2.27, z0 - 0.005, hex('#f4efe6')));
    prop(boxGeo(-40.85, 0, z0 - 0.06, -39.8, 2.15, z0 - 0.01, hex('#e0a33a'))); prop(boxGeo(-40.97, 0, z0 - 0.05, -39.68, 2.27, z0 - 0.005, hex('#f4efe6')));
    det.sails.push({ c: [V(-42.5, 2.55, z0), V(-39.6, 2.55, z0), V(-39.6, 2.25, z0 - 0.9), V(-42.5, 2.25, z0 - 0.9)], color: hex('#f2c14e'), sag: 0.03 });
    for (const z of [-2.4, 0.4, 3.0]) { prop(boxGeo(x0 - 0.06, 2.15, z - 0.6, x0 - 0.01, 2.85, z + 0.6, hex('#f4efe6'))); prop(boxGeo(x0 - 0.07, 2.22, z - 0.53, x0 - 0.05, 2.78, z + 0.53, hex('#3b4f6b'))); }
    prop(cylGeo(x1 - 0.1, 0, h, z0 + 0.12, 0.05, hex('#9aa3a8'), 8));
    prop(boxGeo(-41.0, h + 0.26, 1.6, -39.9, h + 0.95, 2.4, hex('#c9cdd0'))); prop(cylGeo(-40.45, h + 0.95, h + 0.97, 2.0, 0.3, hex('#3a3f44'), 14));
    prop(cylGeo(-38.2, h + 0.26, h + 0.9, -3.0, 0.07, hex('#8a9095'), 8));
    tag(V(-42.6, 1.0, -1.2), V(-1, 0, 0), 1.3, 0.7, 4, 0.04, 0.8);
  }
  {
    // patchwork kiosk: beach snack kiosk; its park-facing wall carries the patchwork mural
    const { x0, x1, z0, z1, h, win } = KIOSK;
    panel('wall', V(x0, 0, z0), V(x1, 0, z0), 0, h, V(0, 0, -1), C_WALL, { grime: 0.7 });
    panel('wall', V(x0, 0, z1), V(x0, 0, z0), 0, h, V(-1, 0, 0), C_KIOSK, { grime: 0.8, seams: 2.2 });
    panel('wall', V(x1, 0, z0), V(x1, 0, z1), 0, h, V(1, 0, 0), C_KIOSK, { grime: 0.8, seams: 2.2 });
    // town side: the wall around the service window (the shallow lit shop inside is built with the scenery)
    const ko = { grime: 0.8, seams: 3.7, collide: false, ground: 0 };
    panel('wall', V(x1, 0, z1), V(win.x1, 0, z1), 0, h, V(0, 0, 1), C_KIOSK, ko);
    panel('wall', V(win.x0, 0, z1), V(x0, 0, z1), 0, h, V(0, 0, 1), C_KIOSK, ko);
    panel('wall', V(win.x1, 0, z1), V(win.x0, 0, z1), 0, win.y0, V(0, 0, 1), C_KIOSK, ko);
    panel('wall', V(win.x1, 0, z1), V(win.x0, 0, z1), win.y1, h, V(0, 0, 1), C_KIOSK, ko);
    b.quad(null, V(x1, 0, z1), V(x0, 0, z1), V(x0, h, z1), V(x1, h, z1), { visual: false }, V(0, 0, 1));
    // window reveal: the wall has a thickness at the opening
    for (const x of [win.x0 - 0.08, win.x1]) prop(boxGeo(x, win.y0 - 0.02, z1 - 0.14, x + 0.08, win.y1, z1 + 0.025, hex('#f4efe6')));
    murals.push({ key: 'mural_patchwork', center: V(25, h / 2 + 0.05, z0 - 0.012), normal: V(0, 0, -1), w: 10 - 0.3, h: h - 0.35, tex: 'mural_patchwork' });
    roofSlab(x0 - 0.35, z0 - 0.35, x1 + 0.35, z1 + 0.8, h, 0.24, hex('#e05a47'));
    plinth(x0, z0, x1, z1);
    // counter, window head, striped awning, stools on the town side
    prop(boxGeo(22.35, 0.9, z1, 27.65, 0.98, z1 + 0.38, hex('#f4efe6')));
    prop(boxGeo(22.35, 2.15, z1 - 0.14, 27.65, 2.25, z1 + 0.05, hex('#f4efe6')));
    for (let k = 0; k < 7; k++) {
      const x = 22.25 + k * 0.92;
      det.sails.push({ c: [V(x, 2.62, z1 + 0.02), V(x + 0.92, 2.62, z1 + 0.02), V(x + 0.92, 2.2, z1 + 1.15), V(x, 2.2, z1 + 1.15)], color: k % 2 ? hex('#fbf3e4') : hex('#2f8f86'), sag: 0.02 });
    }
    for (const x of [23.2, 24.6, 26.0, 27.0]) { prop(cylGeo(x, 0, 0.66, z1 + 0.75, 0.03, hex('#6c7378'), 6)); prop(cylGeo(x, 0.66, 0.71, z1 + 0.75, 0.17, hex('#e05a47'), 12)); }
    prop(boxGeo(x1 + 0.01, 0, 27.2, x1 + 0.06, 2.15, 28.2, hex('#2f8f86'))); prop(boxGeo(x1, 0, 27.08, x1 + 0.05, 2.27, 28.32, hex('#f4efe6')));
    prop(cylGeo(x0 + 0.1, 0, h, z0 + 0.12, 0.05, hex('#9aa3a8'), 8));
    tag(V(30.5, 1.1, 26.0), V(1, 0, 0), 1.0, 0.6, 0, -0.03, 0.75);
  }

  // ------------------------------------------------------------------ landscaped park edges: seat steps, planters, benches, bins
  const seatStep = (x0: number, z0: number, x1: number, z1: number, h = 0.45) =>
    b.box('wall', V(x0, 0, z0), V(x1, h, z1), { vcolor: (p, n) => (n.y > 0.5 ? mul(C_SEAT, 0.97 + 0.05 * hash(p.x, p.z)) : grime(C_WALL, 0, 0.9)(p)) }, ['-y']);
  const SOIL: RGB = hex('#5a4532');
  const planter = (x0: number, z0: number, x1: number, z1: number, h = 0.8, collide = true, plants = true) => {
    b.box('wall', V(x0, 0, z0), V(x1, h - 0.1, z1), { vcolor: grime(C_WALL, 0, 0.8, x0 + z0), collide: false }, ['-y', '+y']);
    const rim = 0.11;
    const rims: [number, number, number, number][] = [[x0, z0, x1, z0 + rim], [x0, z1 - rim, x1, z1], [x0, z0, x0 + rim, z1], [x1 - rim, z0, x1, z1]];
    for (const [a, c, d, e] of rims) b.box('wall', V(a - 0.015, h - 0.1, c - 0.015), V(d + 0.015, h, e + 0.015), { color: C_SEAT, collide: false }, ['-y']);
    prop(boxGeo(x0 + rim, h - 0.13, z0 + rim, x1 - rim, h - 0.08, z1 - rim, SOIL));
    if (collide) colBox(x0, 0, z0, x1, h, z1, ['+x', '-x', '+z', '-z', '+y']);
    if (!plants) return;
    const lx = x1 - x0, lz = z1 - z0, along = lx > lz;
    const L = along ? lx : lz, n = Math.max(1, Math.floor(L / 0.95));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5 + (rnd() - 0.5) * 0.5) / n;
      const w = (along ? lz : lx) - 2 * rim;
      const off = (rnd() - 0.5) * Math.max(0, w - 0.5);
      const x = along ? x0 + lx * t : (x0 + x1) / 2 + off, z = along ? (z0 + z1) / 2 + off : z0 + lz * t;
      const r = rnd();
      const kind = (r < 0.5 ? 0 : r < 0.72 ? 1 : r < 0.9 ? 2 : 3) as Plant['kind'];
      det.plants.push({ pos: V(x, h - 0.09, z), s: 0.75 + rnd() * 0.5, kind });
    }
  };
  // west edge (koi pavilion breaks it), east edge, south edge (terrace + kiosk break it)
  seatStep(-38.5, -23, -38.0, -4.8); seatStep(-38.5, 4.8, -38.0, 25.1);
  planter(-39.6, -23, -38.5, -4.8); planter(-39.6, 4.8, -38.5, 25.6);
  seatStep(38.0, -23, 38.5, 25.1);
  planter(38.5, -23, 39.6, 25.6);
  seatStep(-38.5, 25.1, -4.0, 25.6); seatStep(14.0, 25.1, 19.5, 25.6); seatStep(30.5, 25.1, 38.5, 25.6);
  planter(-39.6, 25.6, -4.0, 26.7); planter(14.0, 25.6, 19.5, 26.7); planter(30.5, 25.6, 39.6, 26.7);
  planter(-4.0, 24.25, 14.0, 26.7, 0.8, false);
  // boardwalk ends: planters across the boardwalk (the boardwalk continues outside the park)
  planter(-40.4, -27.3, -39.0, -23.0); planter(39.0, -27.3, 40.4, -23.0);
  // benches + bins on the edges
  const bench = (cx: number, cz: number, alongX: boolean, backSign: 1 | -1) => {
    const L = 1.8, D = 0.44;
    const ax = alongX ? L / 2 : D / 2, az = alongX ? D / 2 : L / 2;
    const bx = alongX ? 0 : backSign * (D / 2 - 0.03), bz = alongX ? backSign * (D / 2 - 0.03) : 0;
    for (const s of [-0.72, 0.72]) {
      const lx = cx + (alongX ? s : 0), lz = cz + (alongX ? 0 : s);
      b.box('wall', V(lx - (alongX ? 0.06 : D / 2), 0, lz - (alongX ? D / 2 : 0.06)), V(lx + (alongX ? 0.06 : D / 2), 0.42, lz + (alongX ? D / 2 : 0.06)), { color: C_SEAT, collide: false }, ['-y']);
      prop(boxGeo(lx + bx - 0.025, 0.42, lz + bz - 0.025, lx + bx + 0.025, 0.92, lz + bz + 0.025, hex('#3f5a5e')));
    }
    for (let k = 0; k < 3; k++) {
      const o = -D / 2 + 0.07 + k * 0.15;
      const x0 = alongX ? cx - ax : cx + o - 0.065, x1 = alongX ? cx + ax : cx + o + 0.065;
      const z0 = alongX ? cz + o - 0.065 : cz - az, z1 = alongX ? cz + o + 0.065 : cz + az;
      b.box('wood', V(x0, 0.42, z0), V(x1, 0.465, z1), { collide: false, uv: (p) => [p.x / 2, p.z / 2] }, ['-y']);
    }
    for (const yy of [0.62, 0.79]) {
      const x0 = alongX ? cx - ax : cx + bx - 0.02, x1 = alongX ? cx + ax : cx + bx + 0.02;
      const z0 = alongX ? cz + bz - 0.02 : cz - az, z1 = alongX ? cz + bz + 0.02 : cz + az;
      b.box('wood', V(x0, yy, z0), V(x1, yy + 0.11, z1), { collide: false, uv: (p) => [p.x / 2, p.z / 2] });
    }
    colBox(cx - ax, 0, cz - az, cx + ax, 0.465, cz + az, ['+x', '-x', '+z', '-z', '+y']);
    colBox(cx + bx - (alongX ? ax : 0.04), 0.465, cz + bz - (alongX ? 0.04 : az), cx + bx + (alongX ? ax : 0.04), 0.92, cz + bz + (alongX ? 0.04 : az));
  };
  bench(-30.5, 24.6, true, 1); bench(34.4, 24.6, true, 1); bench(-37.7, -12.0, false, -1); bench(37.7, -9.0, false, 1);
  const bin = (x: number, z: number) => {
    prop(cylGeo(x, 0, 0.86, z, 0.27, hex('#3f6f74'), 14, 0.29)); prop(cylGeo(x, 0.86, 0.93, z, 0.31, hex('#2e4f53'), 14));
    colBox(x - 0.29, 0, z - 0.29, x + 0.29, 0.93, z + 0.29, ['+x', '-x', '+z', '-z', '+y']);
  };
  bin(-32.0, 24.6); bin(32.8, 24.6); bin(-37.6, -13.6); bin(37.6, -10.6); bin(18.4, 2.1);
  // boardwalk benches (visual in the scenery): colliders
  for (const x of BOARDWALK_BENCH_X) {
    colBox(x - 0.9, 0, -26.83, x + 0.9, 0.48, -26.37, ['+x', '-x', '+z', '-z', '+y']);
    colBox(x - 0.9, 0.48, -26.89, x + 0.9, 0.95, -26.81);
  }

  // ------------------------------------------------------------------ plaza ground with bowl holes
  const outer = [V(-38, 0, -23), V(38, 0, -23), V(38, 0, 25.6), V(-38, 0, 25.6)];
  b.polygon('concrete', outer, UP, { color: C_PLAZA }, holes);

  // boardwalk (wood, flush with the plaza)
  b.quad('wood', V(-70, 0, -27.4), V(70, 0, -27.4), V(70, 0, -23), V(-70, 0, -23), {
    surface: Surface.Wood, uv: (p) => [p.x / 2.0, p.z / 2.0],
  }, UP);

  // ------------------------------------------------------------------ lamps + their colliders
  const lamps = [
    V(-37.3, 0, -22.3), V(-37.3, 0, -6.2), V(-37.3, 0, 12), V(-37.3, 0, 25), V(37.3, 0, -22.3), V(37.3, 0, -3), V(37.3, 0, 12),
    V(37.3, 0, 25), V(-14, 0, 25.2), V(16, 0, 25.2), V(10, 0, -22.4), V(-20, 0, -22.4),
  ];
  for (const lp of lamps) colBox(lp.x - 0.13, lp.y, lp.z - 0.13, lp.x + 0.13, lp.y + 3.4, lp.z + 0.13);
  for (const x of BOARDWALK_LAMP_X) if (Math.abs(x) < 39) colBox(x - 0.13, 0, -27.13, x + 0.13, 3.4, -26.87);

  // ------------------------------------------------------------------ invisible fences (block only) just behind the visible barriers
  const fence = (x0: number, z0: number, x1: number, z1: number, n: Vector3) =>
    b.quad(null, V(x0, 0, z0), V(x1, 0, z1), V(x1, 3.6, z1), V(x0, 3.6, z0), { visual: false, surface: Surface.Barrier }, n);
  fence(-39.2, -27.45, -39.2, 26.2, V(1, 0, 0));
  fence(39.2, -27.45, 39.2, 26.2, V(-1, 0, 0));
  fence(-39.2, 26.2, 39.2, 26.2, V(0, 0, -1));
  fence(-39.2, -27.45, 39.2, -27.45, V(0, 0, 1));

  return {
    builder: b, grindLines: grind, lamps, murals, tubes, detail: det,
    spawn: { pos: V(9, 0, 3), heading: Math.PI },
    landmarks: {
      bowl: { pos: V(-15.5, 1.7, 7.5), look: V(-27, -1.6, -2) },
      pocket: { pos: V(-17, 1.6, 20.5), look: V(-27, -1.0, 13) },
      halfpipe: { pos: V(24, 4.5, 6), look: V(24, 1.2, -9) },
      stairs: { pos: V(12, 2.2, 6), look: V(7, 0.6, 13) },
      funbox: { pos: V(7, 2.2, 6), look: V(0, 0.3, -1.5) },
      ledges: { pos: V(-2, 1.8, -7), look: V(-3, 0.3, -12.3) },
      north: { pos: V(-2, 2.5, -10), look: V(-4, 0.6, -20) },
      terraceqp: { pos: V(5, 3.0, 9), look: V(5, 1.5, 22) },
      muralkoi: { pos: V(-26, 2.2, 0), look: V(-36.6, 1.6, 0) },
      muralpatch: { pos: V(25, 2.0, 12), look: V(25, 1.5, 24.9) },
      ocean: { pos: V(0, 3.5, -24), look: V(-40, 0, -120) },
      boardwalk: { pos: V(-14, 2.0, -18), look: V(10, 0.5, -26) },
      // pass 2: new lines, structure details, edges
      nwquarter: { pos: V(-25, 2.4, -10.5), look: V(-31, 0.6, -19) },
      nwcurb: { pos: V(-13.0, 1.7, -9.2), look: V(-21, 0.2, -12.4) },
      nestairs: { pos: V(11.5, 2.0, -13.0), look: V(11, 0.3, -19.8) },
      neminiqp: { pos: V(24, 2.4, -12.5), look: V(24, 0.4, -21) },
      seline: { pos: V(21.5, 2.3, 11.0), look: V(22, 0.3, 18) },
      swline: { pos: V(-7, 2.1, 15.5), look: V(-18, 0.2, 21) },
      eastrail: { pos: V(17.5, 1.8, 10.5), look: V(13.4, 0.2, 4.5) },
      hpdeck: { pos: V(11.5, 2.8, 5.5), look: V(17.6, 2.4, -6) },
      hpeast: { pos: V(36.5, 2.2, 0.5), look: V(31.6, 1.6, -9) },
      hpcoping: { pos: V(21.2, 3.6, -6.2), look: V(19.2, 2.9, -9.5) },
      kiosk: { pos: V(25, 3.0, 36), look: V(25, 1.6, 27) },
      edgeeast: { pos: V(33.5, 1.7, 4.0), look: V(39, 0.6, -2) },
      edgesouth: { pos: V(-22, 1.7, 19.5), look: V(-26, 0.5, 26) },
      stairsclose: { pos: V(9.6, 0.7, 10.6), look: V(7, 0.45, 13.4) },
      funboxiron: { pos: V(2.6, 1.05, 2.0), look: V(0.6, 0.55, 0) },
      ledgewax: { pos: V(-3.6, 0.95, -10.8), look: V(-6, 0.4, -12.6) },
      bowlcoping: { pos: V(-19.6, 1.0, 5.8), look: V(-23, -0.4, 7.4) },
    },
  };
}

export function mergeTubes(tubes: BufferGeometry[]) {
  for (const t of tubes) { if (t.getAttribute('uv')) t.deleteAttribute('uv'); }
  return mergeGeometries(tubes.map((t) => (t.index ? t.toNonIndexed() : t)));
}

export function meshFromBuilder(b: ParkBuilder, key: string, mat: Material) {
  const bk = b.buckets.get(key);
  if (!bk) return null;
  const m = new Mesh(b.toGeometry(bk), mat);
  m.receiveShadow = true; m.castShadow = true;
  return m;
}

export type { PathPt };
export { Group };
