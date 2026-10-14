import { PerspectiveCamera, Vector3 } from 'three';
import type { CollisionWorld, Hit } from '../world/collision';
import type { GrindLine } from '../world/park';
import { clamp, damp, dampAngle, lerp, smoothstep, wrapAngle, SpringV3, Spring } from '../core/util';
import { settings } from '../core/settings';

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
const _r = new Vector3(), _o = new Vector3(), _f = new Vector3(), _g = new Vector3(), _h = new Vector3();
const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;
// blocked view: yaw offsets and camera rises tried, and the highest the rise may take it (never top-down)
const AVOID_YAW = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, 2.1, -2.1];
const AVOID_RISE = [0, 0.3, 0.6];
const MAX_ELEV = 0.85;

interface Bowl {
  poly: { x: number; z: number }[]; lipY: number; floorY: number; cx: number; cz: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
}
interface BowlEdge { b: Bowl; d: number; nx: number; nz: number }
interface Seg { a: Vector3; b: Vector3; ux: number; uz: number; lenH: number; inward: Vector3 | null }

/**
 * Third person follow camera. Frames the skater at about a third of the frame height just below centre, from
 * behind at about head height above the floor he rides on. Context layers: inside a sunken bowl the camera rides
 * along at about his head height and follows carves from behind along the wall, never looking down his body line;
 * dropping in from the deck goes side-on along the coping; transitions and walls swing it out to the open side,
 * back-and-forth riding (half pipe, bowl) goes side-on instead of swinging 180 degrees, rails / ledges / stairs go
 * low and side-on, blocked views search for a clear direction before pulling in, and a frame guard keeps the board
 * in frame.
 */
export class CameraRig {
  yaw = Math.PI; // camera position angle around the target (0 = camera on +Z side)
  pitch = 0.2; // current elevation of the camera above the look target
  dist = 4.2;
  /** player look offsets, applied directly (no smoothing); yaw = autoYaw (heading follow, damped) + userYaw */
  userYaw = 0; userPitch = 0;
  autoYaw = Math.PI;
  /** the pointer is locked (mouse look): recentering is opt-in and only after a long pause */
  locked = false;
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
  private colS = new Spring(99, 7); private blockedT = 0;
  private floorY = 0;
  private wSide = 0; private sideSign = 1; private dropW = 0;
  private wPend = 0; private pendDir = new Vector3(1, 0, 0); private pendLastT = -99; private pendTurn = new Vector3();
  private travel = new Vector3(); private travelOk = false; private steepAcc = 0;
  private wall = new Vector3(); private swingSign = 1;
  private avoid = 0; private avoidPick = 0; private avoidE = 0; private avoidPickE = 0;
  private lead = new Vector3();
  private bowls: Bowl[] = [];
  private segs: Seg[] = [];
  private pos = new Vector3();
  private wBowl = 0; private bowlRef: Bowl | null = null; private carveW = 0; private dropT = -99;
  private pendDl = 0; private pendPrev = 0;
  private guardS = new Spring(0, 30);
  private recY = new Spring(0, 1.2); private recP = new Spring(0, 1.2);
  private spS = new Spring(0, 1.6);
  private wallPush = new Vector3(); private groundLift = 0;
  /** last frame's internals, for capture diagnostics */
  info = { side: 0, pend: 0, swing: 0, avoid: 0, rise: 0, wantD: 0, d: 0, clear: 0, clear0: 0, fov: 0, floor: 0, yT: 0, elev: 0, bowl: false, bw: 0, carve: 0, drop: 0, base: 0, goal: 0 };

  constructor(public cam: PerspectiveCamera, private world: CollisionWorld) {
    for (const l of world.grindLines) {
      if (l.kind === 'coping') {
        if (l.closed) {
          const poly = l.pts.map((p) => ({ x: p.x, z: p.z }));
          const lipY = l.pts.reduce((s, p) => s + p.y, 0) / l.pts.length;
          const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length, cz = poly.reduce((s, p) => s + p.z, 0) / poly.length;
          const fh = this.ray(_a.set(cx, lipY + 0.5, cz), DOWN, 12);
          this.bowls.push({
            poly, lipY, floorY: fh ? fh.point.y : lipY - 2, cx, cz,
            minX: Math.min(...poly.map((p) => p.x)), maxX: Math.max(...poly.map((p) => p.x)),
            minZ: Math.min(...poly.map((p) => p.z)), maxZ: Math.max(...poly.map((p) => p.z)),
          });
        }
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
    this.yaw = this.autoYaw = heading + Math.PI;
    this.userYaw = 0; this.userPitch = 0;
    this.lookPend.y = this.lookPend.p = 0;
    this.snapNext = true;
  }

  /** player look (radians, added to userYaw / userPitch): yaw > 0 swings the camera left round the skater, pitch > 0
   *  raises it. Applied from the same frame on, spread over a few ms so 50-125 Hz input events don't step a fast display. */
  look(yaw: number, pitch: number) {
    if (!yaw && !pitch) return;
    this.lookPend.y += yaw; this.lookPend.p += pitch;
    this.idleT = 0;
    this.recY.v = this.recP.v = 0;
    this.recentering = false;
  }
  private lookPend = { y: 0, p: 0 };
  private applyLook(dt: number) {
    const lp = this.lookPend;
    if (!lp.y && !lp.p) return;
    // raw locked mouse: ~12 ms; drag / touch / stick (coarser, ~50-60 Hz events): ~30 ms
    const k = 1 - Math.exp(-dt / (this.locked ? 0.012 : 0.03));
    const dy = Math.abs(lp.y) < 1e-5 ? lp.y : lp.y * k, dp = Math.abs(lp.p) < 1e-5 ? lp.p : lp.p * k;
    lp.y -= dy; lp.p -= dp;
    this.userYaw = wrapAngle(this.userYaw + dy);
    const p = this.userPitch + dp;
    this.userPitch = clamp(p, -0.25, 0.9);
    if (this.userPitch !== p) lp.p = 0;
  }
  addOrbit(dx: number, dy: number) { this.look(-dx * 0.006, dy * 0.004); }
  /** ease the look offsets back to behind the skater */
  recenter() { this.recentering = true; this.recY.v = this.recP.v = 0; }
  private recentering = false;
  private easeBack(omega: number, dt: number) {
    this.recY.x = this.userYaw; this.userYaw = this.recY.update(0, dt, omega);
    this.recP.x = this.userPitch; this.userPitch = this.recP.update(0, dt, omega);
  }

  update(dt: number, focus: Vector3, s: CamSubject) {
    const cam = this.cam;
    if (this.override) {
      cam.position.copy(this.override.pos);
      cam.lookAt(this.override.look);
      return;
    }
    this.time += dt; this.frameN++;
    this.applyLook(dt);
    const snap = this.snapNext;
    this.snapNext = false;
    const portrait = cam.aspect < 1;
    const mode = s.mode;
    const air = mode === 'air', grind = mode === 'grind', down = mode === 'bail' || mode === 'recover';
    const steep = mode === 'ride' ? 1 - s.up.y : air && s.vert ? 1 : 0;
    const hv = Math.hypot(s.vel.x, s.vel.z);
    const pinned = this.idleT < -1e6; // test API camYaw(): exact offsets from behind, no automatic swings
    const orbit = this.orbitMode;

    // ---- bowl context: signed distance to the coping (+ inside), and carving (travel along a bowl wall)
    const edge = this.bowlEdge(s.pos.x, s.pos.z, 4.5);
    const inBowl = !!edge && edge.d > 0;
    if (inBowl) this.bowlRef = edge.b;
    const bowlWant = inBowl && !down && !grind ? 1 : 0; // coping grinds keep the deck framing
    this.wBowl = snap ? bowlWant : damp(this.wBowl, bowlWant, bowlWant ? 3 : 1.5, dt);
    let carve = 0;
    const nh = Math.hypot(s.up.x, s.up.z);
    if (inBowl && mode === 'ride' && hv > 1.5 && nh > 0.1) {
      const tang = Math.abs(s.vel.x * s.up.z - s.vel.z * s.up.x) / (nh * hv);
      carve = smoothstep(0.5, 0.8, tang) * smoothstep(0.1, 0.25, nh) * smoothstep(1.5, 3, hv);
    }
    this.carveW = snap ? carve : damp(this.carveW, carve, carve > this.carveW ? 6 : 2, dt);

    // ---- heading follows horizontal travel; held on vert walls / when slow (except carving along a bowl wall).
    // Reversed travel (half pipe, fakie) turns slowly unless the side-on pendulum view owns the yaw.
    if (hv > 1.2 && !down && (steep < 0.6 || this.carveW > 0.5)) {
      const want = Math.atan2(s.vel.x, s.vel.z);
      const reversed = Math.abs(wrapAngle(want - this.heading)) > 1.9 && this.wPend < 0.98;
      // left ahead of him while he rides toward a wall (it would end up between him and the wall): come round behind him
      let rev = 0.35;
      if (reversed) {
        const h = this.blockedT > 0 || this.wPend > 0.3 ? null : this.ray(focus, _r.set(s.vel.x / hv, 0, s.vel.z / hv), this.distS.x + 1.5);
        rev = this.blockedT > 0 || (h && h.normal.y < 0.8) ? lerp(0.35, 1.8, smoothstep(0, 0.15, this.blockedT + 0.1)) : 0.35;
      }
      this.heading = dampAngle(this.heading, want, reversed ? rev : air ? 1.2 : 2.6, dt);
    }
    this.idleT += dt;
    if (this.recentering) {
      this.easeBack(6, dt);
      if (Math.abs(this.userYaw) + Math.abs(this.userPitch) < 1e-3) this.recentering = false;
    } else if (this.locked) {
      // mouse look holds the view; optionally ease back behind him after a long pause while rolling
      if (settings.autoRecenter && this.idleT > 3 && hv > 1.5) this.easeBack(1.2, dt); else this.recY.v = this.recP.v = 0;
    } else if (this.idleT > 2.5 && hv > 1.5) {
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
        // turning on a bowl wall (carve up into a stall): side-on means along that wall, whatever the travel was
        const axis = inBowl && nh > 0.3 ? _e.set(s.up.x / nh, 0, s.up.z / nh) : this.travel;
        if (this.wPend < 0.05) this.choosePendSide(focus, axis, inBowl); else this.alignPendSide(axis);
        this.pendLastT = this.time;
        this.pendTurn.copy(s.pos);
      }
      this.travel.set(dx, 0, dz); this.travelOk = true; this.steepAcc = steep;
    }
    // climbing straight up a steep wall: a vert air or kickturn is coming, go side-on early
    if (mode === 'ride' && steep > 0.45 && s.vel.y > 1 && !pinned) {
      const nl = Math.hypot(s.up.x, s.up.z);
      if (nl > 0.2 && hv > 0.2 && (s.vel.x * s.up.x + s.vel.z * s.up.z) / (hv * nl) < -0.8) {
        if (this.wPend < 0.05) this.choosePendSide(focus, _e.set(-s.up.x / nl, 0, -s.up.z / nl), inBowl);
        this.pendLastT = this.time; this.pendTurn.copy(s.pos);
      }
    }
    // dropping into a bowl from the deck: side-on along the coping before he reaches it, so the board tipping over the
    // coping and the wall under it stay in view and the camera follows him over the lip beside him, not from behind
    const drop = pinned || down || orbit ? 0 : this.dropInAhead(s, hv, edge);
    if (drop > 0.3 && edge) {
      _e.set(edge.nx, 0, edge.nz);
      if (this.wPend < 0.05) this.choosePendSide(focus, _e); else if (this.time - this.dropT > 0.5) this.alignPendSide(_e);
      this.pendLastT = this.time; this.pendTurn.copy(s.pos); this.dropT = this.time;
    } else if (!inBowl && this.pendLastT === this.dropT && this.time - this.dropT > 1) this.pendLastT -= 8; // turned away
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
    // carving round a bowl wall is not back-and-forth: a side-on view there would look down his body line
    const pendWant = !down && !pinned && this.carveW < 0.4 && (since < 3 || (since < 8 && (onRamp || crossing))) ? 1 : 0;
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
      if (this.wPend > 1e-3) {
        // blend angle unwrapped while side-on is active, so it never flips halfway when side-on and behind end up
        // opposite; starting from opposite, it goes round through the camera's side
        const raw = wrapAngle(Math.atan2(this.pendDir.x, this.pendDir.z) - base);
        if (this.pendPrev <= 1e-3) this.pendDl = Math.abs(raw) > 2.6 && wrapAngle(this.yaw - base) * raw < 0 ? raw - Math.sign(raw) * 2 * Math.PI : raw;
        else this.pendDl += wrapAngle(raw - this.pendDl);
        base += this.pendDl * this.wPend;
      }
    }
    this.pendPrev = pinned ? 0 : this.wPend;

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
      // inside a bowl the open side is its middle, where he leans to: swinging there films him head-on
      if (this.wBowl > 0) wantWall.multiplyScalar(1 - this.wBowl);
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
    let yawT = base + swing + this.userYaw;

    // ---- distance: keep the skater about a third of the frame height (a quarter in portrait)
    // smoothed speed: FOV and distance must not pump with each push
    if (snap) this.spS.set(s.speed); else this.spS.update(s.speed, dt);
    const sp = clamp(this.spS.x / 10, 0, 1);
    this.fovS.update((portrait ? 74 : 56) + sp * 8, dt);
    const tH = Math.tan((this.fovS.x * Math.PI) / 360);
    const sizeFrac = portrait ? 0.22 - 0.03 * sp : 0.37 - 0.05 * sp;
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
    this.floorY = snap ? s.pos.y : damp(this.floorY, floorT, floorT < this.floorY ? (this.wBowl > 0.5 ? 6 : 3.5) : 2.2, dt);
    const fl = this.floorY;
    let yT = fl + (portrait ? 1.9 : 1.72) + 0.45 * Math.max(0, s.pos.y - fl - 0.25);
    const bowl = inBowl ? edge.b : null;
    // bailing in a sunken bowl: stay near lip height (horizon and bowl shape readable, never down on the floor)
    if (bowl && fl < bowl.lipY - 0.3) yT = Math.max(yT, Math.min(bowl.lipY + 0.35, fl + 2.45));
    const br = this.bowlRef;
    if (this.wBowl > 1e-3 && br) {
      // riding in a bowl: a little above his head, rising with him up the walls, never lower than a standing head
      // height above the floor and not far above the lip unless he flies out of it
      const headY = mode === 'ride' ? s.pos.y + 1.5 * s.up.y : focus.y + 0.65;
      let yB = Math.max(Math.max(fl, br.floorY) + (portrait ? 1.95 : 1.8), headY + 0.3);
      yB = Math.min(yB, br.lipY + 0.55 + 0.6 * Math.max(0, focus.y - br.lipY));
      yT = lerp(yT, yB, this.wBowl);
      // camera still out over the deck (dropping in, riding up near the lip): deck height, never skimming the deck
      const ce = this.bowlEdge(this.pos.x, this.pos.z, 2);
      if (ce && ce.b === br) yT = lerp(yT, Math.max(yT, br.lipY + 1.1), smoothstep(0.6, -0.3, ce.d) * this.wBowl);
    }
    if (this.wSide > 0) yT = lerp(yT, Math.max(fl + 1.0, s.pos.y + 0.5), this.wSide * 0.9);
    const prevY = this.camY;
    this.camY = snap ? yT : damp(this.camY, yT, yT > this.camY ? 2.6 : this.wBowl > 0.5 ? 4 : 3.2, dt);
    // follows him down into a bowl, never plunging
    if (!snap && this.wBowl > 0.5) this.camY = Math.max(this.camY, prevY - 3.2 * dt);
    let elev = Math.asin(clamp((this.camY - L.y) / D, -0.95, 0.95));
    elev = orbit ? 0.2 + this.userPitch : clamp(elev + this.userPitch, -0.32, 0.55); // never top-down
    if (this.wBowl > 0.01 && mode === 'ride' && !pinned && !orbit) {
      yawT = this.bodySideOn(yawT, elev, s.up, this.wBowl * (1 - smoothstep(0.15, 0.5, Math.abs(this.userYaw))));
    }

    // ---- clearance: walls / ramps blocking the view now or within ~0.3 s (riding past a wall end, a bowl wall curving
    // in behind the camera): swing out or rise to a clear direction early; pulling the boom in is the last resort
    const auto = !pinned && !orbit; // test views (camYaw / orbit) keep their exact angle
    const Lp = this.aheadOf(L, s.vel);
    const want = yawT + this.avoid, wantE = Math.min(elev + this.avoidE, Math.max(elev, MAX_ELEV));
    let avoidT = auto ? this.avoid : 0, riseT = auto ? this.avoidE : 0;
    if (auto && (this.clear2(L, Lp, want, wantE, D + 0.3) < D * 0.8 || this.colS.x < D - 0.1
      || Math.abs(this.avoid) > 0.01 || this.avoidE > 0.01)) {
      let best = -1e9;
      for (const e of AVOID_RISE) {
        const el = Math.min(elev + e, Math.max(elev, MAX_ELEV));
        if (e && el < elev + 0.5 * e) break; // already about as high as it may go
        for (const o of AVOID_YAW) {
          const c = this.clear2(L, Lp, yawT + o, el, D + 0.3);
          let score = Math.min(c, D) / D - 0.22 * Math.abs(o) - 0.3 * e + (o === this.avoidPick && e === this.avoidPickE ? 0.06 : 0);
          // crossing to the other side would sweep the camera through the blocked view
          if (o * this.avoid < 0 && Math.abs(this.avoid) > 0.15) score -= 0.3;
          if (score > best) { best = score; avoidT = o; riseT = e; }
        }
        if (best > 0.9) break;
      }
      this.avoidPick = avoidT; this.avoidPickE = riseT;
    }
    // escape an obstruction quickly, ease back behind the skater slowly
    this.avoid = snap ? avoidT : damp(this.avoid, avoidT, Math.abs(avoidT) < Math.abs(this.avoid) ? 1.5 : 4, dt);
    this.avoidE = snap ? riseT : damp(this.avoidE, riseT, riseT < this.avoidE ? 1.2 : 3, dt);
    if (auto) elev = Math.min(elev + this.avoidE, Math.max(elev, MAX_ELEV));
    const yawGoal = yawT + this.avoid;
    // the heading follow is damped; the player's look offset goes on top as is
    const autoGoal = yawGoal - this.userYaw, a0 = this.autoYaw;
    this.autoYaw = snap ? autoGoal : dampAngle(this.autoYaw, autoGoal, 5, dt);
    if (!snap && this.wBowl > 0.01) {
      // in a bowl, coming round from ahead of him after a stall is a steady swing, not a whip
      const mx = lerp(40, 2.4, this.wBowl) * dt, dy = wrapAngle(this.autoYaw - a0);
      if (Math.abs(dy) > mx) this.autoYaw = a0 + Math.sign(dy) * mx;
    }
    this.autoYaw = wrapAngle(this.autoYaw);
    this.yaw = this.autoYaw + this.userYaw;

    const ce = Math.cos(elev), se = Math.sin(elev);
    const dir = _c.set(Math.sin(this.yaw) * ce, se, Math.cos(this.yaw) * ce);
    const clearNow = this.losThick(L, dir, D + 0.3);
    const clear = Lp ? Math.min(clearNow, this.losThick(Lp, dir, D + 0.3)) : clearNow;
    const allowed = Math.max(0.6, clear - 0.28);
    this.blockedT = snap ? 0 : clear < 0.8 * D ? this.blockedT + dt : Math.max(0, this.blockedT - 2 * dt);
    // the boom eases in (quicker while something already hides him) and back out: never a cut
    const cs = this.colS;
    if (snap) cs.set(allowed);
    else {
      if (cs.x > D + 0.02) { cs.x = D + 0.02; cs.v = Math.min(cs.v, 0); }
      cs.update(allowed, dt, allowed > cs.x ? 3.5 : clearNow - 0.28 < cs.x ? 12 : 7);
    }
    const d = Math.max(0.6, Math.min(D, cs.x));
    // a pulled-in boom must not crop him: widen the view so cap to board fits in about two thirds of the frame height
    const kS = smoothstep(0.05, 0.6, D - d);
    const fovC = kS > 0 ? Math.min(Math.max(this.fovS.x, 80), (360 / Math.PI) * Math.atan(1.3 / d)) : 0;
    const fov = Math.max(this.fovS.x, lerp(this.fovS.x, fovC, kS));
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const tHf = Math.tan((fov * Math.PI) / 360);
    this.pos.copy(L).addScaledVector(dir, d);
    this.pitch = elev; this.dist = d;
    const inf = this.info;
    inf.side = this.wSide; inf.pend = this.wPend; inf.swing = swing; inf.avoid = this.avoid; inf.rise = this.avoidE; inf.wantD = D; inf.d = d;
    inf.clear = clear; inf.clear0 = clearNow; inf.fov = fov; inf.floor = fl; inf.yT = yT; inf.elev = elev; inf.bowl = !!bowl;
    inf.bw = this.wBowl; inf.carve = this.carveW; inf.drop = drop; inf.base = base; inf.goal = yawGoal;

    // keep a margin from walls beside the camera and stay above the local ground (both eased: no snaps)
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const push = _f.set(0, 0, 0);
    for (const sg of [1, -1]) {
      _d.set(rx * sg, 0, rz * sg);
      const h = this.ray(this.pos, _d, 1.3);
      if (h && Math.abs(h.normal.y) < 0.5) push.addScaledVector(_d, h.distance - 1.3);
    }
    if (snap) this.wallPush.copy(push); else this.wallPush.lerp(push, 1 - Math.exp(-12 * dt));
    this.pos.add(this.wallPush);
    _a.set(this.pos.x, Math.max(this.pos.y, L.y) + 0.5, this.pos.z);
    const g = this.ray(_a, DOWN, _a.y - this.pos.y + 3);
    const lift = g ? Math.max(0, g.point.y + 0.3 - this.pos.y) : 0;
    this.groundLift = snap ? lift : Math.max(damp(this.groundLift, lift, 12, dt), lift - 0.2);
    this.pos.y += this.groundLift;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const k = this.shake * this.shake * 0.06;
      this.pos.x += Math.sin(this.time * 51) * k; this.pos.y += Math.sin(this.time * 67) * k;
    }
    cam.position.copy(this.pos);
    cam.lookAt(L);
    if (!orbit) {
      // composition: skater centre just below the middle of the frame (centred while the boom is pulled in)
      cam.rotateX(Math.atan((portrait ? 0.11 : 0.15) * tHf * (1 - kS)));
      this.frameGuard(s, focus, tHf, down, dt, snap);
    } else this.guardS.set(0);
  }

  /** keep the board (with a little ground under it) and the head inside the frame: an eased extra pitch */
  private frameGuard(s: CamSubject, focus: Vector3, tH: number, down: boolean, dt = 0, snap = true) {
    const cam = this.cam;
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const lo = Math.atan(0.8 * tH), hi = Math.atan(0.9 * tH);
    let want = 0;
    const vb = _a.copy(s.pos).applyMatrix4(inv);
    if (vb.z <= -0.3) {
      const ab = Math.atan2(vb.y, -vb.z);
      if (ab < -lo) want = ab + lo;
      else if (!down) {
        const vh = _b.copy(focus).addScaledVector(s.up, 0.95).applyMatrix4(inv);
        if (vh.z <= -0.3) { const ah = Math.atan2(vh.y, -vh.z); if (ah > hi) want = Math.min(ah - hi, ab + lo); }
      }
    }
    if (snap) this.guardS.set(want); else this.guardS.update(want, dt);
    if (Math.abs(this.guardS.x) > 1e-6) cam.rotateX(this.guardS.x);
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

  /** where the look target will be in ~0.3 s, kept in free space (a ramp or wall ahead stops it short) */
  private aheadOf(L: Vector3, vel: Vector3): Vector3 | null {
    const a = _g.set(vel.x, 0, vel.z);
    let len = a.length() * 0.3;
    if (len < 0.15) return null;
    a.normalize();
    len = Math.min(len, 2);
    const h = this.ray(L, a, len + 0.3);
    if (h) len = h.distance - 0.3;
    return len < 0.15 ? null : _h.copy(L).addScaledVector(a, len);
  }

  /** clear boom length from the look target now and from where it will be shortly */
  private clear2(L: Vector3, Lp: Vector3 | null, yaw: number, elev: number, max: number) {
    const c = this.losClear(L, yaw, elev, max);
    return Lp && c > 0.3 * max ? Math.min(c, this.losClear(Lp, yaw, elev, max)) : c;
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

  private inPoly(P: { x: number; z: number }[], x: number, z: number) {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      if ((P[i].z > z) !== (P[j].z > z) && x < ((P[j].x - P[i].x) * (z - P[i].z)) / (P[j].z - P[i].z) + P[i].x) inside = !inside;
    }
    return inside;
  }

  private bowlAt(x: number, z: number): Bowl | null {
    for (const b of this.bowls) if (this.inPoly(b.poly, x, z)) return b;
    return null;
  }

  /** nearest bowl coping within maxOut outside it: signed distance (+ inside) and the inward normal there */
  private bowlEdge(x: number, z: number, maxOut: number): BowlEdge | null {
    let best: BowlEdge | null = null;
    for (const b of this.bowls) {
      if (x < b.minX - maxOut || x > b.maxX + maxOut || z < b.minZ - maxOut || z > b.maxZ + maxOut) continue;
      const P = b.poly;
      let md = 1e9, qx = 0, qz = 0, ex = 1, ez = 0;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const ax = P[j].x, az = P[j].z, sx = P[i].x - ax, sz = P[i].z - az;
        const l2 = sx * sx + sz * sz;
        const t = l2 > 0 ? clamp(((x - ax) * sx + (z - az) * sz) / l2, 0, 1) : 0;
        const cx = ax + sx * t, cz = az + sz * t;
        const dd = (x - cx) * (x - cx) + (z - cz) * (z - cz);
        if (dd < md) { md = dd; qx = cx; qz = cz; ex = sx; ez = sz; }
      }
      const inside = this.inPoly(P, x, z), dist = Math.sqrt(md);
      const d = inside ? dist : -dist;
      if (d < -maxOut || (best && d < best.d)) continue;
      let nx: number, nz: number;
      if (dist > 1e-3) { nx = (x - qx) / dist; nz = (z - qz) / dist; if (!inside) { nx = -nx; nz = -nz; } }
      else {
        const l = Math.hypot(ex, ez) || 1;
        nx = -ez / l; nz = ex / l;
        if ((b.cx - x) * nx + (b.cz - z) * nz < 0) { nx = -nx; nz = -nz; }
      }
      best = { b, d, nx, nz };
    }
    return best;
  }

  /** 0..1: rolling on the deck toward a bowl's coping (under about a second away), or still high on its wall right
   *  after coming in over it */
  private dropInAhead(s: CamSubject, hv: number, e: BowlEdge | null) {
    if (!e || hv < 0.8 || s.mode === 'grind') return 0;
    const vin = s.vel.x * e.nx + s.vel.z * e.nz;
    if (e.d <= 0) {
      if (s.mode !== 'ride' || s.up.y < 0.9 || Math.abs(s.pos.y - e.b.lipY) > 0.35 || vin < 0.8 || vin < 0.6 * hv) return 0;
      return 1 - smoothstep(0.5, 1.1, -e.d / vin);
    }
    if (this.time - this.dropT > 0.4) return 0;
    return 1 - smoothstep(0.7, 1.5, e.b.lipY - s.pos.y);
  }

  /** yaw at least ~60 degrees off his body line (body axis n): on a steep bowl wall he leans toward the bowl's middle,
   *  and a camera there looks down the length of his body */
  private bodySideOn(yaw: number, elev: number, n: Vector3, w: number) {
    const nh = Math.hypot(n.x, n.z);
    if (nh < 0.2 || w < 1e-3) return yaw;
    const K = (0.45 - n.y * Math.sin(elev)) / (nh * Math.cos(elev));
    if (K >= 1) return yaw;
    const min = Math.acos(Math.max(-1, K));
    const phi = Math.atan2(n.x, n.z);
    const d = wrapAngle(yaw - phi), c = wrapAngle(this.yaw - phi);
    // a goal on the other side of his body line is reached around his back, never by sweeping across his front
    const crosses = d * c < 0 && Math.abs(d) + Math.abs(c) < Math.PI;
    if (Math.abs(d) >= min && !crosses) return yaw;
    const sg = Math.abs(c) > 0.02 ? Math.sign(c) : Math.sign(d) || 1;
    return phi + lerp(d, sg * min, w * smoothstep(0.2, 0.4, nh));
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

  /** side-on direction perpendicular to `axis`: the clearer side, else the one nearer the camera. keepSide (inside a
   *  bowl): always the camera's side, since swapping sides on a wall sweeps across his front or through the wall */
  private choosePendSide(focus: Vector3, axis: Vector3, keepSide = false) {
    const yA = Math.atan2(-axis.z, axis.x), yB = yA + Math.PI;
    let pick = Math.abs(wrapAngle(yA - this.yaw)) <= Math.abs(wrapAngle(yB - this.yaw)) ? yA : yB;
    if (!keepSide) {
      const a = this.clearance(focus, yA, 7), b = this.clearance(focus, yB, 7);
      if (Math.abs(a - b) > 1.5) pick = a > b ? yA : yB;
    }
    this.pendDir.set(Math.sin(pick), 0, Math.cos(pick));
  }

  private alignPendSide(axis: Vector3) {
    let px = -axis.z, pz = axis.x;
    if (px * this.pendDir.x + pz * this.pendDir.z < 0) { px = -px; pz = -pz; }
    this.pendDir.set(px, 0, pz);
  }
}
