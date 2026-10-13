import {
  BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshLambertMaterial, Quaternion, RGBAFormat,
  SRGBColorSpace, Vector2, Vector3, Euler,
} from 'three';
import { toonMaterial } from '../render/materials';

/** Leaf-cluster atlas cells (2 x 2): broad leaves, fine olive leaves, broad + pink blossom, fine + orange blossom. */
export const enum Leaf { Broad = 0, Fine = 1, Pink = 2, Orange = 3 }

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATLAS = 1024, CELL = ATLAS / 2;

/**
 * Texels under (partial) transparency take the colour of the nearest solid texel of their own cell (breadth-first
 * from every solid texel), so a filtered or cut edge shows the leaf's own colour all the way out: no lighter rim round
 * the dark leaves and no darker one round the light leaves. Texels no leaf reaches keep the cell's mean colour.
 */
function dilateUnderAlpha(d: Uint8ClampedArray, W: number, H: number, cell: number) {
  const SOLID = 160;
  const seen = new Uint8Array(W * H), q = new Int32Array(W * H);
  for (let cy = 0; cy < H; cy += cell) for (let cx = 0; cx < W; cx += cell) {
    let head = 0, tail = 0, r = 0, g = 0, b = 0, w = 0;
    for (let y = cy; y < cy + cell; y++) for (let x = cx; x < cx + cell; x++) {
      const i = y * W + x;
      if (d[i * 4 + 3] >= SOLID) { seen[i] = 1; q[tail++] = i; r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; w++; }
    }
    while (head < tail) {
      const i = q[head++], x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < cx || ny < cy || nx >= cx + cell || ny >= cy + cell) continue;
        const j = ny * W + nx;
        if (seen[j]) continue;
        seen[j] = 1; q[tail++] = j;
        d[j * 4] = d[i * 4]; d[j * 4 + 1] = d[i * 4 + 1]; d[j * 4 + 2] = d[i * 4 + 2];
      }
    }
    if (!w) continue;
    r /= w; g /= w; b /= w;
    for (let y = cy; y < cy + cell; y++) for (let x = cx; x < cx + cell; x++) {
      const i = y * W + x;
      if (!seen[i]) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; }
    }
  }
}

/**
 * Painted leaf clumps on transparent cells: a dense core of overlapping leaves and a ragged rim of single leaves with
 * gaps between them. Value varies leaf by leaf (dark gaps, lit edges, a midrib), never by a light direction, because the
 * cards face every way; light and shade come from the clump normals. Transparent texels take the cell's mean colour so
 * the mips fade to leaf colour instead of a dark halo.
 */
function paintAtlas(): DataTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS;
  const x = cv.getContext('2d', { willReadFrequently: true })!;
  x.clearRect(0, 0, ATLAS, ATLAS);
  const cells: { greens: string[]; n: number; len: [number, number]; wid: [number, number]; flowers?: string[] }[] = [
    { greens: ['#33572a', '#456f31', '#56843a', '#679543', '#7ea951'], n: 210, len: [52, 80], wid: [20, 30] },
    { greens: ['#2e4c26', '#3d602d', '#4d7335', '#5d843d', '#73994b'], n: 520, len: [30, 44], wid: [9, 14] },
    { greens: ['#33572a', '#456f31', '#56843a', '#679543', '#7ea951'], n: 190, len: [48, 72], wid: [19, 28], flowers: ['#a8295f', '#c93a72', '#dc5590', '#ea7aac', '#b8449e'] },
    { greens: ['#355628', '#476d31', '#59823b', '#6a9444', '#80a852'], n: 460, len: [30, 42], wid: [9, 13], flowers: ['#e0592f', '#ec7a3c', '#f39a42', '#f8bd55'] },
  ];
  cells.forEach((cell, ci) => {
    const rnd = mulberry(4001 + ci * 77);
    const cx = (ci % 2) * CELL + CELL / 2, cy = Math.floor(ci / 2) * CELL + CELL / 2, R = CELL * 0.44;
    x.save();
    x.beginPath(); x.rect(cx - CELL / 2 + 4, cy - CELL / 2 + 4, CELL - 8, CELL - 8); x.clip();
    const leaf = (px: number, py: number, ang: number, L: number, W: number, fill: string, edge: string, rib: string) => {
      x.save();
      // (px, py) is the middle of the leaf
      x.translate(px - Math.cos(ang) * L * 0.5, py - Math.sin(ang) * L * 0.5); x.rotate(ang);
      x.beginPath();
      x.moveTo(0, 0);
      x.quadraticCurveTo(L * 0.42, -W, L, 0);
      x.quadraticCurveTo(L * 0.42, W, 0, 0);
      x.closePath();
      x.fillStyle = fill; x.fill();
      // a lit edge on one side and a soft midrib: reads as a leaf without turning the clump into noise
      if (edge) {
        x.strokeStyle = edge; x.lineWidth = Math.max(1.5, W * 0.2);
        x.beginPath(); x.moveTo(L * 0.1, -W * 0.22); x.quadraticCurveTo(L * 0.42, -W * 0.84, L * 0.92, -W * 0.08); x.stroke();
      }
      x.strokeStyle = rib; x.lineWidth = Math.max(0.8, W * 0.07);
      x.beginPath(); x.moveTo(L * 0.06, 0); x.lineTo(L * 0.8, 0); x.stroke();
      x.restore();
    };
    const pick = (a: string[], t: number) => a[Math.min(a.length - 1, Math.max(0, Math.floor(t * a.length)))];
    type L = { px: number; py: number; ang: number; L: number; W: number; v: number };
    const leaves: L[] = [];
    for (let i = 0; i < cell.n; i++) {
      const rim = rnd() < 0.22;
      const a = rnd() * Math.PI * 2;
      // core leaves fill a disc; rim leaves sit on its edge and point outwards, leaving gaps between them
      const r = rim ? R * (0.7 + 0.16 * rnd()) : R * 0.66 * Math.sqrt(rnd());
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      const out = a + (rnd() - 0.5) * (rim ? 0.6 : 2.6);
      const L = cell.len[0] + (cell.len[1] - cell.len[0]) * rnd(), W = (cell.wid[0] + (cell.wid[1] - cell.wid[0]) * rnd()) / 2;
      // mid tones with a few dark accents deep in the clump; the light and shade come from the clump normals
      const dark = rnd() < 0.1 && r < R * 0.5;
      const v = dark ? 0.05 + rnd() * 0.15 : 0.32 + rnd() * 0.4 + (rim ? 0.1 : 0);
      leaves.push({ px, py, ang: out, L: L * (rim ? 1.08 : 1), W, v: Math.min(0.999, v) });
    }
    // dark first: the lighter leaves overlap the shadowed ones
    leaves.sort((a, b) => a.v - b.v);
    for (const l of leaves) {
      const fill = pick(cell.greens, l.v);
      const edge = rnd() < 0.45 ? pick(cell.greens, Math.min(0.999, l.v + 0.14)) : '';
      const rib = pick(cell.greens, Math.max(0, l.v - 0.22));
      leaf(l.px, l.py, l.ang, l.L, l.W, fill, edge, rib);
    }
    if (cell.flowers) {
      // blossoms in clusters with leaves between them, not a speckle over the whole clump
      const fl = cell.flowers, pink = ci === Leaf.Pink;
      for (let i = 0; i < (pink ? 9 : 17); i++) {
        const a = rnd() * Math.PI * 2, r = R * 0.72 * Math.sqrt(rnd());
        const fx = cx + Math.cos(a) * r, fy = cy + Math.sin(a) * r;
        const k = pink ? 16 + Math.floor(rnd() * 10) : 9 + Math.floor(rnd() * 8), pr = pink ? 7 + rnd() * 3 : 3.2 + rnd() * 1.4;
        const spread = pink ? 24 + rnd() * 12 : 8 + rnd() * 4;
        for (let j = 0; j < k; j++) {
          const b = rnd() * Math.PI * 2, d = spread * Math.sqrt(rnd());
          const px = fx + Math.cos(b) * d, py = fy + Math.sin(b) * d;
          // cluster centres are lighter, the outside of a cluster sits a little in shade
          const t = Math.min(0.999, rnd() * 0.55 + 0.45 * (1 - d / spread));
          x.fillStyle = pick(fl, t * 0.85);
          if (pink) {
            // papery bracts: three soft lobes
            for (let q = 0; q < 3; q++) {
              const c = b + q * 2.09;
              x.beginPath(); x.ellipse(px + Math.cos(c) * pr * 0.42, py + Math.sin(c) * pr * 0.42, pr * 0.62, pr * 0.42, c, 0, Math.PI * 2); x.fill();
            }
            x.fillStyle = pick(fl, Math.min(0.999, t * 0.85 + 0.35));
            x.beginPath(); x.arc(px - pr * 0.15, py - pr * 0.15, pr * 0.32, 0, Math.PI * 2); x.fill();
          } else {
            x.beginPath(); x.arc(px, py, pr, 0, Math.PI * 2); x.fill();
            x.fillStyle = pick(fl, Math.min(0.999, t + 0.4));
            x.beginPath(); x.arc(px - pr * 0.25, py - pr * 0.25, pr * 0.45, 0, Math.PI * 2); x.fill();
          }
        }
      }
    }
    x.restore();
  });
  const img = x.getImageData(0, 0, ATLAS, ATLAS);
  const d = img.data;
  dilateUnderAlpha(d, ATLAS, ATLAS, CELL);
  const tex = new DataTexture(new Uint8Array(d.buffer.slice(0)), ATLAS, ATLAS, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

let shared: MeshLambertMaterial | null = null;

/** One material for every bush (same program and atlas as far as the renderer is concerned). */
export function foliageMaterial(): MeshLambertMaterial {
  if (shared) return shared;
  const tex = paintAtlas();
  const m = toonMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, side: DoubleSide, wind: true, bands: 0.45, wrap: 0.5, rim: 0.45, name: 'foliage' });
  m.alphaToCoverage = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uMapSize = { value: new Vector2(ATLAS, ATLAS) };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec2 uMapSize; float gLeafLod;`).replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      // a card shows the clump's outward normal from either side (no back-face flip)
      normal *= faceDirection;`).replace('#include <map_fragment>', `#include <map_fragment>
      gLeafLod = 0.0;
      #ifdef USE_MAP
      {
        // keep the clump coverage in the small mips (as the palm fronds do) so far bushes stay full
        vec2 duv = vMapUv * uMapSize;
        vec2 ddx = dFdx(duv), ddy = dFdy(duv);
        float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        diffuseColor.a *= 1.0 + lod * 0.3;
        gLeafLod = lod;
      }
      #endif`).replace('#include <alphatest_fragment>', `#ifdef USE_ALPHATEST
      {
        // partial coverage (alpha to coverage) only where the atlas is drawn at about a texel per pixel or larger, so a
        // leaf outline gets a one-pixel soft edge; where the alpha changes faster than a pixel (minified cards, leaves
        // seen through gaps) partial coverage comes out of the hardware as an ordered dither (a glittering stipple),
        // so those pixels are cut clean. Quarters match the 4x MSAA samples.
        float fw = max(fwidth(diffuseColor.a), 1e-4);
        float ramp = clamp((diffuseColor.a - alphaTest) / fw + 0.5, 0.0, 1.0);
        float a = mix(ramp, step(alphaTest, diffuseColor.a), smoothstep(0.35, 0.75, gLeafLod));
        diffuseColor.a = floor(a * 4.0 + 0.5) * 0.25;
        if (diffuseColor.a <= 0.0) discard;
      }
      #endif`);
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${key}-foliage`;
  shared = m;
  return m;
}

export interface BushSpec {
  /** ground point under the middle of the bush */
  x: number; y: number; z: number;
  /** half extents of the leaf mass (rz defaults to rx) */
  rx: number; ry: number; rz?: number;
  /** atlas cells the clumps are drawn from, picked at random */
  cells: Leaf[];
  /** multiplier on the painted leaf colours */
  tint?: [number, number, number];
  seed: number;
  /** share of the height sunk into the soil (default 0.3) */
  sink?: number;
}

const _q = new Quaternion(), _e = new Euler(), _a = new Vector3(), _b = new Vector3(), _p = new Vector3(), _n = new Vector3(), _nc = new Vector3();
const AX: [Vector3, Vector3][] = [[new Vector3(1, 0, 0), new Vector3(0, 1, 0)], [new Vector3(0, 1, 0), new Vector3(0, 0, 1)], [new Vector3(0, 0, 1), new Vector3(1, 0, 0)]];
const COOL = [0.84, 0.94, 1.12], WARM = [1.1, 1.04, 0.84];

/**
 * Bushes as leaf-clump cards: each clump is three crossed alpha-cut quads around a point of the leaf mass; the normals
 * come from the mass (an ellipsoid) blended with the clump's own roundness, so light wraps across the bush like across a
 * painted blob while the outline stays ragged and open (the material keeps those normals on both sides of a card).
 */
export class FoliageBuilder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; wind: number[] = []; idx: number[] = [];

  bush(s: BushSpec) {
    const rnd = mulberry(Math.floor(s.seed * 7919) + 13);
    const rx = s.rx, ry = s.ry, rz = s.rz ?? s.rx;
    const E = new Vector3(s.x, s.y + ry * (1 - (s.sink ?? 0.3)), s.z);
    const rm = (rx + ry + rz) / 3;
    const rc = Math.min(0.42 * rm, 0.3);
    const n = Math.max(5, Math.min(28, Math.round(2.3 * (rm / rc) ** 2)));
    const tint = s.tint ?? [1, 1, 1];
    const ph = rnd() * 6.28;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < n + 2; k++) {
      // clumps over the upper part of the mass (fibonacci spiral), plus two in the core seen through the gaps
      let dir: Vector3, f: number;
      if (k < n) {
        const yy = 1 - 1.3 * ((k + 0.5) / n);
        const rr = Math.sqrt(Math.max(0, 1 - yy * yy)), th = k * golden + rnd() * 0.6;
        dir = new Vector3(Math.cos(th) * rr, yy, Math.sin(th) * rr);
        f = 0.62 + rnd() * 0.18;
      } else {
        dir = new Vector3(rnd() - 0.5, 0.3 + rnd() * 0.4, rnd() - 0.5).normalize();
        f = 0.2 + rnd() * 0.15;
      }
      const C = new Vector3(E.x + dir.x * rx * f, E.y + dir.y * ry * f, E.z + dir.z * rz * f);
      if (C.y < s.y + 0.02) C.y = s.y + 0.02 + rnd() * 0.04;
      const cell = s.cells[Math.floor(rnd() * s.cells.length)];
      const u0 = (cell % 2) * 0.5 + 0.004, v0 = Math.floor(cell / 2) * 0.5 + 0.004, u1 = u0 + 0.492, v1 = v0 + 0.492;
      const hs = rc * (1.18 + rnd() * 0.3) * (k < n ? 1 : 1.2);
      _q.setFromEuler(_e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
      const depth = Math.min(1, f / 0.75);
      const cv = (0.94 + rnd() * 0.12) * (0.5 + 0.5 * depth);
      for (const [ea, eb] of AX) {
        _a.copy(ea).applyQuaternion(_q).multiplyScalar(hs);
        _b.copy(eb).applyQuaternion(_q).multiplyScalar(hs);
        const rot = Math.floor(rnd() * 4), mir = rnd() < 0.5;
        const uvs: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        const base = this.pos.length / 3;
        for (let c = 0; c < 4; c++) {
          const sx = c === 1 || c === 2 ? 1 : -1, sy = c >= 2 ? 1 : -1;
          _p.copy(C).addScaledVector(_a, sx).addScaledVector(_b, sy);
          if (_p.y < s.y - 0.03) _p.y = s.y - 0.03;
          // mass normal (ellipsoid gradient) blended with the clump's own bulge, nudged up: lit tops, shaded undersides
          _n.set((_p.x - E.x) / (rx * rx), (_p.y - E.y) / (ry * ry), (_p.z - E.z) / (rz * rz)).normalize();
          _nc.subVectors(_p, C).normalize();
          _n.multiplyScalar(0.6).addScaledVector(_nc, 0.4);
          _n.y += 0.14;
          _n.normalize();
          this.pos.push(_p.x, _p.y, _p.z);
          this.nor.push(_n.x, _n.y, _n.z);
          // painted light: warm, light tops; cool, darker undersides
          const t = Math.min(1, Math.max(0, ((_p.y - E.y) / ry) * 0.5 + 0.55));
          const v = cv * (0.6 + 0.52 * t);
          for (let q = 0; q < 3; q++) this.col.push(tint[q] * v * (COOL[q] + (WARM[q] - COOL[q]) * t));
          const uvc = uvs[(mir ? 3 - c + rot : c + rot) % 4];
          this.uv.push(uvc[0], uvc[1]);
          this.wind.push(ph, 0.32 * t, 0.16);
        }
        this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  get empty() { return this.idx.length === 0; }

  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('windData', new BufferAttribute(new Float32Array(this.wind), 3));
    const nv = this.pos.length / 3;
    g.setIndex(new BufferAttribute(nv > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** blade cross-section (side, thickness) in units of the half width / half thickness: a shallow channel on top, a keel below */
const BLADE: [number, number][] = [[-1, 0.25], [-0.55, 0.13], [0, 0.07], [0.55, 0.13], [1, 0.25], [0.55, -0.62], [0, -1], [-0.55, -0.62]];
const AG = { base: new Color('#9cba97'), mid: new Color('#6f9a8a'), tip: new Color('#4e6d5e'), spine: new Color('#3f3426'), wax: new Color('#bcd2bf') };
const _Y = new Vector3(0, 1, 0), _c = new Color();

/**
 * Agave rosette around the origin (s = size): three whorls of thick, smooth blades that rise from the core, bow outwards
 * and taper to a dark spine, painted pale at the base, glaucous along the blade, darker to the tip, with a waxy margin.
 */
export function agaveGeo(s: number, rnd: () => number): BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const NS = 9, NR = BLADE.length;
  const whorls: [number, number, number, number][] = [[7, 1.0, 0.42, 0.2], [5, 0.8, 0.86, 0.12], [4, 0.56, 1.2, 0.05]];
  const fa = new Vector3(), fb = new Vector3(), fn = new Vector3(), out = new Vector3();
  const tri = (a: number, b: number, c: number, sp: Vector3, tg: Vector3) => {
    const v = (i: number, o: Vector3) => o.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    v(a, out); v(b, fa).sub(out); v(c, fb).sub(out);
    fn.crossVectors(fa, fb);
    out.add(v(b, fa)).add(v(c, fb)).multiplyScalar(1 / 3).sub(sp);
    out.addScaledVector(tg, -out.dot(tg));
    if (fn.dot(out) >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  let k = 0;
  for (const [n, lenK, rise, r0] of whorls) {
    for (let i = 0; i < n; i++, k++) {
      const az = k * 2.39996 + rnd() * 0.35;
      const dir = new Vector3(Math.cos(az), 0, Math.sin(az));
      const len = (0.42 + rnd() * 0.18) * s * lenK, up = rise + (rnd() - 0.5) * 0.25, curl = 0.35 + rnd() * 0.35;
      const w0 = (0.084 + rnd() * 0.022) * s * (0.8 + 0.2 * lenK), h0 = 0.04 * s * (0.8 + 0.2 * lenK);
      const tone = 0.92 + rnd() * 0.14;
      const P: Vector3[] = [], T: Vector3[] = [];
      const p = dir.clone().multiplyScalar(r0 * s * 0.25).setY(-0.02 * s);
      for (let j = 0; j <= NS; j++) {
        const t = j / NS, a = up - curl * t * t;
        const tg = dir.clone().multiplyScalar(Math.cos(a)).setY(Math.sin(a));
        P.push(p.clone()); T.push(tg);
        p.addScaledVector(tg, len / NS);
      }
      const base = pos.length / 3;
      for (let j = 0; j < NS; j++) {
        const t = j / NS;
        const S = new Vector3().crossVectors(T[j], _Y).normalize(), N = new Vector3().crossVectors(S, T[j]).normalize();
        const w = w0 * (1 - Math.pow(t, 1.25)) * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.5))), h = h0 * (1 - 0.72 * t);
        _c.copy(AG.base).lerp(AG.mid, Math.min(1, t / 0.45)).lerp(AG.tip, Math.max(0, (t - 0.55) / 0.45));
        const core = 0.72 + 0.28 * Math.min(1, t / 0.2);
        BLADE.forEach(([sx, nx], r) => {
          const q = P[j].clone().addScaledVector(S, sx * w).addScaledVector(N, nx * h);
          pos.push(q.x, q.y, q.z);
          const edge = r === 0 || r === 4, below = nx < 0;
          const m = tone * core * (below ? 0.84 : 1.04);
          const cr = edge ? _c.r + (AG.wax.r - _c.r) * 0.45 : _c.r, cg = edge ? _c.g + (AG.wax.g - _c.g) * 0.45 : _c.g, cb = edge ? _c.b + (AG.wax.b - _c.b) * 0.45 : _c.b;
          col.push(cr * m, cg * m, cb * m);
        });
      }
      const tip = pos.length / 3;
      pos.push(P[NS].x, P[NS].y, P[NS].z);
      col.push(AG.spine.r, AG.spine.g, AG.spine.b);
      const mid = new Vector3();
      for (let j = 0; j < NS - 1; j++) {
        mid.copy(P[j]).add(P[j + 1]).multiplyScalar(0.5);
        for (let r = 0; r < NR; r++) {
          const a = base + j * NR + r, b = base + j * NR + ((r + 1) % NR);
          tri(a, b, b + NR, mid, T[j]); tri(a, b + NR, a + NR, mid, T[j]);
        }
      }
      for (let r = 0; r < NR; r++) tri(base + (NS - 1) * NR + r, base + (NS - 1) * NR + ((r + 1) % NR), tip, P[NS - 1], T[NS - 1]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let agaveM: MeshLambertMaterial | null = null;
/** soft painted shading along the blades, a faint waxy sheen */
export function agaveMaterial() {
  return (agaveM ??= toonMaterial({ vertexColors: true, bands: 0.2, wrap: 0.55, rim: 0.4, spec: 0.1, shininess: 16, name: 'agave' }));
}
