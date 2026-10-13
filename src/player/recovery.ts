import { Vector3 } from 'three';
import type { CollisionWorld, Hit } from '../world/collision';

/**
 * Where a bailed rider stands up, walks and steps back on: pure queries on the collision world, so they run headless.
 * Ground he walks on is nearly flat (normal.y >= WALK_NY, small steps); the board goes back on flat open ground.
 */
export const WALK_NY = 0.89; // ~27 deg: the 25 deg banks and the funbox sides, not transitions or 30 deg banks
export const STEP_UP = 0.2, STEP_DOWN = 0.55; // a stair riser up, a hop down off a ledge
const FLAT_NY = 0.985;
const SAMPLE = 0.075;
const HEEL = 0.36; // he stands this far beside the board centre (heel side), facing across it
/** standing body: spheres (height over the feet, radius) */
const STAND: [number, number][] = [[0.45, 0.2], [0.95, 0.24], [1.45, 0.22]];
const DOWN = new Vector3(0, -1, 0), UP = new Vector3(0, 1, 0);
const _o = new Vector3(), _c = new Vector3(), _d = new Vector3();

export interface RecoveryPlan {
  stand: Vector3; // where he stands up
  ride: Vector3; fwd: Vector3; up: Vector3; // the board on the ground: wheel contact point, nose direction, ground normal
  target: Vector3; faceYaw: number; // where he stands beside the board and the way he faces
  relocate: boolean; // the board is moved to `ride` (where it lies he can't walk to it or step on it)
  path: Vector3[]; // ground points of the walk stand -> target
  why: string;
}

/** ground under (x, z), searched from `above` over y down to `below` under it */
export function groundAt(world: CollisionWorld, x: number, z: number, y: number, above = 0.5, below = 1.5): Hit | null {
  return world.raycast(_o.set(x, y + above, z), DOWN, above + below);
}

const _e1 = new Vector3(), _e2 = new Vector3();
/** how level the ground of a hit is: the smoothed normal blends across seams (the foot of a bank), the face does not */
export function levelness(world: CollisionWorld, h: Hit) {
  const idx = world.geometry.index!.array, P = world.geometry.getAttribute('position').array;
  const i0 = idx[h.faceIndex * 3] * 3, i1 = idx[h.faceIndex * 3 + 1] * 3, i2 = idx[h.faceIndex * 3 + 2] * 3;
  _e1.set(P[i1] - P[i0], P[i1 + 1] - P[i0 + 1], P[i1 + 2] - P[i0 + 2]);
  _e2.set(P[i2] - P[i0], P[i2 + 1] - P[i0 + 1], P[i2 + 2] - P[i0 + 2]);
  const fy = Math.abs(_e1.cross(_e2).normalize().y);
  return Math.min(h.normal.y, fy);
}

/** a rider standing with his feet at p touches nothing and has nothing over his head */
export function standClear(world: CollisionWorld, p: Vector3) {
  for (const [h, r] of STAND) if (world.closestPoint(_c.set(p.x, p.y + h, p.z), r)) return false;
  return !world.raycast(_c.set(p.x, p.y + 0.25, p.z), UP, 1.75, true);
}

/** walkable ground right under p with room to stand (returns the ground hit); minNy: how level */
export function standable(world: CollisionWorld, p: Vector3, minNy = WALK_NY): Hit | null {
  const h = groundAt(world, p.x, p.z, p.y, 0.35, 0.5);
  return h && levelness(world, h) >= minNy && standClear(world, h.point) ? h : null;
}

/** nearest spot within maxR of p where he can stand (rings outward), or null */
export function findStandSpot(world: CollisionWorld, p: Vector3, maxR = 4, minNy = WALK_NY): Vector3 | null {
  for (let r = 0; r <= maxR + 1e-6; r += 0.2) {
    const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = groundAt(world, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, p.y, 0.6, 3);
      if (h && levelness(world, h) >= minNy && standClear(world, h.point)) return h.point;
    }
  }
  return null;
}

/** straight walk from -> to: every sample on walkable ground, small steps, room to stand */
export function walkPath(world: CollisionWorld, from: Vector3, to: Vector3) {
  const dx = to.x - from.x, dz = to.z - from.z, L = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(L / SAMPLE));
  const pts = [from.clone()];
  let y = from.y;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const h = groundAt(world, from.x + dx * k, from.z + dz * k, y, STEP_UP + 0.25, STEP_DOWN + 0.3);
    if (!h) return { ok: false, pts, why: 'no ground' };
    if (levelness(world, h) < WALK_NY) return { ok: false, pts, why: 'steep' };
    const dy = h.point.y - y;
    if (dy > STEP_UP || dy < -STEP_DOWN) return { ok: false, pts, why: 'step' };
    if (!standClear(world, h.point)) return { ok: false, pts, why: 'blocked' };
    y = h.point.y; pts.push(h.point);
  }
  return { ok: true, pts, why: '' };
}

const pathLen = (pts: Vector3[]) => { let s = 0; for (let i = 1; i < pts.length; i++) s += pts[i].distanceTo(pts[i - 1]); return s; };

/** horizontal distance from p to the nearest grind line running at about p's height or a little above */
export function grindDist(world: CollisionWorld, p: Vector3) {
  let best = Infinity;
  for (const l of world.grindLines) {
    const n = l.pts.length, segs = l.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = l.pts[i], c = l.pts[(i + 1) % n];
      const abx = c.x - a.x, abz = c.z - a.z, l2 = abx * abx + abz * abz;
      const u = l2 > 1e-9 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2)) : 0;
      const dy = a.y + (c.y - a.y) * u - p.y;
      if (dy < -0.3 || dy > 1.3) continue;
      best = Math.min(best, Math.hypot(p.x - a.x - abx * u, p.z - a.z - abz * u));
    }
  }
  return best;
}

/** open flat ground for the board at p: level all around, no wall, no grind line close by (tight: just room for it) */
export function boardSpotOK(world: CollisionWorld, p: Vector3, n: Vector3, tight = false) {
  if (n.y < FLAT_NY) return false;
  if (world.closestPoint(_c.set(p.x, p.y + 0.8, p.z), tight ? 0.5 : 0.7)) return false;
  if (grindDist(world, p) < (tight ? 0.7 : 1.0)) return false;
  for (const [r, k] of tight ? [[0.5, 8]] : [[0.6, 8], [1.05, 10]]) {
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      const h = groundAt(world, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, p.y, 0.3, 0.4);
      if (!h || h.normal.y < 0.97 || Math.abs(h.point.y - p.y) > 0.04) return false;
    }
  }
  return true;
}

/** the way to roll off from p: the longest open, level run (a little bias towards `prefer`) */
export function bestHeading(world: CollisionWorld, p: Vector3, prefer?: Vector3) {
  let best = -1, bx = 0, bz = 1;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    let run = 0, y = p.y;
    for (let s = 0.3; s <= 4.2; s += 0.3) {
      const h = groundAt(world, p.x + dx * s, p.z + dz * s, y, 0.3, 0.4);
      if (!h || h.normal.y < 0.94 || Math.abs(h.point.y - y) > 0.05) break;
      if (world.closestPoint(_d.set(h.point.x, h.point.y + 0.55, h.point.z), 0.38)) break;
      y = h.point.y; run = s;
    }
    const score = run + (prefer ? 0.35 * (dx * prefer.x + dz * prefer.z) : 0);
    if (score > best) { best = score; bx = dx; bz = dz; }
  }
  return new Vector3(bx, 0, bz);
}

/** board at ride (ground normal up) with nose fwd: the spot beside it (heel side) where he stands and his facing */
function beside(ride: Vector3, fwd: Vector3, up: Vector3) {
  const heel = new Vector3().crossVectors(up, fwd).setY(0).normalize();
  return { target: ride.clone().addScaledVector(heel, HEEL), faceYaw: Math.atan2(-heel.x, -heel.z) };
}

/** stand beside a board lying at ride: either nose direction, whichever side has room and a walk from `stand` */
function stepOnFrom(world: CollisionWorld, stand: Vector3, ride: Vector3, fwd: Vector3, up: Vector3, maxWalk: number) {
  for (const sgn of [1, -1]) {
    const f = fwd.clone().multiplyScalar(sgn);
    const { target, faceYaw } = beside(ride, f, up);
    const g = groundAt(world, target.x, target.z, ride.y, 0.3, 0.4);
    if (!g || levelness(world, g) < WALK_NY || Math.abs(g.point.y - ride.y) > 0.08 || !standClear(world, g.point)) continue;
    const w = walkPath(world, stand, g.point);
    if (!w.ok || pathLen(w.pts) > maxWalk) continue;
    return { fwd: f, target: g.point, faceYaw, path: w.pts };
  }
  return null;
}

export interface BoardRest { pos: Vector3; fwd: Vector3; up: Vector3 }

/**
 * Plan the walk back after a bail. `stand` is where he stands up (already on walkable ground), `board` where the
 * board lies (ground point under it, nose direction, ground normal). He walks to it if it lies on flat ground he can
 * walk to; otherwise it is put down on open flat ground near him (relocate), facing the longest open run.
 * `face` (his facing) makes the board land right in front of him when it is moved (quick recovery).
 */
export function planRecovery(world: CollisionWorld, stand: Vector3, board: BoardRest | null,
  o: { maxWalk?: number; face?: number; prefer?: Vector3; tight?: boolean } = {}): RecoveryPlan {
  const maxWalk = o.maxWalk ?? 6;
  let miss = 'moving';
  if (board) {
    const { pos, fwd, up } = board;
    let flat = up.y >= 0.94;
    for (const s of [0.38, -0.38]) {
      if (!flat) break;
      const h = groundAt(world, pos.x + fwd.x * s, pos.z + fwd.z * s, pos.y, 0.3, 0.4);
      flat = !!h && h.normal.y >= WALK_NY && Math.abs(h.point.y - pos.y) <= 0.05;
    }
    const room = flat && standClear(world, _d.copy(pos).addScaledVector(up, 0.12));
    const s = room ? stepOnFrom(world, stand, pos, fwd, up, maxWalk) : null;
    if (s) return { stand: stand.clone(), ride: pos.clone(), fwd: s.fwd, up: up.clone(), target: s.target, faceYaw: s.faceYaw, relocate: false, path: s.path, why: 'walk' };
    miss = !flat ? 'not flat' : !room ? 'no room' : 'no walk';
  }
  const prefer = o.prefer ?? board?.fwd;
  // right in front of him (he only has to step on), then rings outward
  if (o.face !== undefined) {
    const fx = Math.sin(o.face), fz = Math.cos(o.face);
    const h = groundAt(world, stand.x + fx * HEEL, stand.z + fz * HEEL, stand.y, 0.3, 0.4);
    if (h && boardSpotOK(world, h.point, h.normal, o.tight)) {
      const heel = new Vector3(-fx, 0, -fz), fwd = new Vector3().crossVectors(heel, h.normal).normalize();
      const s = stepOnFrom(world, stand, h.point, fwd, h.normal, maxWalk);
      if (s && s.fwd.dot(fwd) > 0) return { stand: stand.clone(), ride: h.point, fwd: s.fwd, up: h.normal, target: s.target, faceYaw: s.faceYaw, relocate: true, path: s.path, why: 'front ' + miss };
    }
  }
  // rings of open flat ground around c that he can walk to from where he stands
  const search = (c: Vector3, maxR: number, walk: (r: number) => number, tag: string): RecoveryPlan | null => {
    for (let r = 0; r <= maxR + 0.01; r += 0.3) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.35);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const h = groundAt(world, c.x + Math.sin(a) * r, c.z + Math.cos(a) * r, c.y, 0.5, 0.8);
        if (!h || !boardSpotOK(world, h.point, h.normal, o.tight)) continue;
        const fwd = bestHeading(world, h.point, prefer);
        fwd.addScaledVector(h.normal, -fwd.dot(h.normal)).normalize();
        const s = stepOnFrom(world, stand, h.point, fwd, h.normal, walk(r));
        if (s) return { stand: stand.clone(), ride: h.point, fwd: s.fwd, up: h.normal, target: s.target, faceYaw: s.faceYaw, relocate: true, path: s.path, why: tag + miss };
      }
    }
    return null;
  };
  // tilted on a transition or tucked against something: it just rolls off onto the flat next to it
  const near = board && o.face === undefined && miss !== 'no walk' ? search(board.pos, 1.5, () => maxWalk, 'nudged ') : null;
  if (near) return near;
  const moved = search(stand, 6, (r) => Math.max(maxWalk, r + 1.5), 'moved ');
  if (moved) return moved;
  // nowhere open he can walk to: the board goes down right where he stands
  const g = groundAt(world, stand.x, stand.z, stand.y, 0.3, 0.6);
  const up = g ? g.normal : UP.clone();
  const fwd = bestHeading(world, stand, prefer);
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  const { faceYaw } = beside(stand, fwd, up);
  return { stand: stand.clone(), ride: stand.clone(), fwd, up, target: stand.clone(), faceYaw, relocate: true, path: [stand.clone()], why: 'here ' + miss };
}
