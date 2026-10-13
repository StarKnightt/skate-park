import { Quaternion, Vector3, Matrix4 } from 'three';
import type { CollisionWorld, Hit } from '../world/collision';
import type { GrindLine } from '../world/park';
import { clamp, carryVector, Spring, rng } from '../core/util';

export type FlipDir = 'left' | 'right' | 'down' | 'up';
export type FlipKind = 'kickflip' | 'heelflip' | 'shuvit' | 'treflip';
export type Mode = 'ride' | 'air' | 'grind' | 'bail' | 'recover';
export type BailKind = 'face' | 'back' | 'knock' | 'roll' | 'wall';

export interface SkateInput {
  steer: number; // -1 left .. 1 right
  push: boolean;
  brake: boolean;
  crouch: boolean;
  ollie: boolean; // release event
  flip: FlipDir | null; // direction held at release
  airTrick: FlipDir | null; // event: flip requested in the air
  grind: boolean; // held
  grindPressed: boolean;
  manual: boolean;
  lean: number; // -1 back .. 1 forward
}

export const emptyInput = (): SkateInput => ({
  steer: 0, push: false, brake: false, crouch: false, ollie: false, flip: null, airTrick: null,
  grind: false, grindPressed: false, manual: false, lean: 0,
});

export interface SkateEvent { type: string; [k: string]: any }

/** Collision surface id of invisible barriers (fences): they block and bounce, they never cause a bail. */
export const SURF_BARRIER = 9;

const G = 9.81;
const Y = new Vector3(0, 1, 0);
const TRUCK = 0.18;
export const KICKTURN_T = 0.44;
/** Ollie pop speed: a quick tap pops ~1.85 m/s (0.38 s of air), a full crouch (>= 0.3 s) ~2.8 m/s (0.57 s). */
const POP_MIN = 1.85, POP_MAX = 2.8;
/**
 * dur..durMax: board rotation time (stretched to the air time), flick: pop -> start of the rotation.
 * Real flips (kickflip_pop_24fps #04-#12): the front foot flicks ~0.08 s after the pop and the board is caught ~0.15-0.2 s
 * before touchdown, so the legs are split around the peak while the board turns between them.
 */
const FLIPS: Record<FlipDir, { kind: FlipKind; dur: number; durMax: number; flick: number; name: string; pts: number }> = {
  left: { kind: 'kickflip', dur: 0.2, durMax: 0.3, flick: 0.075, name: 'Kickflip', pts: 250 },
  right: { kind: 'heelflip', dur: 0.2, durMax: 0.3, flick: 0.075, name: 'Heelflip', pts: 250 },
  down: { kind: 'shuvit', dur: 0.19, durMax: 0.3, flick: 0.03, name: 'Pop Shove-It', pts: 200 },
  up: { kind: 'treflip', dur: 0.25, durMax: 0.34, flick: 0.07, name: 'Tre Flip', pts: 500 },
};
const CATCH_LEAD = 0.17; // catch -> touchdown (s)
/** Body collision spheres along the board normal (height, radius); the top one covers head and shoulders. */
const BODY: [number, number][] = [[0.45, 0.25], [0.95, 0.26], [1.3, 0.29], [1.58, 0.31]];

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3(), _q = new Quaternion(), _m = new Matrix4();

export interface FlipState { kind: FlipKind; name: string; pts: number; t: number; dur: number; delay: number; done: boolean }

/**
 * Drop-in: rolling off a deck over a coping into a steep transition. The board rolls on until the trailing truck sits on
 * the coping (nose over the transition), stalls for a beat, then pivots nose-down about the trailing wheels until the
 * leading wheels meet the wall just under the coping, and rides on down the wall. Mode stays 'ride' throughout (no air).
 */
export interface DropIn {
  phase: 'roll' | 'stall' | 'pivot';
  t: number; // time in the current phase (s)
  pk: number; // pivot progress 0..1
  start: Vector3; // board centre when the drop-in began
  dist: number; // roll distance until the trailing wheels reach the coping (m)
  pivot: Vector3; // trailing wheels on the coping lip
  dir: Vector3; // horizontal direction into the transition
  lead: number; // +1 nose first, -1 tail first
  ang: number; // board pitch, leading end down (rad)
  ang1: number; // pitch at which the leading wheels meet the wall
  tRoll: number; tStall: number; tPivot: number;
  speed: number; // approach speed (m/s)
}
const DROP_STALL_UP = -0.06; // leading end lifts a little while the tail sits on the coping

// ------------------------------------------------------------------------------------------ bail board rigid body
const BM = 2.4; // complete board (kg)
const BCOM = 0.075; // centre of mass above the wheel contact plane
const BINV_I = new Vector3(1 / 0.1336, 1 / 0.14, 1 / 0.01124); // about board X (pitch), Y (yaw), Z (roll)
/** contact points (board space from the wheel-plane origin): x, y, z, wheel */
const BPTS: number[][] = [
  [0.094, 0, 0.18, 1], [-0.094, 0, 0.18, 1], [0.094, 0, -0.18, 1], [-0.094, 0, -0.18, 1],
  [0.113, 0.027, 0.18, 0], [-0.113, 0.027, 0.18, 0], [0.113, 0.027, -0.18, 0], [-0.113, 0.027, -0.18, 0],
  [0.09, 0.118, 0.25, 0], [-0.09, 0.118, 0.25, 0], [0.09, 0.118, -0.25, 0], [-0.09, 0.118, -0.25, 0],
  // nose and tail kicks: upside down the board rests on them
  [0.09, 0.149, 0.35, 0], [-0.09, 0.149, 0.35, 0], [0.09, 0.149, -0.35, 0], [-0.09, 0.149, -0.35, 0],
  [0.06, 0.163, 0.385, 0], [-0.06, 0.163, 0.385, 0], [0.06, 0.163, -0.385, 0], [-0.06, 0.163, -0.385, 0],
  [0, 0.168, 0.405, 0], [0, 0.168, -0.405, 0], [0, 0.152, 0.398, 0], [0, 0.152, -0.398, 0],
  [0.105, 0.11, 0, 0], [-0.105, 0.11, 0, 0],
];

/** The board on its own after a bail: a small rigid body that tumbles, skids or rolls, then lies still. */
export class BoardBody {
  com = new Vector3();
  q = new Quaternion();
  v = new Vector3();
  w = new Vector3();
  asleep = false;
  contacts = 0;
  t = 0;
  private restT = 0;
  private tipT = 0;
  private prev = new Vector3();
  private qi = new Quaternion();
  private a = new Vector3(); private b = new Vector3(); private c = new Vector3(); private d = new Vector3();
  private e = new Vector3(); private f = new Vector3(); private g = new Vector3(); private h = new Vector3();
  private i = new Vector3(); private j = new Vector3(); private r = new Vector3(); private dir = new Vector3();
  private nAvg = new Vector3();
  private pivot = new Vector3();

  constructor(private world: CollisionWorld, private onClack: (v: number) => void) {}

  init(rootPos: Vector3, q: Quaternion, v: Vector3, w: Vector3) {
    this.q.copy(q);
    this.com.set(0, BCOM, 0).applyQuaternion(q).add(rootPos);
    this.v.copy(v); this.w.copy(w);
    this.asleep = false; this.restT = 0; this.t = 0;
  }

  /** board root (wheel contact plane origin) in world space */
  rootPos(out: Vector3) { return out.set(0, -BCOM, 0).applyQuaternion(this.q).add(this.com); }
  get wheelsDown() { return _v.set(0, 1, 0).applyQuaternion(this.q).y >= 0; }

  /** where the rider stands the board up again: ground point under the centre + nose direction on the ground */
  ridePose(outPos: Vector3, outFwd: Vector3, outUp: Vector3) {
    const h = this.world.raycast(_v.copy(this.com).add(_v2.set(0, 0.5, 0)), _v3.set(0, -1, 0), 2.5);
    outUp.copy(h ? h.normal : Y);
    outPos.copy(h ? h.point : this.com);
    outFwd.set(0, 0, 1).applyQuaternion(this.q);
    outFwd.addScaledVector(outUp, -outFwd.dot(outUp));
    if (outFwd.lengthSq() < 1e-6) outFwd.set(1, 0, 0).applyQuaternion(this.q).cross(outUp);
    outFwd.normalize();
  }

  private invI(v: Vector3, out: Vector3) {
    this.qi.copy(this.q).invert();
    out.copy(v).applyQuaternion(this.qi);
    out.set(out.x * BINV_I.x, out.y * BINV_I.y, out.z * BINV_I.z);
    return out.applyQuaternion(this.q);
  }

  private friction(r: Vector3, t: Vector3, s: number, maxJ: number) {
    const rt = this.h.crossVectors(r, t);
    const k = 1 / BM + t.dot(this.i.crossVectors(this.invI(rt, this.j), r));
    const jt = clamp(-s / k, -maxJ, maxJ);
    this.v.addScaledVector(t, jt / BM);
    this.w.add(this.invI(rt, this.j).multiplyScalar(jt));
  }

  private impulse(r: Vector3, n: Vector3, wheel: boolean) {
    const vp = this.a.crossVectors(this.w, r).add(this.v);
    const vn = vp.dot(n);
    if (vn >= 0) return;
    const rn = this.b.crossVectors(r, n);
    const k = 1 / BM + n.dot(this.c.crossVectors(this.invI(rn, this.d), r));
    const e = vn < -1.4 ? 0.3 : 0;
    const jn = (-(1 + e) * vn) / k;
    this.v.addScaledVector(n, jn / BM);
    this.w.add(this.invI(rn, this.d).multiplyScalar(jn));
    if (vn < -1.6) this.onClack(-vn);
    // Coulomb friction; wheels roll along the board and grip across it
    vp.crossVectors(this.w, r).add(this.v);
    const vt = this.e.copy(vp).addScaledVector(n, -vp.dot(n));
    if (wheel) {
      const roll = this.f.set(0, 0, 1).applyQuaternion(this.q);
      roll.addScaledVector(n, -roll.dot(n));
      if (roll.lengthSq() > 1e-6) {
        roll.normalize();
        const side = this.g.crossVectors(n, roll);
        this.friction(r, roll, vt.dot(roll), 0.1 * jn);
        this.friction(r, side, vt.dot(side), 0.75 * jn);
        return;
      }
    }
    const s = vt.length();
    if (s > 1e-5) this.friction(r, vt.divideScalar(s), s, 0.45 * jn);
  }

  step(dt: number) {
    if (this.asleep) return;
    this.t += dt;
    this.prev.copy(this.com);
    this.v.y -= G * dt;
    this.v.multiplyScalar(1 - 0.03 * dt);
    this.com.addScaledVector(this.v, dt);
    const wl = this.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_v.copy(this.w).divideScalar(wl), wl * dt); this.q.premultiply(_q).normalize(); }
    // sweep the centre so a fast board never tunnels through the floor or a wall
    const dv = _v.subVectors(this.com, this.prev);
    const dl = dv.length();
    if (dl > 1e-6) {
      const h = this.world.raycast(this.prev, dv.divideScalar(dl), dl + 0.05);
      if (h && h.normal.dot(this.v) < 0) {
        this.com.copy(h.point).addScaledVector(h.normal, 0.05);
        this.v.addScaledVector(h.normal, -1.3 * this.v.dot(h.normal));
      }
    }
    // contact points: a ray from the centre to each point finds the surfaces it sinks into
    const up = _v4.set(0, 1, 0).applyQuaternion(this.q);
    this.contacts = 0;
    this.nAvg.set(0, 0, 0);
    this.pivot.set(0, 0, 0);
    for (let it = 0; it < 2; it++) {
      for (const p of BPTS) {
        const r = this.r.set(p[0], p[1] - BCOM, p[2]).applyQuaternion(this.q);
        const len = r.length();
        const dir = this.dir.copy(r).divideScalar(len);
        const h = this.world.raycast(this.com, dir, len);
        if (!h) continue;
        const n = h.normal;
        const depth = (len - h.distance) * Math.max(0.2, -dir.dot(n));
        if (it === 0) { this.contacts++; this.nAvg.add(n); this.pivot.add(this.com).add(r); }
        if (depth > 0.0015) this.com.addScaledVector(n, (depth - 0.001) * 0.7);
        this.impulse(r, n, p[3] === 1 && up.dot(n) > 0.6);
      }
    }
    if (this.contacts) {
      this.nAvg.normalize();
      this.pivot.divideScalar(this.contacts);
      this.w.multiplyScalar(Math.exp(-2.5 * dt));
      const c = up.dot(this.nAvg);
      const target = c >= 0 ? this.nAvg : _v2.copy(this.nAvg).negate();
      const axis = _v.crossVectors(up, target);
      const s = axis.length();
      const vs = this.v.length(), ws = this.w.length();
      let ang = 0;
      if (Math.abs(c) < 0.75 && vs < 0.8) {
        // a board left on its edge falls over onto the wheels or the grip, pivoting on the edge it stands on
        this.tipT += dt;
        ang = Math.min(Math.asin(Math.min(1, s)), (1.2 + 9 * this.tipT) * dt);
        this.w.multiplyScalar(Math.exp(-6 * dt)); this.v.multiplyScalar(Math.exp(-3 * dt));
      } else {
        this.tipT = 0;
        if (this.contacts >= 2 && vs < 0.4 && ws < 3) {
          // nearly still and nearly flat: rocking dies out and it settles onto the ground
          this.v.multiplyScalar(Math.exp(-5 * dt)); this.w.multiplyScalar(Math.exp(-7 * dt));
          ang = Math.min(Math.asin(Math.min(1, s)), 0.8 * dt);
        }
      }
      if (ang > 1e-6 && s > 1e-6) {
        _q.setFromAxisAngle(axis.divideScalar(s), ang);
        this.q.premultiply(_q).normalize();
        _v3.subVectors(this.com, this.pivot).applyQuaternion(_q);
        this.com.copy(this.pivot).add(_v3);
      }
    } else { this.w.multiplyScalar(Math.exp(-0.3 * dt)); this.tipT = 0; }
    // rest
    const still = this.contacts >= 2 && this.tipT === 0 && this.v.length() < 0.08 && this.w.length() < 0.4;
    this.restT = still ? this.restT + dt : 0;
    if (this.restT > 0.35 || this.t > 9) { this.asleep = true; this.v.set(0, 0, 0); this.w.set(0, 0, 0); }
    if (this.com.y < -30) { this.com.copy(this.prev).setY(0.2); this.v.set(0, 0, 0); }
  }
}

/**
 * Kinematic skateboard controller. `pos` is the contact point of the wheels on the surface,
 * `up` the board normal, `fwd` the nose direction. Runs at a fixed 120 Hz.
 */
export class SkatePhysics {
  mode: Mode = 'ride';
  pos = new Vector3();
  vel = new Vector3();
  up = new Vector3(0, 1, 0);
  fwd = new Vector3(0, 0, -1);
  surface = 0;
  slope = 0; // 1 - up.y
  speed = 0;
  fakie = false;
  time = 0;

  // ride sub-states
  crouch = new Spring(0, 14);
  crouchTime = 0;
  pushT = -1; // push cycle time (s), -1 = idle
  pushCooldown = 0;
  manual = { active: false, balance: 0, bvel: 0, time: 0, nose: false };
  kickturn = { t: -1, dir: 1 };
  wobble = 0; // seconds of landing wobble remaining
  wobbleDur = 0.9;
  dropin: DropIn | null = null;
  dropinEndT = -10; // sim time the last drop-in handed over to riding down the wall
  bonk = 0;
  landImpulse = 0; // for absorb animation
  brakeAmt = 0;

  // air
  airTime = 0;
  spinVel = 0;
  airYaw = 0;
  flip: FlipState | null = null;
  popped = false;
  popT = -1; // sim time of the last pop
  airPredT = 0.5; // predicted air time at take-off (s)
  landT = -10; // sim time of the last landing
  landImpact = 0;
  vert: null | { wallN: Vector3; q0: Quaternion; qPeak: Quaternion; q1: Quaternion; t: number; T: number; sign: number } = null;
  boardQ = new Quaternion(); // board orientation in the air
  predicted: { normal: Vector3; tti: number; point: Vector3 } | null = null;
  grindBuffer = 0;

  // grind
  grind: null | {
    line: GrindLine; seg: number; u: number; dir: number; speed: number; style: '5050' | 'boardslide';
    side: number; balance: number; bvel: number; time: number; name: string;
  } = null;
  grindCooldown = 0;

  // bail
  bail: null | { kind: BailKind; reason: string; t: number; body: Vector3; bodyVel: Vector3; heading: number; board: BoardBody } = null;

  events: SkateEvent[] = [];
  lastGround: Hit | null = null;

  constructor(public world: CollisionWorld) {}

  emit(type: string, data: Record<string, any> = {}) { this.events.push({ type, ...data }); }

  reset(p: Vector3, heading: number) {
    this.mode = 'ride';
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.up.set(0, 1, 0);
    this.fwd.set(Math.sin(heading), 0, Math.cos(heading));
    this.flip = null; this.grind = null; this.bail = null; this.vert = null; this.dropin = null; this.dropinEndT = -10;
    this.manual.active = false; this.kickturn.t = -1; this.wobble = 0; this.pushT = -1; this.crouchTime = 0;
    this.popT = -1; this.landT = -10; this.fakie = false;
    const h = this.world.raycast(_v.copy(p).addScaledVector(Y, 1.5), _v2.set(0, -1, 0), 4);
    if (h) { this.pos.copy(h.point); this.up.copy(h.normal); }
  }

  /** travel direction sign relative to the nose */
  get travelSign() { return this.vel.dot(this.fwd) >= 0 ? 1 : -1; }

  /** progress of the board rotation of the current flip (0 before the flick, 1 at the catch) */
  flipProgress() {
    const f = this.flip;
    return f ? clamp((f.t - f.delay) / f.dur, 0, 1) : 1;
  }

  step(dt: number, inp: SkateInput) {
    this.time += dt;
    this.pushHeld = inp.push;
    this.lastSteer = inp.steer;
    this.grindCooldown = Math.max(0, this.grindCooldown - dt);
    this.pushCooldown = Math.max(0, this.pushCooldown - dt);
    this.wobble = Math.max(0, this.wobble - dt);
    this.bonk = Math.max(0, this.bonk - dt);
    this.landImpulse *= Math.exp(-6 * dt);
    if (inp.grindPressed) this.grindBuffer = 0.3; else this.grindBuffer = Math.max(0, this.grindBuffer - dt);
    switch (this.mode) {
      case 'ride': this.rideStep(dt, inp); break;
      case 'air': this.airStep(dt, inp); break;
      case 'grind': this.grindStep(dt, inp); break;
      case 'bail': this.bailStep(dt); break;
      case 'recover': break;
    }
    this.speed = this.vel.length();
  }

  private surfaceAt(face: number) {
    const idx = this.world.geometry.index!.array;
    return this.world.surfaces[idx[face * 3]] ?? 0;
  }

  // ---------------------------------------------------------------------------------------- ground
  private probe(from: Vector3, up: Vector3, snap: number): Hit | null {
    const o = _v3.copy(from).addScaledVector(up, 0.45);
    return this.world.raycast(o, _v2.copy(up).negate(), 0.45 + snap);
  }

  private rideStep(dt: number, inp: SkateInput) {
    if (this.dropin || this.tryDropIn(dt)) { this.dropinStep(dt); return; }
    const sp = this.vel.length();
    const hit = this.probe(this.pos, this.up, 0.1 + sp * dt * 2.5);
    if (!hit) { this.toAir(false); return; }
    const ang = this.up.angleTo(hit.normal);
    if (ang > 0.72) {
      // big convex change (lip / edge): leave the ground
      this.toAir(false); return;
    }
    const dh = _v.subVectors(hit.point, this.pos).dot(this.up);
    if (dh < -0.06 && ang < 0.12) {
      // the ground dropped away with no change in slope (stairs, ledge edge, drop-off): fly
      this.toAir(false); return;
    }
    if (dh > 0.07 && !this.manual.active) {
      // rolled into a curb / step
      this.onCurb(dh); if (this.mode !== 'ride') return;
    }
    // follow the surface: carry velocity and heading onto the new tangent plane (keeps speed through transitions)
    carryVector(this.vel, this.up, hit.normal);
    carryVector(this.fwd, this.up, hit.normal);
    this.up.copy(hit.normal);
    this.pos.copy(hit.point);
    this.vel.addScaledVector(this.up, -this.vel.dot(this.up));
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.surface = hit.surface;
    this.lastGround = hit;
    this.slope = 1 - this.up.y;

    // crouch / ollie charge
    this.crouch.update(inp.crouch ? 1 : 0, dt);
    if (inp.crouch) this.crouchTime += dt; else if (!inp.ollie) this.crouchTime = 0;

    // ---- forces
    const gT = _v.set(0, -G, 0).addScaledVector(this.up, G * this.up.y); // tangential gravity
    this.vel.addScaledVector(gT, dt);
    let s = this.vel.length();
    const crr = this.surface === 1 ? 0.03 : 0.0135;
    const decel = crr * G * Math.max(0.2, this.up.y) + 0.0028 * s * s + (this.manual.active ? 0.05 : 0);
    if (s > 1e-4) this.vel.multiplyScalar(Math.max(0, s - decel * dt) / s);
    s = this.vel.length();

    const travel = s > 0.05 ? _v2.copy(this.vel).divideScalar(s) : _v2.copy(this.fwd).multiplyScalar(this.fakie ? -1 : 1);

    // push cycle (W): back foot pushes the ground; impulse during the plant phase
    const canPush = this.up.y > 0.94 && !this.manual.active && this.kickturn.t < 0 && this.crouch.x < 0.35;
    if (inp.push && canPush && this.pushT < 0 && this.pushCooldown <= 0) {
      this.pushT = 0; this.emit('push');
    }
    if (this.pushT >= 0) {
      this.pushT += dt;
      const PUSH_DUR = 0.78;
      if (this.pushT > 0.24 && this.pushT < 0.52 && canPush) {
        const sNow = this.vel.length();
        const gain = 2.4 * Math.pow(clamp(1 - sNow / 8.6, 0, 1), 1.15) + 0.15;
        this.vel.addScaledVector(travel, (gain / 0.28) * dt);
      }
      if (this.pushT >= PUSH_DUR || !canPush && this.pushT < 0.24) { this.pushT = -1; this.pushCooldown = 0.05; }
    }
    // pumping transitions (hold W while going downhill on a transition)
    if (inp.push && this.up.y < 0.97 && this.up.y > 0.2) {
      const downhill = gT.dot(travel) / G;
      if (downhill > 0.05) this.vel.addScaledVector(travel, 1.6 * downhill * dt);
    }
    // foot brake
    this.brakeAmt = inp.brake && s > 0.2 && !this.manual.active ? 1 : 0;
    if (this.brakeAmt) {
      const ns = Math.max(0, s - 3.4 * dt);
      this.vel.multiplyScalar(s > 1e-4 ? ns / s : 0);
    }

    // ---- steering (carve): rotate heading and velocity together around the surface normal
    s = this.vel.length();
    const turnRate = inp.steer * (s < 0.4 ? 2.4 : 2.9 - 1.3 * clamp(s / 10, 0, 1)) * (this.crouch.x > 0.5 ? 1.12 : 1) * (this.manual.active ? 0.55 : 1);
    if (Math.abs(turnRate) > 1e-4 && this.kickturn.t < 0) {
      _q.setFromAxisAngle(this.up, -turnRate * dt);
      this.fwd.applyQuaternion(_q);
      this.vel.applyQuaternion(_q);
    }
    // wheel grip: kill lateral sliding
    const vf = this.vel.dot(this.fwd);
    const lat = _v3.copy(this.vel).addScaledVector(this.fwd, -vf);
    this.vel.copy(this.fwd).multiplyScalar(vf).addScaledVector(lat, Math.exp(-16 * dt));
    if (vf < -0.35) this.fakie = true; else if (vf > 0.35) this.fakie = false;

    // ---- kickturn at the top of a transition when speed runs out: the nose lifts and the board
    // swings around its back wheels, so the back truck stays where it is
    if (this.kickturn.t >= 0) {
      const ease = (x: number) => x * x * (3 - 2 * x);
      const k0 = ease(clamp(this.kickturn.t / KICKTURN_T, 0, 1));
      this.kickturn.t += dt;
      const k1 = ease(clamp(this.kickturn.t / KICKTURN_T, 0, 1));
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      const dAng = Math.PI * this.kickturn.dir * (k1 - k0);
      if (dAng !== 0) {
        const pivot = _v.copy(this.pos).addScaledVector(this.fwd, -TRUCK);
        _q.setFromAxisAngle(this.up, dAng);
        this.fwd.applyQuaternion(_q);
        this.pos.copy(pivot).addScaledVector(this.fwd, TRUCK);
      }
      if (this.kickturn.t >= KICKTURN_T) { this.kickturn.t = -1; this.emit('kickturn'); }
    } else if (this.up.y < 0.8 && this.up.y > -0.05 && s < 0.55 && !this.fakie) {
      // riding forward up a transition and running out of speed: pivot on the tail to face downhill
      const uphill = _v.set(0, 1, 0).addScaledVector(this.up, -this.up.y).normalize();
      if (this.fwd.dot(uphill) > 0.6 && this.vel.dot(uphill) > -0.15 && !this.manual.active) {
        this.kickturn.t = 0;
        this.kickturn.dir = inp.steer < 0 ? 1 : -1;
        this.emit('kickturnStart', { dir: this.kickturn.dir });
      }
    }

    // ---- manual
    if (inp.manual && this.up.y > 0.9 && s > 0.6 && this.kickturn.t < 0) {
      if (!this.manual.active) {
        this.manual.active = true; this.manual.balance = 0.08 * (Math.random() - 0.5); this.manual.bvel = 0; this.manual.time = 0;
        this.manual.nose = false;
        this.emit('manualStart'); this.pushT = -1;
      }
    } else if (this.manual.active) this.endManual();
    if (this.manual.active) {
      const m = this.manual;
      m.time += dt;
      // unstable balance the player counters with W/S (lean)
      m.bvel += (m.balance * 2.2 + (Math.sin(this.time * 2.3) * 0.25) - inp.lean * 2.6) * dt;
      m.bvel *= Math.exp(-1.5 * dt);
      m.balance += m.bvel * dt;
      if (Math.abs(m.balance) > 1) { this.endManual(); this.startWobble(0.75); this.emit('manualFail'); }
    }

    // ---- integrate
    this.pos.addScaledVector(this.vel, dt);

    // ---- grind from the ground (coping at the lip of a transition, low ledges at board height)
    if (this.grindBuffer > 0 && this.grindCooldown <= 0) {
      if (this.tryGrind(true)) return;
    }
    // ---- ollie
    if (inp.ollie && this.kickturn.t < 0) { this.pop(inp); return; }
    this.collideBody(dt);
  }

  private startWobble(d: number) { this.wobble = d; this.wobbleDur = d; }

  // ---------------------------------------------------------------------------------------- drop-in
  /** rolling off a flat deck over a coping whose transition is steep: drop in instead of flying off the lip */
  private tryDropIn(dt: number) {
    if (this.up.y < 0.9 || this.kickturn.t >= 0) return false;
    const s = this.vel.length();
    if (s < 0.3) return false;
    const dir = _v.copy(this.vel).setY(0);
    if (dir.lengthSq() < 0.04) return false;
    dir.normalize();
    const p = this.pos;
    const reach = Math.max(0.03, s * dt * 1.5);
    let found = false, bx = 0, by = 0, bz = 0, bsd = 0;
    const inw = _v2;
    for (const line of this.world.grindLines) {
      if (line.kind !== 'coping' || !line.inward) continue;
      const n = line.pts.length, segs = line.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = line.pts[i], c = line.pts[(i + 1) % n];
        const abx = c.x - a.x, abz = c.z - a.z, l2 = abx * abx + abz * abz;
        if (l2 < 1e-8) continue;
        const u = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1);
        const cx = a.x + abx * u, cz = a.z + abz * u, cy = a.y + (c.y - a.y) * u;
        const dy = p.y - cy;
        if (dy < -0.12 || dy > 0.1) continue;
        const ia = line.inward[Math.min(i, line.inward.length - 1)], ic = line.inward[Math.min((i + 1) % n, line.inward.length - 1)];
        const ix = ia.x + (ic.x - ia.x) * u, iz = ia.z + (ic.z - ia.z) * u, il = Math.hypot(ix, iz);
        if (il < 1e-4) continue;
        const nx = ix / il, nz = iz / il, ox = p.x - cx, oz = p.z - cz;
        const sd = ox * nx + oz * nz; // signed distance past the coping line, into the transition
        if (sd < -reach || sd > 0.12) continue;
        if ((u === 0 || u === 1) && Math.abs(ox * nz - oz * nx) > 0.05) continue; // beside the end of an open coping
        if (dir.x * nx + dir.z * nz < 0.4) continue; // rolling along the coping or away from it
        if (!found || Math.abs(sd) < Math.abs(bsd)) { found = true; bx = cx; by = cy; bz = cz; bsd = sd; inw.set(nx, 0, nz); }
      }
    }
    if (!found) return false;
    // only steep transitions (bowls, half pipe, quarter pipes); banks just roll over their coping. The wall angle where
    // the board's centre will meet it (~0.17 m under the coping) is the angle the board pivots to.
    const h = this.world.raycast(_v3.set(bx, by - 0.17, bz).addScaledVector(inw, 0.9), _v4.copy(inw).negate(), 1.3);
    if (!h || h.normal.y > 0.64 || h.normal.dot(inw) < 0.3) return false;
    const along = dir.dot(inw);
    const lead = this.vel.dot(this.fwd) >= 0 ? 1 : -1;
    // the centre rolls on until the trailing wheels sit just over the coping lip
    const dist = Math.max(0, (0.012 - bsd) / along + TRUCK);
    const start = p.clone();
    const pivot = start.clone().addScaledVector(dir, dist - TRUCK);
    pivot.y = Math.max(p.y + 0.004, by - 0.004);
    this.dropin = {
      phase: 'roll', t: 0, pk: 0, start, dist, pivot, dir: dir.clone(), lead, ang: 0,
      ang1: clamp(Math.acos(clamp(h.normal.y, -1, 1)), 0.9, 1.5),
      tRoll: dist / Math.max(s, 1.2), tStall: clamp(0.24 - 0.02 * s, 0.12, 0.2), tPivot: clamp(0.27 - 0.014 * s, 0.17, 0.25),
      speed: s,
    };
    this.endManual(); this.pushT = -1; this.brakeAmt = 0;
    this.emit('dropInStart', { speed: +s.toFixed(2), wall: Math.round((this.dropin.ang1 * 180) / Math.PI) });
    return true;
  }

  /** kinematic drop-in: roll the trailing truck onto the coping, stall, pivot nose-down about the trailing wheels */
  private dropinStep(dt: number) {
    const d = this.dropin!;
    d.t += dt;
    const prev = _v4.copy(this.pos);
    if (d.phase === 'roll') {
      const k = Math.min(1, d.t / Math.max(d.tRoll, 1e-3));
      this.pos.copy(d.start).addScaledVector(d.dir, d.dist * k);
      this.pos.y = d.start.y + (d.pivot.y - d.start.y) * k;
      this.up.set(0, 1, 0);
      this.fwd.copy(d.dir).multiplyScalar(d.lead);
      if (k >= 1) { d.phase = 'stall'; d.t = 0; }
    } else {
      if (d.phase === 'stall') {
        const k = Math.min(1, d.t / d.tStall);
        d.ang = DROP_STALL_UP * k * k * (3 - 2 * k);
        if (k >= 1) { d.phase = 'pivot'; d.t = 0; }
      } else {
        const k = Math.min(1, d.t / d.tPivot);
        d.pk = k;
        // tips over like a fall: slow at first, still turning when the leading wheels meet the wall
        d.ang = DROP_STALL_UP + (d.ang1 - DROP_STALL_UP) * k * k * (2.2 - 1.2 * k);
      }
      const ca = Math.cos(d.ang), sa = Math.sin(d.ang);
      const tdir = _v.copy(d.dir).multiplyScalar(ca).addScaledVector(Y, -sa);
      this.up.copy(Y).multiplyScalar(ca).addScaledVector(d.dir, sa);
      this.fwd.copy(tdir).multiplyScalar(d.lead);
      this.pos.copy(d.pivot).addScaledVector(tdir, TRUCK);
      if (d.phase === 'pivot' && d.pk >= 1) { this.finishDropIn(); return; }
    }
    this.vel.subVectors(this.pos, prev).divideScalar(dt);
  }

  /** the leading wheels are on the wall: ride on down it */
  private finishDropIn() {
    const d = this.dropin!;
    const ca = Math.cos(d.ang1), sa = Math.sin(d.ang1);
    const tdir = _v.copy(d.dir).multiplyScalar(ca).addScaledVector(Y, -sa);
    const up = _v2.copy(Y).multiplyScalar(ca).addScaledVector(d.dir, sa);
    const c = _v3.copy(d.pivot).addScaledVector(tdir, TRUCK);
    const h = this.world.raycast(_v4.copy(c).addScaledVector(up, 0.35), up.clone().negate(), 0.75);
    if (h && h.normal.dot(up) > 0.6) { this.pos.copy(h.point); this.up.copy(h.normal); } else { this.pos.copy(c); this.up.copy(up); }
    tdir.addScaledVector(this.up, -tdir.dot(this.up)).normalize();
    this.fwd.copy(tdir).multiplyScalar(d.lead);
    const v0 = Math.max(2.0, d.speed * Math.cos(d.ang1)) + 0.4;
    this.vel.copy(tdir).multiplyScalar(v0);
    this.fakie = d.lead < 0;
    this.lastGround = h;
    this.dropin = null;
    this.dropinEndT = this.time;
    this.emit('dropIn', { speed: +v0.toFixed(2) });
  }

  private endManual() {
    if (!this.manual.active) return;
    this.manual.active = false;
    this.emit('manualEnd', { time: this.manual.time });
  }

  private onCurb(dh: number) {
    const s = this.vel.length();
    if (dh > 0.36) return; // treated as a wall by the body check
    if (s > 5.2) { this.toBail('face', 'curb'); return; }
    // bonk: bounce back and wobble
    this.vel.multiplyScalar(-0.25);
    this.bonk = 0.4; this.startWobble(0.6);
    this.pos.addScaledVector(this.vel, 0.03);
    this.emit('bonk');
  }

  private pop(inp: SkateInput) {
    const charge = clamp((this.crouchTime - 0.06) / 0.24, 0, 1);
    const popV = POP_MIN + (POP_MAX - POP_MIN) * charge;
    const dir = _v.copy(this.up).multiplyScalar(0.7).addScaledVector(Y, 0.3).normalize();
    this.endManual();
    this.vel.addScaledVector(dir, popV);
    this.toAir(true);
    this.takeoff();
    if (inp.flip) this.startFlip(inp.flip, this.airPredT, false);
    this.emit('pop', { charge, flip: this.flip?.name, airT: +this.airPredT.toFixed(3) });
    this.crouchTime = 0;
  }

  /** remember the pop time and the predicted air time (drives the explicit air animation curves) */
  private takeoff() {
    this.popT = this.time;
    this.predictLanding();
    this.airPredT = this.predicted ? Math.max(0.2, this.predicted.tti) : (2 * Math.max(0.6, this.vel.y)) / G;
  }

  startFlip(d: FlipDir, airT: number, inAir: boolean) {
    const f = FLIPS[d];
    let dur = f.dur, delay = 0;
    // popped from the ground: the front foot flicks right after the pop, the rotation fills the air time up to the catch
    if (!inAir) { delay = f.flick; dur = clamp(airT - delay - CATCH_LEAD, f.dur, f.durMax); }
    else dur = Math.min(dur, Math.max(0.14, airT - 0.1));
    this.flip = { kind: f.kind, name: f.name, pts: f.pts, t: 0, dur, delay, done: false };
    this.emit('flip', { kind: f.kind, dur: +dur.toFixed(3), delay: +delay.toFixed(3) });
  }

  // ---------------------------------------------------------------------------------------- air
  private toAir(popped: boolean) {
    const wasRide = this.mode === 'ride';
    this.mode = 'air';
    this.popped = popped;
    this.airTime = 0;
    this.airYaw = 0;
    this.spinVel = 0;
    this.pushT = -1;
    this.kickturn.t = -1;
    this.endManual();
    this.boardQ.copy(this.basisQuat(this.fwd, this.up));
    this.vert = null;
    // vert assist: leaving a steep transition upwards -> keep the rider over the ramp and turn them around
    const steep = this.up.y < 0.55 && this.up.y > -0.3;
    const wallN = new Vector3().copy(this.up).setY(0);
    if (wasRide && steep && this.vel.y > 0.8 && wallN.lengthSq() > 0.05 && !this.pushHeld) {
      wallN.normalize();
      const vh = new Vector3().copy(this.vel).setY(0);
      const along = vh.addScaledVector(wallN, -vh.dot(wallN));
      this.vel.set(along.x, this.vel.y, along.z).addScaledVector(wallN, 0.4);
      const T = (2 * this.vel.y) / G;
      const coping = new Vector3().crossVectors(wallN, Y).normalize();
      let sign = this.lastSteer !== 0 ? Math.sign(this.lastSteer) : (along.dot(coping) >= 0 ? 1 : -1);
      if (along.lengthSq() > 0.25) sign = along.dot(coping) >= 0 ? 1 : -1;
      const q0 = this.boardQ.clone();
      const peakFwd = coping.clone().multiplyScalar(sign);
      const qPeak = this.basisQuat(peakFwd, Y);
      const q1 = new Quaternion().setFromAxisAngle(wallN, Math.PI * sign).multiply(q0);
      this.vert = { wallN: wallN.clone(), q0, qPeak, q1, t: 0, T: Math.max(0.4, T), sign };
      this.emit('vertAir');
    }
    if (!popped) {
      this.popT = -1;
      this.predictLanding();
      this.airPredT = this.predicted ? this.predicted.tti : 0.6;
      this.emit('leaveGround');
    }
  }

  pushHeld = false;
  lastSteer = 0;

  private airStep(dt: number, inp: SkateInput) {
    this.airTime += dt;
    if (inp.airTrick && !this.flip && this.airTime > 0.04) {
      const left = this.predicted ? this.predicted.tti : 0;
      if (left > 0.2) this.startFlip(inp.airTrick, left, true);
    }
    if (this.flip && !this.flip.done) {
      this.flip.t += dt;
      if (this.flip.t >= this.flip.delay + this.flip.dur) { this.flip.t = this.flip.delay + this.flip.dur; this.flip.done = true; this.emit('flipDone', { kind: this.flip.kind }); }
    }
    this.vel.y -= G * dt;
    this.vel.multiplyScalar(1 - 0.0008 * this.vel.length() * dt);

    // board orientation
    if (this.vert) {
      const v = this.vert;
      v.t += dt;
      const ph = clamp(v.t / v.T, 0, 1);
      const e = (x: number) => x * x * (3 - 2 * x);
      if (ph < 0.5) this.boardQ.slerpQuaternions(v.q0, v.qPeak, e(ph * 2));
      else this.boardQ.slerpQuaternions(v.qPeak, v.q1, e((ph - 0.5) * 2));
      this.airYaw = Math.PI * v.sign * ph;
    } else {
      // spin control around world up
      const target = inp.steer * 7.2;
      this.spinVel += (target - this.spinVel) * (1 - Math.exp(-8 * dt));
      _q.setFromAxisAngle(Y, -this.spinVel * dt);
      this.boardQ.premultiply(_q);
      this.airYaw += -this.spinVel * dt;
    }
    // landing prediction + assist: rotate the board towards the predicted landing normal
    if (Math.floor(this.airTime * 120) % 3 === 0 || !this.predicted) this.predictLanding();
    const bUp = _v.set(0, 1, 0).applyQuaternion(this.boardQ);
    if (this.predicted && this.vert) {
      // keyframed vert orientation, blended onto the re-entry surface over the last 0.4 s
      const k = clamp(1 - this.predicted.tti / 0.4, 0, 1);
      const err = bUp.angleTo(this.predicted.normal);
      if (k > 0 && err > 1e-3 && err < 2.0) {
        _q.setFromUnitVectors(bUp, _v2.copy(bUp).lerp(this.predicted.normal, k).normalize());
        this.boardQ.premultiply(_q);
      }
    } else if (this.predicted) {
      const target = this.predicted.normal;
      const err = bUp.angleTo(target);
      if (err > 1e-3 && err < 2.0) {
        const rate = err / Math.max(0.12, this.predicted.tti) * 0.9;
        const a = Math.min(err, rate * dt);
        _q.setFromUnitVectors(bUp, _v2.copy(bUp).lerp(target, a / err).normalize());
        this.boardQ.premultiply(_q);
      }
    } else if (!this.vert) {
      // nothing below: slowly level out
      const err = bUp.angleTo(Y);
      if (err > 1e-3) {
        const a = Math.min(err, 1.5 * dt);
        _q.setFromUnitVectors(bUp, _v2.copy(bUp).lerp(Y, a / err).normalize());
        this.boardQ.premultiply(_q);
      }
    }
    this.boardQ.normalize();
    this.fwd.set(0, 0, 1).applyQuaternion(this.boardQ);
    this.up.set(0, 1, 0).applyQuaternion(this.boardQ);

    // grind catch
    if ((inp.grind || this.grindBuffer > 0) && this.grindCooldown <= 0 && this.airTime > 0.05) {
      if (this.tryGrind(false)) return;
    }

    // move with a swept ray so we never tunnel through ramps
    const disp = _v2.copy(this.vel).multiplyScalar(dt);
    const len = disp.length();
    if (len > 1e-6) {
      const dir = _v3.copy(disp).divideScalar(len);
      const hit = this.world.raycast(_v.copy(this.pos).addScaledVector(dir, -0.02), dir, len + 0.04);
      if (hit && hit.normal.dot(this.vel) < 0) {
        if (hit.surface === SURF_BARRIER) {
          // invisible fence: bounce off, keep flying
          const vn = this.vel.dot(hit.normal);
          this.vel.addScaledVector(hit.normal, -1.35 * vn).multiplyScalar(0.85);
          this.pos.copy(hit.point).addScaledVector(hit.normal, 0.03);
          this.emit('bonk');
          this.collideBody(dt);
          return;
        }
        this.pos.copy(hit.point);
        this.land(hit);
        return;
      }
      this.pos.add(disp);
    }
    // safety net: below the world
    if (this.pos.y < -12) { this.toBail('roll', 'fell'); }
    this.collideBody(dt);
  }

  private predictLanding() {
    const p = _v.copy(this.pos), v = new Vector3().copy(this.vel);
    const step = 0.025;
    for (let t = 0; t < 1.6; t += step) {
      const np = new Vector3().copy(p).addScaledVector(v, step);
      np.y -= 0.5 * G * step * step;
      const seg = new Vector3().subVectors(np, p);
      const l = seg.length();
      const h = l > 1e-6 ? this.world.raycast(p, seg.divideScalar(l), l + 0.02) : null;
      if (h && h.surface !== SURF_BARRIER) { this.predicted = { normal: h.normal, tti: t + (h.distance / Math.max(l, 1e-6)) * step, point: h.point }; return; }
      p.copy(np); v.y -= G * step;
    }
    this.predicted = null;
  }

  private land(hit: Hit) {
    const n = hit.normal;
    const impact = -this.vel.dot(n);
    const bUp = this.up;
    const upErr = bUp.angleTo(n);
    // travel on the new surface
    const vt = _v.copy(this.vel).addScaledVector(n, -this.vel.dot(n));
    const s = vt.length();
    const fT = _v2.copy(this.fwd).addScaledVector(n, -this.fwd.dot(n));
    if (fT.lengthSq() < 1e-6) fT.copy(vt);
    fT.normalize();
    let yawErr = 0;
    if (s > 0.8) {
      const d = vt.clone().divideScalar(s);
      yawErr = Math.min(fT.angleTo(d), fT.clone().negate().angleTo(d));
    }
    const f = this.flip;
    const flipProg = this.flipProgress();
    const deg = 180 / Math.PI;
    let quality: 'clean' | 'wobble' | 'bail' = 'clean';
    if (upErr * deg > 55 || yawErr * deg > 52 || flipProg < 0.72 || impact > 11.5) quality = 'bail';
    else if (upErr * deg > 22 || yawErr * deg > 22 || flipProg < 0.96 || impact > 7.8) quality = 'wobble';

    const airTime = this.airTime;
    const spin = this.airYaw;
    const wasVert = !!this.vert;
    this.vert = null;
    this.predicted = null;
    if (quality === 'bail') {
      this.toBail(upErr * deg > 55 ? (this.vel.dot(this.fwd) > 0 ? 'face' : 'back') : (flipProg < 0.72 ? 'knock' : 'roll'), 'landing');
      return;
    }
    // align heading with travel (fakie allowed)
    this.up.copy(n);
    if (s > 0.8) {
      const d = vt.clone().divideScalar(s);
      this.fakie = fT.dot(d) < 0;
      this.fwd.copy(d).multiplyScalar(this.fakie ? -1 : 1);
    } else this.fwd.copy(fT);
    this.vel.copy(vt).multiplyScalar(quality === 'wobble' ? 0.86 : 0.97);
    this.mode = 'ride';
    this.landImpulse = clamp(impact / 6, 0.25, 1.2);
    this.landT = this.time;
    this.landImpact = impact;
    if (quality === 'wobble') this.startWobble(1.2);
    this.flip = null;
    this.emit('land', { quality, impact, airTime, spin, popped: this.popped, flip: f, fakie: this.fakie, vert: wasVert, surface: hit.surface,
      upErr: Math.round(upErr * deg), yawErr: Math.round(yawErr * deg) });
    this.surface = hit.surface;
  }

  // ---------------------------------------------------------------------------------------- grind
  private tryGrind(fromGround: boolean) {
    let best: { line: GrindLine; seg: number; u: number; d: number } | null = null;
    const p = this.pos;
    // highest point this jump will reach (a pop that falls a little short is still pulled onto the rail at its peak)
    const peakY = p.y + Math.max(0, this.vel.y) ** 2 / (2 * G);
    for (const line of this.world.grindLines) {
      if (fromGround && line.kind === 'rail') continue;
      const n = line.pts.length;
      const segs = line.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = line.pts[i], c = line.pts[(i + 1) % n];
        const ab = _v.subVectors(c, a);
        const l2 = ab.lengthSq();
        const u = clamp(_v2.subVectors(p, a).dot(ab) / l2, 0, 1);
        const cp = _v3.copy(a).addScaledVector(ab, u);
        const dy = p.y - cp.y;
        const lat = Math.hypot(p.x - cp.x, p.z - cp.z);
        let okY: boolean;
        if (fromGround) okY = dy > -0.3 && dy < 0.12;
        else {
          okY = dy < 0.7 && this.vel.y < 2.5 && (
            dy > -0.06 || // at or above the line
            (peakY < cp.y - 0.04 && this.vel.y < 0.8 && dy > -0.3) || // can't quite reach it: snap at the peak
            (this.vel.y < -0.2 && dy > -0.2)); // falling past it
        }
        if (!okY || lat > (fromGround ? 0.5 : 0.62)) continue;
        const d = lat + Math.abs(dy) * 0.5;
        if (!best || d < best.d) best = { line, seg: i, u, d };
      }
    }
    if (!best) return false;
    const line = best.line, n = line.pts.length;
    const a = line.pts[best.seg], c = line.pts[(best.seg + 1) % n];
    const tan = _v.subVectors(c, a).normalize();
    const vAlong = this.vel.dot(tan);
    const vH = Math.hypot(this.vel.x, this.vel.z);
    if (Math.abs(vAlong) < 0.6 && vH < 1.2) return false;
    const dir = vAlong >= 0 ? 1 : -1;
    const fwdH = _v2.copy(this.fwd).setY(0).normalize();
    const align = Math.abs(fwdH.dot(tan));
    const style: '5050' | 'boardslide' = align > 0.62 ? '5050' : 'boardslide';
    const side = (() => {
      const toBoard = _v3.copy(this.pos).sub(a).setY(0);
      const perp = new Vector3().crossVectors(Y, tan);
      return toBoard.dot(perp) >= 0 ? 1 : -1;
    })();
    const name = style === '5050' ? (line.kind === 'coping' ? 'Coping 50-50' : '50-50 Grind') : (line.kind === 'rail' ? 'Boardslide' : 'Ledge Slide');
    this.grind = {
      line, seg: best.seg, u: best.u, dir, speed: Math.max(Math.abs(vAlong), 0.75 * vH, 1.6), style, side,
      balance: 0, bvel: (Math.random() - 0.5) * 0.3, time: 0, name,
    };
    this.endManual();
    this.mode = 'grind';
    this.vert = null;
    this.flip = null;
    // keep the stance: board fwd on/across the line
    this.applyGrindPose(0);
    this.emit('grindStart', { style, kind: line.kind, metal: line.metal, name });
    return true;
  }

  private grindFrame(out: { a: Vector3; c: Vector3; tan: Vector3 }) {
    const g = this.grind!;
    const n = g.line.pts.length;
    out.a = g.line.pts[g.seg]; out.c = g.line.pts[(g.seg + 1) % n];
    out.tan.subVectors(out.c, out.a).normalize();
  }

  private gf = { a: new Vector3(), c: new Vector3(), tan: new Vector3() };

  private applyGrindPose(dt: number) {
    const g = this.grind!;
    const f = this.gf; this.grindFrame(f);
    const tanDir = _v.copy(f.tan).multiplyScalar(g.dir);
    const lineUp = _v2.copy(Y).addScaledVector(f.tan, -f.tan.y).normalize();
    const point = _v3.copy(f.a).lerp(f.c, g.u);
    // lean from balance
    _q.setFromAxisAngle(tanDir, g.balance * 0.35);
    const up = lineUp.clone().applyQuaternion(_q);
    if (g.style === '5050') {
      // keep nose/tail orientation closest to the previous heading
      const sgn = this.fwd.dot(tanDir) >= 0 ? 1 : -1;
      this.fwd.copy(tanDir).multiplyScalar(sgn);
      this.pos.copy(point).addScaledVector(up, g.line.kind === 'rail' ? -0.012 : -0.035);
    } else {
      const across = new Vector3().crossVectors(up, tanDir).normalize();
      const sgn = this.fwd.dot(across) >= 0 ? 1 : -1;
      this.fwd.copy(across).multiplyScalar(sgn);
      this.pos.copy(point).addScaledVector(up, g.line.kind === 'rail' ? -0.1 : -0.108);
    }
    this.up.copy(up);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.vel.copy(tanDir).multiplyScalar(g.speed);
    void dt;
  }

  private grindStep(dt: number, inp: SkateInput) {
    const g = this.grind!;
    g.time += dt;
    const f = this.gf; this.grindFrame(f);
    const tanDir = _v.copy(f.tan).multiplyScalar(g.dir);
    const fric = g.line.metal ? (g.style === '5050' ? 0.9 : 1.3) : 1.8;
    g.speed += (-G * tanDir.y - fric) * dt;
    // balance
    g.bvel += (g.balance * 1.6 + Math.sin(this.time * 3.1 + 1.3) * 0.35 + inp.steer * 2.4) * dt;
    g.bvel *= Math.exp(-1.2 * dt);
    g.balance = clamp(g.balance + g.bvel * dt, -1.2, 1.2);
    if (inp.ollie) {
      // pop off the rail (back into the ramp for copings)
      const inward = g.line.inward ? g.line.inward[Math.min(g.seg, g.line.inward.length - 1)] : null;
      this.vel.copy(tanDir).multiplyScalar(g.speed).addScaledVector(Y, 2.7);
      if (inward && g.line.kind === 'coping') this.vel.addScaledVector(inward, 1.4);
      this.endGrind(true, inp);
      return;
    }
    if (Math.abs(g.balance) > 1.15 || g.speed < 0.3) {
      // fall off to the side we lean to
      const side = new Vector3().crossVectors(Y, tanDir).normalize().multiplyScalar(Math.sign(g.balance || 1));
      this.vel.copy(tanDir).multiplyScalar(Math.max(g.speed, 0.4)).addScaledVector(side, 1.1).addScaledVector(Y, 0.6);
      const off = Math.abs(g.balance) > 1.15;
      this.endGrind(false, inp);
      if (off) this.startWobble(0.8);
      return;
    }
    // advance along the polyline
    const segLen = f.a.distanceTo(f.c);
    g.u += (g.speed * dt * g.dir) / segLen;
    const n = g.line.pts.length;
    const segs = g.line.closed ? n : n - 1;
    while (g.u > 1 || g.u < 0) {
      if (g.u > 1) {
        if (g.seg + 1 >= segs && !g.line.closed) { this.exitEnd(tanDir, g.speed, inp); return; }
        const over = (g.u - 1) * segLen;
        g.seg = (g.seg + 1) % segs; this.grindFrame(f);
        g.u = over / f.a.distanceTo(f.c);
      } else {
        if (g.seg === 0 && !g.line.closed) { this.exitEnd(tanDir, g.speed, inp); return; }
        const over = -g.u * segLen;
        g.seg = (g.seg - 1 + segs) % segs; this.grindFrame(f);
        g.u = 1 - over / f.a.distanceTo(f.c);
      }
    }
    this.applyGrindPose(dt);
  }

  private exitEnd(tanDir: Vector3, speed: number, inp: SkateInput) {
    this.vel.copy(tanDir).multiplyScalar(speed).addScaledVector(Y, 0.9);
    this.endGrind(false, inp);
  }

  private endGrind(popped: boolean, inp: SkateInput) {
    const g = this.grind!;
    this.emit('grindEnd', { time: g.time, style: g.style, name: g.name, kind: g.line.kind });
    this.grind = null;
    this.grindCooldown = 0.3;
    this.mode = 'air';
    this.popped = popped;
    this.airTime = 0; this.airYaw = 0; this.spinVel = 0;
    // board back to an upright orientation; slides turn out to ride away forward (or fakie)
    const fwdH = _v.copy(this.fwd).setY(0);
    if (g.style === 'boardslide') {
      const t = new Vector3().copy(this.vel).setY(0);
      if (t.lengthSq() > 1e-4) { t.normalize(); fwdH.copy(t).multiplyScalar(fwdH.dot(t) >= 0 ? 1 : -1); if (fwdH.lengthSq() < 1e-4) fwdH.copy(t); }
    }
    if (fwdH.lengthSq() < 1e-4) fwdH.set(0, 0, 1);
    this.boardQ.copy(this.basisQuat(fwdH.normalize(), Y));
    this.fwd.copy(fwdH); this.up.copy(Y);
    this.pos.addScaledVector(Y, 0.04);
    if (popped) {
      this.takeoff();
      if (inp.flip) this.startFlip(inp.flip, this.airPredT, false);
      this.emit('pop', { charge: 0.5, flip: this.flip?.name, fromGrind: true, airT: +this.airPredT.toFixed(3) });
    } else {
      this.popT = -1;
      this.predictLanding();
      this.airPredT = this.predicted ? this.predicted.tti : 0.5;
    }
  }

  // ---------------------------------------------------------------------------------------- collisions
  private collideBody(dt: number) {
    // look a little ahead first: the bail starts before the upper body reaches the wall, so nothing leans into it
    const look = clamp(this.vel.length() * 0.012, 0, 0.09);
    if (this.mode !== 'grind' && this.vel.lengthSq() > 16) {
      let hitN: Vector3 | null = null, high = false;
      for (const [h, r] of BODY) {
        const c = _v.copy(this.pos).addScaledVector(this.up, h).addScaledVector(this.vel, look / Math.max(1, this.vel.length()));
        const cp = this.world.closestPoint(c, r);
        if (!cp) continue;
        const sep = _v2.subVectors(c, cp.point);
        const d = sep.length();
        if (d < 1e-5) continue;
        sep.divideScalar(d);
        if (sep.dot(this.up) > 0.55) continue; // ground under us
        if (this.surfaceAt(cp.faceIndex) === SURF_BARRIER) continue;
        if (-this.vel.dot(sep) > 4.2) { hitN ??= sep.clone(); if (h > 0.9) high = true; }
      }
      // chest-high obstacle: hit it and snap back; a low wall trips the rider over it
      if (hitN) { if (high) this.toBail('wall', 'wall', hitN.setY(0).normalize()); else this.toBail('face', 'trip'); return; }
    }
    for (const [h, r] of BODY) {
      const c = _v.copy(this.pos).addScaledVector(this.up, h);
      const cp = this.world.closestPoint(c, r);
      if (!cp) continue;
      const sep = _v2.subVectors(c, cp.point);
      const d = sep.length();
      if (d < 1e-5) continue;
      sep.divideScalar(d);
      if (sep.dot(this.up) > 0.55) continue; // ground under us
      const barrier = this.surfaceAt(cp.faceIndex) === SURF_BARRIER;
      this.pos.addScaledVector(sep, r - d);
      const vn = this.vel.dot(sep);
      if (vn < 0) {
        if (-vn > 4.2 && this.mode !== 'grind' && !barrier) {
          if (h > 0.9) this.toBail('wall', 'wall', sep.clone().setY(0).normalize()); else this.toBail('face', 'trip');
          return;
        }
        this.vel.addScaledVector(sep, -vn * (barrier ? 1.4 : 1.25));
        this.vel.multiplyScalar(barrier ? 0.85 : 0.75);
        if (-vn > 1.2) { this.bonk = 0.3; this.startWobble(Math.max(this.wobble, 0.45)); this.emit('bonk', { barrier }); }
      }
    }
    void dt;
  }

  // ---------------------------------------------------------------------------------------- bail
  toBail(kind: BailKind, reason: string, wallN?: Vector3) {
    if (this.mode === 'bail' || this.mode === 'recover') return;
    if (wallN && wallN.lengthSq() < 0.5) wallN = undefined;
    const r = rng(Math.floor(this.time * 997) + 11);
    const bQ = this.mode === 'air' ? this.boardQ.clone() : this.basisQuat(this.fwd, this.up);
    const hv = _v.copy(this.vel).setY(0);
    const hs = hv.length();
    // the rider faces the toe side (board -X); toe and heel falls keep that facing, rolls go with the travel
    const toe = new Vector3(-1, 0, 0).applyQuaternion(bQ).setY(0);
    if (toe.lengthSq() < 1e-4) toe.set(0, 0, 1);
    toe.normalize();
    let heading = Math.atan2(toe.x, toe.z);
    if (kind === 'roll' && hs > 0.5) heading = Math.atan2(hv.x, hv.z);
    if (kind === 'wall' && wallN) heading = Math.atan2(-wallN.x, -wallN.z);
    const bodyVel = wallN
      ? this.vel.clone().projectOnPlane(wallN).multiplyScalar(0.25).addScaledVector(wallN, 1.3).setY(Math.max(0, this.vel.y) * 0.3)
      : this.vel.clone().multiplyScalar(0.7);
    // the board separates: it carries on into the wall and kicks back, or shoots out from under the feet
    const board = new BoardBody(this.world, (v) => this.emit('boardClack', { v: +v.toFixed(2) }));
    let bv: Vector3, bw: Vector3;
    const heel = new Vector3(1, 0, 0).applyQuaternion(bQ).setY(0).normalize();
    if (wallN) {
      bv = this.vel.clone().multiplyScalar(0.85).add(new Vector3(0, 0.5, 0));
      bw = new Vector3((r() - 0.5) * 6, (r() - 0.5) * 9, (r() - 0.5) * 10);
    } else if (reason === 'curb' || reason === 'trip') {
      // the wheels stop dead against the obstacle and the board bounces back out from under the feet
      bv = this.vel.clone().setY(0).multiplyScalar(-0.38).addScaledVector(heel, (r() - 0.5) * 1.2).add(new Vector3(0, 1.0, 0));
      bw = new Vector3(-6 - r() * 4, (r() - 0.5) * 4, (r() - 0.5) * 6).applyQuaternion(bQ);
    } else {
      const away = kind === 'face' ? 1 : -1; // falling over the toes kicks the board out behind the heels
      bv = this.vel.clone().multiplyScalar(0.62).addScaledVector(heel, away * (0.7 + r() * 0.7)).add(new Vector3(0, 0.9 + r() * 0.8, 0));
      bw = new Vector3((r() - 0.5) * 3, (r() - 0.5) * 7, (r() > 0.5 ? 1 : -1) * (5 + r() * 9)).applyQuaternion(bQ);
    }
    board.init(this.pos, bQ, bv, bw);
    this.bail = { kind, reason, t: 0, body: this.pos.clone(), bodyVel, heading, board };
    this.mode = 'bail';
    this.flip = null; this.grind = null; this.vert = null; this.dropin = null; this.endManual(); this.kickturn.t = -1; this.pushT = -1;
    this.emit('bail', { kind, reason });
  }

  private bailStep(dt: number) {
    const b = this.bail!;
    b.t += dt;
    // body slides / falls, keeping its momentum for a moment
    b.bodyVel.y -= G * dt;
    const disp = _v.copy(b.bodyVel).multiplyScalar(dt);
    const h = this.world.raycast(_v2.copy(b.body).add(_v3.set(0, 0.6, 0)), _v4.set(0, -1, 0), 0.6 + Math.max(0.05, -disp.y) + 0.05);
    if (h && b.body.y + disp.y <= h.point.y + 0.001) {
      b.body.y = h.point.y;
      if (b.bodyVel.y < 0) b.bodyVel.y = 0;
      // slide friction along the ground (gravity on slopes still pulls)
      const gT = _v3.set(0, -G, 0).addScaledVector(h.normal, G * h.normal.y);
      b.bodyVel.addScaledVector(gT, dt * 0.6);
      const s = b.bodyVel.length();
      const fr = b.t < 0.9 ? 3.0 : 7.5;
      if (s > 1e-4) b.bodyVel.multiplyScalar(Math.max(0, s - fr * dt) / s);
      b.bodyVel.addScaledVector(h.normal, -b.bodyVel.dot(h.normal));
      b.body.addScaledVector(b.bodyVel, dt);
    } else b.body.add(disp);
    // keep the fallen body out of walls (hips and shoulders)
    for (const [hh, rr] of [[0.35, 0.42], [0.95, 0.36]]) {
      const c = _v.copy(b.body).add(_v3.set(0, hh, 0));
      const cp = this.world.closestPoint(c, rr);
      if (!cp) continue;
      const sep = _v2.subVectors(c, cp.point);
      const d = sep.length();
      if (d > 1e-5 && sep.y / d < 0.6) {
        sep.divideScalar(d);
        b.body.addScaledVector(sep, rr - d);
        const vn = b.bodyVel.dot(sep);
        if (vn < 0) b.bodyVel.addScaledVector(sep, -vn * 1.2);
      }
    }
    b.board.step(dt);
    this.vel.copy(b.bodyVel);
    this.pos.copy(b.body);
  }

  /** Called by the animation layer when the rider stands on the board again (it lies where it stopped). */
  finishRecover(pos: Vector3, fwd: Vector3) {
    this.mode = 'ride';
    this.bail = null;
    this.vel.set(0, 0, 0);
    const h = this.world.raycast(_v.copy(pos).add(_v2.set(0, 0.6, 0)), _v3.set(0, -1, 0), 1.6);
    this.pos.copy(h ? h.point : pos);
    this.up.copy(h ? h.normal : Y);
    this.fwd.copy(fwd).addScaledVector(this.up, -fwd.dot(this.up));
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(1, 0, 0);
    this.fwd.normalize();
    this.wobble = 0; this.fakie = false; this.crouchTime = 0; this.pushT = -1; this.kickturn.t = -1;
    this.flip = null; this.popT = -1; this.landT = -10; this.dropin = null; this.dropinEndT = -10;
  }

  // ---------------------------------------------------------------------------------------- helpers
  basisQuat(fwd: Vector3, up: Vector3) {
    const z = _v.copy(fwd).normalize();
    const x = _v2.crossVectors(up, z).normalize();
    const y = _v3.crossVectors(z, x).normalize();
    _m.makeBasis(x, y, z);
    return new Quaternion().setFromRotationMatrix(_m);
  }
}
