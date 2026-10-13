import { Quaternion, Vector3, Matrix4 } from 'three';
import type { CollisionWorld, Hit } from '../world/collision';
import type { GrindLine } from '../world/park';
import { clamp, carryVector, Spring } from '../core/util';

export type FlipDir = 'left' | 'right' | 'down' | 'up';
export type FlipKind = 'kickflip' | 'heelflip' | 'shuvit' | 'treflip';
export type Mode = 'ride' | 'air' | 'grind' | 'bail' | 'recover';
export type BailKind = 'face' | 'back' | 'knock' | 'roll';

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

const G = 9.81;
const Y = new Vector3(0, 1, 0);
const FLIPS: Record<FlipDir, { kind: FlipKind; dur: number; name: string; pts: number }> = {
  left: { kind: 'kickflip', dur: 0.46, name: 'Kickflip', pts: 250 },
  right: { kind: 'heelflip', dur: 0.46, name: 'Heelflip', pts: 250 },
  down: { kind: 'shuvit', dur: 0.40, name: 'Pop Shove-It', pts: 200 },
  up: { kind: 'treflip', dur: 0.58, name: 'Tre Flip', pts: 500 },
};

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _q = new Quaternion(), _m = new Matrix4();

export interface FlipState { kind: FlipKind; name: string; pts: number; t: number; dur: number; done: boolean }

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
  bonk = 0;
  landImpulse = 0; // for absorb animation
  brakeAmt = 0;

  // air
  airTime = 0;
  spinVel = 0;
  airYaw = 0;
  flip: FlipState | null = null;
  popped = false;
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
  bail: null | { kind: BailKind; t: number; body: Vector3; bodyVel: Vector3; heading: number; boardPos: Vector3; boardVel: Vector3; boardQ: Quaternion; boardW: Vector3 } = null;

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
    this.flip = null; this.grind = null; this.bail = null; this.vert = null;
    this.manual.active = false; this.kickturn.t = -1; this.wobble = 0; this.pushT = -1;
    const h = this.world.raycast(_v.copy(p).addScaledVector(Y, 1.5), _v2.set(0, -1, 0), 4);
    if (h) { this.pos.copy(h.point); this.up.copy(h.normal); }
  }

  /** travel direction sign relative to the nose */
  get travelSign() { return this.vel.dot(this.fwd) >= 0 ? 1 : -1; }

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

  // ---------------------------------------------------------------------------------------- ground
  private probe(from: Vector3, up: Vector3, snap: number): Hit | null {
    const o = _v3.copy(from).addScaledVector(up, 0.45);
    return this.world.raycast(o, _v2.copy(up).negate(), 0.45 + snap);
  }

  private rideStep(dt: number, inp: SkateInput) {
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
      if (this.pushT > 0.22 && this.pushT < 0.5 && canPush) {
        const sNow = this.vel.length();
        const gain = 2.4 * Math.pow(clamp(1 - sNow / 8.6, 0, 1), 1.15) + 0.15;
        this.vel.addScaledVector(travel, (gain / 0.28) * dt);
      }
      if (this.pushT >= PUSH_DUR || !canPush && this.pushT < 0.22) { this.pushT = -1; this.pushCooldown = 0.05; }
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

    // ---- kickturn at the top of a transition when speed runs out
    if (this.kickturn.t >= 0) {
      this.kickturn.t += dt;
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      if (this.kickturn.t >= 0.34) {
        _q.setFromAxisAngle(this.up, Math.PI * this.kickturn.dir);
        this.fwd.applyQuaternion(_q);
        this.kickturn.t = -1;
        this.emit('kickturn');
      }
    } else if (this.up.y < 0.8 && this.up.y > 0.05 && s < 0.55 && !this.fakie) {
      // riding forward up a transition and running out of speed: pivot on the tail to face downhill
      const uphill = _v.set(0, 1, 0).addScaledVector(this.up, -this.up.y).normalize();
      if (this.fwd.dot(uphill) > 0.6 && this.vel.dot(uphill) > -0.15 && !this.manual.active) {
        this.kickturn.t = 0;
        this.kickturn.dir = inp.steer < 0 ? 1 : -1;
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
      if (Math.abs(m.balance) > 1) { this.endManual(); this.wobble = 0.5; this.emit('manualFail'); }
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
    this.bonk = 0.4; this.wobble = 0.6;
    this.pos.addScaledVector(this.vel, 0.03);
    this.emit('bonk');
  }

  private pop(inp: SkateInput) {
    const charge = clamp(this.crouchTime / 0.32, 0, 1);
    const popV = 3.15 + 1.45 * charge;
    const dir = _v.copy(this.up).multiplyScalar(0.7).addScaledVector(Y, 0.3).normalize();
    this.endManual();
    this.vel.addScaledVector(dir, popV);
    this.toAir(true);
    if (inp.flip) this.startFlip(inp.flip);
    this.emit('pop', { charge, flip: this.flip?.name });
    this.crouchTime = 0;
  }

  startFlip(d: FlipDir) {
    const f = FLIPS[d];
    this.flip = { kind: f.kind, name: f.name, pts: f.pts, t: 0, dur: f.dur, done: false };
    this.emit('flip', { kind: f.kind });
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
    if (!popped) this.emit('leaveGround');
  }

  pushHeld = false;
  lastSteer = 0;

  private airStep(dt: number, inp: SkateInput) {
    this.airTime += dt;
    if (inp.airTrick && !this.flip && this.airTime > 0.04) this.startFlip(inp.airTrick);
    if (this.flip && !this.flip.done) {
      this.flip.t += dt;
      if (this.flip.t >= this.flip.dur) { this.flip.t = this.flip.dur; this.flip.done = true; }
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
      if (h) { this.predicted = { normal: h.normal, tti: t, point: h.point }; return; }
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
    const flipProg = f ? f.t / f.dur : 1;
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
    if (quality === 'wobble') this.wobble = 0.9;
    this.flip = null;
    this.emit('land', { quality, impact, airTime, spin, popped: this.popped, flip: f, fakie: this.fakie, vert: wasVert, surface: hit.surface,
      upErr: Math.round(upErr * deg), yawErr: Math.round(yawErr * deg) });
    // landing straight into a manual
    this.surface = hit.surface;
  }

  // ---------------------------------------------------------------------------------------- grind
  private tryGrind(fromGround: boolean) {
    let best: { line: GrindLine; seg: number; u: number; d: number } | null = null;
    const p = this.pos;
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
        const okY = fromGround ? dy > -0.3 && dy < 0.12 : dy > -0.32 && dy < 0.7 && this.vel.y < 2.5;
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
      this.vel.copy(tanDir).multiplyScalar(g.speed).addScaledVector(Y, 3.4);
      if (inward && g.line.kind === 'coping') this.vel.addScaledVector(inward, 1.4);
      this.endGrind(true, inp);
      return;
    }
    if (Math.abs(g.balance) > 1.15 || g.speed < 0.3) {
      // fall off to the side we lean to
      const side = new Vector3().crossVectors(Y, tanDir).normalize().multiplyScalar(Math.sign(g.balance || 1));
      this.vel.copy(tanDir).multiplyScalar(Math.max(g.speed, 0.4)).addScaledVector(side, 1.1).addScaledVector(Y, 0.6);
      this.endGrind(false, inp);
      if (Math.abs(g.balance) > 1.15) this.wobble = 0.8;
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
      if (inp.flip) this.startFlip(inp.flip);
      this.emit('pop', { charge: 0.5, flip: this.flip?.name, fromGrind: true });
    }
  }

  // ---------------------------------------------------------------------------------------- collisions
  private collideBody(dt: number) {
    const hs = [0.42, 0.95, 1.42];
    for (const h of hs) {
      const c = _v.copy(this.pos).addScaledVector(this.up, h);
      const r = 0.24;
      const cp = this.world.closestPoint(c, r);
      if (!cp) continue;
      const sep = _v2.subVectors(c, cp.point);
      const d = sep.length();
      if (d < 1e-5) continue;
      sep.divideScalar(d);
      if (sep.dot(this.up) > 0.55) continue; // ground under us
      this.pos.addScaledVector(sep, r - d);
      const vn = this.vel.dot(sep);
      if (vn < 0) {
        if (-vn > 4.2 && this.mode !== 'grind') { this.toBail(Math.random() < 0.5 ? 'knock' : 'face', 'wall'); return; }
        this.vel.addScaledVector(sep, -vn * 1.25);
        this.vel.multiplyScalar(0.75);
        if (-vn > 1.2) { this.bonk = 0.3; this.wobble = Math.max(this.wobble, 0.4); this.emit('bonk'); }
      }
    }
    void dt;
  }

  // ---------------------------------------------------------------------------------------- bail
  toBail(kind: BailKind, reason: string) {
    if (this.mode === 'bail' || this.mode === 'recover') return;
    const heading = Math.atan2(this.vel.x, this.vel.z);
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    const bQ = this.basisQuat(this.fwd, this.up);
    this.bail = {
      kind, t: 0,
      body: this.pos.clone(),
      bodyVel: this.vel.clone().multiplyScalar(0.55),
      heading: hspeed > 0.5 ? heading : Math.atan2(this.fwd.x, this.fwd.z),
      boardPos: this.pos.clone().addScaledVector(this.up, 0.06),
      boardVel: this.vel.clone().multiplyScalar(0.95).add(new Vector3((Math.random() - 0.5) * 1.5, 1.6, (Math.random() - 0.5) * 1.5)),
      boardQ: bQ,
      boardW: new Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14),
    };
    this.mode = 'bail';
    this.flip = null; this.grind = null; this.vert = null; this.endManual();
    this.emit('bail', { kind, reason });
  }

  private bailStep(dt: number) {
    const b = this.bail!;
    b.t += dt;
    // body slides / falls
    b.bodyVel.y -= G * dt;
    const disp = _v.copy(b.bodyVel).multiplyScalar(dt);
    const h = this.world.raycast(_v2.copy(b.body).add(new Vector3(0, 0.6, 0)), _v3.set(0, -1, 0), 0.6 + Math.max(0.05, -disp.y) + 0.05);
    if (h && b.body.y + disp.y <= h.point.y + 0.001) {
      b.body.y = h.point.y;
      if (b.bodyVel.y < 0) b.bodyVel.y = 0;
      // slide friction along the ground (gravity on slopes still pulls)
      const gT = new Vector3(0, -G, 0).addScaledVector(h.normal, G * h.normal.y);
      b.bodyVel.addScaledVector(gT, dt * 0.6);
      const s = b.bodyVel.length();
      if (s > 1e-4) b.bodyVel.multiplyScalar(Math.max(0, s - 5.5 * dt) / s);
      b.bodyVel.addScaledVector(h.normal, -b.bodyVel.dot(h.normal));
      b.body.addScaledVector(b.bodyVel, dt);
    } else b.body.add(disp);
    // keep the body out of walls
    const cp = this.world.closestPoint(_v.copy(b.body).add(new Vector3(0, 0.5, 0)), 0.35);
    if (cp) {
      const sep = _v2.subVectors(_v.copy(b.body).add(new Vector3(0, 0.5, 0)), cp.point);
      const d = sep.length();
      if (d > 1e-5 && sep.y / d < 0.6) { sep.divideScalar(d); b.body.addScaledVector(sep, 0.35 - d); const vn = b.bodyVel.dot(sep); if (vn < 0) b.bodyVel.addScaledVector(sep, -vn); }
    }
    // board tumbles away as a little rigid body
    b.boardVel.y -= G * dt;
    const bd = _v.copy(b.boardVel).multiplyScalar(dt);
    const bl = bd.length();
    if (bl > 1e-6) {
      const hit = this.world.raycast(_v2.copy(b.boardPos), _v3.copy(bd).divideScalar(bl), bl + 0.06);
      if (hit) {
        b.boardPos.copy(hit.point).addScaledVector(hit.normal, 0.06);
        const vn = b.boardVel.dot(hit.normal);
        if (vn < 0) b.boardVel.addScaledVector(hit.normal, -vn * 1.3);
        b.boardVel.multiplyScalar(0.72);
        b.boardW.multiplyScalar(0.6);
        if (Math.abs(vn) > 1.5) this.emit('boardClack', { v: Math.abs(vn) });
        // settle flat
        const bu = new Vector3(0, 1, 0).applyQuaternion(b.boardQ);
        const target = bu.dot(hit.normal) >= 0 ? hit.normal : hit.normal.clone().negate();
        _q.setFromUnitVectors(bu, bu.clone().lerp(target, 0.25).normalize());
        b.boardQ.premultiply(_q);
      } else b.boardPos.add(bd);
    }
    const w = b.boardW.length();
    if (w > 1e-4) { _q.setFromAxisAngle(_v.copy(b.boardW).divideScalar(w), w * dt); b.boardQ.premultiply(_q).normalize(); }
    b.boardW.multiplyScalar(Math.exp(-0.8 * dt));
    this.vel.copy(b.bodyVel);
    this.pos.copy(b.body);
  }

  /** Called by the animation layer once the get-up clip finished and the board is back under the feet. */
  finishRecover(pos: Vector3, heading: number) {
    this.mode = 'ride';
    this.bail = null;
    this.vel.set(0, 0, 0);
    const h = this.world.raycast(_v.copy(pos).add(new Vector3(0, 0.8, 0)), _v2.set(0, -1, 0), 2);
    this.pos.copy(h ? h.point : pos);
    this.up.copy(h ? h.normal : Y);
    this.fwd.set(Math.sin(heading), 0, Math.cos(heading)).addScaledVector(this.up, -0).normalize();
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.wobble = 0; this.fakie = false;
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
