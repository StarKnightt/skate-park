// Pass-3 animation checks (workstream anim): flip legs side by side, drop-in, idle knees, grip readability, hands.
// bash tools/heavy.sh anim node tools/capture/run.mjs tools/capture/anim3.mjs --out E:/shots/skate-park/pass-03/dev/anim
// ONLY=flips,dropin,idle,grip,hands (comma list; default all). Strips: python tools/capture/anim3_strip.py <out>
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './anim_check.mjs';

const adv = (c, n = 1, render = true) => c.eval(([k, r]) => window.__skate.advance(k, 1 / 30, r), [n, render]);
const FLIP = (t0, key, hold = 0.32) => [{ at: t0, down: ['Space'] }, ...(key ? [{ at: t0 + Math.min(0.15, hold - 0.02), down: [key] }] : []),
  { at: t0 + hold, up: ['Space'] }, ...(key ? [{ at: t0 + hold + 0.08, up: [key] }] : [])];
const W = 1280, H = 720;

/** camera from the start heading's side (angle 0 = toe side, +90 = ahead), tracking the board; returns the screen point of `look` */
async function cam(c, o) {
  return c.eval((o) => {
    const g = window.__skate.game, ph = g.physics, V = ph.pos.constructor;
    const h = (o.heading * Math.PI) / 180, fwd = new V(Math.sin(h), 0, Math.cos(h));
    const a = (o.angle * Math.PI) / 180;
    const dir = new V(-fwd.z, 0, fwd.x).multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
    const b = g.board.root.position;
    if (o.deckY) { if (window.__deckY == null || o.reset) window.__deckY = ph.pos.y; }
    const gy = o.deckY ? window.__deckY : o.groundY ?? ph.pos.y;
    const look = new V(b.x, (o.trackY ? b.y : gy) + o.lookH, b.z).addScaledVector(fwd, o.lead ?? 0);
    if (o.deckY) look.y = Math.max(gy - 1.6, Math.min(gy + o.lookH, (b.y + sk_hips(g, V).y) / 2));
    const pos = look.clone().addScaledVector(dir, o.dist); pos.y = (o.trackY ? b.y : gy) + o.h;
    if (o.deckY) pos.y = Math.max(look.y + 0.2, gy + o.h - 0.5 * Math.max(0, gy - b.y));
    function sk_hips(g, V) { return g.skater.hipsWorld(new V()); }
    const cm = g.camera;
    if (Math.abs(cm.fov - o.fov) > 0.01) { cm.fov = o.fov; cm.updateProjectionMatrix(); }
    window.__skate.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
    cm.position.copy(pos); cm.lookAt(look); cm.updateMatrixWorld();
    g.render(1 / 30);
    const p = look.clone().project(cm);
    return [(p.x + 1) / 2, (1 - p.y) / 2];
  }, o);
}

async function clipShot(c, file, pt, cw, ch) {
  const x = Math.max(0, Math.min(W - cw, pt[0] * W - cw / 2)), y = Math.max(0, Math.min(H - ch, pt[1] * H - ch / 2));
  await c.page.screenshot({ path: file, type: 'jpeg', quality: 92, clip: { x, y, width: cw, height: ch } });
}

/** per-frame leg/board data (root space): ankles, knees, board roll */
const probe = () => {
  const g = window.__skate.game, sk = g.skater, ph = g.physics, V = ph.pos.constructor;
  const r = (n) => { const p = sk.b.get(n).bone.getWorldPosition(new V()); return sk.root.worldToLocal(p).toArray().map((v) => +v.toFixed(3)); };
  return { mode: ph.mode, flip: ph.flip ? { k: ph.flip.kind, t: +ph.flip.t.toFixed(3), d: ph.flip.delay, dur: +ph.flip.dur.toFixed(3), done: ph.flip.done } : null,
    fAnk: r('LeftFoot'), bAnk: r('RightFoot'), fKnee: r('LeftLeg'), bKnee: r('RightLeg'), fHip: r('LeftUpLeg'), bHip: r('RightUpLeg'),
    fToe: r('LeftToeBase'), bToe: r('RightToeBase'), dropin: ph.dropin ? ph.dropin.phase : null, up: ph.up.toArray().map((v) => +v.toFixed(3)), pos: ph.pos.toArray().map((v) => +v.toFixed(3)) };
};

async function flips(c) {
  const tricks = [['ollie', null], ['kickflip', 'ArrowLeft'], ['heelflip', 'ArrowRight'], ['shuvit', 'ArrowDown'], ['treflip', 'ArrowUp']];
  const views = [
    // wide enough for the kickflip/heelflip front foot swept ~0.7 m ahead of the board
    { tag: 'side', heading: 180, angle: 0, dist: 2.1, h: 0.62, lookH: 0.55, fov: 45, cw: 760, ch: 520 },
    { tag: 'q35', heading: 180, angle: 35, dist: 2.1, h: 0.62, lookH: 0.55, fov: 45, cw: 560, ch: 520 },
    // the pass-02 clip13-15 camera (media2 sideCam(180))
    { tag: 'crit', heading: 180, angle: 0, dist: 2.9, h: 0.85, lookH: 0.9, fov: 50, cw: 620, ch: 700 },
  ].filter((v) => !process.env.VIEWS || process.env.VIEWS.split(',').includes(v.tag));
  for (const v of views) {
    for (const [name, key] of tricks) {
      const dir = path.join(c.out, 'flips', `${v.tag}_${name}`);
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      await c.api('script', []); await c.api('release'); await adv(c, 1, false);
      await c.api('teleport', 30, 0, 22, 180, 4.5);
      await adv(c, 2, false);
      await c.api('script', FLIP(0.4, key, 0.32));
      await c.api('events');
      const log = [];
      let popF = -1;
      for (let i = 0; i < 40; i++) {
        await adv(c, 1, false);
        const ev = await c.api('events');
        if (popF < 0 && ev.some((e) => e.type === 'pop')) popF = i;
        const d = await c.eval(probe);
        log.push({ i, ev: ev.map((e) => e.type), ...d });
        if (popF < 0 || i < popF - 1 || i > popF + 20) continue;
        const pt = await cam(c, v);
        await clipShot(c, path.join(dir, `f${String(i - popF).padStart(2, '0')}.jpg`), pt, v.cw, v.ch);
      }
      fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log));
      const land = log.find((l) => l.i > popF && l.ev.includes('land'));
      console.log(`${v.tag} ${name}: pop f${popF} land ${land ? 'f' + land.i + ' (+' + (land.i - popF) + ')' : '-'}`);
    }
  }
}

/** bowl / half pipe / quarter pipe drop-ins from the deck: side-on close, deck-level and from the bowl floor */
async function dropin(c) {
  // side: on the toe side level with the coping, looking along it; q45: ahead of the rider on the toe side, looking back
  const SIDE = (heading, dist = 3.2) => ({ heading, angle: 0, dist, h: 0.95, lookH: 0.55, fov: 50, groundY: null, deckY: true, cw: 700, ch: 680 });
  const runs = [
    // main bowl east coping x = -15, rolling west from the plaza
    { name: 'bowl_side', tp: [-12.5, 0, 0.6, -90, 4.5], frames: 40, cam: SIDE(-90) },
    { name: 'bowl_q45', tp: [-12.5, 0, 0.6, -90, 4.5], frames: 40, cam: { ...SIDE(-90, 3.4), angle: 50 } },
    { name: 'bowl_floor', tp: [-12.5, 0, 0.6, -90, 4.5], frames: 40, fixed: { pos: [-19.6, -1.45, -2.6], look: [-15.4, -0.2, 0.6] } },
    { name: 'bowl_fast', tp: [-11, 0, 0.6, -90, 6.5], frames: 34, cam: SIDE(-90) },
    { name: 'bowl_slow', tp: [-14.0, 0, 0.6, -90, 1.4], frames: 44, cam: SIDE(-90) },
    // half pipe west deck (top 3.0, coping x = 19.2), rolling east into the half pipe
    { name: 'hp_side', tp: [17.4, 3.0, -9.0, 90, 4.0], frames: 40, cam: SIDE(90, 3.4) },
    // north quarter (top 1.2, coping z = -20.3, ramp descends to +z); deck behind it
    { name: 'nqp_side', tp: [-7.5, 1.2, -21.3, 0, 3.5], frames: 36, cam: SIDE(0) },
    // pass-02 clip01: push, carve, roll into the main bowl with the game's own follow camera
    { name: 'clip01', tp: [-2, 0, 1.5, -90, 1.5], frames: 40, follow: true,
      script: [{ at: 0, down: ['KeyW'] }, { at: 2.2, up: ['KeyW'] }, { at: 4.0, down: ['KeyD'] }, { at: 4.35, up: ['KeyD'] }] },
  ];
  const only = process.env.DROP ? process.env.DROP.split(',') : null;
  for (const r of runs) {
    if (only && !only.includes(r.name)) continue;
    const dir = path.join(c.out, 'dropin', r.name);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    await c.api('script', []); await c.api('release'); await adv(c, 1, false);
    await c.api('free');
    await c.api('teleport', ...r.tp);
    if (r.follow) { await c.api('snapCam'); await c.eval(() => { const cm = window.__skate.game.camera; cm.fov = 58; cm.updateProjectionMatrix(); }); }
    await adv(c, 1, false);
    if (r.script) await c.api('script', r.script);
    await c.api('events');
    await c.eval(() => { window.__deckY = null; });
    const log = [];
    let started = -1;
    for (let i = 0; i < 400 && (started < 0 || i < started + r.frames); i++) {
      await adv(c, 1, false);
      const ev = await c.api('events');
      const d = await c.eval(probe);
      log.push({ i, ev: ev.map((e) => e.type + (e.quality ? ':' + e.quality : '')), ...d });
      if (started < 0 && (d.dropin || d.mode === 'air')) started = Math.max(0, i - 8);
      if (started < 0) continue;
      let pt;
      if (r.follow) {
        await c.eval(() => window.__skate.game.render(1 / 30));
        await c.page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 90 });
        continue;
      }
      if (r.fixed) {
        await c.api('view', ...r.fixed.pos, ...r.fixed.look);
        await c.eval(() => { const g = window.__skate.game; g.camera.fov = 50; g.camera.updateProjectionMatrix(); g.camera.position.copy(g.rig.override.pos); g.camera.lookAt(g.rig.override.look); g.camera.updateMatrixWorld(); g.render(1 / 30); });
        await c.page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 90 });
        continue;
      }
      pt = await cam(c, r.cam);
      await clipShot(c, path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), pt, r.cam.cw, r.cam.ch);
    }
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log));
    const evs = log.filter((l) => l.ev.length).map((l) => `${l.i}:${l.ev.join('+')}`).join(' ');
    const ph = log.filter((l, k) => k === 0 || l.dropin !== log[k - 1].dropin || l.mode !== log[k - 1].mode).map((l) => `${l.i}:${l.mode}/${l.dropin ?? '-'}`).join(' ');
    console.log(`dropin ${r.name}: events ${evs}\n   phases ${ph}`);
  }
}

/** idle + weight shifts from the front (toe side) and the front quarter, plus knee-over-toe numbers */
async function idle(c) {
  const dir = path.join(c.out, 'idle');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await c.api('script', []); await c.api('release'); await adv(c, 1, false);
  await c.api('teleport', 9, 0, 3, 180, 0);
  const rows = [];
  for (let i = 0; i < 420; i++) {
    await adv(c, 1, false);
    const d = await c.eval(probe);
    rows.push(d);
    if (i % 30 === 0) {
      for (const [tag, angle] of [['front', 0], ['q30', 30], ['qm40', -40]]) {
        const pt = await cam(c, { heading: 180, angle, dist: 2.3, h: 0.9, lookH: 0.62, fov: 45, groundY: 0 });
        await clipShot(c, path.join(dir, `${tag}_${String(i).padStart(3, '0')}.jpg`), pt, 460, 620);
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(rows));
}

/** knees over the toes through weight shifts: idle (+ foot fidget), crouch + landing, carve, manual; constraint on / off */
async function knees(c) {
  const dir = path.join(c.out, 'knees');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ctxs = [
    { name: 'idle', tp: [9, 0, 3, 180, 0], script: [], frames: 150, shots: [40, 100, 140], fidget: true },
    { name: 'crouch_land', tp: [30, 0, 20, 180, 3.0], script: [{ at: 0.1, down: ['Space'] }, { at: 0.75, up: ['Space'] }], frames: 50, shots: [18, 42, 46] },
    { name: 'carve', tp: [31, 0, 21, 180, 5.5], script: [{ at: 0.1, down: ['KeyD'] }, { at: 0.8, up: ['KeyD'] }, { at: 0.9, down: ['KeyA'] }, { at: 1.6, up: ['KeyA'] }], frames: 50, shots: [15, 40] },
    { name: 'manual', tp: [30, 0, 20, 180, 4.5], script: [{ at: 0.05, down: ['ShiftLeft'] }, { at: 1.6, up: ['ShiftLeft'] }], frames: 45, shots: [30] },
  ];
  const metric = (r) => {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    // (1) inward (towards the other foot) offset of the knee from the vertical plane of the foot
    // (2) frontal view (rider faces root +Z, root X = nose): knee offset towards the midline from the hip-ankle line
    const inward = (knee, ank, toe, other, hip, side) => {
      let fx = toe[0] - ank[0], fz = toe[2] - ank[2]; const l = Math.hypot(fx, fz); fx /= l; fz /= l;
      let nx = -fz, nz = fx; const o = sub(other, ank); if (nx * o[0] + nz * o[2] < 0) { nx = -nx; nz = -nz; }
      const k = sub(knee, ank);
      const t = (hip[1] - knee[1]) / Math.max(1e-3, hip[1] - ank[1]);
      const lx = hip[0] + (ank[0] - hip[0]) * t;
      return [k[0] * nx + k[2] * nz, side * (lx - knee[0])];
    };
    const f = inward(r.fKnee, r.fAnk, r.fToe, r.bAnk, r.fHip, 1), b = inward(r.bKnee, r.bAnk, r.bToe, r.fAnk, r.bHip, -1);
    return [f[0], b[0], f[1], b[1]];
  };
  const summary = [];
  for (const kw of [1, 0]) {
    await c.eval((kw) => { window.__skate.game.skater.kneeW = kw; }, kw);
    for (const x of ctxs) {
      await c.api('script', []); await c.api('release'); await adv(c, 1, false);
      await c.api('teleport', ...x.tp); await adv(c, 2, false);
      await c.api('script', x.script);
      let fMax = -1, bMax = -1, fL = -1, bL = -1;
      for (let i = 0; i < x.frames; i++) {
        if (x.fidget && i === 30) await c.eval(() => { const f = window.__skate.game.skater.fid; f.n = 2; f.wait = 0; f.kind = ''; });
        await adv(c, 1, false);
        const [fi, bi, fl, bl] = metric(await c.eval(probe));
        fMax = Math.max(fMax, fi); bMax = Math.max(bMax, bi); fL = Math.max(fL, fl); bL = Math.max(bL, bl);
        if (x.shots.includes(i)) {
          for (const [tag, angle] of [['front', 0], ['q30', 30]]) {
            const pt = await cam(c, { heading: 180, angle, dist: 2.3, h: 0.9, lookH: 0.62, fov: 45, groundY: 0 });
            await clipShot(c, path.join(dir, `${x.name}_${tag}_${String(i).padStart(3, '0')}_k${kw}.jpg`), pt, 460, 620);
          }
        }
      }
      summary.push(`kneeW ${kw} ${x.name}: knee inward of foot plane: front ${(fMax * 100).toFixed(1)} back ${(bMax * 100).toFixed(1)} cm | front view, towards the midline: front ${(fL * 100).toFixed(1)} back ${(bL * 100).toFixed(1)} cm`);
    }
  }
  await c.eval(() => { window.__skate.game.skater.kneeW = 1; });
  console.log(summary.join('\n'));
  fs.writeFileSync(path.join(dir, 'summary.txt'), summary.join('\n'));
}

/** mid-flip grip side towards the camera, golden hour, front-lit and backlit */
async function grip(c) {
  const dir = path.join(c.out, 'grip');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const [name, key] of [['kickflip', 'ArrowLeft'], ['heelflip', 'ArrowRight']]) {
    await c.api('script', []); await c.api('release'); await adv(c, 1, false);
    await c.api('teleport', 30, 0, 22, 180, 4.5);
    await adv(c, 2, false);
    await c.api('events');
    await c.api('script', FLIP(0.4, key, 0.32));
    let popF = -1;
    const evs = [];
    for (let i = 0; i < 40; i++) {
      await adv(c, 1, false);
      const ev = await c.api('events');
      evs.push(...ev.map((e) => `${i}:${e.type}${e.flip ? '<' + e.flip + '>' : ''}`));
      if (popF < 0 && ev.some((e) => e.type === 'pop')) popF = i;
      if (i === 39) console.log(`grip ${name}: ${evs.join(' ')}`);
      if (popF < 0 || i < popF + 3 || i > popF + 12) continue;
      const pt = await cam(c, { heading: 180, angle: 20, dist: 1.6, h: 0.5, lookH: 0.3, fov: 40, trackY: false });
      await clipShot(c, path.join(dir, `${name}_f${String(i - popF).padStart(2, '0')}.jpg`), pt, 420, 320);
      const pt2 = await cam(c, { heading: 180, angle: 200, dist: 1.6, h: 0.5, lookH: 0.3, fov: 40, trackY: false });
      await clipShot(c, path.join(dir, `${name}_back_f${String(i - popF).padStart(2, '0')}.jpg`), pt2, 420, 320);
    }
  }
}

/** open hand (in the air after a pop) and relaxed hand close-ups + forearm skin vs face */
async function hands(c) {
  const dir = path.join(c.out, 'hands');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const shot = async (name, bone, off) => {
    const pt = await c.eval(([bone, off]) => {
      const g = window.__skate.game, sk = g.skater, V = g.physics.pos.constructor;
      const q = sk.root.quaternion;
      const fwd = new V(0, 0, 1).applyQuaternion(q).setY(0).normalize();
      const nose = new V(1, 0, 0).applyQuaternion(q).setY(0).normalize();
      const target = sk.b.get(bone).bone.getWorldPosition(new V());
      const pos = target.clone().addScaledVector(fwd, off[0]).addScaledVector(nose, off[1]).add(new V(0, off[2], 0));
      window.__skate.view(pos.x, pos.y, pos.z, target.x, target.y, target.z);
      g.camera.fov = 40; g.camera.updateProjectionMatrix();
      g.camera.position.copy(pos); g.camera.lookAt(target); g.camera.updateMatrixWorld();
      g.render(1 / 30);
      const p = target.clone().project(g.camera);
      return [(p.x + 1) / 2, (1 - p.y) / 2];
    }, [bone, off]);
    await clipShot(c, path.join(dir, name + '.jpg'), pt, 520, 520);
  };
  await c.api('script', []); await c.api('release'); await adv(c, 1, false);
  await c.api('teleport', 30, 0, 20, 180, 0); await adv(c, 45, false);
  await shot('relaxed_R', 'RightHand', [0.42, -0.12, 0.04]);
  await shot('face_ref', 'Head', [0.55, 0.35, 0.02]);
  await shot('arm_face_mid', 'RightForeArm', [0.9, 0.2, 0.25]);
  // cap adjust: the hand right next to the face, same light (skin match)
  await adv(c, 30, false);
  await c.eval(() => { const f = window.__skate.game.skater.fid; f.n = 1; f.wait = 0; f.kind = ''; });
  await adv(c, 30, false);
  await shot('cap_hand_face', 'Head', [0.62, 0.2, -0.02]);
  await shot('cap_hand_face_side', 'Head', [0.35, -0.5, 0.0]);
  await c.api('teleport', 30, 0, 20, 180, 4.5); await adv(c, 2, false);
  await c.api('script', [{ at: 0.05, down: ['Space'] }, { at: 0.4, up: ['Space'] }]);
  await adv(c, 19, false);
  await shot('open_R', 'RightHand', [0.42, -0.1, 0.05]);
  await shot('open_R_top', 'RightHand', [0.2, -0.05, 0.4]);
  await shot('open_L', 'LeftHand', [0.42, 0.12, 0.05]);
  // manual: arms out, hands open
  await c.api('teleport', 30, 0, 20, 180, 4.5); await adv(c, 2, false);
  await c.api('script', [{ at: 0.05, down: ['ShiftLeft'] }, { at: 2.0, up: ['ShiftLeft'] }]);
  await adv(c, 30, false);
  await shot('manual_open_R', 'RightHand', [0.45, -0.1, 0.05]);
  await shot('manual_body', 'Spine1', [1.6, 0.4, 0.1]);
  await c.api('release');
}

export default async function (c) {
  await isolate(c);
  await c.api('manual', true);
  await c.api('hud', false);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  if (want('flips')) await flips(c);
  if (want('dropin')) await dropin(c);
  if (want('idle')) await idle(c);
  if (want('knees')) await knees(c);
  if (want('grip')) await grip(c);
  if (want('hands')) await hands(c);
}
