import { MathUtils, Quaternion, Vector3 } from 'three';

export const clamp = MathUtils.clamp;
export const lerp = MathUtils.lerp;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const dampAngle = (a: number, b: number, lambda: number, dt: number) =>
  a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

/** Critically damped spring for scalars (no overshoot, no pops between states). */
export class Spring {
  v = 0;
  constructor(public x = 0, public omega = 12) {}
  update(target: number, dt: number, omega = this.omega) {
    const f = 1 + 2 * dt * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const detInv = 1 / (f + hhoo);
    const detX = f * this.x + dt * this.v + hhoo * target;
    const detV = this.v + hoo * (target - this.x);
    this.x = detX * detInv;
    this.v = detV * detInv;
    return this.x;
  }
  set(x: number) { this.x = x; this.v = 0; }
  kick(v: number) { this.v += v; }
}

export class SpringV3 {
  v = new Vector3();
  x = new Vector3();
  constructor(public omega = 12) {}
  update(target: Vector3, dt: number, omega = this.omega) {
    const f = 1 + 2 * dt * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const detInv = 1 / (f + hhoo);
    for (const k of ['x', 'y', 'z'] as const) {
      const detX = f * this.x[k] + dt * this.v[k] + hhoo * target[k];
      const detV = this.v[k] + hoo * (target[k] - this.x[k]);
      this.x[k] = detX * detInv;
      this.v[k] = detV * detInv;
    }
    return this.x;
  }
  set(p: Vector3) { this.x.copy(p); this.v.set(0, 0, 0); }
}

const _q = new Quaternion();
/** Rotate v so that it stays tangent when the surface normal changes from n0 to n1. */
export function carryVector(v: Vector3, n0: Vector3, n1: Vector3) {
  _q.setFromUnitVectors(n0, n1);
  return v.applyQuaternion(_q);
}

export const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const params = new URLSearchParams(location.search);
export const DEBUG = params.has('debug') || params.has('test');
export const TEST = params.has('test');
