// Pass-4 media (M1): the pass-03 set (same names, cameras, numbering) + the pass-03 critique's needs-capture clips 37-42
// and the #68-#73 proofs. Screens (screens/*.png) + frame-stepped clips (frames/<clip>/f####.jpg + events.json + meta.json).
// bash tools/heavy.sh M1 node tools/capture/run.mjs tools/capture/media4.mjs --nohmr --out E:/shots/skate-park/pass-04 --log <log>
// ONLY=<comma list>, default everything:
//   stills: close noon chars capface wide tod h55 extra kiosk people hair h62 bush grip idle handsplay h70
//   clips:  clip01 clip02 clip04 clip07 clip09 clip10 clip12..clip17 clip20..clip25 (pass-2 recipes, same numbering)
//           clip26..clip36 (pass-3), clip37..clip42 (pass-4 needs-capture)
// Key timelines + teleports of the physics-driven segments live in media4_cases.mjs (checked headless by media4_sim.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { CASES as C, FLIP, KEY, CARVE } from './media4_cases.mjs';

const adv = (c, n = 1, render = true) => c.eval(([k, r]) => window.__skate.advance(k, 1 / 30, r), [n, render]);
const render = (c) => c.eval(() => window.__skate.game.render(1 / 30));
const S = (c, n) => c.shot(`screens/${n}.png`);
/** still without the HUD (trick popups) even while a clip records with the HUD on */
const SH = async (c, n) => {
  await c.api('hud', false);
  await S(c, n);
  await c.api('hud', true);
};
const plainCam = (c) => c.eval(() => {
  const s = window.__skate; s.free();
  const r = s.game.rig; r.userYaw = 0; r.userPitch = 0; r.idleT = 0; r.distOverride = null;
});
const pinCam = async (c, yaw, dist, pitch = 0) => { await c.api('snapCam'); await c.api('camYaw', yaw, pitch); await c.api('camDist', dist); };
const setFov = (c, f) => c.eval((f) => { const cam = window.__skate.game.camera; cam.fov = f; cam.updateProjectionMatrix(); }, f);
const view = async (c, v, fov = 56) => { await c.api('view', ...v); await setFov(c, fov); await adv(c, 2); };
/** release scripted keys and let the input see it (a released Space would otherwise pop an ollie after the next teleport) */
const clearInput = async (c) => { await c.api('script', []); await c.api('release'); await adv(c, 1, false); };
const TOD = ['golden', 'sunset', 'blue_hour', 'noon'];

/** advance (no render) until a page-side condition over (g, ph, sk) holds; then render. Returns frames advanced or -1. */
async function until(c, cond, max = 120) {
  for (let i = 0; i <= max; i++) {
    const ok = await c.eval((src) => { const g = window.__skate.game; return !!new Function('g', 'ph', 'sk', `return (${src});`)(g, g.physics, g.skater); }, cond);
    if (ok) { await render(c); return i; }
    await adv(c, 1, false);
  }
  await render(c);
  return -1;
}

// ------------------------------------------------------------------------------------------ scripted cameras (page side)
function installCam() {
  const s = window.__skate, g = s.game, V = g.physics.pos.constructor;
  const mem = { dir: null };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (key, v, k, reset) => {
    if (!mem[key] || reset) mem[key] = v.clone(); else mem[key].lerp(v, 1 - Math.exp(-k / 30));
    return mem[key].clone();
  };
  const groundY = (x, z) => { const h = g.physics.world.raycast(new V(x, 4, z), new V(0, -1, 0), 12); return h ? h.point.y : -2.3; };
  const head = (i) => g.scenery.people.items[i].holder.getObjectByName('mixamorigHead').getWorldPosition(new V());
  window.__mcam = (spec) => {
    const ph = g.physics, cam = g.camera;
    const hips = g.skater.hipsWorld(new V());
    const src = spec.track === 'hips' ? hips : ph.pos;
    let pos, look;
    if (spec.kind === 'side') {
      // fixed world direction from the start heading: angle 0 = toe side (the rider faces it), +90 = ahead
      const h = (spec.heading * Math.PI) / 180, fwd = new V(Math.sin(h), 0, Math.cos(h));
      const a = ((spec.angle ?? 0) * Math.PI) / 180;
      const dir = new V(-fwd.z, 0, fwd.x).multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
      if (spec.deckY) {
        // drop-ins: level with the deck, sinking with the board once it is below the coping
        const b = g.board.root.position;
        if (mem.deckY == null || spec.reset) mem.deckY = ph.pos.y;
        const gy = mem.deckY;
        look = new V(b.x, 0, b.z).addScaledVector(fwd, spec.lead ?? 0);
        look.y = Math.max(gy - 1.6, Math.min(gy + spec.lookH, (b.y + hips.y) / 2));
        pos = look.clone().addScaledVector(dir, spec.dist);
        pos.y = Math.max(look.y + 0.2, gy + spec.h - 0.5 * Math.max(0, gy - b.y));
      } else {
        const gy = spec.trackY ? ph.pos.y : (spec.groundY ?? 0);
        look = new V(src.x, gy + spec.lookH, src.z).addScaledVector(fwd, spec.lead ?? 0);
        if (spec.axis) { // track only along one world axis (x or z), the other stays fixed
          if (spec.axis === 'x') look.z = spec.fixed; else look.x = spec.fixed;
        }
        pos = look.clone().addScaledVector(dir, spec.dist); pos.y = gy + spec.h;
        if (spec.lookY != null) look.y = spec.lookY;
      }
    } else if (spec.kind === 'bowl') {
      // inside a rounded-rect bowl: camera between the rider and the bowl's core rectangle (side-on to the wall he rides)
      const [x0, x1, z0, z1] = spec.core;
      const qx = Math.min(x1, Math.max(x0, ph.pos.x)), qz = Math.min(z1, Math.max(z0, ph.pos.z));
      const d = new V(qx - ph.pos.x, 0, qz - ph.pos.z);
      if (d.length() < 0.5) d.set(spec.center[0] - ph.pos.x, 0, spec.center[1] - ph.pos.z);
      d.normalize();
      if (!mem.dir || spec.reset) mem.dir = d.clone(); else mem.dir.lerp(d, 1 - Math.exp(-3.5 / 30)).normalize();
      look = hips.clone();
      look.y = spec.floor + 0.25 + 0.75 * (hips.y - spec.floor);
      pos = new V(ph.pos.x, 0, ph.pos.z).addScaledVector(mem.dir, spec.dist);
      pos.y = spec.floor + spec.h + spec.hk * (ph.pos.y - spec.floor);
    } else if (spec.kind === 'wall') {
      // ahead of the rider along the bowl wall and a little out from it (side-on to the board on the wall), kept
      // above the bowl surface; smoothed like a camera operator walking with him
      const [x0, x1, z0, z1] = spec.core;
      const inn = new V(clamp(ph.pos.x, x0, x1) - ph.pos.x, 0, clamp(ph.pos.z, z0, z1) - ph.pos.z);
      if (inn.length() < 0.3) inn.set(spec.center[0] - ph.pos.x, 0, spec.center[1] - ph.pos.z);
      inn.normalize();
      const t = new V(-inn.z, 0, inn.x);
      const v = ph.vel.clone().setY(0);
      if (v.length() < 0.5) v.copy(ph.fwd).setY(0);
      if (t.dot(v) < 0) t.negate();
      const tt = smooth('wt', t, 3, spec.reset).normalize();
      const p = ph.pos.clone().addScaledVector(tt, spec.ahead).addScaledVector(inn, spec.out);
      p.y = Math.max(hips.y + spec.dy, groundY(p.x, p.z) + (spec.clear ?? 0.5));
      pos = smooth('wp', p, spec.k ?? 4, spec.reset);
      look = smooth('wl', hips.clone().lerp(g.board.root.position, 0.35), 8, spec.reset);
    } else if (spec.kind === 'dolly') {
      // slides along one world axis level with the rider on that axis, fixed elsewhere; looks at him
      const tv = spec.axis === 'x' ? ph.pos.x : ph.pos.z;
      const want = clamp(tv + (spec.offset ?? 0), spec.range[0], spec.range[1]);
      if (mem.dolly == null || spec.reset) mem.dolly = want; else mem.dolly += (want - mem.dolly) * (1 - Math.exp(-(spec.k ?? 5) / 30));
      pos = new V(...spec.pos);
      if (spec.axis === 'x') pos.x = mem.dolly; else pos.z = mem.dolly;
      look = smooth('dl', hips.clone().lerp(g.board.root.position, 0.35), 8, spec.reset);
    } else if (spec.kind === 'pan') {
      // fixed camera panning (smoothed) to keep the rider in view; hold blends towards a fixed look point
      pos = new V(...spec.pos);
      const tgt = hips.clone().lerp(g.board.root.position, 0.3).lerp(new V(...spec.look), spec.hold ?? 0);
      look = smooth('pl', tgt, spec.k ?? 6, spec.reset);
    } else if (spec.kind === 'rel') {
      // world-space offset from the hips, looking at hips + lookOff (absolute heights optional)
      pos = hips.clone().add(new V(...spec.off));
      look = hips.clone().add(new V(...spec.lookOff));
      if (spec.y != null) pos.y = spec.y;
      if (spec.lookY != null) look.y = spec.lookY;
    } else if (spec.kind === 'group') {
      // a seated group of people seen from the front: midpoint of their heads, facing of person `ref`
      if (!mem.grp || spec.reset) {
        const hs = spec.idx.map(head);
        const mid = hs.reduce((a, b) => a.add(b), new V()).multiplyScalar(1 / hs.length);
        const ry = g.scenery.people.items[spec.ref ?? spec.idx[0]].holder.rotation.y + ((spec.yaw ?? 0) * Math.PI) / 180;
        const fwd = new V(Math.sin(ry), 0, Math.cos(ry));
        const lk = mid.clone().add(new V(0, spec.lookDy ?? -0.15, 0));
        const ps = lk.clone().addScaledVector(fwd, spec.dist); ps.y = mid.y + (spec.dy ?? 0.1);
        mem.grp = { pos: ps, look: lk };
      }
      pos = mem.grp.pos.clone(); look = mem.grp.look.clone();
    } else if (spec.kind === 'vert') {
      const x = Math.min(spec.xr[1], Math.max(spec.xr[0], ph.pos.x));
      pos = new V(x, spec.h0 + spec.hk * hips.y, spec.z);
      look = new V(ph.pos.x, spec.l0 + spec.lk * hips.y, spec.lz);
    } else if (spec.kind === 'person') {
      const p = g.scenery.people.items[spec.idx];
      const hp = p.holder.position, ry = p.holder.rotation.y;
      const fwd = new V(Math.sin(ry), 0, Math.cos(ry));
      if (!mem.pf || spec.reset) mem.pf = fwd.clone(); else mem.pf.lerp(fwd, 1 - Math.exp(-1.5 / 30)).normalize();
      const lat = new V(mem.pf.z, 0, -mem.pf.x);
      look = new V(hp.x, hp.y + spec.lookH, hp.z);
      pos = look.clone().addScaledVector(mem.pf, spec.ahead).addScaledVector(lat, spec.side);
      pos.y = hp.y + spec.h;
    } else {
      pos = new V(...spec.pos); look = new V(...spec.look);
    }
    if (spec.fov && Math.abs(cam.fov - spec.fov) > 0.01) { cam.fov = spec.fov; cam.updateProjectionMatrix(); }
    cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
    s.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
  };
  /** leg spread (ankle to ankle) and how much the grip faces the camera (+1 = straight at it) */
  window.__probe = () => {
    const sk = g.skater, cam = g.camera;
    const p = (n) => sk.b.get(n).bone.getWorldPosition(new V());
    // the flip / pitch / lean live in board.deck.matrix (manual matrix), so read the deck's world matrix
    const mw = g.board.deck.matrixWorld, rot = mw.clone().extractRotation(mw);
    const up = new V(0, 1, 0).applyMatrix4(rot).normalize();
    const toCam = cam.position.clone().sub(new V().setFromMatrixPosition(mw)).normalize();
    return { spread: +p('LeftFoot').distanceTo(p('RightFoot')).toFixed(3), grip: +up.dot(toCam).toFixed(3) };
  };
}

/** one frame: simulate, place the scripted camera (or keep the game's follow camera), render; returns events + state */
function stepFrame(cam) {
  const s = window.__skate, g = s.game;
  if (cam) { s.advance(1, 1 / 30, false); window.__mcam(cam); g.render(1 / 30); } else s.advance(1, 1 / 30, true);
  const e = g.eventLog.slice(); g.eventLog.length = 0;
  const ph = g.physics;
  return { e, mode: ph.mode, phase: g.skater.phase, pos: ph.pos.toArray(), fwd: ph.fwd.toArray(), speed: ph.speed, t: g.simTime,
    dropin: ph.dropin ? ph.dropin.phase : null };
}

/**
 * Frame-stepped clip made of one or more segments (continuous frame numbers). Segment fields:
 *  setup() (teleport, time of day...), script, frames, skip (leading frames simulated but not saved),
 *  cam (spec | (i) => spec | null = game follow camera), onFrame(i, ctx) -> { frames?: newLength, script?: steps },
 *  still(i, st, ctx) -> screen name | null (may be async). meta.hud = false hides the HUD for the whole clip.
 */
async function record(c, name, segs, meta = {}) {
  const dir = path.join(c.out, 'frames', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ev = [], marks = [];
  const hudOn = meta.hud !== false;
  await c.api('hud', hudOn);
  let f = 0;
  for (const seg of segs) {
    await plainCam(c);
    await clearInput(c);
    await c.eval(() => window.__skate.game.hud.update(5)); // no trick popup left over from the previous clip
    await c.wait(250);
    if (seg.setup) await seg.setup();
    await adv(c, seg.preroll ?? 2, false);
    if (seg.script) await c.api('script', seg.script);
    await c.api('events');
    if (seg.label) marks.push({ frame: f, label: seg.label });
    const ctx = { st: null, data: {} };
    let lastPh = null, end = seg.frames;
    for (let i = 0; i < end; i++) {
      if (seg.onFrame) {
        const r = await seg.onFrame(i, ctx);
        if (r?.script) await c.api('script', r.script);
        if (r?.frames) end = r.frames;
      }
      let cam = typeof seg.cam === 'function' ? seg.cam(i) : seg.cam;
      if (cam && i === 0) cam = { ...cam, reset: true };
      const st = await c.eval(stepFrame, cam ?? null);
      ctx.st = st;
      if (i < (seg.skip ?? 0)) continue;
      for (const x of st.e) ev.push({ frame: f, ...x });
      if (st.phase !== lastPh) { if (lastPh) ev.push({ frame: f, t: +st.t.toFixed(2), type: 'phase', phase: st.phase, mode: st.mode }); lastPh = st.phase; }
      if (st.dropin !== ctx.lastDrop) { if (st.dropin) ev.push({ frame: f, t: +st.t.toFixed(2), type: 'dropinPhase', phase: st.dropin }); ctx.lastDrop = st.dropin; }
      await c.page.screenshot({ path: path.join(dir, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
      ctx.f = f;
      if (seg.still) {
        const r = await seg.still(i, st, ctx);
        // a still may carry several names (the same frame filed under a pass-03 name and a pass-04 proof name)
        for (const [k, n] of (r ? [].concat(r) : []).entries()) {
          if (k === 0) await (hudOn ? SH(c, n) : S(c, n));
          else fs.copyFileSync(path.join(c.out, 'screens', `${[].concat(r)[0]}.png`), path.join(c.out, 'screens', `${n}.png`));
          marks.push({ frame: f, still: n });
        }
      }
      f++;
    }
    await c.api('release');
  }
  await c.api('hud', true);
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(ev, null, 1));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ frames: f, marks, ...meta }, null, 1));
  const stills = {};
  for (const m of marks) if (m.still) stills[m.still] = m.frame;
  console.log('clip', name, f, 'frames | events', ev.filter((e) => e.type !== 'boardClack').map((e) => `${e.frame}:${e.type}${e.phase ? '=' + e.phase : ''}${e.quality ? ':' + e.quality : ''}`).join(' '),
    Object.keys(stills).length ? '| stills ' + JSON.stringify(stills) : '');
}

/** a media4_cases.mjs segment as record() fields (teleport, script, frames, skip, preroll) */
const seg = (k, i = 0, extra = {}) => {
  const s = C[k][i];
  return { frames: s.frames, ...(s.skip ? { skip: s.skip } : {}), ...(s.preroll != null ? { preroll: s.preroll } : {}), ...(s.script ? { script: s.script } : {}),
    setup: () => c_.api('teleport', ...s.tp), ...extra };
};
const sideCam = (heading, o = {}) => ({ kind: 'side', heading, angle: 0, dist: 2.9, h: 0.85, lookH: 0.9, fov: 50, track: 'board', ...o });
const BOWL_MAIN = { kind: 'bowl', core: [-27.5, -20.5, -1.5, 1.5], center: [-24, 0], floor: -2.3, dist: 3.1, h: 1.05, hk: 0.55, fov: 50 };
/** stills at segment-local frames i, named after the clip's global frame number */
const atFrames = (list, prefix) => (i, st, ctx) => (list.includes(i) ? `${prefix}_f${String(ctx.f).padStart(3, '0')}` : null);

/** wall bail into the half pipe's mural wall; once he is riding again he turns away from the wall and pushes off */
function wallBailSeg(cam, label, still) {
  return {
    label, frames: 480, cam, still,
    setup: () => c_.api('teleport', 10.5, 0, -9, 90, 7.5),
    onFrame: (i, ctx) => {
      const st = ctx.st, d = ctx.data;
      if (!st) return null;
      if (st.mode === 'bail') d.bailed = true;
      if (d.bailed && d.ride == null && st.mode === 'ride' && st.phase === 'ride') d.ride = i;
      if (d.ride != null && i === d.ride + 9 && !d.pushed) {
        d.pushed = true;
        const turn = st.fwd[0] > 0.2; // still facing the wall (+x): turning push
        console.log('  ride again at', d.ride, 'fwd', st.fwd.map((v) => v.toFixed(2)).join(','), turn ? 'turning push' : 'push');
        return { script: turn ? [{ at: 0, down: ['KeyW', 'KeyA'] }, { at: 1.1, up: ['KeyA'] }, { at: 2.4, up: ['KeyW'] }] : KEY('KeyW', 0, 2.2), frames: i + 125 };
      }
      return null;
    },
  };
}

/** #44: a flip filmed at board height; saves the frame of widest leg spread (pop+2..landing) as a still */
function boardHeightSeg(trick, key, tag, angle) {
  return {
    label: `${trick}: ${tag === 'side' ? 'side-on from the toe side' : 'front quarter (35 deg)'}, camera at board height`,
    frames: 46, setup: () => c_.api('teleport', 30, 0, 22, 180, 4.5),
    script: FLIP(0.3, key, 0.32),
    cam: { kind: 'side', heading: 180, angle, dist: 2.25, h: 0.42, lookH: 0.86, fov: 54, track: 'board', groundY: 0 },
    still: async (i, st, ctx) => {
      const d = ctx.data;
      if (st.e.some((e) => e.type === 'pop')) d.pop = i;
      if (st.e.some((e) => e.type === 'land') && d.pop != null) d.landed = true;
      if (d.pop == null || d.landed || i < d.pop + 2) return null;
      const p = await c_.eval(() => window.__probe());
      if (p.spread > (d.best ?? -1)) { d.best = p.spread; console.log(`  ${trick} ${tag} spread ${p.spread} at pop+${i - d.pop}`); return `h44_${trick}_peak_${tag}`; }
      return null;
    },
  };
}

/** #65 / #72 drop-in stills: set-up (stall frame 3, tail on the coping, nose up), nose passing level (pivot frame 5), nose
 *  down onto the wall (pivot frame 10), wheels on the wall (dropIn), crouch on the wall (dropIn + 5); `extra` adds pass-03
 *  names per beat; d counts the phase frames */
function dropStills(d, where, extra, i) {
  const beats = [d.stall === 3 && !d.s1 && (d.s1 = 1), d.pivot === 5 && !d.s2 && (d.s2 = 1), d.pivot === 10 && !d.s3 && (d.s3 = 1),
    d.done != null && i === d.done && !d.s4 && (d.s4 = 1), d.done != null && i === d.done + 5 && !d.s5 && (d.s5 = 1)];
  const names = [`h72_dropin_${where}_setup_nose_up`, `h72_dropin_${where}_pivot_level`, `h72_dropin_${where}_nose_down`, `h72_dropin_${where}_wheels_on_wall`, `h72_dropin_${where}_crouch`];
  const k = beats.findIndex(Boolean);
  return k < 0 ? null : [...(extra[k] ?? []), names[k]];
}

let c_ = null;

export default async function (c) {
  c_ = c;
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  await c.api('manual', true);
  await c.api('hud', false);
  await c.eval(installCam);
  await c.page.waitForFunction(() => window.__skate.game.scenery.people.group.children.length > 0, null, { timeout: 30000 })
    .catch(() => console.log('people not loaded'));
  await adv(c, 4);

  // ================================================================ (b) close-ups from the follow camera (pinned yaw, as pass-02)
  if (want('close')) {
    const trick = async (name, tp, script, cond, yaw, extra = 0, max = 90, dist = 2.0, pitch = 0.02) => {
      await clearInput(c);
      await c.api('teleport', ...tp);
      await pinCam(c, yaw, dist, pitch);
      await adv(c, 4);
      await c.api('script', script);
      const n = await until(c, cond, max);
      if (extra) { await adv(c, extra, false); await render(c); }
      await S(c, name);
      const st = await c.api('state');
      console.log('close', name, n, st.mode, st.phase, st.grind ?? '', st.flip ?? '');
      await c.api('release');
    };
    const T = (sec) => `g.simTime >= ${sec}`;
    let t0 = 0;
    const at = async () => { t0 = await c.eval(() => window.__skate.game.simTime); return t0; };
    await at(); await trick('b_ride', [30, 0, 20, 180, 5.5], [], T(t0 + 0.8 + 4 / 30), 0.85);
    await at(); await trick('b_crouch', [30, 0, 20, 180, 4.5], [{ at: 0.1, down: ['Space'] }], T(t0 + 0.6 + 4 / 30), 1.1);
    await trick('b_ollie_mid', [30, 0, 20, 180, 5], [{ at: 0.1, down: ['Space'] }, { at: 0.4, up: ['Space'] }], `ph.mode==='air' && ph.vel.y < 0.35`, 1.2);
    const midFlip = `ph.flip && ph.flip.t >= ph.flip.delay + ph.flip.dur * 0.5`;
    await trick('b_kickflip_mid', [30, 0, 20, 180, 5], FLIP(0.1, 'kickflip', 0.3), midFlip, 1.2);
    await trick('b_heelflip_mid', [30, 0, 20, 180, 5], FLIP(0.1, 'heelflip', 0.3), midFlip, 1.2);
    await trick('b_shuvit_mid', [30, 0, 20, 180, 5], FLIP(0.1, 'shuvit', 0.3), midFlip, 1.2);
    await trick('b_5050', [3.2, 0, -12.95, -90, 5.5], [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }], `ph.mode==='grind'`, -1.1, 22);
    await trick('b_boardslide', [0, 0, 4.0, 180, 6.0], [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }], `ph.mode==='grind'`, 1.15, 9, 90, 2.8, 0.14);
    await at(); await trick('b_manual', [30, 0, 20, 180, 4.5], [{ at: 0.2, down: ['ShiftLeft'] }], T(t0 + 1.0 + 4 / 30), 1.25);
    await at(); await trick('b_push', [30, 0, 20, 180, 1.0], [{ at: 0.0, down: ['KeyW'] }], T(t0 + 0.36 + 4 / 30), 1.0);
    await trick('b_handrail', [7, 1, 17.2, 180, 5.0], [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }], `ph.mode==='grind'`, 1.3, 5);
    // #68 at the brightest light: the b_5050 / b_manual recipes at noon
    if (want('noon')) {
      await c.api('setTime', 3, true);
      await trick('b_5050_noon', [3.2, 0, -12.95, -90, 5.5], [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }], `ph.mode==='grind'`, -1.1, 22);
      await at(); await trick('b_manual_noon', [30, 0, 20, 180, 4.5], [{ at: 0.2, down: ['ShiftLeft'] }], T(t0 + 1.0 + 4 / 30), 1.25);
      await c.api('setTime', 0, true);
    }
    await c.api('free');
  }

  // ================================================================ #70: background skaters' boards (west steps, north deck, half-pipe deck)
  if (want('h70')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    const v = {
      h70_west_steps_board_above: [-36.0, 2.6, 9.6, -38.25, 1.0, 9.55], h70_west_steps_board_close: [-36.9, 1.45, 6.9, -38.25, 0.5, 8.25],
      h70_north_deck_skater_board: [-9.0, 2.0, -19.7, -10.6, 1.3, -21.1], h70_north_deck_skater_board_close: [-9.6, 1.75, -20.2, -10.45, 1.25, -21.2],
      h70_hp_deck_skater_board: [29.4, 4.1, -8.6, 31.0, 3.4, -10.2],
    };
    for (const [n, vv] of Object.entries(v)) { await view(c, vv, 45); await adv(c, 1); await S(c, n); }
    await c.api('free');
  }

  // ================================================================ (b) character close-ups: face, upper body, feet, expressions, hands, cloth
  if (want('chars')) {
    await clearInput(c);
    await c.api('teleport', 9, 0, 3, 180, 0);
    await adv(c, 20);
    const p = await c.eval(() => { const h = window.__skate.game.skater.headWorld(window.__skate.game.physics.pos.clone()); return [h.x, h.y, h.z]; });
    const bp = await c.eval(() => window.__skate.game.board.root.position.toArray());
    await view(c, [p[0] + 0.62, p[1] + 0.08, p[2] - 0.55, p[0], p[1] - 0.02, p[2]]); await S(c, 'b_face_closeup');
    await view(c, [p[0] + 1.22, p[1] - 0.26, p[2] - 0.58, p[0], p[1] - 0.36, p[2]], 50); await S(c, 'b_upper_body');
    await view(c, [bp[0] + 0.78, bp[1] + 0.42, bp[2] - 0.5, bp[0], bp[1] + 0.12, bp[2]], 50); await S(c, 'b_feet_on_board');
    await c.api('free');
    // close parts (camera relative to the rider's facing; the head looks over the leading shoulder)
    const part = (name, kind, fovOver) => c.eval(([kind, fovOver]) => {
      const g = window.__skate.game, sk = g.skater, V = g.physics.pos.constructor;
      const q = sk.root.quaternion;
      const fwd = new V(0, 0, 1).applyQuaternion(q).setY(0).normalize(), nose = new V(1, 0, 0).applyQuaternion(q).setY(0).normalize();
      let target, pos;
      let fov = 50;
      if (kind === 'face') { target = sk.headWorld(new V()).add(new V(0, 0.1, 0)); pos = target.clone().addScaledVector(fwd, 0.5).addScaledVector(nose, 0.45).add(new V(0, 0.03, 0)); }
      else if (kind === 'hand' || kind === 'handL') {
        const hand = sk.b.get(kind === 'hand' ? 'RightHand' : 'LeftHand').bone.getWorldPosition(new V());
        target = hand.clone().add(new V(0, -0.04, 0)); pos = target.clone().addScaledVector(fwd, 0.38).addScaledVector(nose, kind === 'hand' ? -0.12 : 0.12).add(new V(0, 0.05, 0)); fov = 45;
      }
      else if (kind.startsWith('handx')) {
        // extreme close-up: aimed at the middle of the hand (wrist to middle fingertip), 0.42 m away
        const right = !kind.includes('L'), back = kind.includes('B');
        const hand = sk.b.get(right ? 'RightHand' : 'LeftHand').bone.getWorldPosition(new V());
        const tip = sk.fingers.find((x) => x.s === (right ? -1 : 1) && x.f === 1 && x.j === 3).bi.bone.getWorldPosition(new V());
        target = hand.clone().lerp(tip, 0.55);
        const dir = new V().addScaledVector(fwd, back ? -0.38 : 0.38).addScaledVector(nose, right ? -0.12 : 0.12).add(new V(0, 0.05, 0)).normalize();
        pos = target.clone().addScaledVector(dir, 0.42); fov = 32;
      }
      else if (kind === 'capface') {
        // head and the raised right hand together, from the front right (skin of hand and face in the same light)
        const hand = sk.b.get('RightHand').bone.getWorldPosition(new V()), head = sk.headWorld(new V());
        target = head.clone().lerp(hand, 0.4);
        pos = target.clone().addScaledVector(fwd, 0.8).addScaledVector(nose, -0.35).add(new V(0, 0.04, 0)); fov = 40;
      }
      else { target = sk.hipsWorld(new V()).add(new V(0, 0.08, 0)); pos = target.clone().addScaledVector(fwd, 1.25).addScaledVector(nose, -0.45).add(new V(0, 0.12, 0)); }
      if (fovOver) fov = fovOver;
      window.__skate.view(pos.x, pos.y, pos.z, target.x, target.y, target.z);
      g.camera.fov = fov; g.camera.updateProjectionMatrix();
      g.camera.position.copy(pos); g.camera.lookAt(target); g.camera.updateMatrixWorld();
      g.render(1 / 30);
      return sk.expr ?? '';
    }, [kind, fovOver ?? 0]).then(async (expr) => { await S(c, name); console.log('char', name, 'expr', expr); });
    const run = async (tp, script, sec) => { await c.api('free'); await clearInput(c); await c.api('teleport', ...tp); await adv(c, 2, false); await c.api('script', script); if (sec > 0) await adv(c, Math.round(sec * 30), false); };
    await run([30, 0, 20, 180, 0], [], 1.5); await part('b_face_neutral', 'face'); await part('b_hands_relaxed', 'hand'); await part('b_cloth_still', 'cloth');
    // #63 extreme close-ups (hand fills the frame)
    await part('h63_hand_relaxed_xclose', 'handx');
    await run([30, 0, 20, 180, 7.5], [], 0.4); await part('b_face_focus', 'face'); await part('b_cloth_speed', 'cloth');
    await run([30, 0, 20, 180, 4.5], [{ at: 0.1, down: ['Space'] }], 0.45); await part('b_cloth_crouch', 'cloth');
    await c.api('script', [{ at: 0.0, up: ['Space'] }]); await adv(c, 7, false); await part('b_face_wide', 'face'); await part('b_hands_open', 'hand');
    await part('h63_hand_open_xclose', 'handx'); await part('h63_hand_open_xclose_back', 'handxB'); await part('h63_hand_open_left_xclose', 'handxL');
    await until(c, `ph.mode==='ride'`, 40); await adv(c, 2, false); await part('b_cloth_land', 'cloth');
    await adv(c, 6, false); await part('b_face_grin', 'face');
    await run([30, 0, 20, 180, 4.5], [], 0.2);
    await c.eval(() => window.__skate.game.physics.toBail('back', 'test'));
    await adv(c, 6, false); await part('b_face_grimace', 'face');
    await c.api('release');
    // #63: the cap-adjust fidget puts the hand beside the face in the same light (skin match)
    await run([30, 0, 20, 180, 0], [], 2.5);
    await c.eval(() => { const f = window.__skate.game.skater.fid; f.n = 1; f.wait = 0; f.kind = ''; });
    await adv(c, 30, false);
    await part('h63_hand_cap_face', 'capface');
    await c.api('free');
  }
  // #63: hand and face in one frame during the cap-adjust fidget, cameras on the face side (fwd/nose mixes)
  if (want('capface')) {
    await c.api('free'); await clearInput(c);
    await c.api('teleport', 30, 0, 20, 180, 0); await adv(c, 2, false);
    await adv(c, 75, false);
    await c.eval(() => { const f = window.__skate.game.skater.fid; f.n = 1; f.wait = 0; f.kind = ''; });
    await adv(c, 30, false);
    for (const [name, kf, kn] of [['h63_hand_cap_face_front', 0.5, 0.62]]) {
      await c.eval(([kf, kn]) => {
        const g = window.__skate.game, sk = g.skater, V = g.physics.pos.constructor, q = sk.root.quaternion;
        const fwd = new V(0, 0, 1).applyQuaternion(q).setY(0).normalize(), nose = new V(1, 0, 0).applyQuaternion(q).setY(0).normalize();
        const hand = sk.b.get('RightHand').bone.getWorldPosition(new V()), head = sk.headWorld(new V());
        const target = head.clone().lerp(hand, 0.4);
        const pos = target.clone().addScaledVector(fwd, kf).addScaledVector(nose, kn).add(new V(0, 0.04, 0));
        window.__skate.view(pos.x, pos.y, pos.z, target.x, target.y, target.z);
        g.camera.fov = 40; g.camera.updateProjectionMatrix();
        g.camera.position.copy(pos); g.camera.lookAt(target); g.camera.updateMatrixWorld();
        g.render(1 / 30);
      }, [kf, kn]);
      await S(c, name);
    }
    await c.api('free');
  }

  // ================================================================ (c)(d) park elements and scenery (pass-02 cameras)
  if (want('wide')) {
    await c.api('teleport', 37, 0, 24, 180, 0); // park the skater out of the way
    await adv(c, 4);
    const views = {
      c_bowl_main: [-15.5, 1.8, 8, -27, -1.6, -2], c_bowl_pocket: [-16.5, 1.7, 21, -27, -1.0, 13],
      c_halfpipe: [24, 4.6, 6.5, 24, 1.0, -9], c_halfpipe_inside: [23.2, 0.9, -4.5, 25, 1.4, -11],
      c_quarterpipe_terrace: [-9.5, 4.2, 14.5, 6, 1.4, 22], c_quarterpipe_and_bank_north: [-5, 2.4, -11, -4, 0.7, -21],
      c_stairs_handrail: [11.5, 2.2, 7.5, 7, 0.6, 13.5], c_funbox_flatbar: [7.5, 2.4, 5.5, 0, 0.4, -1.5],
      c_banks_terrace: [-9, 2.2, 7, -0.5, 0.5, 13.5], c_ledges_rail: [-3, 1.9, -6.5, -2, 0.3, -12.4],
      c_curb_and_manualpad: [-1, 1.8, 10, -7, 0.1, 5.8], c_mural_sunwaves: [8.5, 1.8, -9, 16.4, 1.5, -9],
      c_mural_koi: [-27, 1.9, 0.5, -36.6, 1.7, 0], c_mural_patchwork: [25, 1.8, 15.5, 25, 1.6, 24.9],
      d_ocean_glitter: [-12, 8, -36, -70, -0.5, -150], d_boardwalk: [-20, 2.0, -21, 6, 0.6, -26.5],
      d_beach_houses: [40, 4, -24, 72, 2, -38], d_palms: [-30, 1.6, -18, -47, 6, -30],
      d_overview: [42, 18, 42, 0, 0, -6], d_lighthouse_headland: [36, 3.6, -26.2, 300, 40, -300],
      c_line_nw_quarter_pyramid: [-25, 2.4, -10.5, -31, 0.6, -19], c_line_nw_curb: [-13.0, 1.7, -9.2, -21, 0.2, -12.4],
      c_line_ne_platform_stairs: [11.5, 2.0, -13.0, 11, 0.3, -19.8], c_line_ne_mini_quarter: [24, 2.4, -12.5, 24, 0.4, -21],
      c_line_se_ledge_bank: [21.5, 2.3, 11.0, 22, 0.3, 18], c_line_sw_pad_ledge: [-7, 2.1, 15.5, -18, 0.2, 21],
      c_line_east_rail: [17.5, 1.8, 10.5, 13.4, 0.2, 4.5], c_halfpipe_deck_stairs: [11.5, 2.8, 5.5, 17.6, 2.4, -6],
      c_halfpipe_exterior_east: [36.5, 2.2, 0.5, 31.6, 1.6, -9], c_halfpipe_coping: [21.2, 3.6, -6.2, 19.2, 2.9, -9.5],
      c_stairs_close: [9.6, 0.7, 10.6, 7, 0.45, 13.4], c_funbox_iron: [2.6, 1.05, 2.0, 0.6, 0.55, 0],
      c_ledge_wax: [-3.6, 0.95, -10.8, -6, 0.4, -12.6], c_bowl_coping: [-19.6, 1.0, 5.8, -23, -0.4, 7.4],
      c_mural_koi_close: [-33.2, 1.0, 1.5, -36.6, 0.9, 0.2],
      d_kiosk_town_side: [25, 3.0, 36, 25, 1.6, 27], d_edge_east: [33.5, 1.7, 4.0, 39, 0.6, -2], d_edge_south: [-22, 1.7, 19.5, -26, 0.5, 26],
      d_edge_west: [-33.5, 1.6, 14, -39, 0.6, 9], d_edge_north_boardwalk: [-36, 1.6, -21, -40, 0.6, -26],
      d_people_hp_deck: [26.5, 4.4, -6.5, 30.8, 3.6, -10.6], d_people_north_deck: [-7.5, 2.4, -15.5, -10.8, 1.6, -21],
      d_people_west_steps: [-33.5, 1.6, 9.5, -38.2, 0.9, 9.5], d_people_beach: [-24, 2.2, -42, -29.5, 0.4, -47.5],
      d_people_lifeguard: [-5.5, 3.2, -57.5, -8, 2.9, -53.4], d_people_boardwalk: [36, 1.8, -24.5, 50, 1.0, -24.6],
      d_palm_close: [-33.5, 1.7, -24.5, -39.1, 7.5, -19.5], d_palm_crown_up: [-36.5, 2.0, 7.5, -39.0, 10.0, 8.2],
      d_palms_far: [0, 6, 20, -10, 5, -30], d_shore_wet: [-20, 3.2, -57, -20, -1.25, -71], d_shore_wide: [-36, 4.5, -36, -12, -1.2, -76],
      d_sand_footprints: [-19, 1.6, -33, -22, -0.4, -40], d_umbrella_shadow: [52, 4.5, -36, 46, -0.6, -52],
      d_headland_close: [120, 18, -150, 280, 22, -330], d_beach_house_close: [-52, 2.4, -29, -58, 2.4, -38],
      d_town_south: [8, 5, 28, 6, 2.5, 60], d_overview_top: [0, 60, 40, 0, 0, 0],
      d_ground_low_feet: [9.9, 0.45, 2.4, 8.95, 0.2, 3.0], d_ground_low_sand: [2, 0.35, -16, -6, 0.05, -21],
    };
    const sel = process.env.VIEWS ? process.env.VIEWS.split(',') : Object.keys(views);
    for (const n of sel) {
      if (n === 'd_ground_low_feet') { await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 10); }
      await view(c, views[n]);
      await S(c, n);
    }
    await c.api('teleport', 37, 0, 24, 180, 0);
    await c.api('free');
  }

  // ================================================================ (e) times of day: close (behind the rider) and wide
  if (want('tod')) {
    const names = ['e_golden_hour', 'e_sunset', 'e_blue_hour', 'e_bright_noon'];
    await c.api('teleport', 9, 0, 3, 180, 0);
    await pinCam(c, 0.35, 3.4, 0.05);
    await adv(c, 20);
    for (let i = 0; i < 4; i++) { await c.api('setTime', i, true); await adv(c, 2); await S(c, names[i]); }
    for (let i = 0; i < 4; i++) { await c.api('setTime', i, true); await view(c, [42, 14, 40, -2, 0, -8]); await S(c, names[i] + '_wide'); }
    await c.api('setTime', 2, true);
    await view(c, [-31, 4.0, 27.5, -37.3, 0, 0]); await S(c, 'e_blue_hour_lamps_wide');
    await view(c, [0, 7.5, 27.5, -2, 0, -6]); await S(c, 'e_blue_hour_lamps_south');
    await view(c, [-8, 3.0, 14, -26, -0.8, 0]); await S(c, 'e_blue_hour_bowl');
    await c.api('setTime', 3, true);
    await view(c, [-15.5, 1.8, 8, -27, -1.6, -2]); await S(c, 'e_bright_noon_bowl');
    await view(c, [-12, 8, -36, -70, -0.5, -150]); await S(c, 'e_bright_noon_sea');
    await c.api('setTime', 1, true);
    await view(c, [-15.5, 1.8, 8, -27, -1.6, -2]); await S(c, 'e_sunset_bowl');
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  // ================================================================ #55: soft-shadow interiors, the critic's four views at every time of day
  if (want('h55')) {
    const views = {
      c_bowl_coping: [-19.6, 1.0, 5.8, -23, -0.4, 7.4], d_ground_low_feet: [9.9, 0.45, 2.4, 8.95, 0.2, 3.0],
      c_halfpipe_coping: [21.2, 3.6, -6.2, 19.2, 2.9, -9.5], c_stairs_close: [9.6, 0.7, 10.6, 7, 0.45, 13.4],
    };
    for (let t = 0; t < 4; t++) {
      await c.api('setTime', t, true);
      for (const [n, v] of Object.entries(views)) {
        if (n === 'd_ground_low_feet') { await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 10); }
        else { await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2); }
        await view(c, v);
        await S(c, `h55_${n}_${TOD[t]}`);
      }
    }
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  // ================================================================ (g) scale, lamp light, backlight (pass-02 set)
  if (want('extra')) {
    await c.api('teleport', 22.6, 0, -3.8, 90, 0); await adv(c, 30);
    await view(c, [23.8, 1.6, 2.8, 21.4, 1.7, -3.6]); await S(c, 'g_scale_halfpipe');
    await c.api('teleport', -25.3, 0, -18.7, 180, 0); await adv(c, 30);
    await view(c, [-20.6, 1.2, -17.4, -25.6, 0.85, -19.6]); await S(c, 'g_scale_quarterpipe');
    await c.api('free');
    await c.api('setTime', 2, true);
    await c.api('teleport', 10.6, 0, -19.6, 200, 0); await adv(c, 12);
    await view(c, [14.5, 1.9, -15.5, 10.4, 0.8, -20.5]); await S(c, 'g_lamp_blue_hour');
    await view(c, [12.6, 1.35, -17.6, 10.5, 0.95, -19.9]); await S(c, 'g_lamp_blue_hour_close');
    await view(c, [4.0, 2.6, -12.0, 10.0, 0.4, -21.0]); await S(c, 'g_lamp_blue_hour_pool');
    await c.api('free'); await pinCam(c, 0.35, 3.4, 0.05); await adv(c, 8); await S(c, 'g_lamp_blue_hour_follow');
    await c.api('free');
    await c.api('setTime', 0, true);
    await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 12);
    const sk = await c.eval(() => { const p = window.__skate.game.skater.root.position; const s = window.__skate.game.tod.cur.lightDir; return [p.x, p.y, p.z, s.x, s.z]; });
    const [x, y, z, sx, sz] = sk; const l = Math.hypot(sx, sz), dx = sx / l, dz = sz / l;
    await view(c, [x - dx * 3.0, y + 1.25, z - dz * 3.0, x, y + 0.95, z]); await S(c, 'g_backlight_golden');
    await view(c, [x - dx * 1.6 + dz * 0.4, y + 1.3, z - dz * 1.6 - dx * 0.4, x, y + 1.1, z]); await S(c, 'g_backlight_golden_close');
    await view(c, [x + dx * 3.0, y + 1.25, z + dz * 3.0, x, y + 0.95, z]); await S(c, 'g_frontlight_golden');
    await c.api('setTime', 1, true);
    const s2 = await c.eval(() => { const s = window.__skate.game.tod.cur.lightDir; return [s.x, s.z]; });
    const l2 = Math.hypot(s2[0], s2[1]), ex = s2[0] / l2, ez = s2[1] / l2;
    await view(c, [x - ex * 3.0, y + 1.25, z - ez * 3.0, x, y + 0.95, z]); await S(c, 'g_backlight_sunset');
    await view(c, [x - ex * 1.6 + ez * 0.4, y + 1.3, z - ez * 1.6 - ex * 0.4, x, y + 1.1, z]); await S(c, 'g_backlight_sunset_close');
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  // ================================================================ #58: kiosk service window, golden hour and blue hour
  if (want('kiosk')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    const v = { town_side: [25, 3.0, 36, 25, 1.6, 27], window_close: [25.6, 1.75, 31.6, 25.4, 1.5, 28.6], window_oblique: [21.0, 1.9, 33.5, 25.5, 1.5, 28.6] };
    for (const t of [0, 2]) {
      await c.api('setTime', t, true);
      for (const [n, vv] of Object.entries(v)) { await view(c, vv); await S(c, `h58_kiosk_${n}_${TOD[t]}`); }
    }
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  // ================================================================ #59 / #61: faces of the people from about 3 m (+ the critic's framings)
  if (want('people')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    const pshot = async (name, idx, ahead, side, h, lookH, fov = 45) => {
      await adv(c, 1, false);
      await c.eval(([idx, ahead, side, h, lookH, fov]) => {
        const s = window.__skate, g = s.game, p = g.scenery.people.items[idx];
        const hp = p.holder.position, ry = p.holder.rotation.y, fx = Math.sin(ry), fz = Math.cos(ry);
        const look = [hp.x, hp.y + lookH, hp.z], pos = [look[0] + fx * ahead + fz * side, hp.y + h, look[2] + fz * ahead - fx * side];
        s.view(...pos, ...look);
        const cam = g.camera; cam.fov = fov; cam.updateProjectionMatrix();
        cam.position.set(...pos); cam.lookAt(...look); cam.updateMatrixWorld();
        g.render(1 / 30); g.render(1 / 30); // the LOD picks its level while rendering
      }, [idx, ahead, side, h, lookH, fov]);
      await S(c, name);
    };
    await pshot('h59_walker_face_5m_clip20_framing', 7, 5.0, 1.6, 1.5, 1.0, 45);
    await pshot('h59_walker_face_3m', 7, 3.0, 0.6, 1.6, 1.5, 35);
    await pshot('h59_walker2_face_3m', 8, 3.0, 0.6, 1.6, 1.5, 35);
    await pshot('h59_shore_walker_face_3m', 9, 3.0, 0.6, 1.6, 1.5, 35);
    await pshot('h59_town_walker_face_3m', 10, 3.0, 0.6, 1.6, 1.5, 35);
    await pshot('h59_hp_deck_skater_face_3m', 0, 3.0, 0.5, 1.6, 1.5, 35);
    await pshot('h59_north_deck_skater_face_3m', 1, 3.0, 0.5, 1.6, 1.5, 35);
    await pshot('h59_phone_face_3m', 5, 3.0, 0.5, 1.6, 1.5, 35);
    await pshot('h59_waver_face_3m', 6, 3.0, 0.5, 1.6, 1.5, 35);
    await pshot('h61_lifeguard_face_3m', 13, 2.6, 0.5, 1.15, 1.0, 35);
    await view(c, [-5.5, 3.2, -57.5, -8, 2.9, -53.4]); await S(c, 'h61_lifeguard_critic_view');
    // seated groups from about 3 m (same cameras as clip32)
    const grp = async (name, spec) => {
      await adv(c, 1, false);
      await c.eval((sp) => { window.__mcam({ ...sp, reset: true }); window.__skate.game.render(1 / 30); window.__skate.game.render(1 / 30); }, spec);
      await S(c, name);
    };
    await grp('h59_west_steps_pair_3m', { kind: 'group', idx: [2, 3], dist: 3.0, dy: 0.05, fov: 40 });
    await grp('h59_beach_couple_3m', { kind: 'group', idx: [11, 12], ref: 12, yaw: 20, dist: 3.0, dy: 0.5, fov: 40 });
    await grp('h59_south_steps_clapper_3m', { kind: 'group', idx: [4], dist: 3.0, dy: 0.05, fov: 35 });
    await grp('h59_kiosk_vendor_3m', { kind: 'group', idx: [14], dist: 3.4, dy: 0.0, fov: 35 });
    await c.api('free');
  }

  // ================================================================ #60: dark hair from above (west steps), incl. the most hunched moment
  if (want('hair')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    const A = [-36.0, 2.6, 9.6, -38.25, 1.0, 9.55], B = [-40.2, 2.2, 8.4, -38.25, 1.0, 9.55], CR = [-33.5, 1.6, 9.5, -38.2, 0.9, 9.5];
    await view(c, A, 45); await S(c, 'h60_west_steps_above');
    await view(c, B, 45); await S(c, 'h60_west_steps_behind');
    // the left figure hunches forward from time to time: keep the frame where his head is lowest (critic's view + above)
    const fixedNow = (v, fov) => c.eval(([v, fov]) => { window.__mcam({ kind: 'fixed', pos: v.slice(0, 3), look: v.slice(3), fov }); window.__skate.game.render(1 / 30); }, [v, fov]);
    let low = 9, lowF = -1;
    for (let k = 0; k < 110; k++) {
      await adv(c, 3, false);
      const hy = await c.eval(() => { const g = window.__skate.game; return g.scenery.people.items[2].holder.getObjectByName('mixamorigHead').getWorldPosition(g.camera.position.clone()).y; });
      if (hy < low - 0.004) {
        low = hy; lowF = k * 3;
        await fixedNow(CR, 56); await S(c, 'h60_west_steps_hunch_critic_view');
        await fixedNow(A, 45); await S(c, 'h60_west_steps_hunch_above');
      }
    }
    console.log('hair: lowest head', low.toFixed(3), 'at +', lowF, 'frames');
    for (const t of [1, 2, 3]) { await c.api('setTime', t, true); await view(c, A, 45); await S(c, `h60_west_steps_above_${TOD[t]}`); }
    await c.api('setTime', 0, true);
    // the skater's own dark hair from above
    await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 20);
    const hp = await c.eval(() => { const h = window.__skate.game.skater.headWorld(window.__skate.game.physics.pos.clone()); return [h.x, h.y, h.z]; });
    await view(c, [hp[0] + 0.35, hp[1] + 0.95, hp[2] + 0.25, hp[0], hp[1], hp[2]], 45); await S(c, 'h60_skater_hair_above');
    await c.api('free');
  }

  // ================================================================ #62: the north quarter pipe -> bank join up close; #57 close bushes
  if (want('h62')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    await view(c, [-0.5, 1.3, -15.2, -2.0, 0.5, -19.5]); await S(c, 'h62_qp_bank_join_close');
    await view(c, [-5.6, 2.5, -22.2, -1.8, 0.5, -18.6]); await S(c, 'h62_qp_bank_join_from_qp_deck');
    await view(c, [2.2, 1.0, -16.0, -1.6, 0.6, -19.4]); await S(c, 'h62_qp_bank_join_from_bank_side');
    await c.api('free');
  }
  if (want('bush')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    const vs = {
      h57_bush_close_west_planter: [-36.3, 1.35, 15.8, -39.05, 0.95, 18.0], h57_bush_close_west_planter_2: [-36.4, 1.3, 20.6, -39.05, 0.95, 22.8],
      h57_bush_close_east_planter: [36.2, 1.35, -1.2, 39.05, 0.95, -3.4], h57_bush_close_boardwalk_end: [-37.4, 1.4, -22.0, -39.7, 0.95, -25.0],
      h57_town_bush_former_boulder: [7.7, 1.45, 34.2, 5.9, 0.35, 37.3],
      h57_bush_backlit_west_planter: [-40.8, 1.4, 21.5, -39.05, 0.95, 18.6],
    };
    for (const [n, v] of Object.entries(vs)) { await view(c, v, 45); await S(c, n); }
    // ultra-close, ~1.3 m from the bush centre (centre = centroid of the leaf-card vertices near a guess);
    // side: camera 90 deg from the sun (painted light and shade), back: facing the sun, low (outline against the sky)
    const xclose = async (name, mesh, gx, gz, mode, dist = 1.3) => {
      const r = await c.eval(([mesh, gx, gz, mode, dist]) => {
        const g = window.__skate.game, V = g.physics.pos.constructor, m = g.scene.getObjectByName(mesh);
        if (!m) return null;
        m.updateMatrixWorld();
        const pa = m.geometry.getAttribute('position'), p = new V();
        let cx = gx, cz = gz, cy = 0, top = -9, n = 0;
        for (let it = 0; it < 4; it++) {
          let ax = 0, az = 0, ay = 0; n = 0; top = -9;
          for (let i = 0; i < pa.count; i++) {
            p.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
            if (Math.hypot(p.x - cx, p.z - cz) > 0.55) continue;
            ax += p.x; az += p.z; ay += p.y; n++; top = Math.max(top, p.y);
          }
          if (!n) return null;
          cx = ax / n; cz = az / n; cy = ay / n;
        }
        const L = g.tod.cur.lightDir, l = Math.hypot(L.x, L.z), sx = L.x / l, sz = L.z / l;
        let dx, dz;
        if (mode === 'back') { dx = -sx; dz = -sz; } else { dx = sz; dz = -sx; if (mode === 'side2') { dx = -dx; dz = -dz; } }
        const pos = mode === 'back' ? [cx + dx * dist, cy + 0.05, cz + dz * dist] : [cx + dx * dist, top + 0.12, cz + dz * dist];
        const look = mode === 'back' ? [cx, top - 0.08, cz] : [cx, cy + 0.04, cz];
        return { pos, look, c: [cx, cy, cz].map((v) => +v.toFixed(2)), top: +top.toFixed(2), n };
      }, [mesh, gx, gz, mode, dist]);
      if (!r) { console.log('bush xclose', name, 'no leaves near', gx, gz); return; }
      console.log('bush xclose', name, 'centre', r.c, 'top', r.top, 'verts', r.n);
      await view(c, [...r.pos, ...r.look], 45); await S(c, name);
    };
    await xclose('h57_bush_xclose_planter_side', 'planterBushes', -39.05, 18.0, 'side2');
    await xclose('h57_bush_xclose_flowering_side', 'planterBushes', -39.05, 17.0, 'side2');
    await xclose('h57_bush_xclose_planter_backlit', 'planterBushes', -39.05, 18.0, 'back');
    await xclose('h57_bush_xclose_town_scrub', 'townBushes', 5.9, 37.3, 'side2', 1.5);
    await c.api('free');
  }

  // ================================================================ #64: mid-flip with the grip side towards the camera (closest frame kept)
  if (want('grip')) {
    for (const [trick, key] of [['kickflip', 'kickflip'], ['heelflip', 'heelflip']]) {
      for (const [tag, angle] of [['', 20], ['_sunlit', 200]]) {
        await clearInput(c); await c.api('free');
        await c.api('teleport', 30, 0, 22, 180, 4.5);
        await adv(c, 2, false);
        await c.api('events');
        await c.api('script', FLIP(0.3, key, 0.32));
        let pop = -1, best = -2, bestF = -1;
        for (let i = 0; i < 45; i++) {
          const st = await c.eval(stepFrame, { kind: 'side', heading: 180, angle, dist: 1.6, h: 0.5, lookH: 0.3, fov: 40, track: 'board', trackY: true, ...(i === 0 ? { reset: true } : {}) });
          if (pop < 0 && st.e.some((e) => e.type === 'pop')) pop = i;
          if (pop < 0 || i < pop + 3 || i > pop + 13) continue;
          const p = await c.eval(() => window.__probe());
          if (p.grip > best) { best = p.grip; bestF = i - pop; await S(c, `h64_grip_${trick}${tag}`); }
        }
        console.log(`grip ${trick}${tag}: grip-to-camera ${best} at pop+${bestF}`);
        await c.api('release');
      }
    }
    await c.api('free');
  }

  // ================================================================ #66: idle stance from the front (knees over toes) through weight shifts
  if (want('idle')) {
    await clearInput(c); await c.api('free');
    await c.api('teleport', 9, 0, 3, 180, 0);
    const cam = { kind: 'side', heading: 180, angle: 0, dist: 2.5, h: 1.0, lookH: 0.95, fov: 50, track: 'board', groundY: 0 };
    for (let i = 0; i <= 330; i++) {
      await c.eval(stepFrame, i === 0 ? { ...cam, reset: true } : cam);
      if ([60, 150, 240, 330].includes(i)) await S(c, `h66_idle_front_f${String(i).padStart(3, '0')}`);
    }
    await c.eval(() => { const f = window.__skate.game.skater.fid; f.n = 2; f.wait = 0; f.kind = ''; }); // foot nudge fidget
    for (let i = 0; i < 40; i++) {
      await c.eval(stepFrame, cam);
      if (i === 20) await S(c, 'h66_idle_front_foot_fidget');
    }
    await c.api('free');
  }

  // ================================================================ #63: hands at normal gameplay distance (default follow camera)
  if (want('handsplay')) {
    const settle = async (tp) => { await clearInput(c); await plainCam(c); await c.api('teleport', ...tp); await adv(c, 2, false); };
    await settle([10.5, 0, -9, 90, 7.5]);
    await until(c, `ph.mode==='bail'`, 90);
    await adv(c, 6); await S(c, 'h63_hands_follow_bail_impact');
    await adv(c, 10); await S(c, 'h63_hands_follow_bail_fall');
    await adv(c, 40); await S(c, 'h63_hands_follow_bail_lying');
    await settle([30, 0, 20, 180, 4.5]);
    await c.api('script', [{ at: 0.05, down: ['ShiftLeft'] }, { at: 2.5, up: ['ShiftLeft'] }]);
    await adv(c, 34); await S(c, 'h63_hands_follow_manual');
    await adv(c, 20); await S(c, 'h63_hands_follow_manual_late');
    await settle([3.2, 0, -12.95, -90, 5.5]);
    await c.api('script', [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }]);
    await until(c, `ph.mode==='grind'`, 60);
    await adv(c, 16); await S(c, 'h63_hands_follow_grind_5050');
    await c.api('release');
    await c.api('free');
  }

  // bug evidence (dev/, not part of the set): the pass-3 clip35 input; he stalls at the top of the NE wall and creeps along it
  if (want('bug35old')) {
    await clearInput(c); await plainCam(c);
    await c.api('teleport', -24, -2.3, -4.2, 90, 7.0); await adv(c, 2, false);
    await c.api('script', KEY('KeyA', 0.2, 1.4));
    for (let f = 0; f <= 210; f++) {
      await adv(c, 1, [45, 90, 150, 210].includes(f));
      if ([45, 90, 150, 210].includes(f)) {
        const st = await c.api('state');
        await c.shot(`dev/m1/bug_clip35_pass3_input_f${String(f).padStart(3, '0')}.png`);
        console.log('bug35old', f, st.mode, st.pos, st.speed, st.up);
      }
    }
    await c.api('release'); await c.api('free');
  }
  await c.api('hud', true);
  // clips show the HUD as during play: the 6 s controls hint of a fresh page has already faded (CSS fade is wall-clock)
  await c.eval(() => window.__skate.game.hud.update(10));
  await c.wait(1500);

  // ================================================================ clips: default follow camera (pass-02 set, same numbering)
  if (want('clip01')) await record(c, 'clip01_push_carve_bowl', [{
    frames: 390, setup: () => c.api('teleport', -2, 0, 1.5, -90, 1.5),
    script: [...KEY('KeyW', 0, 2.2), ...KEY('KeyD', 4.0, 0.35), ...KEY('KeyW', 7.6, 0.7)],
  }]);
  if (want('clip02')) {
    const s = [];
    await record(c, 'clip02_flatground_flips', [seg('clip02')]);
  }
  if (want('clip04')) await record(c, 'clip04_grinds_5050_boardslide', [
    { label: '50-50 down the stair handrail', frames: 78, setup: () => c.api('teleport', 7, 1, 17.4, 180, 5.0),
      script: [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }] },
    { label: 'boardslide on the funbox flat bar', frames: 132, preroll: 0, setup: () => c.api('teleport', 0, 0, 4.0, 180, 6.0),
      script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.8, up: ['KeyE'] }] },
  ]);
  if (want('clip07')) await record(c, 'clip07_bail_and_get_up', [wallBailSeg(null, null, atFrames([45, 120, 200, 254], 'h56_wall_bail_follow'))]);
  if (want('clip09')) await record(c, 'clip09_camera_orbit_idle', [{
    frames: 450, setup: async () => { await c.api('teleport', 9, 0, 3, 180, 0); await c.api('snapCam'); await c.api('camDist', null); await c.api('orbit', 0.47, 3.0, 0.25); },
  }]);

  // ================================================================ clips: pass-02 needs-capture set (scripted side / close cameras)
  if (want('clip10')) await record(c, 'clip10_grinds_trucks_side', [
    { label: '50-50 on the long ledge (camera on the grind side at truck height)', frames: 100,
      setup: () => c.api('teleport', 3.2, 0, -12.95, -90, 5.5),
      script: [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }, { at: 1.2, up: ['KeyE'] }],
      cam: { kind: 'side', heading: -90, dist: 1.55, h: 0.62, lookH: 0.5, fov: 45, track: 'board', axis: 'x', fixed: -12.6 },
      still: (i, st, ctx) => { const d = ctx.data; if (st.mode === 'grind') d.g = (d.g ?? 0) + 1; return d.g === 24 && !d.done && (d.done = true) ? 'b_grind_5050_trucks' : null; } },
    { label: 'boardslide on the funbox flat bar (camera on the bar axis)', frames: 72,
      setup: () => c.api('teleport', 0, 0, 4.0, 180, 6.0), preroll: 0,
      script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.8, up: ['KeyE'] }],
      cam: { kind: 'side', heading: 90, angle: 90, dist: 1.9, h: 1.08, lookH: 0.95, fov: 45, track: 'board', axis: 'x', fixed: -1.32, groundY: 0, lookY: 0.9 },
      still: (i, st, ctx) => { const d = ctx.data; if (st.mode === 'grind') d.g = (d.g ?? 0) + 1; return d.g === 9 && !d.done && (d.done = true) ? 'b_grind_boardslide_trucks' : null; } },
    { label: 'boardslide on the funbox flat bar (camera across the bar)', frames: 72,
      setup: () => c.api('teleport', 0, 0, 4.0, 180, 6.0), preroll: 0,
      script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.8, up: ['KeyE'] }],
      cam: { kind: 'side', heading: 90, angle: 0, dist: 1.7, h: 1.12, lookH: 0.9, fov: 45, track: 'board', axis: 'x', fixed: -1.5, groundY: 0 },
      still: (i, st, ctx) => { const d = ctx.data; if (st.mode === 'grind') d.g = (d.g ?? 0) + 1; return d.g === 9 && !d.done && (d.done = true) ? 'b_grind_boardslide_side' : null; } },
    { label: '50-50 down the stair handrail (camera beside the rail)', frames: 60,
      setup: () => c.api('teleport', 7, 1, 17.4, 180, 5.0), preroll: 0,
      script: [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }],
      cam: { kind: 'side', heading: 180, angle: 0, dist: 1.7, h: 0.32, lookH: 0.12, fov: 45, track: 'board', axis: 'z', fixed: 7, trackY: true },
      still: (i, st, ctx) => { const d = ctx.data; if (st.mode === 'grind') d.g = (d.g ?? 0) + 1; return d.g === 5 && !d.done && (d.done = true) ? 'b_grind_handrail_trucks' : null; } },
  ], { sheetStep: 2 });
  for (const [k, name, key] of [['clip12', 'clip12_ollie_side', null], ['clip13', 'clip13_kickflip_side', 'kickflip'], ['clip14', 'clip14_heelflip_side', 'heelflip'], ['clip15', 'clip15_shuvit_side', 'shuvit']]) {
    if (want(k)) await record(c, name, [{
      frames: 120, setup: () => c.api('teleport', 30, 0, 22, 180, 4.5),
      script: [...FLIP(0.4, key, 0.32), ...FLIP(2.3, key, 0.12)], cam: sideCam(180),
    }], { sheetStep: 2 });
  }
  if (want('clip16')) await record(c, 'clip16_push_side', [{
    frames: 150, setup: () => c.api('teleport', 30, 0, 22, 180, 0), script: KEY('KeyW', 0.3, 3.4), cam: sideCam(180, { dist: 3.0, h: 0.8, lookH: 0.85, angle: 8 }),
  }], { sheetStep: 2 });
  if (want('clip17')) await record(c, 'clip17_vert_air_close', [{
    frames: 330, setup: () => c.api('teleport', 22.5, 0, -9, 90, 9.6), script: KEY('KeyW', 2.6, 0.8),
    cam: { kind: 'vert', xr: [20.2, 27.8], z: -3.6, h0: 1.15, hk: 0.45, l0: 1.25, lk: 0.5, lz: -9, fov: 50 },
  }]);
  if (want('clip20')) {
    const items = await c.eval(() => window.__skate.game.scenery.people.items.map((p, i) => ({ i, clip: p.spot.clip, at: p.spot.at, path: !!p.spot.path })));
    const walkers = items.filter((p) => p.path);
    const near = (x, z) => walkers.reduce((a, b) => (Math.hypot(b.at[0] - x, b.at[2] - z) < Math.hypot(a.at[0] - x, a.at[2] - z) ? b : a)).i;
    const fixed = (pos, look, fov = 50) => ({ kind: 'fixed', pos, look, fov });
    await c.api('teleport', 37, 0, 24, 180, 0);
    await record(c, 'clip20_people_motion', [
      { label: 'walker on the boardwalk (east)', frames: 75, cam: { kind: 'person', idx: near(41.5, -24.4), ahead: 5.0, side: 1.6, h: 1.5, lookH: 1.0, fov: 45 } },
      { label: 'waving on the boardwalk (west end)', frames: 75, cam: fixed([-40.6, 1.6, -23.4], [-44.5, 1.15, -24.8], 45) },
      { label: 'beach: couple on towels, walker on the shore path', frames: 75, cam: fixed([-24, 2.2, -42], [-29.5, 0.4, -47.5]) },
      { label: 'walker on the shore', frames: 75, cam: { kind: 'person', idx: near(-34, -64), ahead: 4.5, side: 2.2, h: 1.4, lookH: 0.9, fov: 45 } },
      { label: 'lifeguard in the tower', frames: 60, cam: fixed([-5.5, 3.2, -57.5], [-8, 2.9, -53.4]) },
      { label: 'friends on the west seat steps', frames: 60, cam: fixed([-33.5, 1.6, 9.5], [-38.2, 0.9, 9.5]) },
      { label: 'skater waiting on the half pipe deck', frames: 60, cam: fixed([26.5, 4.4, -6.5], [30.8, 3.6, -10.6]) },
      { label: 'walker on the town-side path (south)', frames: 75, cam: { kind: 'person', idx: near(-34, 33), ahead: 5.0, side: 1.8, h: 1.5, lookH: 1.0, fov: 45 } },
    ]);
  }
  if (want('clip21')) await record(c, 'clip21_palms_breeze', [
    { label: 'palm crown from below (boardwalk end)', frames: 120, cam: { kind: 'fixed', pos: [-33.5, 1.7, -24.5], look: [-39.1, 7.5, -19.5], fov: 56 } },
    { label: 'palm crown close (west edge)', frames: 120, cam: { kind: 'fixed', pos: [-36.5, 2.0, 7.5], look: [-39.0, 10.0, 8.2], fov: 56 } },
  ]);
  if (want('clip22')) await record(c, 'clip22_bowl_carve_follow', [{ frames: 150, setup: () => c.api('teleport', -28, -2.3, -2.0, 90, 7.5), script: CARVE }]);
  if (want('clip23')) await record(c, 'clip23_wall_bail_close', [wallBailSeg({ kind: 'side', heading: 90, angle: -60, dist: 3.6, h: 1.3, lookH: 0.85, fov: 50, track: 'hips' }, null,
    atFrames([20, 22, 24, 28, 34, 46, 149, 205, 217], 'h56_wall_bail_close'))], { sheetStep: 4 });
  if (want('clip24')) await record(c, 'clip24_manual_side', [{
    frames: 135, setup: () => c.api('teleport', 30, 0, 22, 180, 4.5), script: KEY('ShiftLeft', 0.4, 2.9), cam: sideCam(180, { angle: 10 }),
  }], { sheetStep: 2 });
  if (want('clip25')) await record(c, 'clip25_sketchy_landing_side', [{
    frames: 105, setup: () => c.api('teleport', 30, 0, 22, 180, 4.5),
    script: [{ at: 0.6, down: ['Space'] }, { at: 0.92, up: ['Space'] }, ...KEY('KeyD', 1.25, 0.09)], cam: sideCam(180, { angle: 20 }),
  }], { sheetStep: 2 });

  // ================================================================ clips: pass-03 open items + the critic's "needs capture" list
  // #44: kickflip / heelflip / shove-it at board height, side-on and from the front quarter, front foot in frame pop to catch
  for (const [k, trick, key] of [['clip26', 'kickflip', 'kickflip'], ['clip27', 'heelflip', 'heelflip'], ['clip28', 'shuvit', 'shuvit']]) {
    if (want(k)) await record(c, `${k}_${trick}_board_height`, [boardHeightSeg(trick, key, 'side', 0), boardHeightSeg(trick, key, 'q35', 35)], { sheetStep: 1, hud: false });
  }
  // #65: drop-in into the main bowl from the east deck, side-on close at deck level (camera sinks with him)
  if (want('clip29')) await record(c, 'clip29_dropin_side_deck', [{
    label: 'drop-in from the deck, side-on at deck level', ...seg('clip29'),
    cam: { kind: 'side', heading: -90, angle: 0, dist: 3.2, h: 0.95, lookH: 0.55, fov: 50, deckY: true },
    still: (i, st, ctx) => {
      const d = ctx.data;
      if (st.dropin === 'stall') d.stall = (d.stall ?? 0) + 1;
      if (st.dropin === 'pivot') d.pivot = (d.pivot ?? 0) + 1;
      if (st.e.some((e) => e.type === 'dropIn')) d.done = i;
      return dropStills(d, 'bowl', [['h65_dropin_tail_on_coping'], [], ['h65_dropin_nose_down'], [], ['h65_dropin_crouch_on_wall']], i);
    },
  }], { sheetStep: 2, hud: false });
  // #65: the same drop-in seen from the bowl floor (board and coping in frame), camera panning with him
  if (want('clip30')) await record(c, 'clip30_dropin_bowl_floor', [{
    label: 'drop-in seen from the bowl floor', ...seg('clip29', 0, { frames: 60 }),
    cam: { kind: 'pan', pos: [-18.0, -1.5, -1.6], look: [-15.4, -0.2, 0.6], hold: 0.2, k: 7, fov: 50 },
    still: (i, st, ctx) => {
      const d = ctx.data;
      if (st.dropin === 'stall') d.stall = (d.stall ?? 0) + 1;
      if (st.e.some((e) => e.type === 'dropIn')) d.done = i;
      if (d.stall === 3 && !d.s1) { d.s1 = 1; return 'h65_dropin_floor_tail_on_coping'; }
      if (d.done != null && i === d.done + 2) return 'h65_dropin_floor_on_wall';
      if (d.done == null && st.dropin === 'pivot') d.pv = (d.pv ?? 0) + 1;
      if (d.pv === 5 && !d.s2) { d.s2 = 1; return 'h72_dropin_bowl_floor_pivot'; }
      return null;
    },
  }], { sheetStep: 2, hud: false });
  // side-on daylight carve close-up on the steep, sunlit south wall of the main bowl (new pass-4 line, media4_search.mjs:
  // round the SE corner and west along the south wall); the floor approach is simulated but not saved (skip)
  if (want('clip31')) {
    await record(c, 'clip31_carve_side_steep_wall', [
      { ...seg('clip31', 0), label: 'carve round the SE corner and along the steep sunlit south wall: camera ahead along the wall',
        cam: { kind: 'wall', core: [-27.5, -20.5, -1.5, 1.5], center: [-24, 0], ahead: 3.0, out: 1.3, dy: 0.05, clear: 0.5, k: 4, fov: 50 },
        still: atFrames([53, 68, 83, 98], 'n_carve_along_wall') },
      { ...seg('clip31', 1), label: 'the same carve from the bowl floor, level with him',
        cam: { kind: 'dolly', axis: 'x', pos: [-24, -1.55, 3.3], range: [-30.0, -17.0], offset: -0.8, k: 4, fov: 45 },
        still: atFrames([60, 75, 90, 105], 'n_carve_from_floor') },
    ], { sheetStep: 2, hud: false });
  }
  // #59-#61: seated groups for ~7 s each from about 3 m
  if (want('clip32')) await record(c, 'clip32_people_seated_close', [
    { label: 'lifeguard in the tower, ~3 m', frames: 210, setup: () => c.api('teleport', 37, 0, 24, 180, 0), cam: { kind: 'group', idx: [13], dist: 2.8, dy: 0.05, fov: 40 } },
    { label: 'friends on the west seat steps, ~3 m', frames: 210, cam: { kind: 'group', idx: [2, 3], dist: 3.0, dy: 0.05, fov: 40 } },
    { label: 'beach couple (towel + chair), ~3 m', frames: 210, cam: { kind: 'group', idx: [11, 12], ref: 12, yaw: 20, dist: 3.0, dy: 0.5, fov: 40 } },
  ], { sheetStep: 6, hud: false });
  // #56: riding slowly along a sunlit wall (his shadow on the wall outside a bail)
  if (want('clip33')) await record(c, 'clip33_wall_ride_shadow', [
    { label: 'slow ride along the sunlit half-pipe mural wall (golden hour)', frames: 75,
      setup: async () => { await c.api('setTime', 0, true); await c.api('teleport', 15.3, 0, -14.2, 0, 2.6); },
      cam: { kind: 'rel', off: [-3.4, 0, -1.2], lookOff: [1.1, 0, 1.4], y: 1.45, lookY: 1.0, fov: 50 }, still: atFrames([35], 'h56_wall_ride_golden') },
    { label: 'closer, side-on to the wall (golden hour)', frames: 50,
      setup: () => c.api('teleport', 15.3, 0, -13.8, 0, 2.2),
      cam: { kind: 'rel', off: [-2.2, 0, 0.4], lookOff: [1.1, 0, 1.0], y: 1.25, lookY: 1.05, fov: 56 }, still: atFrames([25], 'h56_wall_ride_close_golden') },
    { label: 'the patchwork kiosk wall (golden hour)', frames: 50,
      setup: () => c.api('teleport', 21.5, 0, 23.9, 90, 2.2),
      cam: { kind: 'rel', off: [-1.0, 0, -3.6], lookOff: [0.6, 0, 1.2], y: 1.5, lookY: 1.0, fov: 50 }, still: atFrames([25], 'h56_wall_ride_kiosk_golden') },
    { label: 'half-pipe mural wall at sunset', frames: 50,
      setup: async () => { await c.api('setTime', 1, true); await c.api('teleport', 15.3, 0, -13.8, 0, 2.2); },
      cam: { kind: 'rel', off: [-2.2, 0, 0.4], lookOff: [1.1, 0, 1.0], y: 1.25, lookY: 1.05, fov: 56 }, still: atFrames([25], 'h56_wall_ride_close_sunset') },
  ], { sheetStep: 2, hud: false });
  if (want('clip33')) await c.api('setTime', 0, true);
  // #62: follow camera riding the north quarter pipe past the bank join (both directions)
  if (want('clip34')) await record(c, 'clip34_north_qp_bank_join_follow', [
    { label: 'follow cam: along the north quarter pipe, east over the join into the bank', frames: 75, setup: () => c.api('teleport', -7, 0, -19.1, 90, 5.5) },
    { label: 'follow cam: along the bank, west over the join onto the quarter pipe', frames: 80, setup: () => c.api('teleport', 3, 0, -19.3, -90, 5.5) },
    { label: 'follow cam: straight up the join (hip)', frames: 70, setup: () => c.api('teleport', -2.25, 0, -15.5, 180, 4.8) },
  ]);
  // #67: follow camera on a long high carve round the main bowl (cam workstream's carve2 line)
  if (want('clip35')) await record(c, 'clip35_bowl_follow_high_carve', [seg('clip35')]);
  // #66: the on-board idle seen from the front for 10 s (knees over toes through the weight shifts)
  if (want('clip36')) await record(c, 'clip36_idle_front_knees', [{
    frames: 300, setup: () => c.api('teleport', 9, 0, 3, 180, 0),
    cam: { kind: 'side', heading: 180, angle: 0, dist: 2.5, h: 1.0, lookH: 0.95, fov: 50, track: 'board', groundY: 0 },
  }], { hud: false });

  // ================================================================ pass-4: the pass-03 critique's "needs capture" list
  // blue hour in motion: follow cam through the lamp pools and west past the kiosk; the kiosk's town side is outside the
  // park fence (z > 26.2, not rideable), so the second segment dollies along it level with him as he rides past behind it
  if (want('clip37')) {
    await record(c, 'clip37_blue_hour_kiosk_ride', [
      { ...seg('clip37', 0), label: 'blue hour, follow cam: lamp pools, west past the kiosk', setup: async () => { await c.api('setTime', 2, true); await c.api('teleport', ...C.clip37[0].tp); } },
      { ...seg('clip37', 1), label: 'blue hour: dolly along the kiosk town side as he rides past behind it',
        cam: { kind: 'dolly', axis: 'x', pos: [33.5, 1.75, 33.6], range: [16, 36], offset: 0, k: 4, fov: 50 } },
    ]);
    await c.api('setTime', 0, true);
  }
  // flips off the funbox, side-on (pass-2 clip18 camera): west across the top, pop at its west edge, land on the flat
  const funCam = { kind: 'side', heading: -90, angle: 180, dist: 4.2, h: 1.35, lookH: 1.0, fov: 50, track: 'board', axis: 'x', fixed: -0.6, groundY: 0 };
  for (const [k, trick] of [['clip38', 'kickflip'], ['clip39', 'heelflip']]) {
    if (want(k)) await record(c, `${k}_funbox_${trick}_side`, [{ ...seg(k), label: `${trick} off the funbox's west edge, side-on`, cam: funCam,
      still: (i, st, ctx) => { const d = ctx.data; if (st.e.some((e) => e.type === 'pop')) d.pop = i; return d.pop != null && i === d.pop + 6 ? `n_funbox_${trick}_peak` : null; } }],
    { sheetStep: 2, hud: false });
  }
  // kickflip off the terrace bank (up the bank, pop at the coping, land on the terrace), side-on from the east
  if (want('clip40')) await record(c, 'clip40_bank_kickflip_side', [{ ...seg('clip40'), label: 'kickflip off the terrace bank, side-on',
    cam: { kind: 'side', heading: 0, angle: 180, dist: 4.6, h: 1.5, lookH: 1.0, fov: 50, track: 'board', axis: 'z', fixed: 0, groundY: 0 },
    still: (i, st, ctx) => { const d = ctx.data; if (st.e.some((e) => e.type === 'pop')) d.pop = i; return d.pop != null && i === d.pop + 6 ? 'n_bank_kickflip_peak' : null; } }],
  { sheetStep: 2, hud: false });
  // #72 on the half pipe: side-on at deck level (clip29 camera), west deck into the half pipe (A2's dropin_capture set-up)
  if (want('clip41')) await record(c, 'clip41_halfpipe_dropin_side_deck', [{
    label: 'half-pipe drop-in from the west deck, side-on at deck level', ...seg('clip41'),
    cam: { kind: 'side', heading: 90, angle: 0, dist: 3.2, h: 0.95, lookH: 0.55, fov: 50, deckY: true },
    still: (i, st, ctx) => {
      const d = ctx.data;
      if (st.dropin === 'stall') d.stall = (d.stall ?? 0) + 1;
      if (st.dropin === 'pivot') d.pivot = (d.pivot ?? 0) + 1;
      if (st.e.some((e) => e.type === 'dropIn')) d.done = i;
      return dropStills(d, 'halfpipe', [], i);
    },
  }], { sheetStep: 2, hud: false });
  // #68: board-height manual in direct golden sun, from behind the tail (riding away from the low sun, the raised grip faces it)
  if (want('clip42')) await record(c, 'clip42_manual_board_height_sun', [{
    label: 'manual in direct golden sun, board height, heel side behind the tail', ...seg('clip42'),
    cam: { kind: 'side', heading: 0, angle: -125, dist: 1.5, h: 0.3, lookH: 0.12, fov: 42, track: 'board', trackY: true },
    still: atFrames([36, 66], 'h68_manual_board_height_sun'),
  }], { sheetStep: 2, hud: false });
  await c.api('free');
}
