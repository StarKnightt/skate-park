import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2, Vector3 } from 'three';

/** Barrier = invisible block-only fence just behind a visible barrier (physics never bails on it). */
export const enum Surface { Concrete = 0, Wood = 1, Sand = 2, Barrier = 9 }

export interface Bucket { pos: number[]; nor: number[]; uv: number[]; col: number[]; idx: number[] }

export interface BuildOpts {
  collide?: boolean;
  surface?: Surface;
  color?: [number, number, number];
  /** per-vertex colour for the visual bucket (overrides `color`); never affects collision */
  vcolor?: (p: Vector3, n: Vector3) => [number, number, number];
  visual?: boolean;
  uv?: (p: Vector3) => [number, number];
}

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _n = new Vector3();

/** Accumulates visual buckets (one mesh per material) and one collision mesh with smooth vertex normals. */
export class ParkBuilder {
  buckets = new Map<string, Bucket>();
  cPos: number[] = [];
  cNor: number[] = [];
  cIdx: number[] = [];
  cSurf: number[] = [];

  bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) { b = { pos: [], nor: [], uv: [], col: [], idx: [] }; this.buckets.set(key, b); }
    return b;
  }

  /** Add an indexed triangle soup. verts/normals are flat xyz arrays. */
  addMesh(key: string | null, verts: number[], normals: number[], tris: number[], o: BuildOpts = {}) {
    const visual = o.visual !== false && key !== null;
    if (visual) {
      const b = this.bucket(key!);
      const base = b.pos.length / 3;
      const col0 = o.color ?? [1, 1, 1];
      for (let i = 0; i < verts.length; i += 3) {
        b.pos.push(verts[i], verts[i + 1], verts[i + 2]);
        b.nor.push(normals[i], normals[i + 1], normals[i + 2]);
        if (o.uv) { const uv = o.uv(_a.set(verts[i], verts[i + 1], verts[i + 2])); b.uv.push(uv[0], uv[1]); } else b.uv.push(0, 0);
        const col = o.vcolor ? o.vcolor(_a.set(verts[i], verts[i + 1], verts[i + 2]), _n.set(normals[i], normals[i + 1], normals[i + 2])) : col0;
        b.col.push(col[0], col[1], col[2]);
      }
      for (const t of tris) b.idx.push(base + t);
    }
    if (o.collide !== false) {
      const base = this.cPos.length / 3;
      for (let i = 0; i < verts.length; i++) { this.cPos.push(verts[i]); this.cNor.push(normals[i]); }
      for (const t of tris) this.cIdx.push(base + t);
      // per-vertex surface id (the BVH reorders triangles, vertices stay put)
      for (let i = 0; i < verts.length; i += 3) this.cSurf.push(o.surface ?? Surface.Concrete);
    }
  }

  /**
   * Parametric grid surface. f(u,v) -> position, nf(u,v) -> normal (optional; finite differences otherwise).
   * Winding is fixed automatically so triangle normals agree with the supplied normals (or `up` hint).
   */
  grid(key: string | null, nu: number, nv: number, f: (u: number, v: number, out: Vector3) => void,
    nf: ((u: number, v: number, out: Vector3) => void) | null, o: BuildOpts = {}, hint?: Vector3) {
    const verts: number[] = [], normals: number[] = [], tris: number[] = [];
    const p = new Vector3(), q = new Vector3(), r = new Vector3(), n = new Vector3();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        f(u, v, p);
        verts.push(p.x, p.y, p.z);
        if (nf) nf(u, v, n);
        else {
          const e = 1e-3;
          f(Math.min(1, u + e), v, q); f(Math.max(0, u - e), v, r); q.sub(r);
          f(u, Math.min(1, v + e), r); f(u, Math.max(0, v - e), _c); r.sub(_c);
          n.crossVectors(q, r).normalize();
          if (hint && n.dot(hint) < 0) n.negate();
        }
        normals.push(n.x, n.y, n.z);
      }
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      tris.push(a, c, b, b, c, d);
    }
    this.fixWinding(verts, normals, tris);
    this.addMesh(key, verts, normals, tris, o);
  }

  private fixWinding(verts: number[], normals: number[], tris: number[]) {
    for (let t = 0; t < tris.length; t += 3) {
      const i0 = tris[t] * 3, i1 = tris[t + 1] * 3, i2 = tris[t + 2] * 3;
      _a.set(verts[i0], verts[i0 + 1], verts[i0 + 2]);
      _b.set(verts[i1], verts[i1 + 1], verts[i1 + 2]).sub(_a);
      _c.set(verts[i2], verts[i2 + 1], verts[i2 + 2]).sub(_a);
      _n.crossVectors(_b, _c);
      const dn = _n.x * (normals[i0] + normals[i1] + normals[i2]) + _n.y * (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) +
        _n.z * (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]);
      if (dn < 0) { const tmp = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = tmp; }
    }
  }

  /** Planar polygon (any simple outline, optional holes) with a given facing normal. */
  polygon(key: string | null, outline: Vector3[], normal: Vector3, o: BuildOpts = {}, holes: Vector3[][] = []) {
    const n = normal.clone().normalize();
    const t = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0).cross(n).normalize() : new Vector3(1, 0, 0).cross(n).normalize();
    const b2 = n.clone().cross(t).normalize();
    const to2 = (p: Vector3) => new Vector2(p.dot(t), p.dot(b2));
    const contour = outline.map(to2);
    const hs = holes.map((h) => h.map(to2));
    const faces = ShapeUtils.triangulateShape(contour, hs);
    const all = [...outline, ...holes.flat()];
    const verts: number[] = [], normals: number[] = [], tris: number[] = [];
    for (const p of all) { verts.push(p.x, p.y, p.z); normals.push(n.x, n.y, n.z); }
    const c2 = [...contour, ...hs.flat()];
    for (const f of faces) {
      const p = c2[f[0]], q = c2[f[1]], r = c2[f[2]];
      if (Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) < 1e-9) continue; // collinear outline vertices
      tris.push(f[0], f[1], f[2]);
    }
    this.fixWinding(verts, normals, tris);
    this.addMesh(key, verts, normals, tris, o);
  }

  quad(key: string | null, a: Vector3, b: Vector3, c: Vector3, d: Vector3, o: BuildOpts = {}, normal?: Vector3) {
    const n = normal ?? new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();
    this.polygon(key, [a, b, c, d], n, o);
  }

  /** Axis aligned box. skip: faces to omit ('-y' etc). */
  box(key: string | null, min: Vector3, max: Vector3, o: BuildOpts = {}, skip: string[] = []) {
    const [x0, y0, z0] = [min.x, min.y, min.z], [x1, y1, z1] = [max.x, max.y, max.z];
    const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
    const faces: [string, Vector3[], Vector3][] = [
      ['+y', [V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1)], V(0, 1, 0)],
      ['-y', [V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1)], V(0, -1, 0)],
      ['+x', [V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), V(x1, y0, z1)], V(1, 0, 0)],
      ['-x', [V(x0, y0, z0), V(x0, y1, z0), V(x0, y1, z1), V(x0, y0, z1)], V(-1, 0, 0)],
      ['+z', [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)], V(0, 0, 1)],
      ['-z', [V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0)], V(0, 0, -1)],
    ];
    for (const [name, pts, n] of faces) if (!skip.includes(name)) this.polygon(key, pts, n, o);
  }

  toGeometry(b: Bucket) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(b.col), 3));
    const n = b.pos.length / 3;
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  collisionGeometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.cPos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.cNor), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(this.cIdx), 1));
    return g;
  }
}

/** Transition profile from the coping (d=0, y=0) down to the flat (d=W, y=-H). Returns points and slope angles. */
export function transitionProfile(H: number, R: number, segs = 22) {
  const pts: { d: number; y: number; beta: number }[] = [];
  if (H <= R + 1e-6) {
    const bmax = Math.acos(1 - H / R);
    const W = R * Math.sin(bmax);
    for (let i = 0; i <= segs; i++) {
      const b = bmax * (1 - i / segs);
      pts.push({ d: W - R * Math.sin(b), y: -H + R - R * Math.cos(b), beta: b });
    }
    return { pts, W, topAngle: bmax };
  }
  const vert = H - R;
  const nv = 2;
  for (let i = 0; i < nv; i++) pts.push({ d: 0, y: -vert * (i / nv), beta: Math.PI / 2 });
  for (let i = 0; i <= segs; i++) {
    const b = (Math.PI / 2) * (1 - i / segs);
    pts.push({ d: R - R * Math.sin(b), y: -vert - R * Math.cos(b), beta: b });
  }
  return { pts, W: R, topAngle: Math.PI / 2 };
}

export interface PathPt { x: number; z: number; mx: number; mz: number }

/** Closed rounded rectangle (counter-clockwise seen from above), inward normals. */
export function roundedRectPath(cx: number, cz: number, hx: number, hz: number, rc: number, step = 0.32): PathPt[] {
  const out: PathPt[] = [];
  const corners = [
    { x: cx + hx - rc, z: cz + hz - rc, a0: 0 },
    { x: cx - hx + rc, z: cz + hz - rc, a0: Math.PI / 2 },
    { x: cx - hx + rc, z: cz - hz + rc, a0: Math.PI },
    { x: cx + hx - rc, z: cz - hz + rc, a0: Math.PI * 1.5 },
  ];
  for (let k = 0; k < 4; k++) {
    const c = corners[k];
    const na = Math.max(6, Math.ceil(((Math.PI / 2) * rc) / step));
    for (let i = 0; i < na; i++) {
      const a = c.a0 + (Math.PI / 2) * (i / na);
      const x = c.x + Math.cos(a) * rc, z = c.z + Math.sin(a) * rc;
      out.push({ x, z, mx: -Math.cos(a), mz: -Math.sin(a) });
    }
    const nx = corners[(k + 1) % 4];
    const aEnd = c.a0 + Math.PI / 2;
    const sx = c.x + Math.cos(aEnd) * rc, sz = c.z + Math.sin(aEnd) * rc;
    const ex = nx.x + Math.cos(nx.a0) * rc, ez = nx.z + Math.sin(nx.a0) * rc;
    const len = Math.hypot(ex - sx, ez - sz);
    const ns = Math.max(1, Math.ceil(len / (step * 1.6)));
    for (let i = 0; i < ns; i++) {
      const t = i / ns;
      out.push({ x: sx + (ex - sx) * t, z: sz + (ez - sz) * t, mx: -Math.cos(aEnd), mz: -Math.sin(aEnd) });
    }
  }
  return out;
}
