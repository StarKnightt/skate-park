import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, NoColorSpace, RepeatWrapping,
  SRGBColorSpace, Vector3, ClampToEdgeWrapping,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/materials';
import { agaveGeo, agaveMaterial, FoliageBuilder, foliageMaterial, Leaf } from './foliage';
import type { EdgeStrip, ParkData, PathPt, Plant, RGB } from './park';

const UP = new Vector3(0, 1, 0);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash1 = (x: number) => { const s = Math.sin(x * 127.1 + 17.3) * 43758.5453; return s - Math.floor(s); };
const noise1 = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; };
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lin = (h: string): RGB => { const c = new Color(h); return [c.r, c.g, c.b]; };

/** growable triangle soup with per-vertex normal/colour/uv */
class Soup {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; idx: number[] = [];
  v(p: Vector3, n: Vector3, c: RGB, u = 0, w = 0) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.col.push(c[0], c[1], c[2]); this.uv.push(u, w);
    return this.pos.length / 3 - 1;
  }
  /** connect ring A (indices) to ring B */
  strip(a: number[], b: number[], flip = false) {
    for (let k = 0; k < a.length - 1; k++) {
      if (flip) this.idx.push(a[k], a[k + 1], b[k], b[k], a[k + 1], b[k + 1]);
      else this.idx.push(a[k], b[k], a[k + 1], a[k + 1], b[k], b[k + 1]);
    }
  }
  geometry(withUv = false) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    if (withUv) g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
  /** make every triangle face along its vertex normals */
  fixWinding() {
    const P = this.pos, N = this.nor, I = this.idx;
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let t = 0; t < I.length; t += 3) {
      const i0 = I[t] * 3, i1 = I[t + 1] * 3, i2 = I[t + 2] * 3;
      a.set(P[i0], P[i0 + 1], P[i0 + 2]);
      b.set(P[i1] - a.x, P[i1 + 1] - a.y, P[i1 + 2] - a.z);
      c.set(P[i2] - a.x, P[i2 + 1] - a.y, P[i2 + 2] - a.z);
      b.cross(c);
      const d = b.x * (N[i0] + N[i1] + N[i2]) + b.y * (N[i0 + 1] + N[i1 + 1] + N[i2 + 1]) + b.z * (N[i0 + 2] + N[i1 + 2] + N[i2 + 2]);
      if (d < 0) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
    }
    return this;
  }
}

// ------------------------------------------------------------------ chunky pool coping (bullnose blocks, joints, chips, grind marks)
function poolCoping(path: PathPt[], seed: number, s: Soup) {
  const rnd = mulberry(seed);
  const n = path.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) { const a = path[i - 1], c = path[i % n]; cum.push(cum[i - 1] + Math.hypot(c.x - a.x, c.z - a.z)); }
  const L = cum[n];
  const at = (sv: number) => {
    sv = ((sv % L) + L) % L;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= sv) lo = mid; else hi = mid - 1; }
    const a = path[lo], c = path[(lo + 1) % n];
    const t = (sv - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
    const mx = a.mx + (c.mx - a.mx) * t, mz = a.mz + (c.mz - a.mz) * t, ml = Math.hypot(mx, mz) || 1;
    return { x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, mx: mx / ml, mz: mz / ml };
  };
  // bullnose profile: (d along the inward normal, y, 2D normal, grind weight)
  const prof: { d: number; y: number; nd: number; ny: number; gw: number }[] = [
    { d: -0.32, y: 0.003, nd: 0, ny: 1, gw: 0 }, { d: -0.17, y: 0.006, nd: 0, ny: 1, gw: 0.08 }, { d: -0.04, y: 0.006, nd: 0, ny: 1, gw: 0.45 },
  ];
  const cx = -0.012, cy = -0.046, r = 0.052;
  for (let k = 0; k <= 7; k++) {
    const ang = Math.PI / 2 - (k / 7) * (Math.PI / 2 + 1.2);
    prof.push({ d: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, nd: Math.cos(ang), ny: Math.sin(ang), gw: [0.9, 1, 1, 0.85, 0.6, 0.35, 0.15, 0.05][k] });
  }
  prof.push({ d: -0.004, y: -0.106, nd: 0.5, ny: -0.86, gw: 0 });
  const nb = Math.max(4, Math.round(L / 0.62));
  const bl = L / nb;
  const ringsS: { s: number; joint: number; block: number }[] = [];
  const chips: { s: number; w: number; d: number }[] = [];
  for (let k = 0; k < nb; k++) {
    const s0 = k * bl;
    const list = [s0 + 0.004, s0 + 0.013];
    for (let t = s0 + 0.08; t < s0 + bl - 0.05; t += 0.08) list.push(t);
    if (rnd() < 0.38) {
      const c = s0 + 0.12 + rnd() * (bl - 0.24), w = 0.05 + rnd() * 0.07;
      chips.push({ s: c, w, d: 0.011 + rnd() * 0.012 });
      list.push(c - w / 2, c - w / 4, c, c + w / 4, c + w / 2);
    }
    list.push(s0 + bl - 0.013, s0 + bl - 0.004);
    list.sort((a, b) => a - b);
    let last = -1;
    for (const t of list) {
      if (t - last < 0.006) continue;
      last = t;
      const dj = Math.min(t - s0, s0 + bl - t);
      ringsS.push({ s: t, joint: dj < 0.006 ? 1 : dj < 0.015 ? 0.35 : 0, block: k });
    }
  }
  const tint = Array.from({ length: nb }, () => 0.95 + rnd() * 0.08);
  const base: RGB = [0.87, 0.85, 0.81];
  const rings: number[][] = [];
  const p = new Vector3(), nrm = new Vector3();
  for (const rg of ringsS) {
    const P = at(rg.s);
    let chipF = 0, chipD = 0;
    for (const c of chips) { const q = Math.abs(rg.s - c.s) / (c.w / 2); if (q < 1) { const f = 1 - q * q; if (f > chipF) { chipF = f; chipD = c.d; } } }
    const mark = smooth(0.5, 0.85, noise1(rg.s * 1.9 + seed) * 0.7 + noise1(rg.s * 7.3) * 0.3);
    const scuff = smooth(0.82, 0.95, noise1(rg.s * 3.1 + 40 + seed));
    const ring: number[] = [];
    prof.forEach((q, j) => {
      let d = q.d, y = q.y;
      const nose = j >= 2 && j <= 10;
      if (rg.joint >= 1) { y -= 0.004 * (q.ny > 0.3 ? 1 : 0); d -= nose ? 0.004 : 0; }
      if (chipF > 0 && nose) { d -= chipD * chipF * (0.4 + 0.6 * q.gw); y -= chipD * 0.5 * chipF * Math.max(0, q.ny); }
      p.set(P.x + P.mx * d, y, P.z + P.mz * d);
      nrm.set(P.mx * q.nd, q.ny, P.mz * q.nd).normalize();
      let f = tint[rg.block] * (0.97 + 0.06 * hash1(rg.s * 31.7 + j));
      f *= 1 - 0.58 * mark * q.gw - 0.25 * scuff * (j <= 2 ? 1 : 0.3);
      if (chipF > 0.25 && nose) f *= 1.14;
      else if (chipF > 0 && nose) f *= 0.8;
      if (rg.joint >= 1) f *= 0.36; else if (rg.joint > 0) f *= 0.82;
      ring.push(s.v(p, nrm, [base[0] * f, base[1] * f, base[2] * f * 1.01]));
    });
    rings.push(ring);
  }
  for (let i = 0; i < rings.length; i++) s.strip(rings[i], rings[(i + 1) % rings.length]);
}

// ------------------------------------------------------------------ steel angle iron (polished where ground, painted / rusty at the ends)
function angleIron(e: EdgeStrip, s: Soup) {
  const len = e.a.distanceTo(e.c);
  const t = e.c.clone().sub(e.a).normalize();
  const W = 0.052, T = 0.006;
  const corner = UP.clone().add(e.out).normalize();
  const steel: RGB = [0.86, 0.88, 0.92], dark: RGB = [0.3, 0.31, 0.33], rust: RGB = lin('#8a4a24');
  const paint = e.paint;
  const nSeg = Math.max(2, Math.ceil(len / 0.05));
  const cs = (E: Vector3) => [
    { p: E.clone().addScaledVector(e.top, W), n: e.top, k: 0.0 },
    { p: E.clone().addScaledVector(e.top, W).addScaledVector(UP, T), n: UP, k: 0.0 },
    { p: E.clone().addScaledVector(e.top, 0.006).addScaledVector(UP, T), n: UP, k: 0.8 },
    { p: E.clone().addScaledVector(corner, T * 1.15), n: corner, k: 1.0 },
    { p: E.clone().addScaledVector(e.side, 0.006).addScaledVector(e.out, T), n: e.out, k: 0.8 },
    { p: E.clone().addScaledVector(e.side, W).addScaledVector(e.out, T), n: e.out, k: 0.0 },
    { p: E.clone().addScaledVector(e.side, W), n: e.side, k: 0.0 },
  ];
  const rings: number[][] = [];
  for (let i = 0; i <= nSeg; i++) {
    const sv = (len * i) / nSeg;
    const E = e.a.clone().addScaledVector(t, sv);
    const endD = Math.min(sv, len - sv);
    const painted = smooth(0.34, 0.1, endD);
    const rustAmt = smooth(0.45, 0.75, noise1(sv * 9.0 + e.a.x * 3.0 + e.a.z)) * (0.35 + 0.65 * painted);
    const ring: number[] = [];
    for (const q of cs(E)) {
      // middle: ground to bright steel on the corner, worn paint over dark steel on the leg edges
      const worn = noise1(sv * 14.0 + q.k * 5.0) > 0.55 ? 1 : 0;
      const mid: RGB = q.k > 0.5 ? steel : worn ? [paint[0] * 0.8, paint[1] * 0.8, paint[2] * 0.8] : dark;
      const ends: RGB = rustAmt > 0.4 ? rust : paint;
      const c: RGB = [0, 1, 2].map((j) => mid[j] * (1 - painted) + ends[j] * painted) as RGB;
      ring.push(s.v(q.p, q.n, c));
    }
    rings.push(ring);
  }
  for (let i = 0; i < nSeg; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let k = 0; k < a.length - 1; k++) s.idx.push(a[k], b[k], a[k + 1], a[k + 1], b[k], b[k + 1]);
  }
}

// ------------------------------------------------------------------ waxed grind edge (dark, a bit shiny, scraped)
function waxStrip(e: EdgeStrip, s: Soup) {
  const len = e.a.distanceTo(e.c);
  const t = e.c.clone().sub(e.a).normalize();
  const lift = 0.0025, Wt = 0.08, Ws = 0.042;
  const corner = UP.clone().add(e.out).normalize();
  const waxC: RGB = [0.56, 0.53, 0.5], edgeC: RGB = [0.82, 0.8, 0.77];
  const sideC: RGB = [e.paint[0] * 0.66, e.paint[1] * 0.64, e.paint[2] * 0.62];
  const nSeg = Math.max(2, Math.ceil(len / 0.3));
  const rings: number[][] = [];
  for (let i = 0; i <= nSeg; i++) {
    const sv = (len * i) / nSeg;
    const E = e.a.clone().addScaledVector(t, sv);
    const u = sv / 0.6;
    const pts: [Vector3, Vector3, RGB, number][] = [
      [E.clone().addScaledVector(e.top, Wt).addScaledVector(UP, lift), UP, [0.86, 0.83, 0.79], 0],
      [E.clone().addScaledVector(e.top, Wt * 0.55).addScaledVector(UP, lift), UP, waxC, 0.25],
      [E.clone().addScaledVector(e.top, 0.008).addScaledVector(UP, lift), UP, waxC, 0.5],
      [E.clone().addScaledVector(corner, lift * 1.3), corner, edgeC, 0.6],
      [E.clone().addScaledVector(e.side, 0.008).addScaledVector(e.out, lift), e.out, sideC, 0.7],
      [E.clone().addScaledVector(e.side, Ws).addScaledVector(e.out, lift), e.out, [e.paint[0] * 0.9, e.paint[1] * 0.9, e.paint[2] * 0.9], 1],
    ];
    rings.push(pts.map(([p, n, c, v]) => s.v(p, n, c, u, v)));
  }
  for (let i = 0; i < nSeg; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let k = 0; k < a.length - 1; k++) s.idx.push(a[k], b[k], a[k + 1], a[k + 1], b[k], b[k + 1]);
  }
}

function waxTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const x = c.getContext('2d')!;
  const rnd = mulberry(31);
  x.fillStyle = 'rgb(232,232,232)'; x.fillRect(0, 0, 512, 64);
  // dark waxy smears along the length
  for (let i = 0; i < 70; i++) {
    const y = 6 + rnd() * 34, w = 30 + rnd() * 160, h = 2 + rnd() * 9, x0 = rnd() * 512;
    x.fillStyle = `rgba(60,58,56,${0.12 + rnd() * 0.25})`;
    for (const o of [0, -512, 512]) { x.beginPath(); x.ellipse(x0 + o, y, w / 2, h / 2, 0, 0, Math.PI * 2); x.fill(); }
  }
  // scrape lines (lighter) and black truck marks
  for (let i = 0; i < 140; i++) {
    const y = 2 + rnd() * 44, x0 = rnd() * 512, l = 20 + rnd() * 200;
    const light = rnd() < 0.6;
    x.strokeStyle = light ? `rgba(255,255,255,${0.25 + rnd() * 0.4})` : `rgba(20,20,22,${0.2 + rnd() * 0.35})`;
    x.lineWidth = 0.6 + rnd() * 1.4;
    for (const o of [0, -512, 512]) { x.beginPath(); x.moveTo(x0 + o, y); x.lineTo(x0 + o + l, y + (rnd() - 0.5) * 2); x.stroke(); }
  }
  // paint chips on the side face (lower part of v)
  for (let i = 0; i < 50; i++) {
    x.fillStyle = `rgba(250,248,240,${0.35 + rnd() * 0.4})`;
    x.fillRect(rnd() * 512, 46 + rnd() * 16, 3 + rnd() * 14, 2 + rnd() * 5);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.flipY = false;
  t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ abstract spray tags (scribbles, blobs, bursts; never letters)
function tagAtlas() {
  const TS = 256, c = document.createElement('canvas'); c.width = TS * 4; c.height = TS * 2;
  const x = c.getContext('2d')!;
  const rnd = mulberry(77);
  const pal = ['#e8463a', '#2a9d8f', '#f4a261', '#6a4c93', '#1d3557', '#ff70a6', '#ffd23f', '#3a86ff', '#8ac926', '#fb5607'];
  const pick = () => pal[Math.floor(rnd() * pal.length)];
  const blob = (cx: number, cy: number, sc: number, fill: string, line: string) => {
    const pts: [number, number, number][] = [];
    const nb = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < nb; i++) pts.push([cx + (i - (nb - 1) / 2) * sc * 0.42 + (rnd() - 0.5) * sc * 0.2, cy + (rnd() - 0.5) * sc * 0.5, sc * (0.32 + rnd() * 0.25)]);
    x.lineJoin = 'round';
    x.fillStyle = line; for (const [px, py, r] of pts) { x.beginPath(); x.arc(px, py, r + sc * 0.09, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = fill; for (const [px, py, r] of pts) { x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); }
    x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = sc * 0.06; x.lineCap = 'round';
    for (const [px, py, r] of pts) { x.beginPath(); x.arc(px - r * 0.2, py - r * 0.2, r * 0.6, Math.PI * 1.05, Math.PI * 1.45); x.stroke(); }
    // drips
    x.strokeStyle = fill; x.lineWidth = sc * 0.045;
    for (let i = 0; i < 4; i++) { const [px, py, r] = pts[Math.floor(rnd() * pts.length)]; x.beginPath(); x.moveTo(px, py + r); x.lineTo(px, py + r + sc * (0.2 + rnd() * 0.5)); x.stroke(); }
  };
  const scribble = (cx: number, cy: number, sc: number, col: string) => {
    x.strokeStyle = col; x.lineWidth = sc * (0.05 + rnd() * 0.04); x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath();
    let px = cx - sc * 1.1, py = cy;
    x.moveTo(px, py);
    for (let i = 0; i < 9; i++) {
      const loop = rnd() < 0.5;
      const nx = px + sc * (0.18 + rnd() * 0.15), ny = cy + (rnd() - 0.5) * sc * 0.5;
      if (loop) x.bezierCurveTo(px + sc * 0.4, py - sc * 0.7, px - sc * 0.25, py - sc * 0.6, nx, ny);
      else x.quadraticCurveTo(px + sc * 0.1, py + sc * (rnd() - 0.5) * 1.1, nx, ny);
      px = nx; py = ny;
    }
    x.stroke();
    // underline swoosh with an arrow-ish end
    x.beginPath(); x.moveTo(cx - sc, cy + sc * 0.45); x.quadraticCurveTo(cx, cy + sc * 0.75, cx + sc * 1.1, cy + sc * 0.3); x.stroke();
    x.beginPath(); x.moveTo(cx + sc * 1.1, cy + sc * 0.3); x.lineTo(cx + sc * 0.9, cy + sc * 0.22); x.moveTo(cx + sc * 1.1, cy + sc * 0.3); x.lineTo(cx + sc * 0.98, cy + sc * 0.46); x.stroke();
  };
  const burst = (cx: number, cy: number, sc: number, fill: string, line: string) => {
    const k = 7 + Math.floor(rnd() * 5);
    const path = () => { x.beginPath(); for (let i = 0; i <= k * 2; i++) { const a = (i / (k * 2)) * Math.PI * 2, rr = (i % 2 ? 0.45 : 1) * sc * (0.85 + rnd() * 0.3); const px = cx + Math.cos(a) * rr * 1.3, py = cy + Math.sin(a) * rr * 0.8; if (i) x.lineTo(px, py); else x.moveTo(px, py); } x.closePath(); };
    x.lineJoin = 'round';
    path(); x.lineWidth = sc * 0.16; x.strokeStyle = line; x.stroke();
    x.fillStyle = fill; x.fill();
    x.fillStyle = line; x.beginPath(); x.arc(cx, cy, sc * 0.18, 0, Math.PI * 2); x.fill();
  };
  for (let t = 0; t < 8; t++) {
    const ox = (t % 4) * TS, oy = Math.floor(t / 4) * TS;
    x.save(); x.beginPath(); x.rect(ox + 4, oy + 4, TS - 8, TS - 8); x.clip();
    x.translate(ox + TS / 2, oy + TS / 2);
    x.shadowColor = 'rgba(0,0,0,0)';
    const st = t % 4;
    if (st === 0) blob(0, -10, 62, pick(), '#151515');
    else if (st === 1) scribble(0, -6, 78, rnd() < 0.5 ? '#151515' : pick());
    else if (st === 2) burst(0, 0, 70, pick(), '#151515');
    else { scribble(-6, -24, 60, pick()); x.globalAlpha = 0.9; burst(58, 46, 30, pick(), '#151515'); x.globalAlpha = 1; }
    x.restore();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------ planter plants (grass + agave here; shrubs are leaf-clump cards)
/** shrubs (kind 0: broad or fine leaves) and flowering shrubs (kind 2: bougainvillea pink or lantana orange) */
function planterBush(f: FoliageBuilder, p: Plant, rnd: () => number) {
  const s = p.s;
  const cells = p.kind === 2 ? [rnd() < 0.7 ? Leaf.Pink : Leaf.Orange] : [rnd() < 0.72 ? Leaf.Broad : Leaf.Fine];
  const k = 0.94 + rnd() * 0.12;
  f.bush({
    x: p.pos.x, y: p.pos.y, z: p.pos.z, rx: (0.36 + 0.12 * rnd()) * s, rz: (0.32 + 0.1 * rnd()) * s, ry: (0.3 + 0.1 * rnd()) * s,
    cells, tint: [k * (0.97 + rnd() * 0.06), k, k * (0.92 + rnd() * 0.1)], seed: p.pos.x * 13.1 + p.pos.z * 7.3, sink: 0.28,
  });
}

function plantGeo(kind: number, s: number, rnd: () => number): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  if (kind === 1) {
    // ornamental grass: arching blades (double sided)
    const base = lin('#5f7a3a'), tipC = lin('#d9c67e');
    const pos: number[] = [], col: number[] = [];
    const nb = 14;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + rnd() * 0.4, len = (0.55 + rnd() * 0.35) * s, lean = 0.35 + rnd() * 0.4, w = 0.035 * s;
      const dir = new Vector3(Math.cos(a), 0, Math.sin(a)), side = new Vector3(-dir.z, 0, dir.x);
      const P = (t: number) => dir.clone().multiplyScalar(lean * len * t * t).setY(len * (t - 0.25 * t * t));
      const p0 = P(0), p1 = P(0.55), p2 = P(1);
      const quad: [Vector3, RGB][] = [[p0.clone().addScaledVector(side, -w), base], [p0.clone().addScaledVector(side, w), base], [p1.clone().addScaledVector(side, w * 0.7), base.map((v, k) => (v + tipC[k]) / 2) as RGB], [p1.clone().addScaledVector(side, -w * 0.7), base.map((v, k) => (v + tipC[k]) / 2) as RGB]];
      const tri = (A: number, B: number, C: number) => { for (const k of [A, B, C]) { const q = quad[k]; pos.push(q[0].x, q[0].y, q[0].z); col.push(...q[1]); } };
      tri(0, 1, 2); tri(0, 2, 3); tri(0, 2, 1); tri(0, 3, 2);
      for (const [A, B] of [[3, 2], [2, 3]]) { const qa = quad[A], qb = quad[B]; pos.push(qa[0].x, qa[0].y, qa[0].z, qb[0].x, qb[0].y, qb[0].z, p2.x, p2.y, p2.z); col.push(...qa[1], ...qb[1], ...tipC); }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.computeVertexNormals();
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) n.setY(i, Math.abs(n.getY(i)) * 0.5 + 0.5);
    out.push(g);
  }
  return out;
}

function sailGeo(c: Vector3[], color: RGB, sag: number, s: Soup) {
  const nu = 6, nv = 4;
  const rows: number[][] = [];
  const e1 = c[1].clone().sub(c[0]), e2 = c[3].clone().sub(c[0]);
  const n = e1.clone().cross(e2).normalize();
  if (n.y < 0) n.negate();
  for (let j = 0; j <= nv; j++) {
    const row: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const a = c[0].clone().lerp(c[1], u), b = c[3].clone().lerp(c[2], u);
      const p = a.lerp(b, v);
      p.y -= sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      const k = 0.95 + 0.08 * hash1(u * 7 + v * 13 + c[0].x);
      row.push(s.v(p, n, [color[0] * k, color[1] * k, color[2] * k]));
    }
    rows.push(row);
  }
  for (let j = 0; j < nv; j++) s.strip(rows[j], rows[j + 1]);
}

/** Visual-only detail for the park: pool coping blocks, angle iron, waxed edges, tags, planter plants, shade sails, props. */
export function buildParkDetail(park: ParkData): Group {
  const g = new Group();
  g.name = 'parkDetail';
  const d = park.detail;
  const add = (geo: BufferGeometry, mat: ReturnType<typeof toonMaterial>, cast = true) => {
    const m = new Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true;
    g.add(m);
    return m;
  };

  {
    const s = new Soup();
    d.pool.forEach((p, i) => poolCoping(p.path, 11 + i * 7, s));
    s.fixWinding();
    add(s.geometry(), toonMaterial({ vertexColors: true, spec: 0.18, shininess: 24, bands: 0.3, wrap: 0.5, rim: 0.35, name: 'poolCoping' }));
  }
  if (d.iron.length) {
    const s = new Soup();
    for (const e of d.iron) angleIron(e, s);
    s.fixWinding();
    add(s.geometry(), toonMaterial({ vertexColors: true, spec: 1.0, shininess: 48, bands: 0.4, wrap: 0.45, rim: 0.5, name: 'angleIron' }));
  }
  if (d.wax.length) {
    const s = new Soup();
    for (const e of d.wax) waxStrip(e, s);
    s.fixWinding();
    const m = toonMaterial({ vertexColors: true, map: waxTexture(), spec: 0.55, shininess: 26, bands: 0.25, wrap: 0.5, rim: 0.15, name: 'wax' });
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
    add(s.geometry(true), m, false);
  }
  if (d.tags.length) {
    const s = new Soup();
    for (const t of d.tags) {
      const tx = new Vector3().crossVectors(UP, t.normal).normalize();
      const ty = new Vector3().crossVectors(t.normal, tx).normalize();
      const cr = Math.cos(t.rot), sr = Math.sin(t.rot);
      const ax = tx.clone().multiplyScalar(cr).addScaledVector(ty, sr), ay = ty.clone().multiplyScalar(cr).addScaledVector(tx, -sr);
      const u0 = (t.tile % 4) / 4 + 0.004, u1 = (t.tile % 4 + 1) / 4 - 0.004;
      const v1 = 1 - Math.floor(t.tile / 4) / 2 - 0.004, v0 = 1 - (Math.floor(t.tile / 4) + 1) / 2 + 0.004;
      const f = t.fade;
      const col: RGB = [f, f, f * 0.98];
      const P = (sx: number, sy: number) => t.pos.clone().addScaledVector(ax, (sx * t.w) / 2).addScaledVector(ay, (sy * t.h) / 2);
      const i0 = s.v(P(-1, -1), t.normal, col, u0, v0), i1 = s.v(P(1, -1), t.normal, col, u1, v0);
      const i2 = s.v(P(1, 1), t.normal, col, u1, v1), i3 = s.v(P(-1, 1), t.normal, col, u0, v1);
      s.idx.push(i0, i1, i2, i0, i2, i3);
    }
    s.fixWinding();
    const m = toonMaterial({ vertexColors: true, map: tagAtlas(), alphaTest: 0.45, bands: 0.15, wrap: 0.5, rim: 0.05, name: 'tags' });
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
    add(s.geometry(true), m, false);
  }
  if (d.plants.length) {
    const rnd = mulberry(5);
    const parts: BufferGeometry[] = [], agaves: BufferGeometry[] = [];
    const leaves = new FoliageBuilder();
    for (const p of d.plants) {
      const ry = rnd() * Math.PI * 2;
      if (p.kind === 0 || p.kind === 2) { planterBush(leaves, p, rnd); continue; }
      if (p.kind === 3) {
        // own random stream; the shared one advances as the old faceted rosette did, so every plant after it is unchanged
        const geo = agaveGeo(p.s, mulberry(Math.floor(p.pos.x * 131 + p.pos.z * 71) >>> 0));
        for (let i = 0; i < 253; i++) rnd();
        geo.rotateY(ry); geo.translate(p.pos.x, p.pos.y, p.pos.z); agaves.push(geo);
        continue;
      }
      for (const geo of plantGeo(p.kind, p.s, rnd)) { geo.rotateY(ry); geo.translate(p.pos.x, p.pos.y, p.pos.z); parts.push(geo); }
    }
    if (parts.length) {
      add(mergeGeometries(parts.map((q) => { for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color'].includes(k)) q.deleteAttribute(k); return q.index ? q.toNonIndexed() : q; })),
        toonMaterial({ vertexColors: true, side: DoubleSide, bands: 0.45, wrap: 0.6, rim: 0.45, name: 'planterPlants' }));
    }
    if (!leaves.empty) add(leaves.geometry(), foliageMaterial()).name = 'planterBushes';
    if (agaves.length) {
      const m = add(mergeGeometries(agaves), agaveMaterial());
      m.name = 'planterAgaves';
      // thin blades at grazing sun receive a mosaic of triangles from the per-triangle receiver-plane / slope bias
      m.receiveShadow = false;
    }
  }
  if (d.sails.length) {
    const s = new Soup();
    for (const sl of d.sails) sailGeo(sl.c, sl.color, sl.sag, s);
    s.fixWinding();
    add(s.geometry(), toonMaterial({ vertexColors: true, side: DoubleSide, bands: 0.3, wrap: 0.6, rim: 0.3, name: 'fabric' }));
  }
  if (d.props.length) {
    add(mergeGeometries(d.props), toonMaterial({ vertexColors: true, spec: 0.25, shininess: 30, bands: 0.35, wrap: 0.5, rim: 0.25, name: 'parkProps' }));
  }
  return g;
}
