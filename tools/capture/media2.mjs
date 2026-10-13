// Pass-2 media: screens (screens/*.png) + frame-stepped clips (frames/<clip>/f####.jpg + events.json + meta.json).
// bash tools/heavy.sh media node tools/capture/run.mjs tools/capture/media2.mjs --nohmr --out E:/shots/skate-park/pass-02 --log <log>
// ONLY=close,chars,wide,tod,extra,clip01,...,clip23 (comma list; default: everything)
import fs from 'node:fs';
import path from 'node:path';

const DT = 1 / 30;
const adv = (c, n = 1, render = true) => c.eval(([k, r]) => window.__skate.advance(k, 1 / 30, r), [n, render]);
const render = (c) => c.eval(() => window.__skate.game.render(1 / 30));
const S = (c, n) => c.shot(`screens/${n}.png`);
const plainCam = (c) => c.eval(() => {
  const s = window.__skate; s.free();
  const r = s.game.rig; r.userYaw = 0; r.userPitch = 0; r.idleT = 0; r.distOverride = null;
});
const pinCam = async (c, yaw, dist, pitch = 0) => { await c.api('snapCam'); await c.api('camYaw', yaw, pitch); await c.api('camDist', dist); };
const setFov = (c, f) => c.eval((f) => { const cam = window.__skate.game.camera; cam.fov = f; cam.updateProjectionMatrix(); }, f);
const view = async (c, v, fov = 56) => { await c.api('view', ...v); await setFov(c, fov); await adv(c, 2); };
/** release scripted keys and let the input see it (a released Space would otherwise pop an ollie after the next teleport) */
const clearInput = async (c) => { await c.api('script', []); await c.api('release'); await adv(c, 1, false); };

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
      const gy = spec.trackY ? ph.pos.y : (spec.groundY ?? 0);
      look = new V(src.x, gy + spec.lookH, src.z).addScaledVector(fwd, spec.lead ?? 0);
      if (spec.axis) { // track only along one world axis (x or z), the other stays fixed
        if (spec.axis === 'x') look.z = spec.fixed; else look.x = spec.fixed;
      }
      pos = look.clone().addScaledVector(dir, spec.dist); pos.y = gy + spec.h;
      if (spec.lookY != null) look.y = spec.lookY;
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
}

/** one frame: simulate, place the scripted camera (or keep the game's follow camera), render; returns events + state */
function stepFrame(cam) {
  const s = window.__skate, g = s.game;
  if (cam) { s.advance(1, 1 / 30, false); window.__mcam(cam); g.render(1 / 30); } else s.advance(1, 1 / 30, true);
  const e = g.eventLog.slice(); g.eventLog.length = 0;
  const ph = g.physics;
  return { e, mode: ph.mode, phase: g.skater.phase, pos: ph.pos.toArray(), fwd: ph.fwd.toArray(), speed: ph.speed, t: g.simTime };
}

/**
 * Frame-stepped clip made of one or more segments (continuous frame numbers). Segment fields:
 *  setup() (teleport, time of day...), script, frames, cam (spec | (i) => spec | null = game follow camera),
 *  onFrame(i, ctx) -> { frames?: newLength, script?: steps }, still(i, st, ctx) -> screen name | null
 */
async function record(c, name, segs, meta = {}) {
  const dir = path.join(c.out, 'frames', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ev = [], marks = [];
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
    for (let i = 0; i < end; i++, f++) {
      if (seg.onFrame) {
        const r = await seg.onFrame(i, ctx);
        if (r?.script) await c.api('script', r.script);
        if (r?.frames) end = r.frames;
      }
      let cam = typeof seg.cam === 'function' ? seg.cam(i) : seg.cam;
      if (cam && i === 0) cam = { ...cam, reset: true };
      const st = await c.eval(stepFrame, cam ?? null);
      ctx.st = st;
      for (const x of st.e) ev.push({ frame: f, ...x });
      if (st.phase !== lastPh) { if (lastPh) ev.push({ frame: f, t: +st.t.toFixed(2), type: 'phase', phase: st.phase, mode: st.mode }); lastPh = st.phase; }
      await c.page.screenshot({ path: path.join(dir, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (seg.still) { const n = seg.still(i, st, ctx); if (n) { await S(c, n); marks.push({ frame: f, still: n }); } }
    }
    await c.api('release');
  }
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(ev, null, 1));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ frames: f, marks, ...meta }, null, 1));
  console.log('clip', name, f, 'frames | events', ev.filter((e) => e.type !== 'boardClack').map((e) => `${e.frame}:${e.type}${e.phase ? '=' + e.phase : ''}${e.quality ? ':' + e.quality : ''}`).join(' '));
}

const FLIP = (t0, key, hold = 0.32) => [{ at: t0, down: ['Space'] }, ...(key ? [{ at: t0 + Math.min(0.15, hold - 0.02), down: [key] }] : []),
  { at: t0 + hold, up: ['Space'] }, ...(key ? [{ at: t0 + hold + 0.08, up: [key] }] : [])];
const KEY = (k, t0, d) => [{ at: t0, down: [k] }, { at: t0 + d, up: [k] }];
const sideCam = (heading, o = {}) => ({ kind: 'side', heading, angle: 0, dist: 2.9, h: 0.85, lookH: 0.9, fov: 50, track: 'board', ...o });
const CARVE = [{ at: 0.2, down: ['KeyA'] }, { at: 0.6, up: ['KeyA'] }, { at: 1.3, down: ['KeyD'] }, { at: 1.9, up: ['KeyD'] }, { at: 2.6, down: ['KeyA'] }, { at: 3.4, up: ['KeyA'] }];
const BOWL_MAIN = { kind: 'bowl', core: [-27.5, -20.5, -1.5, 1.5], center: [-24, 0], floor: -2.3, dist: 3.1, h: 1.05, hk: 0.55, fov: 50 };

/** wall bail into the half pipe's mural wall; once he is riding again he turns away from the wall and pushes off */
function wallBailSeg(cam, label) {
  return {
    label, frames: 480, cam,
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

  // ================================================================ (b) close-ups from the follow camera (pinned yaw, as pass-01)
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
    await trick('b_kickflip_mid', [30, 0, 20, 180, 5], FLIP(0.1, 'ArrowLeft', 0.3), midFlip, 1.2);
    await trick('b_heelflip_mid', [30, 0, 20, 180, 5], FLIP(0.1, 'ArrowRight', 0.3), midFlip, 1.2);
    await trick('b_shuvit_mid', [30, 0, 20, 180, 5], FLIP(0.1, 'ArrowDown', 0.3), midFlip, 1.2);
    await trick('b_5050', [3.2, 0, -12.95, -90, 5.5], [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }], `ph.mode==='grind'`, -1.1, 22);
    await trick('b_boardslide', [0, 0, 4.0, 180, 6.0], [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }], `ph.mode==='grind'`, 1.15, 9, 90, 2.8, 0.14);
    await at(); await trick('b_manual', [30, 0, 20, 180, 4.5], [{ at: 0.2, down: ['ShiftLeft'] }], T(t0 + 1.0 + 4 / 30), 1.25);
    await at(); await trick('b_push', [30, 0, 20, 180, 1.0], [{ at: 0.0, down: ['KeyW'] }], T(t0 + 0.36 + 4 / 30), 1.0);
    await trick('b_handrail', [7, 1, 17.2, 180, 5.0], [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }], `ph.mode==='grind'`, 1.3, 5);
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
    // chest height, front-side (the rider faces +x at heading 180)
    await view(c, [p[0] + 1.22, p[1] - 0.26, p[2] - 0.58, p[0], p[1] - 0.36, p[2]], 50); await S(c, 'b_upper_body');
    await view(c, [bp[0] + 0.78, bp[1] + 0.42, bp[2] - 0.5, bp[0], bp[1] + 0.12, bp[2]], 50); await S(c, 'b_feet_on_board');
    await c.api('free');
    // close parts (camera relative to the rider's facing; the head looks over the leading shoulder)
    const part = (name, kind) => c.eval(([kind]) => {
      const g = window.__skate.game, sk = g.skater, V = g.physics.pos.constructor;
      const q = sk.root.quaternion;
      const fwd = new V(0, 0, 1).applyQuaternion(q).setY(0).normalize(), nose = new V(1, 0, 0).applyQuaternion(q).setY(0).normalize();
      let target, pos;
      let fov = 50;
      if (kind === 'face') { target = sk.headWorld(new V()).add(new V(0, 0.1, 0)); pos = target.clone().addScaledVector(fwd, 0.5).addScaledVector(nose, 0.45).add(new V(0, 0.03, 0)); }
      else if (kind === 'faceup') {
        // lying on his back: look down at the face from above the chest
        const head = sk.headWorld(new V()), hips = sk.hipsWorld(new V());
        const toHips = hips.clone().sub(head).setY(0).normalize();
        target = head.clone(); pos = head.clone().addScaledVector(toHips, 0.32).add(new V(0, 0.62, 0));
      }
      else if (kind === 'hand') {
        const hand = sk.b.get('RightHand').bone.getWorldPosition(new V());
        target = hand.clone().add(new V(0, -0.04, 0)); pos = target.clone().addScaledVector(fwd, 0.38).addScaledVector(nose, -0.12).add(new V(0, 0.05, 0)); fov = 45;
      }
      else { target = sk.hipsWorld(new V()).add(new V(0, 0.08, 0)); pos = target.clone().addScaledVector(fwd, 1.25).addScaledVector(nose, -0.45).add(new V(0, 0.12, 0)); }
      window.__skate.view(pos.x, pos.y, pos.z, target.x, target.y, target.z);
      g.camera.fov = fov; g.camera.updateProjectionMatrix();
      g.camera.position.copy(pos); g.camera.lookAt(target); g.camera.updateMatrixWorld();
      g.render(1 / 30);
      return sk.expr ?? '';
    }, [kind]).then(async (expr) => { await S(c, name); console.log('char', name, 'expr', expr); });
    const run = async (tp, script, sec) => { await c.api('free'); await clearInput(c); await c.api('teleport', ...tp); await adv(c, 2, false); await c.api('script', script); if (sec > 0) await adv(c, Math.round(sec * 30), false); };
    await run([30, 0, 20, 180, 0], [], 1.5); await part('b_face_neutral', 'face'); await part('b_hands_relaxed', 'hand'); await part('b_cloth_still', 'cloth');
    await run([30, 0, 20, 180, 7.5], [], 0.4); await part('b_face_focus', 'face'); await part('b_cloth_speed', 'cloth');
    await run([30, 0, 20, 180, 4.5], [{ at: 0.1, down: ['Space'] }], 0.45); await part('b_cloth_crouch', 'cloth');
    await c.api('script', [{ at: 0.0, up: ['Space'] }]); await adv(c, 7, false); await part('b_face_wide', 'face'); await part('b_hands_open', 'hand');
    await until(c, `ph.mode==='ride'`, 40); await adv(c, 2, false); await part('b_cloth_land', 'cloth');
    await adv(c, 6, false); await part('b_face_grin', 'face');
    await run([30, 0, 20, 180, 4.5], [], 0.2);
    await c.eval(() => window.__skate.game.physics.toBail('back', 'test'));
    await adv(c, 6, false); await part('b_face_grimace', 'face');
    await c.api('release');
    await c.api('free');
  }

  // ================================================================ (c)(d) park elements and scenery
  if (want('wide')) {
    await c.api('teleport', 37, 0, 24, 180, 0); // park the skater out of the way
    await adv(c, 4);
    const views = {
      // pass-01 views (same cameras)
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
      // pass-02: new connecting lines and structure details (park.landmarks)
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
    for (const [n, v] of Object.entries(views)) {
      if (n === 'd_ground_low_feet') { await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 10); }
      await view(c, v);
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

  // ================================================================ (g) needs-capture stills: scale, lamp light, backlight
  if (want('extra')) {
    // scale: standing at the foot of the half pipe's west wall (3.0 m + coping) and the NW quarter pipe (1.4 m)
    await c.api('teleport', 22.6, 0, -3.8, 90, 0); await adv(c, 30);
    await view(c, [23.8, 1.6, 2.8, 21.4, 1.7, -3.6]); await S(c, 'g_scale_halfpipe');
    await c.api('teleport', -25.3, 0, -18.7, 180, 0); await adv(c, 30);
    await view(c, [-20.6, 1.2, -17.4, -25.6, 0.85, -19.6]); await S(c, 'g_scale_quarterpipe');
    await c.api('free');
    // blue hour: skater next to the lamp at (10, 0, -22.4): warm pool + lamp shadow
    await c.api('setTime', 2, true);
    await c.api('teleport', 10.6, 0, -19.6, 200, 0); await adv(c, 12);
    await view(c, [14.5, 1.9, -15.5, 10.4, 0.8, -20.5]); await S(c, 'g_lamp_blue_hour');
    await view(c, [12.6, 1.35, -17.6, 10.5, 0.95, -19.9]); await S(c, 'g_lamp_blue_hour_close');
    await view(c, [4.0, 2.6, -12.0, 10.0, 0.4, -21.0]); await S(c, 'g_lamp_blue_hour_pool');
    await c.api('free'); await pinCam(c, 0.35, 3.4, 0.05); await adv(c, 8); await S(c, 'g_lamp_blue_hour_follow');
    // backlight: the rider between the camera and the low sun (rim light), plus a front-lit reference
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

  await c.api('hud', true);
  // clips show the HUD as during play: the 6 s controls hint of a fresh page has already faded (CSS fade is wall-clock)
  await c.eval(() => window.__skate.game.hud.update(10));
  await c.wait(1500);
  // ================================================================ clips: default follow camera (pass-01 set)
  if (want('clip01')) await record(c, 'clip01_push_carve_bowl', [{
    frames: 390, setup: () => c.api('teleport', -2, 0, 1.5, -90, 1.5),
    script: [...KEY('KeyW', 0, 2.2), ...KEY('KeyD', 4.0, 0.35), ...KEY('KeyW', 7.6, 0.7)],
  }]);
  if (want('clip02')) {
    const s = [];
    ['', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].forEach((k, i) => {
      const t0 = 0.3 + i * 1.75;
      s.push(...FLIP(t0, k, 0.32));
      if (i < 4) s.push(...KEY('KeyW', t0 + 1.15, 0.4));
    });
    s.push(...KEY('KeyS', 8.1, 1.4));
    await record(c, 'clip02_flatground_flips', [{ frames: 285, setup: () => c.api('teleport', -20, 0, 10.5, 90, 5.6), script: s }]);
  }
  if (want('clip03')) await record(c, 'clip03_bank_funbox_flips', [{
    frames: 300, setup: () => c.api('teleport', 11, 0, -0.6, -90, 6.4),
    script: [{ at: 1.15, down: ['Space'] }, { at: 1.3, down: ['ArrowLeft'] }, { at: 1.45, up: ['Space'] }, { at: 1.55, up: ['ArrowLeft'] },
      ...KEY('KeyD', 3.0, 1.2), { at: 5.3, down: ['Space'] }, { at: 5.45, down: ['ArrowDown'] }, { at: 5.6, up: ['Space'] }, { at: 5.7, up: ['ArrowDown'] }],
  }]);
  if (want('clip04')) await record(c, 'clip04_grinds_5050_boardslide', [
    { label: '50-50 down the stair handrail', frames: 78, setup: () => c.api('teleport', 7, 1, 17.4, 180, 5.0),
      script: [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }] },
    { label: 'boardslide on the funbox flat bar', frames: 132, preroll: 0, setup: () => c.api('teleport', 0, 0, 4.0, 180, 6.0),
      script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.8, up: ['KeyE'] }] },
  ]);
  if (want('clip05')) await record(c, 'clip05_manual', [{ frames: 210, setup: () => c.api('teleport', 34, 0, 18, 180, 5.0), script: KEY('ShiftLeft', 0.6, 3.6) }]);
  if (want('clip06')) await record(c, 'clip06_sketchy_landing_wobble', [{
    frames: 210, setup: () => c.api('teleport', 34, 0, 18, 180, 5.0),
    script: [{ at: 0.6, down: ['Space'] }, { at: 0.92, up: ['Space'] }, ...KEY('KeyD', 1.25, 0.09)],
  }]);
  if (want('clip07')) await record(c, 'clip07_bail_and_get_up', [wallBailSeg(null)]);
  if (want('clip08')) await record(c, 'clip08_halfpipe_vert_air', [{ frames: 330, setup: () => c.api('teleport', 22.5, 0, -9, 90, 9.6), script: KEY('KeyW', 2.6, 0.8) }]);
  if (want('clip09')) await record(c, 'clip09_camera_orbit_idle', [{
    frames: 450, setup: async () => { await c.api('teleport', 9, 0, 3, 180, 0); await c.api('snapCam'); await c.api('camDist', null); await c.api('orbit', 0.47, 3.0, 0.25); },
  }]);

  // ================================================================ clips: needs-capture set (scripted side / close cameras)
  if (want('clip10')) await record(c, 'clip10_grinds_trucks_side', [
    { label: '50-50 on the long ledge (camera on the grind side at truck height)', frames: 100,
      setup: () => c.api('teleport', 3.2, 0, -12.95, -90, 5.5),
      script: [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }, { at: 1.2, up: ['KeyE'] }],
      cam: { kind: 'side', heading: -90, dist: 1.55, h: 0.62, lookH: 0.5, fov: 45, track: 'board', axis: 'x', fixed: -12.6 },
      still: (i, st, ctx) => { const d = ctx.data; if (st.mode === 'grind') d.g = (d.g ?? 0) + 1; return d.g === 24 ? 'b_grind_5050_trucks' : null; } },
    { label: 'boardslide on the funbox flat bar (camera on the bar axis)', frames: 72,
      setup: () => c.api('teleport', 0, 0, 4.0, 180, 6.0), preroll: 0,
      script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.8, up: ['KeyE'] }],
      cam: { kind: 'side', heading: 90, angle: 90, dist: 1.9, h: 1.08, lookH: 0.95, fov: 45, track: 'board', axis: 'x', fixed: -1.32, groundY: 0, lookY: 0.9 },
      still: (i, st, ctx) => { const d = ctx.data; if (st.mode === 'grind') d.g = (d.g ?? 0) + 1; return d.g === 9 ? 'b_grind_boardslide_trucks' : null; } },
    { label: 'boardslide on the funbox flat bar (camera across the bar)', frames: 72,
      setup: () => c.api('teleport', 0, 0, 4.0, 180, 6.0), preroll: 0,
      script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.8, up: ['KeyE'] }],
      cam: { kind: 'side', heading: 90, angle: 0, dist: 1.7, h: 1.12, lookH: 0.9, fov: 45, track: 'board', axis: 'x', fixed: -1.5, groundY: 0 },
      still: (i, st, ctx) => { const d = ctx.data; if (st.mode === 'grind') d.g = (d.g ?? 0) + 1; return d.g === 9 ? 'b_grind_boardslide_side' : null; } },
    { label: '50-50 down the stair handrail (camera beside the rail)', frames: 60,
      setup: () => c.api('teleport', 7, 1, 17.4, 180, 5.0), preroll: 0,
      script: [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }],
      cam: { kind: 'side', heading: 180, angle: 0, dist: 1.7, h: 0.32, lookH: 0.12, fov: 45, track: 'board', axis: 'z', fixed: 7, trackY: true },
      still: (i, st, ctx) => { const d = ctx.data; if (st.mode === 'grind') d.g = (d.g ?? 0) + 1; return d.g === 5 ? 'b_grind_handrail_trucks' : null; } },
  ], { sheetStep: 2 });
  if (want('clip11')) await record(c, 'clip11_bowl_carve_side', [{
    frames: 150, setup: () => c.api('teleport', -28, -2.3, -2.0, 90, 7.5), script: CARVE, cam: BOWL_MAIN,
  }], { sheetStep: 2 });
  for (const [k, name, key] of [['clip12', 'clip12_ollie_side', null], ['clip13', 'clip13_kickflip_side', 'ArrowLeft'], ['clip14', 'clip14_heelflip_side', 'ArrowRight'], ['clip15', 'clip15_shuvit_side', 'ArrowDown']]) {
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
  if (want('clip18')) await record(c, 'clip18_funbox_kickflip_side', [{
    frames: 100, setup: () => c.api('teleport', 11, 0, -0.6, -90, 6.4),
    script: [{ at: 1.15, down: ['Space'] }, { at: 1.3, down: ['ArrowLeft'] }, { at: 1.45, up: ['Space'] }, { at: 1.55, up: ['ArrowLeft'] }],
    cam: { kind: 'side', heading: -90, angle: 180, dist: 4.2, h: 1.35, lookH: 1.0, fov: 50, track: 'board', axis: 'x', fixed: -0.6, groundY: 0 },
  }], { sheetStep: 2 });
  if (want('clip19')) await record(c, 'clip19_blue_hour_lamp_pass', [{
    frames: 150, setup: async () => { await c.api('setTime', 2, true); await c.api('teleport', -28, 0, 23.6, 90, 5.5); },
    script: [...KEY('KeyW', 1.0, 0.5), ...KEY('KeyS', 2.9, 1.7)],
  }]);
  if (want('clip19')) await c.api('setTime', 0, true);
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
  if (want('clip23')) await record(c, 'clip23_wall_bail_close', [wallBailSeg({ kind: 'side', heading: 90, angle: -60, dist: 3.6, h: 1.3, lookH: 0.85, fov: 50, track: 'hips' })], { sheetStep: 4 });
  if (want('clip24')) await record(c, 'clip24_manual_side', [{
    frames: 135, setup: () => c.api('teleport', 30, 0, 22, 180, 4.5), script: KEY('ShiftLeft', 0.4, 2.9), cam: sideCam(180, { angle: 10 }),
  }], { sheetStep: 2 });
  if (want('clip25')) await record(c, 'clip25_sketchy_landing_side', [{
    frames: 105, setup: () => c.api('teleport', 30, 0, 22, 180, 4.5),
    script: [{ at: 0.6, down: ['Space'] }, { at: 0.92, up: ['Space'] }, ...KEY('KeyD', 1.25, 0.09)], cam: sideCam(180, { angle: 20 }),
  }], { sheetStep: 2 });
  await c.api('free');
}
