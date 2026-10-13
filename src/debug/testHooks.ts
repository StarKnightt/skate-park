import { Vector3 } from 'three';
import type { Game } from '../game';
import { PRESETS } from '../render/timeOfDay';

interface Step { at: number; down?: string[]; up?: string[] }

/**
 * window.__skate test API (enabled with ?debug or ?test):
 *  teleport(x,y,z,headingDeg,speed) · setTime(nameOrIndex, instant) · script(steps) · hold(codes) · release(codes)
 *  manual(true) + advance(frames, dt) for deterministic frame-stepped capture · shot(landmark) · free() · orbit(speed,dist,h)
 *  state() · hud(bool) · touch(bool)
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
      if (speed) g.physics.vel.copy(g.physics.fwd).multiplyScalar(speed);
      return api.state();
    },
    setTime(n: string | number, instant = true) {
      const i = typeof n === 'number' ? n : g.tod.byName(n);
      g.tod.set(i, instant);
      if (instant) { g.applyEnv(g.tod.cur); }
      g.hud.setTimeLabel(PRESETS[g.tod.index].name);
    },
    script(s: Step[]) { steps = [...s].sort((a, b) => a.at - b.at); scriptStart = g.simTime; held.clear(); },
    hold(codes: string[]) { codes.forEach((c) => held.add(c)); },
    release(codes?: string[]) { if (!codes) held.clear(); else codes.forEach((c) => held.delete(c)); },
    manual(on: boolean) { g.manualClock = on; g.lastFrame = 0; },
    advance(frames = 1, dt = 1 / 30, render = true) {
      for (let i = 0; i < frames; i++) g.simulate(dt);
      if (render) g.render(dt);
      return g.simTime;
    },
    shot(name: string) {
      const l = g.landmarks[name];
      if (!l) return Object.keys(g.landmarks);
      g.rig.override = { pos: l.pos.clone(), look: l.look.clone() };
      return true;
    },
    view(px: number, py: number, pz: number, lx: number, ly: number, lz: number) {
      g.rig.override = { pos: new Vector3(px, py, pz), look: new Vector3(lx, ly, lz) };
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
