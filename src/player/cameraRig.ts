import { PerspectiveCamera, Vector3 } from 'three';
import type { CollisionWorld } from '../world/collision';
import { clamp, dampAngle, wrapAngle, SpringV3, Spring } from '../core/util';

/** Third person follow camera with orbit offsets, collision pull-in and speed framing. */
export class CameraRig {
  yaw = Math.PI; // camera position angle around the target (0 = camera on +Z side)
  pitch = 0.2;
  dist = 3.6;
  userYaw = 0; userPitch = 0;
  idleT = 0;
  target = new SpringV3(9);
  fovS = new Spring(58, 3);
  shake = 0;
  private heading = 0;
  private tmp = new Vector3();
  private pos = new Vector3();
  override: null | { pos: Vector3; look: Vector3 } = null;
  orbitMode: null | { t: number; speed: number; dist: number; height: number } = null;
  distOverride: number | null = null;

  constructor(public cam: PerspectiveCamera, private world: CollisionWorld) {}

  snap(targetPos: Vector3, heading: number) {
    this.target.set(targetPos);
    this.heading = heading;
    this.yaw = heading + Math.PI;
    this.userYaw = 0; this.userPitch = 0;
  }

  addOrbit(dx: number, dy: number) {
    this.userYaw -= dx * 0.006;
    this.userPitch = clamp(this.userPitch + dy * 0.004, -0.25, 0.9);
    this.idleT = 0;
  }
  recenter() { this.userYaw = 0; this.userPitch = 0; }

  update(dt: number, focus: Vector3, vel: Vector3, speed: number, mode: string, steepness: number) {
    if (this.override) {
      this.cam.position.copy(this.override.pos);
      this.cam.lookAt(this.override.look);
      return;
    }
    const hv = Math.hypot(vel.x, vel.z);
    // heading follows horizontal travel; hold it on vert walls / when slow
    if (hv > 1.2 && mode !== 'bail' && steepness < 0.6) this.heading = dampAngle(this.heading, Math.atan2(vel.x, vel.z), mode === 'air' ? 1.2 : 2.6, dt);
    this.idleT += dt;
    if (this.idleT > 2.5 && hv > 1.5) {
      this.userYaw *= Math.exp(-0.8 * dt);
      this.userPitch *= Math.exp(-0.8 * dt);
    }
    if (this.orbitMode) {
      this.orbitMode.t += dt;
      this.userYaw += this.orbitMode.speed * dt;
    }
    const baseYaw = this.heading + Math.PI;
    this.yaw = dampAngle(this.yaw, baseYaw + this.userYaw, 6, dt);
    const tgtPitch = 0.2 + this.userPitch + (mode === 'air' ? 0.06 : 0) + clamp(steepness * 0.25, 0, 0.25);
    this.pitch += (tgtPitch - this.pitch) * (1 - Math.exp(-4 * dt));
    const wantDist = this.distOverride ?? ((this.orbitMode ? this.orbitMode.dist : 3.5 + clamp(speed / 9, 0, 1) * 1.3) + (mode === 'air' ? 0.4 : 0));
    this.dist += (wantDist - this.dist) * (1 - Math.exp(-2.5 * dt));
    // smoothed focus (lag a little behind the skater for weight)
    const f = this.tmp.copy(focus);
    f.y += this.orbitMode ? this.orbitMode.height : 0.35;
    this.target.update(f, dt, mode === 'bail' ? 4 : 10);
    const t = this.target.x;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    // collision: pull the camera in front of walls
    let d = this.dist;
    const hit = this.world.raycast(t, dir, d + 0.3);
    if (hit) d = Math.max(0.9, hit.distance - 0.3);
    this.pos.copy(t).addScaledVector(dir, d);
    // never below the local ground
    const g = this.world.raycast(this.tmp.copy(this.pos).add(new Vector3(0, 2, 0)), new Vector3(0, -1, 0), 2.5);
    if (g && this.pos.y < g.point.y + 0.35) this.pos.y = g.point.y + 0.35;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * this.shake * 0.06;
      this.pos.x += Math.sin(performance.now() * 0.051) * s; this.pos.y += Math.sin(performance.now() * 0.067) * s;
    }
    this.cam.position.copy(this.pos);
    this.cam.lookAt(t);
    this.fovS.update(56 + clamp(speed / 10, 0, 1) * 8, dt);
    if (Math.abs(this.cam.fov - this.fovS.x) > 0.01) { this.cam.fov = this.fovS.x; this.cam.updateProjectionMatrix(); }
    void wrapAngle;
  }
}
