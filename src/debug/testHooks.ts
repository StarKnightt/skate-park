import { Vector3 } from 'three';
import type { Game } from '../game';
import { PRESETS } from '../render/timeOfDay';
import { settings, MOUSE_RAD_PER_COUNT } from '../core/settings';

interface Step { at: number; down?: string[]; up?: string[] }

/**
 * window.__skate test API (enabled with ?debug or ?test):
 *  teleport(x,y,z,headingDeg,speed) · setTime(nameOrIndex, instant) · script(steps) · hold(codes) · release(codes)
 *  manual(true) + advance(frames, dt) for deterministic frame-stepped capture · shot(landmark) · free() · orbit(speed,dist,h)
 *  state() (physics) · view() (interpolated state the frame draws) · frame() (steps / acc / alpha of the last frame)
 *  look(dx, dy) (raw mouse counts) · input · pause(on) · hud(bool) · touch(bool)
 */
export function installTestHooks(g: Game) {
  const held = new Set<string>();
  let steps: Step[] = [];
  let scriptStart = 0;
  g.scriptInput = (t) => {
    if (steps.length) {
      const rel = t - scriptStart;
      while (steps.length && steps[0].at <= rel) {
        const s = steps.shift()!;
        s.down?.forEach((c) => held.add(c));
        s.up?.forEach((c) => held.delete(c));
      }
    }
    if (!held.size) return null;
    const o: Record<string, boolean> = {};
    held.forEach((c) => (o[c] = true));
    return o;
  };
  const api = {
    game: g,
    get ready() { return g.ready; },
    teleport(x: number, y: number, z: number, headingDeg = 180, speed = 0) {
      g.respawn(new Vector3(x, y, z), (headingDeg * Math.PI) / 180);
      if (speed) { g.physics.vel.copy(g.physics.fwd).multiplyScalar(speed); g.physics.speed = speed; g.resnap(); }
      return api.state();
    },
    setTime(n: string | number, instant = true) {
      g.setTime(typeof n === 'number' ? n : g.tod.byName(n), instant);
    },
    script(s: Step[]) { steps = [...s].sort((a, b) => a.at - b.at); scriptStart = g.simTime; held.clear(); },
    hold(codes: string[]) { codes.forEach((c) => held.add(c)); },
    release(codes?: string[]) { if (!codes) held.clear(); else codes.forEach((c) => held.delete(c)); },
    manual(on: boolean) { g.manualClock = on; g.lastFrame = 0; },
    /** frame-stepped: input + simulate per frame (never paused), one render at the end */
    advance(frames = 1, dt = 1 / 30, render = true) {
      for (let i = 0; i < frames; i++) { g.frameInput(dt); g.simulate(dt); }
      if (render) g.render(dt);
      return g.simTime;
    },
    /** raw mouse-look counts, as with the pointer locked (dx > 0 looks right, dy > 0 looks down) */
    look(dx: number, dy: number) {
      const k = MOUSE_RAD_PER_COUNT * settings.mouseSens;
      g.rig.look(-dx * k, (settings.invertY ? -1 : 1) * dy * k * 0.8);
    },
    get input() { return g.input; },
    pause(on: boolean) { g.setPaused(on, true); return g.paused; },
    /** what the last frame drew: physics steps run, leftover time, interpolation fraction */
    frame() { return { steps: g.frameSteps, acc: +g.acc.toFixed(5), alpha: +g.frameAlpha.toFixed(4), t: +g.simTime.toFixed(4), paused: g.paused }; },
    /** view(px,py,pz,lx,ly,lz): fixed camera; view(): the interpolated state the last frame drew */
    view(px?: number, py = 0, pz = 0, lx = 0, ly = 0, lz = 0) {
      if (px !== undefined) { g.rig.override = { pos: new Vector3(px, py, pz), look: new Vector3(lx, ly, lz) }; return null; }
      const v = g.view, r = (a: number[]) => a.map((x) => +x.toFixed(4));
      return {
        mode: v.mode, pos: r(v.pos.toArray()), vel: r(v.vel.toArray()), up: r(v.up.toArray()), fwd: r(v.fwd.toArray()),
        speed: +v.speed.toFixed(4), time: +v.time.toFixed(5), alpha: +g.frameAlpha.toFixed(4), steps: g.frameSteps,
        flipP: v.flip ? +v.flipProgress().toFixed(4) : null, pushT: +v.pushT.toFixed(4), kickturnT: +v.kickturn.t.toFixed(4),
        airTime: +v.airTime.toFixed(4), tti: v.predicted ? +v.predicted.tti.toFixed(4) : null, steerS: +v.steerS.toFixed(4),
      };
    },
    shot(name: string) {
      const l = g.landmarks[name];
      if (!l) return Object.keys(g.landmarks);
      g.rig.override = { pos: l.pos.clone(), look: l.look.clone() };
      return true;
    },
    free() { g.rig.override = null; g.rig.orbitMode = null; },
    orbit(speed = 0.6, dist = 3.2, height = 0.2) { g.rig.orbitMode = { t: 0, speed, dist, height }; },
    camYaw(rad: number, pitch = 0) { g.rig.userYaw = rad; g.rig.userPitch = pitch; g.rig.idleT = -1e9; },
    camDist(d: number | null) { g.rig.distOverride = d; },
    snapCam() { g.rig.snap(g.physics.pos, Math.atan2(g.physics.vel.x || g.physics.fwd.x, g.physics.vel.z || g.physics.fwd.z)); },
    hud(on: boolean) { (document.querySelector('.hud') as HTMLElement).style.display = on ? '' : 'none'; },
    touch(on: boolean) { g.touch.show(on); },
    state() {
      const p = g.physics;
      return {
        mode: p.mode, pos: p.pos.toArray().map((v) => +v.toFixed(3)), vel: p.vel.toArray().map((v) => +v.toFixed(3)),
        speed: +p.speed.toFixed(3), up: p.up.toArray().map((v) => +v.toFixed(3)), fakie: p.fakie, air: +p.airTime.toFixed(2),
        grind: p.grind?.name ?? null, manual: p.manual.active, flip: p.flip?.kind ?? null, phase: g.skater.phase,
        t: +g.simTime.toFixed(3), time: PRESETS[g.tod.index].name, quality: g.quality,
      };
    },
    events() { const e = g.eventLog.slice(); g.eventLog.length = 0; return e; },
    feetError() {
      // distance from each sole to the deck top (for glued-feet checks)
      const sk = g.skater;
      const out: Record<string, number> = {};
      for (const side of ['Left', 'Right']) {
        const foot = sk.b.get(side + 'Foot')!.bone.getWorldPosition(new Vector3());
        const up = new Vector3(0, 1, 0).applyQuaternion(g.board.root.quaternion);
        const deck = g.board.root.position.clone().addScaledVector(up, 0.116);
        out[side] = +foot.sub(deck).dot(up).toFixed(4);
      }
      return out;
    },
  };
  (window as any).__skate = api;
}
