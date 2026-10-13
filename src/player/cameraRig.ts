import { PerspectiveCamera, Vector3 } from 'three';
import type { CollisionWorld, Hit } from '../world/collision';
import type { GrindLine } from '../world/park';
import { clamp, damp, dampAngle, lerp, smoothstep, wrapAngle, SpringV3, Spring } from '../core/util';

/** What the rig reads from the skate physics each frame. */
export interface CamSubject {
  mode: string;
  pos: Vector3;
  vel: Vector3;
  up: Vector3;
  speed: number;
  vert: { wallN: Vector3 } | null;
  grind: { line: GrindLine; seg: number } | null;
  predicted: { point: Vector3; normal: Vector3 } | null;
}

const BARRIER = 9; // invisible fence quads: the camera passes through them
const SKATER_H = 1.62; // board to cap top in the riding stance
const DOWN = new Vector3(0, -1, 0);
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3(), _e = new Vector3();
const _r = new Vector3(), _o = new Vector3(), _f = new Vector3();
const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

interface Bowl { poly: { x: number; z: number }[]; lipY: number }
interface Seg { a: Vector3; b: Vector3; ux: number; uz: number; lenH: number; inward: Vector3 | null }

/**
 * Third person follow camera. Frames the skater at about a third of the frame height just below centre, from
 * behind at about head height above the floor he rides on. Context layers: sunken bowls keep the camera near lip
 * height, transitions and walls swing it out to the open side, back-and-forth riding (half pipe, bowl) goes side-on
 * instead of swinging 180 degrees, rails / ledges / stairs go low and side-on, blocked views search for a clear
 * direction before pulling in, and a frame guard keeps the board in frame.
 */
export class CameraRig {
  yaw = Math.PI; // camera position angle around the target (0 = camera on +Z side)
  pitch = 0.2; // current elevation of the camera above the look target
  dist = 4.2;
  userYaw = 0; userPitch = 0;
  idleT = 0;
  target = new SpringV3(10);
  fovS = new Spring(58, 3);
  shake = 0;
  override: null | { pos: Vector3; look: Vector3 } = null;
  orbitMode: null | { t: number; speed: number; dist: number; height: number } = null;
  distOverride: number | null = null;
  snapNext = false;

  private heading = 0;
  private time = 0;
  private frameN = 0;
  private camY = 1.7;
  private distS = new Spring(4.2, 2.5);
  private colDist = 99;
  private floorY = 0;
  private wSide = 0; private sideSign = 1; private dropW = 0;
  private wPend = 0; private pendDir = new Vector3(1, 0, 0); private pendLastT = -99; private pendTurn = new Vector3();
  private travel = new Vector3(); private travelOk = false; private steepAcc = 0;
  private wall = new Vector3(); private swingSign = 1;
  private avoid = 0; private avoidPick = 0;
  private lead = new Vector3();
  private bowls: Bowl[] = [];
  private segs: Seg[] = [];
  private pos = new Vector3();
  /** last frame's internals, for capture diagnostics */
  info = { side: 0, pend: 0, swing: 0, avoid: 0, wantD: 0, d: 0, clear: 0, floor: 0, yT: 0, elev: 0, bowl: false };

  constructor(public cam: PerspectiveCamera, private world: CollisionWorld) {
    for (const l of world.grindLines) {
      if (l.kind === 'coping') {
        if (l.closed) this.bowls.push({ poly: l.pts.map((p) => ({ x: p.x, z: p.z })), lipY: l.pts.reduce((s, p) => s + p.y, 0) / l.pts.length });
        continue;
      }
      for (let i = 0; i + 1 < l.pts.length; i++) {
        const a = l.pts[i], b = l.pts[i + 1];
        const lenH = Math.hypot(b.x - a.x, b.z - a.z);
        if (lenH < 0.3 || Math.max(a.y, b.y) < 0.25) continue; // skip stubs and flush pads (manual pad)
        this.segs.push({ a: a.clone(), b: b.clone(), ux: (b.x - a.x) / lenH, uz: (b.z - a.z) / lenH, lenH, inward: l.inward?.[i]?.clone() ?? null });
      }
    }
  }

  snap(targetPos: Vector3, heading: number) {
    this.target.set(targetPos);
    this.heading = heading;
    this.yaw = heading + Math.PI;
    this.userYaw = 0; this.userPitch = 0;
    this.snapNext = true;
  }

  addOrbit(dx: number, dy: number) {
    this.userYaw -= dx * 0.006;
    this.userPitch = clamp(this.userPitch + dy * 0.004, -0.25, 0.9);
    this.idleT = 0;
  }
  recenter() { this.userYaw = 0; this.userPitch = 0; }

  update(dt: number, focus: Vector3, s: CamSubject) {
    const cam = this.cam;
    if (this.override) {
      cam.position.copy(this.override.pos);
      cam.lookAt(this.override.look);
      return;
    }
    this.time += dt; this.frameN++;
    const snap = this.snapNext;
    this.snapNext = false;
    const portrait = cam.aspect < 1;
    const mode = s.mode;
    const air = mode === 'air', grind = mode === 'grind', down = mode === 'bail' || mode === 'recover';
    const steep = mode === 'ride' ? 1 - s.up.y : air && s.vert ? 1 : 0;
    const hv = Math.hypot(s.vel.x, s.vel.z);
    const pinned = this.idleT < -1e6; // test API camYaw(): exact offsets from behind, no automatic swings
    const orbit = this.orbitMode;

    // ---- heading follows horizontal travel; held on vert walls / when slow. Reversed travel (half pipe, fakie)
    // turns slowly unless the side-on pendulum view owns the yaw.
    if (hv > 1.2 && !down && steep < 0.6) {
      const want = Math.atan2(s.vel.x, s.vel.z);
      const reversed = Math.abs(wrapAngle(want - this.heading)) > 1.9 && this.wPend < 0.98;
      this.heading = dampAngle(this.heading, want, reversed ? 0.35 : air ? 1.2 : 2.6, dt);
    }
    this.idleT += dt;
    if (this.idleT > 2.5 && hv > 1.5) {
      this.userYaw *= Math.exp(-0.8 * dt);
      this.userPitch *= Math.exp(-0.8 * dt);
    }
    if (orbit) { orbit.t += dt; this.userYaw += orbit.speed * dt; }

    // ---- back-and-forth detection: travel reversed after riding up a transition
    this.steepAcc = Math.max(this.steepAcc, steep);
    if (snap || down) { this.travelOk = false; this.pendLastT = -99; }
    else if (hv > 1.0 && (mode === 'ride' || air)) {
      const dx = s.vel.x / hv, dz = s.vel.z / hv;
      if (this.travelOk && dx * this.travel.x + dz * this.travel.z < -0.5 && this.steepAcc > 0.1) {
        if (this.wPend < 0.05) this.choosePendSide(focus, this.travel); else this.alignPendSide(this.travel);
        this.pendLastT = this.time;
        this.pendTurn.copy(s.pos);
      }
      this.travel.set(dx, 0, dz); this.travelOk = true; this.steepAcc = steep;
    }
    // climbing straight up a steep wall: a vert air or kickturn is coming, go side-on early
    if (mode === 'ride' && steep > 0.45 && s.vel.y > 1 && !pinned) {
      const nl = Math.hypot(s.up.x, s.up.z);
      if (nl > 0.2 && hv > 0.2 && (s.vel.x * s.up.x + s.vel.z * s.up.z) / (hv * nl) < -0.8) {
        if (this.wPend < 0.05) this.choosePendSide(focus, _e.set(-s.up.x / nl, 0, -s.up.z / nl));
        this.pendLastT = this.time; this.pendTurn.copy(s.pos);
      }
    }
    // side-on stays perpendicular to the current travel (carves, exits), on the side already chosen
    if (this.wPend > 0.01 && hv > 1.2 && !air) {
      let px = -s.vel.z / hv, pz = s.vel.x / hv;
      if (px * this.pendDir.x + pz * this.pendDir.z < 0) { px = -px; pz = -pz; }
      const k = 1 - Math.exp(-3 * dt);
      this.pendDir.set(this.pendDir.x + (px - this.pendDir.x) * k, 0, this.pendDir.z + (pz - this.pendDir.z) * k).normalize();
    }
    const since = this.time - this.pendLastT;
    const onRamp = steep > 0.1 || (air && !!s.vert) || (mode === 'ride' && hv < 1.5); // slow: about to turn
    // still crossing between the walls: moving along the pendulum axis, not far from the last turn
    const crossing = hv > 1.5 && Math.abs(s.vel.x * this.pendDir.z - s.vel.z * this.pendDir.x) > 0.85 * hv
      && Math.hypot(s.pos.x - this.pendTurn.x, s.pos.z - this.pendTurn.z) < 16;
    const pendWant = !down && !pinned && (since < 3 || (since < 8 && (onRamp || crossing))) ? 1 : 0;
    this.wPend = snap ? 0 : damp(this.wPend, pendWant, pendWant > this.wPend ? 2.6 : 1.1, dt);

    // ---- rails, ledges, stairs and drops: low and side-on so the steps and the rail slope read
    const hint = _d.set(0, 0, 0);
    let sideWant = 0;
    if (grind && s.grind && s.grind.line.kind !== 'coping') {
      sideWant = 1;
      const inw = s.grind.line.inward?.[s.grind.seg];
      if (inw) hint.set(inw.x, 0, inw.z);
    } else if ((mode === 'ride' || air) && hv > 2) {
      sideWant = Math.max(this.railAhead(s, hv, hint), this.dropAhead(s, hv));
    }
    if (pinned || down || orbit) sideWant = 0;
    if (this.wSide < 0.04 && sideWant > 0.05) this.sideSign = this.chooseSide(focus, hint);
    this.wSide = snap ? 0 : damp(this.wSide, sideWant, sideWant > this.wSide ? 4 : 1.0, dt);

    // ---- base yaw: behind, blended to the side-on views
    const back = this.heading + Math.PI;
    let base = back;
    if (!pinned) {
      if (this.wSide > 1e-3) base = lerpAngle(base, back + this.sideSign * 1.05, this.wSide);
      if (this.wPend > 1e-3) base = lerpAngle(base, Math.atan2(this.pendDir.x, this.pendDir.z), this.wPend);
    }

    // ---- open side of transitions and walls: swing the camera out toward it
    const wantWall = _b.set(0, 0, 0);
    if (!down) {
      if (mode === 'ride' && steep > 0.1) {
        const k = smoothstep(0.1, 0.55, steep);
        if (Math.hypot(s.up.x, s.up.z) > 1e-3) wantWall.set(s.up.x, 0, s.up.z).normalize().multiplyScalar(k);
      } else if (air && s.vert) wantWall.set(s.vert.wallN.x, 0, s.vert.wallN.z).normalize();
      else if (grind && s.grind?.line.kind === 'coping') {
        const inw = s.grind.line.inward?.[s.grind.seg];
        if (inw) wantWall.set(inw.x, 0, inw.z).normalize().multiplyScalar(0.8);
      }
      this.wallBeside(focus, wantWall);
    }
    if (snap) this.wall.copy(wantWall);
    else {
      // grows quickly, fades quickly on flat ground, lingers through airs, drops at once when the wall flips side
      const rate = wantWall.dot(this.wall) < -0.01 ? 9 : wantWall.lengthSq() > this.wall.lengthSq() ? 4 : air ? 1.2 : 5;
      this.wall.lerp(wantWall, 1 - Math.exp(-rate * dt));
    }
    let swing = 0;
    const wl = Math.min(1, this.wall.length());
    if (wl > 0.02 && !pinned && !orbit) {
      const a = wrapAngle(Math.atan2(this.wall.x, this.wall.z) - base);
      // camera roughly behind the wall (drop-in from the deck): it is already in the open, leave it
      const g = 1 - smoothstep(1.9, 2.6, Math.abs(a));
      swing = clamp(a, -0.62, 0.62) * wl * g;
    }
    const yawT = base + swing + this.userYaw;

    // ---- distance: keep the skater about a third of the frame height (a quarter in portrait)
    const sp = clamp(s.speed / 10, 0, 1);
    this.fovS.update((portrait ? 64 : 56) + sp * 8, dt);
    if (Math.abs(cam.fov - this.fovS.x) > 0.01) { cam.fov = this.fovS.x; cam.updateProjectionMatrix(); }
    const tH = Math.tan((cam.fov * Math.PI) / 360);
    const sizeFrac = portrait ? 0.25 - 0.03 * sp : 0.37 - 0.05 * sp;
    // vert / back-and-forth: closer, the tucked skater in the air should still fill about a third of the frame
    let wantD = SKATER_H / (2 * tH * sizeFrac) * (1 - 0.15 * this.wPend) + (air && !s.vert ? 0.25 : 0) + (down ? 0.4 : 0);
    if (orbit) wantD = orbit.dist;
    if (this.distOverride != null) wantD = this.distOverride;
    if (snap) this.distS.set(wantD); else this.distS.update(wantD, dt);
    const D = this.distS.x;

    // ---- look target: the skater's body, with a velocity lead so the spring lag doesn't push him off centre
    const leadW = _c.set(s.vel.x, air ? s.vel.y : 0, s.vel.z).multiplyScalar(down || orbit ? 0 : 0.16);
    if (leadW.length() > 1.4) leadW.setLength(1.4);
    if (snap) this.lead.copy(leadW); else this.lead.lerp(leadW, 1 - Math.exp(-5 * dt));
    const ft = _a.copy(focus).add(this.lead);
    if (orbit) ft.y += orbit.height;
    if (snap) this.target.set(ft); else this.target.update(ft, dt, down ? 4 : 10);
    const L = this.target.x;

    // ---- camera height: about head height above the floor he rides on (held on walls and in the air)
    let floorT = this.floorY;
    if (mode === 'ride') floorT = s.up.y > 0.93 ? s.pos.y : Math.min(this.floorY, s.pos.y);
    else if (grind) floorT = this.groundBelow(s.pos, this.floorY);
    else if (air && s.predicted && s.predicted.normal.y > 0.9) floorT = Math.min(this.floorY, s.predicted.point.y);
    else if (down) floorT = Math.min(this.floorY, focus.y - 0.3);
    this.floorY = snap ? s.pos.y : damp(this.floorY, floorT, floorT < this.floorY ? 3.5 : 2.2, dt);
    const fl = this.floorY;
    let yT = fl + (portrait ? 1.9 : 1.72) + 0.45 * Math.max(0, s.pos.y - fl - 0.25);
    const bowl = this.bowlAt(s.pos.x, s.pos.z);
    // inside a sunken bowl: stay near lip height (horizon and bowl shape readable, never down on the floor)
    if (bowl && fl < bowl.lipY - 0.3) yT = Math.max(yT, Math.min(bowl.lipY + 0.35, fl + 2.45));
    if (this.wSide > 0) yT = lerp(yT, Math.max(fl + 1.0, s.pos.y + 0.5), this.wSide * 0.9);
    this.camY = snap ? yT : damp(this.camY, yT, yT > this.camY ? 2.6 : 3.2, dt);
    let elev = Math.asin(clamp((this.camY - L.y) / D, -0.95, 0.95));
    elev = orbit ? 0.2 + this.userPitch : clamp(elev + this.userPitch, -0.32, 0.55); // never top-down

    // ---- clearance: if walls / ramps block the view, swing to a clear direction before pulling in
    const want = yawT + this.avoid;
    let avoidT = pinned || orbit ? 0 : this.avoid; // test views (camYaw / orbit) keep their exact angle
    if (!pinned && !orbit && (this.losClear(L, want, elev, D + 0.3) < D * 0.8 || Math.abs(this.avoid) > 0.01)) {
      let best = -1e9;
      for (const o of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
        const c = this.losClear(L, yawT + o, elev, D + 0.3);
        let score = Math.min(c, D) / D - 0.22 * Math.abs(o) + (o === this.avoidPick ? 0.06 : 0);
        // crossing to the other side would sweep the camera through the blocked view
        if (o * this.avoid < 0 && Math.abs(this.avoid) > 0.15) score -= 0.3;
        if (score > best) { best = score; avoidT = o; }
      }
      this.avoidPick = avoidT;
    }
    // escape an obstruction quickly, ease back behind the skater slowly
    this.avoid = snap ? avoidT : damp(this.avoid, avoidT, Math.abs(avoidT) < Math.abs(this.avoid) ? 1.5 : 4, dt);
    const yawGoal = yawT + this.avoid;
    this.yaw = snap ? yawGoal : dampAngle(this.yaw, yawGoal, 5, dt);

    const ce = Math.cos(elev), se = Math.sin(elev);
    const dir = _c.set(Math.sin(this.yaw) * ce, se, Math.cos(this.yaw) * ce);
    const clear = this.losThick(L, dir, D + 0.3);
    const allowed = Math.max(0.6, clear - 0.28);
    this.colDist = snap || allowed < this.colDist ? allowed : damp(this.colDist, allowed, 3.5, dt);
    const d = Math.min(D, this.colDist);
    this.pos.copy(L).addScaledVector(dir, d);
    this.pitch = elev; this.dist = d;
    const inf = this.info;
    inf.side = this.wSide; inf.pend = this.wPend; inf.swing = swing; inf.avoid = this.avoid; inf.wantD = D; inf.d = d;
    inf.clear = clear; inf.floor = fl; inf.yT = yT; inf.elev = elev; inf.bowl = !!bowl;

    // keep a margin from walls beside the camera
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    for (const sg of [1, -1]) {
      _d.set(rx * sg, 0, rz * sg);
      const h = this.ray(this.pos, _d, 1.3);
      if (h && Math.abs(h.normal.y) < 0.5) this.pos.addScaledVector(_d, h.distance - 1.3);
    }
    // never below the local ground
    _a.set(this.pos.x, Math.max(this.pos.y, L.y) + 0.5, this.pos.z);
    const g = this.ray(_a, DOWN, _a.y - this.pos.y + 3);
    if (g && this.pos.y < g.point.y + 0.3) this.pos.y = g.point.y + 0.3;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const k = this.shake * this.shake * 0.06;
      this.pos.x += Math.sin(this.time * 51) * k; this.pos.y += Math.sin(this.time * 67) * k;
    }
    cam.position.copy(this.pos);
    cam.lookAt(L);
    if (!orbit) {
      // composition: skater centre just below the middle of the frame
      cam.rotateX(Math.atan((portrait ? 0.11 : 0.15) * tH));
      this.frameGuard(s, focus, tH, down);
    }
  }

  /** keep the board (with a little ground under it) and the head inside the frame */
  private frameGuard(s: CamSubject, focus: Vector3, tH: number, down: boolean) {
    const cam = this.cam;
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const lo = Math.atan(0.8 * tH), hi = Math.atan(0.9 * tH);
    const vb = _a.copy(s.pos).applyMatrix4(inv);
    if (vb.z > -0.3) return;
    const ab = Math.atan2(vb.y, -vb.z);
    if (ab < -lo) { cam.rotateX(ab + lo); return; }
    if (down) return;
    const vh = _b.copy(focus).addScaledVector(s.up, 0.95).applyMatrix4(inv);
    if (vh.z > -0.3) return;
    const ah = Math.atan2(vh.y, -vh.z);
    if (ah > hi) cam.rotateX(Math.min(ah - hi, ab + lo));
  }

  /** first hit along a ray, passing through invisible barriers */
  private ray(o: Vector3, d: Vector3, max: number): Hit | null {
    let h = this.world.raycast(o, d, max);
    let travelled = 0;
    for (let i = 0; i < 3 && h && h.surface === BARRIER; i++) {
      travelled += h.distance + 0.02;
      const rest = max - travelled;
      const h2 = rest > 0 ? this.world.raycast(_o.copy(o).addScaledVector(d, travelled), d, rest) : null;
      if (h2) h2.distance += travelled;
      h = h2;
    }
    return h;
  }

  private losClear(L: Vector3, yaw: number, elev: number, max: number) {
    const ce = Math.cos(elev);
    const h = this.ray(L, _r.set(Math.sin(yaw) * ce, Math.sin(elev), Math.cos(yaw) * ce), max);
    return h ? h.distance : max;
  }

  /** median clear distance of three parallel rays, so thin posts don't yank the camera in */
  private losThick(L: Vector3, dir: Vector3, max: number) {
    const rx = Math.cos(this.yaw) * 0.28, rz = -Math.sin(this.yaw) * 0.28;
    const c: number[] = [];
    for (const k of [0, 1, -1]) {
      const h = this.ray(_d.set(L.x + rx * k, L.y, L.z + rz * k), dir, max);
      c.push(h ? h.distance : max);
    }
    c.sort((a, b) => a - b);
    return c[1];
  }

  private clearance(from: Vector3, yaw: number, max: number) {
    const h = this.ray(from, _r.set(Math.sin(yaw), 0, Math.cos(yaw)), max);
    return h ? h.distance : max;
  }

  /** near-vertical wall right beside the skater: swing the camera out of it. Probed a little ahead and behind so a
   *  lamp post or a sign passing by doesn't count as a wall. */
  private wallBeside(focus: Vector3, out: Vector3) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const sg of [1, -1]) {
      _r.set(fz * sg, 0, -fx * sg);
      let far = 0;
      let n: Vector3 | null = null;
      for (const a of [0.7, -0.7]) {
        const h = this.ray(_f.set(focus.x + fx * a, focus.y, focus.z + fz * a), _r, 2.4);
        if (!h || Math.abs(h.normal.y) > 0.35) { n = null; break; }
        if (h.distance >= far) { far = h.distance; n = h.normal; }
      }
      if (!n) continue;
      const k = 1 - smoothstep(0.6, 2.4, far);
      if (k > out.length()) out.set(n.x, 0, n.z).normalize().multiplyScalar(k);
    }
  }

  private groundBelow(p: Vector3, fallback: number) {
    const h = this.ray(_r.set(p.x, p.y + 0.05, p.z), DOWN, 4);
    return h ? h.point.y : fallback;
  }

  private bowlAt(x: number, z: number): Bowl | null {
    for (const b of this.bowls) {
      let inside = false;
      const P = b.poly;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        if ((P[i].z > z) !== (P[j].z > z) && x < ((P[j].x - P[i].x) * (z - P[i].z)) / (P[j].z - P[i].z) + P[i].x) inside = !inside;
      }
      if (inside) return b;
    }
    return null;
  }

  /** rail or ledge ahead along the travel direction (0..0.9), with the ledge's open side in `hint` */
  private railAhead(s: CamSubject, hv: number, hint: Vector3) {
    const tx = s.vel.x / hv, tz = s.vel.z / hv;
    let best = 0;
    for (const g of this.segs) {
      const along = tx * g.ux + tz * g.uz;
      if (Math.abs(along) < 0.8) continue;
      const px = s.pos.x - g.a.x, pz = s.pos.z - g.a.z;
      const lat = Math.abs(px * g.uz - pz * g.ux);
      if (lat > 1.4) continue;
      const u = px * g.ux + pz * g.uz;
      const enter = along > 0 ? -u : u - g.lenH; // > 0: distance still to go before the segment starts
      if (enter > 4.5 || enter < -g.lenH - 0.3) continue;
      const dy = g.a.y + (g.b.y - g.a.y) * clamp(u / g.lenH, 0, 1) - s.pos.y;
      if (dy < -0.5 || dy > 1.4) continue;
      const w = (1 - smoothstep(1.6, 4.5, enter)) * (1 - smoothstep(0.7, 1.4, lat)) * 0.9;
      if (w > best) {
        best = w;
        if (g.inward) hint.set(g.inward.x, 0, g.inward.z); else hint.set(0, 0, 0);
      }
    }
    return best;
  }

  /** stairs / ledge drop ahead (flat ground lower than the deck), or flying down one */
  private dropAhead(s: CamSubject, hv: number) {
    if (s.mode === 'air') {
      const p = s.predicted;
      return p && p.normal.y > 0.9 && p.point.y < this.floorY - 0.35 && !this.bowlAt(p.point.x, p.point.z) ? 1 : 0;
    }
    if (s.up.y < 0.95) return (this.dropW = 0);
    if (this.frameN % 2) return this.dropW;
    const tx = s.vel.x / hv, tz = s.vel.z / hv;
    let w = 0;
    for (let i = 0; i < 4; i++) {
      const d = 1.0 + i * 1.3;
      const h = this.ray(_r.set(s.pos.x + tx * d, s.pos.y + 1.6, s.pos.z + tz * d), DOWN, 4.5);
      if (!h || h.normal.y < 0.88 || this.bowlAt(h.point.x, h.point.z)) break; // transition / bowl: not a drop
      if (h.point.y < s.pos.y - 0.35) { w = 1 - smoothstep(2.5, 5.0, d); break; }
    }
    return (this.dropW = w);
  }

  /** +1: camera to the right of the travel direction (seen from behind), -1: left */
  private chooseSide(focus: Vector3, hint: Vector3) {
    const back = this.heading + Math.PI;
    if (hint.lengthSq() > 0.01) return wrapAngle(Math.atan2(hint.x, hint.z) - back) >= 0 ? 1 : -1;
    const r = this.clearance(focus, back + 1.1, 6), l = this.clearance(focus, back - 1.1, 6);
    if (Math.abs(r - l) > 1.2) return r > l ? 1 : -1;
    return wrapAngle(this.yaw - back) >= 0 ? 1 : -1;
  }

  private choosePendSide(focus: Vector3, axis: Vector3) {
    const yA = Math.atan2(-axis.z, axis.x), yB = yA + Math.PI;
    const a = this.clearance(focus, yA, 7), b = this.clearance(focus, yB, 7);
    const pick = Math.abs(a - b) > 1.5 ? (a > b ? yA : yB)
      : Math.abs(wrapAngle(yA - this.yaw)) <= Math.abs(wrapAngle(yB - this.yaw)) ? yA : yB;
    this.pendDir.set(Math.sin(pick), 0, Math.cos(pick));
  }

  private alignPendSide(axis: Vector3) {
    let px = -axis.z, pz = axis.x;
    if (px * this.pendDir.x + pz * this.pendDir.z < 0) { px = -px; pz = -pz; }
    this.pendDir.set(px, 0, pz);
  }
}
