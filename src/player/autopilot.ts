import { Vector3 } from 'three';
import type { Game } from '../game';
import type { AutoSource } from '../core/input';
import { emptyInput, type FlipDir, type SkateInput, type SkatePhysics } from './physics';
import { lapLines, type Act, type Feature, type Line } from './lines';

interface Node { x: number; z: number; y: number; v: number; act?: Act; f: Feature; y3: boolean; s: number; line: number }
type State = 'follow' | 'wall' | 'manual';

const Y = new Vector3(0, 1, 0);
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3(), _e = new Vector3();
const FLIPS: [FlipDir, number][] = [['left', 0.3], ['right', 0.25], ['down', 0.25], ['up', 0.2]];

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Auto-ride: pure-pursuit steering along the authored lap (lines.ts) with speed-scaled lookahead, push/brake/pump speed
 * control, and actions (ollies, flips, grinds, manuals, transition hits, bowl exit) timed by the distance along the line.
 * Reads the physics state only; everything it does goes through SkateInput.
 */
export class Autopilot implements AutoSource {
  lap = 0;
  nodes: Node[] = [];
  lines: Line[] = [];
  len = 0;
  seg = 0;
  s = 0;
  state: State = 'follow';
  /** last action fired (for tests / debug overlays) */
  lastAct = '';
  private rnd: () => number;
  private fired = new Set<number>();
  /** optional actions left out this lap */
  private skip = new Set<number>();
  private reached = new Set<number>();
  private apexNode = -1; private apexT = 0;
  private steerF = 0;
  private grindHold = 0;
  private wallNode = -1; private wallN: Node | null = null; private wallDir = new Vector3(); private wallT = 0; private escapeSide = 1;
  private manualLeft = 0;
  private slowT = 0;
  private escapeT = 0; private escapeDir = 1; private trapT = 0;
  /** unstick manoeuvres so far (stats) */
  stuck = 0;
  private airTrickDone = false;
  private reacquire = true;
  private copeOut = false;
  private grindPlan: { pop: boolean; flip: FlipDir | null } | null = null;
  private prevMode = '';
  private _attract = false;

  constructor(public ph: SkatePhysics, opts: { attract?: boolean; seed?: number } = {}) {
    this.rnd = mulberry(opts.seed ?? (Date.now() & 0xffff));
    this.attract = !!opts.attract;
  }

  /** calmer start-screen riding: same flowing lap, plain ollies, no flips off rails or in vert airs, longer manuals, a bit slower on the flat */
  get attract() { return this._attract; }
  set attract(on: boolean) { this._attract = on; this.build(); this.reset(); }

  private build() {
    this.lines = lapLines(this._attract);
    const nodes: Node[] = [];
    this.lines.forEach((l, li) => { for (const p of l.pts) nodes.push({ x: p.x, z: p.z, y: 0, v: p.v, act: p.act, f: p.f ?? l.f, y3: !!p.y3, s: 0, line: li }); });
    let s = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], m = nodes[(i + 1) % nodes.length];
      n.s = s; s += Math.hypot(m.x - n.x, m.z - n.z);
      const h = this.ph.world.raycast(_a.set(n.x, 6, n.z), _b.set(0, -1, 0), 12);
      n.y = h ? h.point.y : 0;
    }
    this.nodes = nodes; this.len = s;
    this.rollLap();
  }

  /** per-lap variety: optional actions come and go */
  private rollLap() {
    this.skip.clear();
    this.nodes.forEach((n, i) => { const p = n.act && 'p' in n.act ? n.act.p : undefined; if (p !== undefined && this.rnd() > p) this.skip.add(i); });
  }

  private pending(i: number) { return !!this.nodes[i].act && !this.fired.has(i) && !this.skip.has(i); }

  reset() {
    this.state = 'follow'; this.reacquire = true; this.grindHold = 0; this.manualLeft = 0;
    this.slowT = 0; this.copeOut = false; this.grindPlan = null; this.steerF = 0; this.escapeT = 0;
  }

  /** feature of the line being ridden (for coverage stats) */
  get feature(): Feature { return (this.state === 'wall' ? this.wallN : this.nodes[this.seg])?.f ?? 'flat'; }

  /** signed distance of the rider from the current segment (+ = right of the line) */
  private crossTrack() {
    const n = this.nodes, a = n[this.seg], b = n[(this.seg + 1) % n.length];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l < 1e-6) return 0;
    return (dx * (this.ph.pos.z - a.z) - dz * (this.ph.pos.x - a.x)) / l;
  }
  get lineName() { return this.lines[this.nodes[this.seg]?.line ?? 0]?.name ?? ''; }

  // -------------------------------------------------------------------------------------------- path geometry
  private segLen(i: number) { const n = this.nodes, a = n[i], b = n[(i + 1) % n.length]; return Math.hypot(b.x - a.x, b.z - a.z); }
  private ahead(sFrom: number, sTo: number) { let d = sTo - sFrom; if (d < -this.len / 2) d += this.len; else if (d > this.len / 2) d -= this.len; return d; }

  /** closest point of the lap to the rider: whole lap (with a heading penalty) or a window ahead of the progress */
  private acquire(full: boolean): void {
    const ph = this.ph, n = this.nodes, N = n.length;
    const px = ph.pos.x, pz = ph.pos.z, py = ph.pos.y;
    const tv = this.travel(_c);
    let best = Infinity, bs = this.s, bseg = this.seg;
    const count = full ? N : 12;
    const start = full ? 0 : (this.seg - 1 + N) % N;
    const cands: [number, number, number, number, number][] = [];
    for (let k = 0; k < count; k++) {
      const i = (start + k) % N, a = n[i], b = n[(i + 1) % N];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      if (l2 < 1e-6) continue;
      const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / l2, 0, 1);
      const qx = a.x + dx * t, qz = a.z + dz * t;
      // a line on another level (bowl floor vs deck) is far away even when it is close in plan
      let d = Math.hypot(px - qx, pz - qz) + 2.5 * Math.max(0, Math.abs(a.y + (b.y - a.y) * t - py) - 0.7);
      const l = Math.sqrt(l2), sq = a.s + t * l;
      if (full) {
        // never join a line on a grind run-in or on the rail itself: those only work from their approach
        const g = (j: number) => { const k = n[(j + N) % N].act?.k; return k === 'grind' || k === 'grindFlat'; };
        if (g(i) || g(i + 1) || g(i - 1)) continue;
        if ((tv.x * dx + tv.z * dz) / l < -0.2) d += 4;
        cands.push([d, sq, i, qx, qz]);
        continue;
      }
      const ah = this.ahead(this.s, sq);
      if (ah < -1.5 || ah > 16) continue;
      d += Math.max(0, ah) * 0.06;
      if (d < best) { best = d; bs = sq; bseg = i; }
    }
    if (full) {
      // nearest line points first; take the first one a straight, level ride reaches (not across a wall or a bowl)
      cands.sort((a, b) => a[0] - b[0]);
      const pick = cands.slice(0, 8).find((c) => this.clearTo(c[3], c[4])) ?? cands[0];
      if (pick) { best = pick[0]; bs = pick[1]; bseg = pick[2]; }
    }
    if (!full && best > 7) return this.acquire(true);
    if (!full) {
      if (this.ahead(this.s, bs) < 0) return;
      // never skip an action that has not fired yet: hold the progress just before it
      const steps = (bseg - this.seg + N) % N;
      for (let k = 1; k <= steps && steps < N / 2; k++) {
        const i = (this.seg + k) % N;
        if (this.pending(i) || n[i].y3 && !this.reached.has(i)) { bseg = (i - 1 + N) % N; bs = n[i].s - 0.02; if (bs < 0) bs += this.len; break; }
      }
    }
    if (bseg < this.seg && this.seg - bseg > N / 2) { this.lap++; this.fired.clear(); this.reached.clear(); this.rollLap(); }
    if (full && bseg !== this.seg) { this.fired.clear(); this.reached.clear(); }
    this.seg = bseg; this.s = bs;
  }

  /** a straight ride from the rider to (x, z) meets no wall at knee or chest height and no step or drop in the ground */
  private clearTo(x: number, z: number) {
    const ph = this.ph, p = ph.pos, w = ph.world;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.6) return true;
    const dir = _a.set(dx / d, 0, dz / d), down = _b.set(0, -1, 0);
    for (const h of [0.35, 1.0]) {
      const hit = w.raycast(_c.copy(p).addScaledVector(Y, h), dir, d);
      if (hit && hit.normal.y < 0.6) return false;
    }
    for (let s = 1; s < d; s += 1) {
      const g = w.raycast(_d.copy(p).addScaledVector(dir, s).addScaledVector(Y, 1.5), down, 3.5);
      if (!g || Math.abs(g.point.y - p.y) > 0.3) return false;
    }
    return true;
  }

  /** next transition apex the rider still has to reach (progress and lookahead are held at it), or -1 */
  private apex(dt: number) {
    const ph = this.ph, n = this.nodes, N = n.length;
    for (let k = 1; k < 4; k++) {
      const i = (this.seg + k) % N, nd = n[i];
      if (!nd.y3 || this.reached.has(i)) continue;
      if (i !== this.apexNode) { this.apexNode = i; this.apexT = 0; }
      this.apexT += dt;
      const dx = nd.x - ph.pos.x, dy = nd.y - ph.pos.y, dz = nd.z - ph.pos.z;
      const d2 = Math.hypot(dx, dz), d3 = Math.hypot(dx, dy, dz);
      const leaving = d2 < 2.6 && ph.vel.x * dx + ph.vel.z * dz < 0;
      if (d3 < 1.0 || leaving || this.apexT > 5) { this.reached.add(i); continue; }
      return i;
    }
    return -1;
  }

  /** point on the lap at arc length s (x, z, surface y, whether the segment is a transition wall) */
  private pointAt(s: number, out: Vector3) {
    const n = this.nodes, N = n.length;
    s = ((s % this.len) + this.len) % this.len;
    let i = this.seg;
    for (let k = 0; k < N; k++) {
      const a = n[i], l = this.segLen(i);
      if (s >= a.s && s <= a.s + l) break;
      i = (i + 1) % N;
    }
    const a = n[i], b = n[(i + 1) % N], l = Math.max(1e-6, this.segLen(i));
    const t = clamp((s - a.s) / l, 0, 1);
    out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    return a.y3 || b.y3;
  }

  private speedAt(s: number) {
    const n = this.nodes, i = this.seg, a = n[i], b = n[(i + 1) % n.length];
    const t = clamp((s - a.s) / Math.max(1e-6, this.segLen(i)), 0, 1);
    return (a.v + (b.v - a.v) * t) * (this._attract && a.f !== 'bowl' && a.f !== 'halfpipe' ? 0.92 : 1);
  }

  /** travel direction on the riding plane (nose direction when nearly still) */
  private travel(out: Vector3) {
    const ph = this.ph;
    out.copy(ph.vel).addScaledVector(ph.up, -ph.vel.dot(ph.up));
    if (out.lengthSq() < 0.16) out.copy(ph.fwd).multiplyScalar(ph.fakie ? -1 : 1);
    return out.normalize();
  }

  /** signed turn angle (rad, + = left) from the travel direction to `dir` about the board normal */
  private angleTo(dir: Vector3) {
    const ph = this.ph, tv = this.travel(_a);
    const d = _b.copy(dir).addScaledVector(ph.up, -dir.dot(ph.up));
    if (d.lengthSq() < 1e-8) return 0;
    return Math.atan2(_c.crossVectors(tv, d).dot(ph.up), tv.dot(d));
  }

  /** pure pursuit: steer value that bends the path through the lookahead point */
  private pursue(target: Vector3) {
    const ph = this.ph, sp = ph.speed;
    const d = _d.subVectors(target, ph.pos);
    const alpha = this.angleTo(d);
    const Ld = Math.max(0.6, d.addScaledVector(ph.up, -d.dot(ph.up)).length());
    if (Math.abs(alpha) > 1.75) return alpha > 0 ? -1 : 1;
    const omega = (2 * Math.sin(alpha) / Ld) * Math.max(sp, 1.2);
    // nominal full-lock turn rate of the physics (lateral-acceleration capped); only the loop gain depends on it
    const wmax = Math.min(2.4, 7.6 / Math.max(sp, 1.2));
    return clamp(-omega / wmax, -1, 1);
  }

  private pickFlip(): FlipDir {
    let r = this.rnd();
    for (const [d, w] of FLIPS) { if ((r -= w) <= 0) return d; }
    return 'left';
  }

  // -------------------------------------------------------------------------------------------- per step
  sample(dt: number, _airborne: boolean): SkateInput {
    const ph = this.ph, inp = emptyInput();
    const mode = ph.mode;
    if (mode === 'bail' || mode === 'recover') { this.reacquire = true; this.state = 'follow'; this.prevMode = mode; this.steerF = 0; return inp; }
    if (this.prevMode === 'grind' && mode !== 'grind') { this.grindPlan = null; this.copeOut = false; }
    this.prevMode = mode;
    if (mode !== 'ride' && this.state === 'manual') this.state = 'follow';

    if (mode === 'grind') return this.grindStep(inp);
    if (mode === 'air') return this.airStep(inp);
    if (this.copeOut && this.state !== 'wall') this.copeOut = false;
    this.airTrickDone = false;

    // ---- ride
    if (this.reacquire) { this.acquire(false); this.reacquire = false; }
    if (ph.dropin || ph.kickturn.t >= 0) { this.steerF = 0; return inp; }
    const sp = ph.speed;
    if (this.state === 'wall') return this.wallStep(dt, inp);
    const ax = this.apex(dt);
    this.acquire(false);
    // down in a bowl floor while the line runs on the deck above: climb out first
    const sa = this.nodes[this.seg], sb = this.nodes[(this.seg + 1) % this.nodes.length];
    if (ph.pos.y < -0.15 && Math.min(sa.y, sb.y) > ph.pos.y + 0.1) this.trapT += dt; else this.trapT = 0;
    if (this.trapT > 1.2 && this.startBowlEscape()) { this.trapT = 0; return this.wallStep(dt, inp); }

    // ---- actions ahead
    let crouch = false;
    const N = this.nodes.length;
    for (let k = 0; k < 4; k++) {
      const i = (this.seg + k) % N, nd = this.nodes[i];
      if (!this.pending(i)) continue;
      const dRem = this.ahead(this.s, nd.s);
      if (dRem > 6) break;
      const a = nd.act!;
      if (dRem < -1.2) { this.fired.add(i); continue; }
      if (a.k === 'ollie' || a.k === 'grind') {
        const lead = sp * 0.24 + 0.05;
        if (dRem <= lead) crouch = true;
        if (dRem <= sp * dt * 1.5 + 0.02) {
          this.fired.add(i);
          inp.ollie = true; crouch = false;
          inp.popCharge = a.charge ?? 0.6;
          if (a.k === 'ollie' && a.flip && !this._attract) inp.flip = this.pickFlip();
          if (a.k === 'grind') { inp.grindPressed = true; this.grindHold = 0.7; this.grindPlan = this.planGrind(); }
          this.lastAct = a.k + (inp.flip ? ':' + inp.flip : '');
        }
      } else if (a.k === 'grindFlat' && dRem <= 0.4) {
        this.fired.add(i); inp.grindPressed = true; this.grindHold = 0.4; this.grindPlan = this.planGrind(); this.lastAct = 'grindFlat';
      } else if (a.k === 'manual' && dRem <= 0.1) {
        this.fired.add(i); this.state = 'manual'; this.manualLeft = a.len * (this._attract ? 1.25 : 1); this.lastAct = 'manual';
      } else if ((a.k === 'wall' || a.k === 'copeOut') && dRem <= 0.25) {
        this.fired.add(i); this.startWall(i); this.lastAct = a.k;
        return this.wallStep(dt, inp);
      }
    }
    if (this.grindHold > 0) { this.grindHold -= dt; inp.grind = true; }

    // ---- steering: lookahead scales with speed
    const L = clamp(1.3 + 0.42 * sp, 1.7, 4.6);
    const tgt = _c;
    const sT = ax >= 0 && this.ahead(this.s, this.nodes[ax].s) < L ? this.nodes[ax].s : this.s + L;
    const wall = this.pointAt(sT, tgt);
    const tp = _e.copy(tgt);
    if (!wall) tp.y = ph.pos.y;
    let steer = this.pursue(tp);
    // cross-track term on the flat: settles onto the line before a pop instead of converging over a lookahead length
    if (!wall && ph.up.y > 0.94 && ax < 0) steer = clamp(steer - clamp(0.45 * this.crossTrack(), -0.3, 0.3), -1, 1);

    // ---- speed
    const vt = this.speedAt(this.s);
    const flat = ph.up.y > 0.94;
    if (this.state === 'manual') {
      const m = ph.manual;
      inp.manual = true;
      inp.lean = clamp(1.7 * m.balance + 0.7 * m.bvel, -1, 1);
      this.manualLeft -= sp * dt;
      if (this.manualLeft <= 0 || sp < 1.1 || !flat) this.state = 'follow';
    } else if (flat) {
      inp.push = sp < vt - 0.25 && !crouch;
      inp.brake = sp > vt + 1.1;
    } else if (ph.up.y > 0.2) {
      // pump the downhill side of transitions
      inp.push = ph.vel.y < -0.4;
    }
    // stuck against something: pivot away on the spot, push off, then look for the line again
    if (this.escapeT > 0) {
      this.escapeT -= dt;
      inp.steer = this.steerF = this.escapeDir; inp.push = this.escapeT < 0.6; inp.brake = false; inp.manual = false;
      if (this.escapeT <= 0) this.acquire(true);
      return inp;
    }
    if (sp < 0.35 && ph.kickturn.t < 0 && this.state !== 'manual') {
      this.slowT += dt;
      if (!flat && this.slowT > 1.0) {
        // stalled against a wall face: pop off it
        this.slowT = 0; this.stuck++;
        inp.ollie = true; inp.popCharge = 0.5; inp.steer = 0;
        return inp;
      }
      if (this.slowT > 1.6) {
        this.slowT = 0; this.escapeT = 1.3; this.stuck++;
        this.escapeDir = steer > 0.1 ? 1 : steer < -0.1 ? -1 : this.rnd() < 0.5 ? 1 : -1;
      }
    } else this.slowT = 0;

    inp.crouch = crouch;
    this.steerF += (steer - this.steerF) * (1 - Math.exp(-dt / 0.05));
    inp.steer = Math.abs(this.steerF) < 0.02 ? 0 : this.steerF;
    return inp;
  }

  private planGrind() {
    if (this._attract) return { pop: false, flip: null };
    const pop = this.rnd() < 0.45;
    return { pop, flip: pop && this.rnd() < 0.5 ? this.pickFlip() : null };
  }

  private airStep(inp: SkateInput) {
    const ph = this.ph;
    if (this.grindHold > 0) { this.grindHold -= 1 / 120; inp.grind = true; }
    // vert airs: sometimes a late flip while hanging over the ramp
    if (ph.vert && !this.airTrickDone && !this._attract && ph.airTime > 0.06) {
      this.airTrickDone = true;
      const left = ph.predicted?.tti ?? 0;
      if (left > 0.5 && this.rnd() < 0.4) inp.airTrick = this.pickFlip();
    }
    this.steerF = 0;
    if (!ph.vert) {
      // line the board up with the travel for the landing (nose or tail first): small corrective spin only
      const vx = ph.vel.x, vz = ph.vel.z, vh = Math.hypot(vx, vz);
      const fx = ph.fwd.x, fz = ph.fwd.z, fh = Math.hypot(fx, fz);
      if (vh > 0.8 && fh > 0.3) {
        let a = Math.atan2(fz * vx - fx * vz, fx * vx + fz * vz);
        if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
        if (Math.abs(a) > 0.07) inp.steer = clamp(-2.2 * a, -1, 1) * (Math.abs(a) > 0.4 ? 1 : 0.7);
      }
    }
    return inp;
  }

  private grindStep(inp: SkateInput) {
    const ph = this.ph, g = ph.grind!;
    this.grindHold = 0;
    const tan = _a.subVectors(g.line.pts[(g.seg + 1) % g.line.pts.length], g.line.pts[g.seg]).normalize().multiplyScalar(g.dir);
    if (this.copeOut) {
      // lean to the deck side until the board steps off the coping
      const inward = g.line.inward ? g.line.inward[Math.min(g.seg, g.line.inward.length - 1)] : null;
      const side = _b.crossVectors(Y, tan);
      inp.steer = inward ? -Math.sign(side.dot(inward)) || 1 : 1;
      return inp;
    }
    // balance: PD on the lean
    inp.steer = clamp(-1.5 * g.balance - 0.55 * g.bvel, -1, 1);
    // remaining rail
    let rem = Infinity;
    if (!g.line.closed) {
      const pts = g.line.pts, n = pts.length;
      rem = 0;
      const segL = (i: number) => pts[i].distanceTo(pts[i + 1]);
      if (g.dir > 0) { rem = (1 - g.u) * segL(g.seg); for (let i = g.seg + 1; i < n - 1; i++) rem += segL(i); }
      else { rem = g.u * segL(g.seg); for (let i = g.seg - 1; i >= 0; i--) rem += segL(i); }
    }
    const plan = this.grindPlan;
    if (plan?.pop && rem < 0.12 + g.speed * 0.03 && g.time > 0.25) {
      inp.ollie = true; inp.flip = plan.flip; this.grindPlan = null;
      this.lastAct = 'grindPop' + (plan.flip ? ':' + plan.flip : '');
    }
    return inp;
  }

  private startWall(i: number) {
    const n = this.nodes, prev = n[(i - 1 + n.length) % n.length], w = n[i];
    this.wallDir.set(w.x - prev.x, 0, w.z - prev.z).normalize();
    this.wallNode = i; this.wallN = w; this.wallT = 0; this.state = 'wall';
    this.copeOut = w.act?.k === 'copeOut';
  }

  /** in a bowl the lap does not ride (rolled into it): climb out over the nearest coping like the authored bowl exit */
  private startBowlEscape() {
    const ph = this.ph, p = ph.pos;
    let bd = Infinity, cx = 0, cz = 0;
    for (const line of ph.world.grindLines) {
      if (line.kind !== 'coping' || !line.closed) continue;
      const pts = line.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const u = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1), qx = a.x + dx * u, qz = a.z + dz * u;
        const d = Math.hypot(p.x - qx, p.z - qz);
        if (d < bd) { bd = d; cx = qx; cz = qz; }
      }
    }
    if (bd === Infinity) return false;
    const fx = (cx - p.x) / (bd || 1), fz = (cz - p.z) / (bd || 1), sg = this.escapeSide = -this.escapeSide;
    this.wallDir.set(fx * 0.77 - fz * 0.64 * sg, 0, fz * 0.77 + fx * 0.64 * sg).normalize();
    this.wallN = { x: p.x, z: p.z, y: p.y, v: 8, act: { k: 'copeOut' }, f: 'bowl', y3: false, s: 0, line: -1 };
    this.wallNode = -1; this.wallT = 0; this.state = 'wall'; this.copeOut = true; this.lastAct = 'bowlEscape';
    return true;
  }

  private leaveWall(next: number) {
    this.state = 'follow'; this.copeOut = false;
    if (this.wallN?.line === -1) { this.acquire(true); return; }
    const N = this.nodes.length, nx = ((next % N) + N) % N;
    this.seg = nx; this.s = this.nodes[nx].s;
    this.acquire(false);
  }

  /** transition hit: ride straight up the fall line, pump on the way down, hand back once rolling away on the flat */
  private wallStep(dt: number, inp: SkateInput) {
    const ph = this.ph, wn = this.wallN!;
    this.wallT += dt;
    const tv = this.travel(_c);
    const onFlat = ph.up.y > 0.97;
    const away = onFlat && this.wallT > 0.6 && tv.dot(this.wallDir) < -0.2;
    if (wn.line === -1 && wn.act?.k === 'copeOut') {
      if (onFlat && ph.pos.y > wn.y + 0.9 && this.wallT > 0.3) { this.leaveWall(0); return inp; }
      if (away || this.wallT > 9) { this.state = 'follow'; this.startBowlEscape(); return inp; }
      if (ph.pos.y > wn.y + 0.75 && ph.up.y < 0.6) { inp.grind = true; inp.grindPressed = true; }
    } else if (wn.act?.k === 'copeOut') {
      // bowl exit: out on the deck -> next line; back on the bowl floor -> carve another lap of the bowl and retry
      if (onFlat && ph.pos.y > wn.y + 2.0 && this.wallT > 0.3) { this.leaveWall(this.wallNode + 1); return inp; }
      if (away && ph.pos.y < wn.y + 0.3 || this.wallT > 9) {
        this.fired.delete(this.wallNode);
        for (let k = 1; k <= 8; k++) this.reached.delete((this.wallNode - k + this.nodes.length) % this.nodes.length);
        this.leaveWall(this.wallNode - (wn.act.retry ?? 6));
        return inp;
      }
      if (ph.pos.y > wn.y + 1.5) { inp.grind = true; inp.grindPressed = true; }
    } else if (away || this.wallT > 8) { this.leaveWall(this.wallNode + 1); return inp; }
    let dir: Vector3;
    if (onFlat) dir = tv.dot(this.wallDir) >= 0 ? this.wallDir : _d.copy(this.wallDir).negate();
    else {
      const up = _d.copy(Y).addScaledVector(ph.up, -ph.up.y);
      if (up.lengthSq() < 1e-6) dir = tv;
      else {
        up.normalize();
        const goingUp = tv.dot(up) >= 0;
        dir = goingUp ? up : up.negate();
        if (this.copeOut && goingUp) {
          // the coping is only caught with some speed along it: climb 40 deg off the fall line, on the approach side
          const side = _b.crossVectors(ph.up, up);
          if (side.dot(this.wallDir) < 0) side.negate();
          dir = up.multiplyScalar(0.77).addScaledVector(side, 0.64);
        }
      }
    }
    const steer = clamp(-2.2 * this.angleTo(dir), -1, 1);
    this.steerF += (steer - this.steerF) * (1 - Math.exp(-dt / 0.05));
    inp.steer = this.steerF;
    if (onFlat) inp.push = ph.speed < wn.v - 0.25 && tv.dot(this.wallDir) > 0;
    else inp.push = ph.up.y > 0.2 && ph.vel.y < -0.4;
    return inp;
  }
}

/** game.ts: `input.auto = createAutopilot(this)` once the physics exists */
export function createAutopilot(game: Game): AutoSource & { attract: boolean } {
  return new Autopilot(game.physics);
}
