import { CatmullRomCurve3, Group, Mesh, TubeGeometry, Vector3, BufferGeometry, CylinderGeometry, Matrix4, BoxGeometry, Material } from 'three';
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

export interface ParkData {
  builder: ParkBuilder;
  grindLines: GrindLine[];
  lamps: Vector3[];
  murals: { key: string; center: Vector3; normal: Vector3; w: number; h: number; tex: string }[];
  tubes: BufferGeometry[]; // metal coping / rails (visual only)
  spawn: { pos: Vector3; heading: number };
  landmarks: Record<string, { pos: Vector3; look: Vector3 }>;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const UP = V(0, 1, 0);

// warm concrete tints (linear-ish multipliers applied on top of the concrete material)
const C_PLAZA: [number, number, number] = [1.0, 0.98, 0.95];
const C_BOWL: [number, number, number] = [0.97, 0.97, 0.98];
const C_RAMP: [number, number, number] = [1.0, 0.97, 0.93];
const C_WALL: [number, number, number] = [0.95, 0.92, 0.88];

export function buildPark(): ParkData {
  const b = new ParkBuilder();
  const grind: GrindLine[] = [];
  const tubes: BufferGeometry[] = [];
  const murals: ParkData['murals'] = [];
  const holes: Vector3[][] = [];

  const tube = (pts: Vector3[], r: number, closed = false) => {
    const curve = new CatmullRomCurve3(pts, closed, 'catmullrom', 0.0);
    const n = Math.max(8, Math.ceil(curve.getLength() / 0.12));
    tubes.push(new TubeGeometry(curve, n, r, 10, closed));
  };
  const post = (x: number, y0: number, y1: number, z: number, r = 0.022) => {
    const g = new CylinderGeometry(r, r, y1 - y0, 10);
    g.applyMatrix4(new Matrix4().makeTranslation(x, (y0 + y1) / 2, z));
    tubes.push(g);
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
    b.grid('concrete', n, nv, (u, v, o) => P(Math.round(u * n), Math.round(v * nv), o),
      (u, v, o) => N(Math.round(u * n), Math.round(v * nv), o), { color: C_BOWL });
    // floor
    const floor = path.map((p) => V(p.x + p.mx * prof.W, -H, p.z + p.mz * prof.W));
    b.polygon('concrete', floor, UP, { color: C_BOWL });
    // coping line (top row) - grindable, and a hole in the plaza
    const top = path.map((p) => V(p.x, 0, p.z));
    holes.push(top);
    grind.push({ name, kind: 'coping', pts: top.map((p) => p.clone()), closed: true, inward: path.map((p) => V(p.mx, 0, p.mz)), metal: true });
    const cop = path.map((p) => V(p.x + p.mx * 0.018, -0.012, p.z + p.mz * 0.018));
    tube(cop, 0.034, true);
    return { path, prof };
  };
  bowl('main bowl', -24, 0, 9, 7, 5.5, 2.3, 2.1);
  bowl('pocket bowl', -24, 15, 6, 4.5, 3.6, 1.4, 1.9);

  // ------------------------------------------------------------------ quarter pipe with deck
  const qp = (name: string, ax: number, az: number, bx: number, bz: number, mx: number, mz: number, baseY: number,
    H: number, R: number, deck: number, groundY = 0, sides = true) => {
    const prof = transitionProfile(H, R, 24);
    const A = V(ax, 0, az), B = V(bx, 0, bz), m = V(mx, 0, mz);
    const len = A.distanceTo(B);
    const nu = Math.max(2, Math.ceil(len / 1.5));
    const nv = prof.pts.length - 1;
    const topY = baseY + H;
    const P = (u: number, j: number, o: Vector3) => {
      const q = prof.pts[j];
      return o.copy(A).lerp(B, u).addScaledVector(m, q.d).setY(topY + q.y);
    };
    b.grid('concrete', nu, nv, (u, v, o) => P(u, Math.round(v * nv), o), (u, v, o) => {
      const q = prof.pts[Math.round(v * nv)];
      return o.set(m.x * Math.sin(q.beta), Math.cos(q.beta), m.z * Math.sin(q.beta)).normalize();
    }, { color: C_RAMP });
    // deck
    const back = m.clone().multiplyScalar(-deck);
    b.quad('concrete', V(ax, topY, az), V(bx, topY, bz), V(bx, topY, bz).add(back), V(ax, topY, az).add(back), { color: C_PLAZA }, UP);
    // back wall
    b.quad('wall', V(ax, groundY, az).add(back), V(bx, groundY, bz).add(back), V(bx, topY, bz).add(back), V(ax, topY, az).add(back),
      { color: C_WALL }, m.clone().negate());
    // side walls following the profile
    if (sides) {
      const t = B.clone().sub(A).normalize();
      for (const [E, sgn] of [[A, -1], [B, 1]] as [Vector3, number][]) {
        const outline: Vector3[] = [];
        for (let j = nv; j >= 0; j--) { const q = prof.pts[j]; outline.push(E.clone().addScaledVector(m, q.d).setY(topY + q.y)); }
        outline.push(E.clone().add(back).setY(topY));
        outline.push(E.clone().add(back).setY(groundY));
        outline.push(E.clone().addScaledVector(m, prof.W).setY(groundY));
        // remove duplicate floor point when groundY == baseY
        const pts = outline.filter((p, i) => i === 0 || p.distanceTo(outline[i - 1]) > 1e-4);
        if (pts[pts.length - 1].distanceTo(pts[0]) < 1e-4) pts.pop();
        b.polygon('wall', pts, t.clone().multiplyScalar(sgn), { color: C_WALL });
      }
    }
    grind.push({ name: name + ' coping', kind: 'coping', pts: [V(ax, topY, az), V(bx, topY, bz)], closed: false, inward: [m.clone(), m.clone()], metal: true });
    const off = m.clone().multiplyScalar(0.018);
    tube([V(ax, topY - 0.012, az).add(off), V(bx, topY - 0.012, bz).add(off)], 0.034);
    return { W: prof.W, topY };
  };

  // half pipe (east): two quarter pipes facing each other, open ends onto the plaza
  qp('half pipe west', 19.2, -15, 19.2, -3, 1, 0, 0, 3.0, 2.8, 2.8);
  qp('half pipe east', 28.8, -3, 28.8, -15, -1, 0, 0, 3.0, 2.8, 2.8);
  murals.push({ key: 'mural_sunwaves', center: V(16.4 - 0.015, 1.5, -9), normal: V(-1, 0, 0), w: 7.6, h: 2.85, tex: 'mural_sunwaves' });

  // north quarter pipe + bank sharing a deck (backs onto the boardwalk)
  qp('north quarter', -12, -20.3, -3, -20.3, 0, 1, 0, 1.2, 1.8, 1.5);
  {
    const x0 = -1.5, x1 = 6, zTop = -20.3, h = 1.2, run = h / Math.tan((30 * Math.PI) / 180);
    const zB = zTop + run;
    const n = V(0, run, h).normalize();
    b.quad('concrete', V(x0, 0, zB), V(x1, 0, zB), V(x1, h, zTop), V(x0, h, zTop), { color: C_RAMP }, n);
    for (const [x, s] of [[x0, -1], [x1, 1]] as [number, number][])
      b.polygon('wall', [V(x, 0, zB), V(x, h, zTop), V(x, 0, zTop)], V(s, 0, 0), { color: C_WALL });
    // deck spanning the gap, its front face in the gap, back wall
    b.quad('concrete', V(-3, h, zTop), V(x1, h, zTop), V(x1, h, -21.8), V(-3, h, -21.8), { color: C_PLAZA }, UP);
    b.quad('wall', V(-3, 0, zTop), V(x0, 0, zTop), V(x0, h, zTop), V(-3, h, zTop), { color: C_WALL }, V(0, 0, 1));
    b.quad('wall', V(-3, 0, -21.8), V(x1, 0, -21.8), V(x1, h, -21.8), V(-3, h, -21.8), { color: C_WALL }, V(0, 0, -1));
    b.quad('wall', V(x1, 0, zTop), V(x1, 0, -21.8), V(x1, h, -21.8), V(x1, h, zTop), { color: C_WALL }, V(1, 0, 0));
    grind.push({ name: 'north deck ledge', kind: 'ledge', pts: [V(-3, h, zTop), V(x0, h, zTop)], closed: false, inward: [V(0, 0, 1), V(0, 0, 1)], metal: true });
  }

  // ------------------------------------------------------------------ south terrace: bank, 6-stair + handrail, quarter pipe
  {
    const y = 1.0, z0 = 14, z1 = 21;
    b.quad('concrete', V(-4, y, z0), V(14, y, z0), V(14, y, z1), V(-4, y, z1), { color: C_PLAZA }, UP);
    // bank up from the plaza (30 deg)
    const run = y / Math.tan((30 * Math.PI) / 180), zB = z0 - run;
    b.quad('concrete', V(-4, 0, zB), V(3, 0, zB), V(3, y, z0), V(-4, y, z0), { color: C_RAMP }, V(0, run, -y).normalize());
    b.polygon('wall', [V(-4, 0, zB), V(-4, y, z0), V(-4, 0, z0)], V(-1, 0, 0), { color: C_WALL });
    b.polygon('wall', [V(3, 0, zB), V(3, y, z0), V(3, 0, z0)], V(1, 0, 0), { color: C_WALL });
    // walls of the terrace front
    b.quad('wall', V(3, 0, z0), V(5, 0, z0), V(5, y, z0), V(3, y, z0), { color: C_WALL }, V(0, 0, -1));
    b.quad('wall', V(9, 0, z0), V(14, 0, z0), V(14, y, z0), V(9, y, z0), { color: C_WALL }, V(0, 0, -1));
    grind.push({ name: 'terrace ledge', kind: 'ledge', pts: [V(9, y, z0), V(14, y, z0)], closed: false, inward: [V(0, 0, -1), V(0, 0, -1)], metal: true });
    // stairs: 6 risers of 1/6 m, treads 0.32 m, descending north
    const nR = 6, rise = y / nR, tread = 0.32, sx0 = 5, sx1 = 9;
    for (let r = 0; r < nR; r++) {
      const zr = z0 - r * tread, yt = y - r * rise, yb = y - (r + 1) * rise;
      b.quad('concrete', V(sx0, yb, zr), V(sx1, yb, zr), V(sx1, yt, zr), V(sx0, yt, zr), { color: C_RAMP }, V(0, 0, -1));
      if (r < nR - 1) b.quad('concrete', V(sx0, yb, zr - tread), V(sx1, yb, zr - tread), V(sx1, yb, zr), V(sx0, yb, zr), { color: C_PLAZA }, UP);
    }
    for (const [x, s] of [[sx0, -1], [sx1, 1]] as [number, number][]) {
      const outline: Vector3[] = [V(x, 0, z0), V(x, y, z0)];
      for (let r = 0; r < nR; r++) {
        const zr = z0 - r * tread, yb = y - (r + 1) * rise;
        outline.push(V(x, y - r * rise, zr), V(x, yb, zr));
        if (r < nR - 1) outline.push(V(x, yb, zr - tread));
      }
      const pts = outline.filter((p, i) => i === 0 || p.distanceTo(outline[i - 1]) > 1e-4);
      b.polygon('wall', pts.reverse(), V(s, 0, 0), { color: C_WALL });
    }
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
    // quarter pipe at the back of the terrace
    const R = 1.8, H = 1.4;
    const W = transitionProfile(H, R).W;
    qp('terrace quarter', 14, z1 + W, -4, z1 + W, 0, -1, y, H, R, 1.45, 0);
    // terrace side walls below the deck level
    const zBack = z1 + W + 1.45;
    void zBack;
    b.quad('wall', V(-4, 0, z0), V(-4, 0, z1), V(-4, y, z1), V(-4, y, z0), { color: C_WALL }, V(-1, 0, 0));
    b.quad('wall', V(14, 0, z0), V(14, 0, z1), V(14, y, z1), V(14, y, z0), { color: C_WALL }, V(1, 0, 0));
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
    }
    grind.push({ name: 'funbox edge', kind: 'ledge', pts: [V(tx0, h, tz0), V(tx1, h, tz0)], closed: false, inward: [V(0, 0, -1), V(0, 0, -1)], metal: true });
    grind.push({ name: 'funbox edge', kind: 'ledge', pts: [V(tx0, h, tz1), V(tx1, h, tz1)], closed: false, inward: [V(0, 0, 1), V(0, 0, 1)], metal: true });
    const bar = [V(-2.2, h + 0.32, -1.5), V(2.2, h + 0.32, -1.5)];
    grind.push({ name: 'flat bar', kind: 'rail', pts: bar, closed: false, metal: true });
    tube(bar, 0.026);
    post(-2.0, h, h + 0.32, -1.5, 0.03); post(2.0, h, h + 0.32, -1.5, 0.03);
    // angle iron on the top edges
    for (const z of [tz0, tz1]) tubes.push(edgeIron(V(tx0, h, z), V(tx1, h, z)));
  }

  // ------------------------------------------------------------------ ledges, manual pad, flat rail
  const ledge = (name: string, x0: number, x1: number, z0: number, z1: number, h: number, paint: [number, number, number]) => {
    b.box('concrete', V(x0, 0, z0), V(x1, h, z1), { color: C_PLAZA }, ['-y', '+x', '-x', '+z', '-z']);
    b.box('paint', V(x0, 0, z0), V(x1, h, z1), { color: paint }, ['-y', '+y']);
    grind.push({ name, kind: 'ledge', pts: [V(x0, h, z0), V(x1, h, z0)], closed: false, inward: [V(0, 0, -1), V(0, 0, -1)], metal: true });
    grind.push({ name, kind: 'ledge', pts: [V(x0, h, z1), V(x1, h, z1)], closed: false, inward: [V(0, 0, 1), V(0, 0, 1)], metal: true });
    tubes.push(edgeIron(V(x0, h, z0), V(x1, h, z0)), edgeIron(V(x0, h, z1), V(x1, h, z1)));
  };
  ledge('long ledge', -10, 0, -12.6, -12.0, 0.45, [0.98, 0.74, 0.22]);
  ledge('red curb', 18, 27, 8.0, 8.5, 0.38, [0.86, 0.32, 0.27]);
  ledge('manual pad', -9, -5, 5.0, 6.6, 0.16, [0.25, 0.55, 0.78]);
  {
    const rail = [V(4, 0.36, -12.3), V(10, 0.36, -12.3)];
    grind.push({ name: 'flat rail', kind: 'rail', pts: rail, closed: false, metal: true });
    tube(rail, 0.025);
    post(4.4, 0, 0.36, -12.3, 0.026); post(9.6, 0, 0.36, -12.3, 0.026);
  }

  // ------------------------------------------------------------------ mural walls
  const muralWall = (x0: number, z0: number, x1: number, z1: number, h: number, nx: number, nz: number, key: string, tex: string) => {
    const n = V(nx, 0, nz), t = V(x1 - x0, 0, z1 - z0);
    const w = t.length(); t.normalize();
    const thick = 0.3;
    const a = V(x0, 0, z0), c = V(x1, 0, z1), bk = n.clone().multiplyScalar(-thick);
    b.quad('wall', a, c, c.clone().setY(h), a.clone().setY(h), { color: C_WALL }, n);
    b.quad('wall', a.clone().add(bk), c.clone().add(bk), c.clone().add(bk).setY(h), a.clone().add(bk).setY(h), { color: C_WALL }, n.clone().negate());
    b.quad('wall', a.clone().setY(h), c.clone().setY(h), c.clone().add(bk).setY(h), a.clone().add(bk).setY(h), { color: C_PLAZA }, UP);
    b.quad('wall', a, a.clone().add(bk), a.clone().add(bk).setY(h), a.clone().setY(h), { color: C_WALL }, t.clone().negate());
    b.quad('wall', c, c.clone().add(bk), c.clone().add(bk).setY(h), c.clone().setY(h), { color: C_WALL }, t);
    murals.push({ key, center: a.clone().lerp(c, 0.5).setY(h / 2 + 0.05).addScaledVector(n, 0.012), normal: n, w: w - 0.3, h: h - 0.35, tex });
  };
  muralWall(-36.6, 4.8, -36.6, -4.8, 3.4, 1, 0, 'mural_koi', 'mural_koi');
  muralWall(20, 24.9, 30, 24.9, 3.2, 0, -1, 'mural_patchwork', 'mural_patchwork');

  // ------------------------------------------------------------------ perimeter seat walls (collision boundary)
  const seat = (x0: number, z0: number, x1: number, z1: number) =>
    b.box('wall', V(x0, 0, z0), V(x1, 0.45, z1), { color: C_WALL }, ['-y']);
  seat(-38.6, -23, -38, 26.2); seat(38, -23, 38.6, 26.2); seat(-38.6, 25.6, 38.6, 26.2);

  // ------------------------------------------------------------------ plaza ground with bowl holes
  const outer = [V(-38, 0, -23), V(38, 0, -23), V(38, 0, 25.6), V(-38, 0, 25.6)];
  b.polygon('concrete', outer, UP, { color: C_PLAZA }, holes);

  // boardwalk (wood, flush with the plaza) + railing line
  b.quad('wood', V(-70, 0, -27.4), V(70, 0, -27.4), V(70, 0, -23), V(-70, 0, -23), {
    surface: Surface.Wood, uv: (p) => [p.x / 2.0, p.z / 2.0],
  }, UP);
  // invisible boundary (boardwalk railing / park ends)
  const inv = (a: Vector3, c: Vector3, n: Vector3) => b.quad(null, a, c, c.clone().setY(3), a.clone().setY(3), { visual: false }, n);
  inv(V(-38.6, 0, -27.25), V(38.6, 0, -27.25), V(0, 0, 1));
  inv(V(-38.6, 0, -27.4), V(-38.6, 0, -23), V(1, 0, 0));
  inv(V(38.6, 0, -27.4), V(38.6, 0, -23), V(-1, 0, 0));

  const lamps = [
    V(-37.3, 0, -22.3), V(-37.3, 0, -4), V(-37.3, 0, 12), V(-37.3, 0, 25), V(37.3, 0, -22.3), V(37.3, 0, -3), V(37.3, 0, 12),
    V(37.3, 0, 25), V(-14, 0, 25.2), V(16, 0, 25.2), V(10, 0, -22.4), V(-20, 0, -22.4),
  ];

  return {
    builder: b, grindLines: grind, lamps, murals, tubes,
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
    },
  };
}

/** Thin L-shaped angle iron strip along a ledge edge (visual). */
function edgeIron(a: Vector3, c: Vector3): BufferGeometry {
  const len = a.distanceTo(c);
  const g = new BoxGeometry(len, 0.012, 0.03);
  const mid = a.clone().lerp(c, 0.5);
  const ang = Math.atan2(-(c.z - a.z), c.x - a.x);
  g.applyMatrix4(new Matrix4().makeRotationY(ang));
  g.applyMatrix4(new Matrix4().makeTranslation(mid.x, mid.y + 0.002, mid.z));
  g.deleteAttribute('uv');
  return g;
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
