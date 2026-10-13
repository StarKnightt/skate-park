// Animation checks (workstream anim): side-on close crops at 30 fps frame steps + per-frame state/events.
// bash tools/heavy.sh anim node tools/capture/run.mjs tools/capture/anim_check.mjs --out E:/shots/skate-park/pass-02/dev/anim
// ONLY=ollie,kickflip,heelflip,shuvit,treflip,push,manual,wobble,idle,bowl,kickturn,5050,boardslide,wallbail,landbail
// EVERY=n saves every n-th frame (default per test). Sheets: python tools/capture/anim_sheet.py <out>/<test>
import fs from 'node:fs';
import path from 'node:path';

const FLIP = (key) => [{ at: 0.1, down: ['Space'] }, ...(key ? [{ at: 0.25, down: [key] }] : []), { at: 0.42, up: ['Space'] }, ...(key ? [{ at: 0.5, up: [key] }] : [])];
// tp: teleport x,y,z,headingDeg,speed. cam: side angle (deg from the toe side towards the travel direction), distance, height
const TESTS = [
  { name: 'ollie', tp: [30, 0, 20, 180, 4.5], script: FLIP(null), from: 0.32, to: 1.45, cam: [20, 2.5, 0.95] },
  { name: 'kickflip', tp: [30, 0, 20, 180, 4.5], script: FLIP('ArrowLeft'), from: 0.32, to: 1.45, cam: [20, 2.5, 0.95] },
  { name: 'heelflip', tp: [30, 0, 20, 180, 4.5], script: FLIP('ArrowRight'), from: 0.32, to: 1.45, cam: [20, 2.5, 0.95] },
  { name: 'shuvit', tp: [30, 0, 20, 180, 4.5], script: FLIP('ArrowDown'), from: 0.32, to: 1.45, cam: [20, 2.5, 0.95] },
  { name: 'treflip', tp: [30, 0, 20, 180, 4.5], script: FLIP('ArrowUp'), from: 0.32, to: 1.45, cam: [20, 2.5, 0.95] },
  { name: 'tapollie', tp: [30, 0, 20, 180, 4.5], script: [{ at: 0.1, down: ['Space'] }, { at: 0.15, up: ['Space'] }], from: 0.1, to: 0.9, cam: [20, 2.5, 0.95] },
  { name: 'push', tp: [30, 0, 20, 180, 1.2], script: [{ at: 0.0, down: ['KeyW'] }, { at: 1.6, up: ['KeyW'] }], from: 0, to: 1.6, cam: [35, 2.6, 0.95] },
  { name: 'manual', tp: [30, 0, 20, 180, 4.5], script: [{ at: 0.2, down: ['ShiftLeft'] }, { at: 3.0, up: ['ShiftLeft'] }], from: 0.2, to: 3.0, every: 3, cam: [0, 2.6, 0.9] },
  { name: 'wobble', tp: [30, 0, 20, 180, 4.5], script: [{ at: 0.1, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.75, down: ['KeyD'] }, { at: 0.84, up: ['KeyD'] }], from: 0.6, to: 2.2, every: 2, cam: [20, 2.6, 0.95] },
  { name: 'carve', tp: [31, 0, 21, 180, 5.5], script: [{ at: 0.3, down: ['KeyD'] }, { at: 0.9, up: ['KeyD'] }, { at: 1.1, down: ['KeyA'] }, { at: 1.9, up: ['KeyA'] }], from: 0.2, to: 2.4, every: 2, cam: [-90, 2.8, 1.0], track: true },
  { name: 'idle', tp: [30, 0, 20, 180, 0], script: [], from: 0, to: 14, every: 10, cam: [25, 2.4, 1.0] },
  { name: 'bowl', tp: [-11, 0, 0, -90, 5.5], script: [{ at: 2.2, down: ['KeyA'] }, { at: 3.0, up: ['KeyA'] }], from: 0.6, to: 5.6, every: 3, cam: [60, 3.2, 1.2], track: true },
  { name: 'kickturn', tp: [-24, -2.3, 0, 90, 4.6], script: [], from: 1.6, to: 3.0, every: 1, cam: [-90, 3.0, 1.0], track: true },
  { name: 'kickturn_t', tp: [-24, -2.3, 0, 90, 4.6], script: [], from: 1.6, to: 3.0, every: 1, cam: [0, 3.0, 0.8], track: true },
  { name: '5050', tp: [3.2, 0, -12.95, -90, 5.5], script: [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }, { at: 1.2, up: ['KeyE'] }], from: 0.3, to: 1.6, every: 2, cam: [-20, 2.6, 1.1] },
  { name: 'boardslide', tp: [0, 0, 4.0, 180, 6.0], script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.6, up: ['KeyE'] }], from: 0.7, to: 1.9, every: 2, cam: [10, 2.8, 1.2] },
  { name: 'wallbail', tp: [12, 0, -9, 90, 7.5], script: [], from: 0.3, to: 12.5, every: 4, cam: [-60, 3.6, 1.3], track: true },
  { name: 'tripbail', tp: [33, 0, 0, 90, 7.5], script: [], from: 0.2, to: 4.0, every: 2, cam: [-60, 3.6, 1.3], track: true },
  { name: 'facebail', tp: [30, 0, 20, 180, 4.5], script: [], bail: [0.5, 'face'], from: 0.3, to: 11, every: 4, cam: [20, 3.4, 1.2], track: true },
  { name: 'backbail', tp: [30, 0, 20, 180, 4.5], script: [], bail: [0.5, 'back'], from: 0.3, to: 11, every: 4, cam: [20, 3.4, 1.2], track: true },
];
// profile views (mostly from behind, like the follow camera) of the flat ground tricks
for (const n of ['ollie', 'kickflip', 'heelflip', 'shuvit', 'treflip', 'push', 'wobble']) {
  const t = TESTS.find((x) => x.name === n);
  TESTS.push({ ...t, name: n + '_p', cam: [-90, 2.7, 1.0] });
}
// close-ups of the legs and board during the flips (front and from behind the tail)
for (const n of ['kickflip', 'heelflip', 'treflip']) {
  const t = TESTS.find((x) => x.name === n);
  TESTS.push({ ...t, name: n + '_z', cam: [15, 2.0, 0.75], zoom: [0.0, 1.45], from: 0.45, to: 1.1 });
  TESTS.push({ ...t, name: n + '_pz', cam: [-70, 2.0, 0.75], zoom: [0.0, 1.45], from: 0.45, to: 1.1 });
}

const adv = (c, n = 1, render = true) => c.eval(([k, r]) => window.__skate.advance(k, 1 / 30, r), [n, render]);

/** camera at a fixed angle from the rider's toe side, following the skater (track=true also follows heading) */
async function aim(c, cam, base) {
  return c.eval(([cam, base]) => {
    const g = window.__skate.game, ph = g.physics, sk = g.skater;
    const V = ph.pos.constructor;
    const hips = sk.hipsWorld(new V());
    const head = base.heading;
    const fwd = new V(Math.sin(head), 0, Math.cos(head));
    const toe = new V(fwd.z, 0, -fwd.x).negate(); // rider faces the toe side (board -X)
    const a = (cam[0] * Math.PI) / 180;
    const dir = toe.clone().multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
    // flat ground: camera and crop stay at ground level so the rise of a jump shows; tracked tests follow the body
    const groundY = base.track ? Math.min(hips.y - 0.85, ph.pos.y) : base.groundY;
    const look = new V(hips.x, groundY + 0.85, hips.z);
    const pos = look.clone().addScaledVector(dir, cam[1]);
    pos.y = groundY + cam[2];
    window.__skate.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
    // screen box around the rider (for the crop)
    g.camera.position.copy(pos); g.camera.lookAt(look); g.camera.updateMatrixWorld();
    const pr = (v) => { const p = v.clone().project(g.camera); return [(p.x + 1) / 2, (1 - p.y) / 2]; };
    if (!base.track) {
      const z = base.zoom ?? [-0.05, 2.15];
      const top = pr(new V(hips.x, groundY + z[1], hips.z)), bot = pr(new V(hips.x, groundY + z[0], hips.z));
      return { top, bot, mid: pr(hips) };
    }
    const top = pr(sk.headWorld(new V()).add(new V(0, 0.25, 0)));
    const bot = pr(g.board.root.position.clone());
    const mid = pr(hips);
    return { top, bot, mid };
  }, [cam, base]);
}

/** reload the page with an inert Vite HMR socket so other agents' saves don't reload it mid-test */
export async function isolate(c) {
  await c.page.addInitScript(() => {
    const Real = window.WebSocket;
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
      return new Real(url, protocols);
    };
  });
  await c.page.reload({ waitUntil: 'load' });
  await c.page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout: 120000 });
  await c.wait(3200); // let the intro title fade
}

/** close-ups: face expressions, hands (relaxed / open), shirt hem (still / at speed / crouched) */
async function closeups(c) {
  const dir = path.join(c.out, 'closeups');
  fs.mkdirSync(dir, { recursive: true });
  const shot = async (name, part) => {
    const box = await c.eval((part) => {
      const g = window.__skate.game, sk = g.skater, V = g.physics.pos.constructor;
      const q = sk.root.quaternion;
      const fwd = new V(0, 0, 1).applyQuaternion(q).setY(0).normalize(); // facing (toe side)
      const nose = new V(1, 0, 0).applyQuaternion(q).setY(0).normalize();
      let target, pos;
      if (part === 'face') {
        target = sk.headWorld(new V()).add(new V(0, 0.11, 0));
        // the head looks over the leading shoulder: film from between the toe side and the nose
        pos = target.clone().addScaledVector(fwd, 0.42).addScaledVector(nose, 0.42).add(new V(0, 0.02, 0));
      } else if (part === 'hand') {
        target = sk.b.get('RightHand').bone.getWorldPosition(new V());
        pos = target.clone().addScaledVector(fwd, 0.45).addScaledVector(nose, -0.15).add(new V(0, 0.05, 0));
      } else {
        target = sk.hipsWorld(new V()).add(new V(0, 0.1, 0));
        pos = target.clone().addScaledVector(fwd, 1.1).addScaledVector(nose, -0.4).add(new V(0, 0.1, 0));
      }
      window.__skate.view(pos.x, pos.y, pos.z, target.x, target.y, target.z);
      g.camera.position.copy(pos); g.camera.lookAt(target); g.camera.updateMatrixWorld();
      g.render(1 / 30);
      const p = target.clone().project(g.camera);
      return [(p.x + 1) / 2, (1 - p.y) / 2, sk.expr ?? ''];
    }, part);
    const W = 1280, H = 720, cw = 520, ch = 520;
    const x = Math.max(0, Math.min(W - cw, box[0] * W - cw / 2)), y = Math.max(0, Math.min(H - ch, box[1] * H - ch / 2));
    await c.page.screenshot({ path: path.join(dir, name + '.jpg'), type: 'jpeg', quality: 90, clip: { x, y, width: cw, height: ch } });
    const st = await c.api('state');
    console.log('closeup', name, st.mode, st.phase, 'expr', box[2]);
  };
  const run = async (tp, script, sec) => { await c.api('teleport', ...tp); await adv(c, 2, false); await c.api('script', script); if (sec > 0) await adv(c, Math.round(sec * 30), false); };
  await run([30, 0, 20, 180, 0], [], 1.5); await shot('face_neutral', 'face'); await shot('hand_relaxed', 'hand'); await shot('cloth_still', 'cloth');
  await run([30, 0, 20, 180, 7.5], [], 0.4); await shot('face_focus', 'face'); await shot('cloth_speed', 'cloth');
  await run([30, 0, 20, 180, 4.5], [{ at: 0.1, down: ['Space'] }], 0.4); await shot('cloth_crouch', 'cloth');
  await c.api('script', [{ at: 0.0, up: ['Space'] }]); await adv(c, 7, false); await shot('face_wide', 'face'); await shot('hand_open', 'hand');
  await adv(c, 14, false); await shot('face_grin', 'face'); await shot('cloth_land', 'cloth');
  await run([30, 0, 20, 180, 4.5], [], 0.2);
  await c.eval(() => window.__skate.game.physics.toBail('face', 'test'));
  await adv(c, 30, false); await shot('face_grimace', 'face');
  await c.api('release');
}

export default async function (c) {
  await isolate(c);
  await c.api('manual', true);
  await c.api('hud', false);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  if (only && only.includes('closeups')) await closeups(c);
  const W = 1280, H = 720;
  for (const t of TESTS) {
    if (only && !only.includes(t.name)) continue;
    const dir = path.join(c.out, t.name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await c.api('teleport', ...t.tp);
    await c.api('events');
    await adv(c, 2);
    await c.api('script', t.script);
    const st0 = await c.api('state');
    const base = { heading: (t.tp[3] * Math.PI) / 180, track: !!t.track, groundY: st0.pos[1], zoom: t.zoom };
    const every = Number(process.env.EVERY) || t.every || 1;
    const log = [];
    let simT = 0;
    const n0 = Math.round(t.from * 30);
    if (n0 > 0) { await adv(c, n0, false); simT += n0 / 30; }
    const frames = Math.round((t.to - t.from) * 30);
    let bailed = false;
    for (let i = 0; i < frames; i++) {
      if (t.bail && !bailed && simT >= t.bail[0]) { bailed = true; await c.eval((k) => window.__skate.game.physics.toBail(k, 'test'), t.bail[1]); }
      await adv(c, 1, false);
      simT += 1 / 30;
      const st = await c.api('state');
      const ev = await c.api('events');
      const fe = await c.api('feetError');
      log.push({ f: i, t: +simT.toFixed(3), mode: st.mode, phase: st.phase, flip: st.flip, grind: st.grind, pos: st.pos, speed: st.speed, ev: ev.map((e) => e.type + (e.quality ? ':' + e.quality : '') + (e.kind ? ':' + e.kind : '')), feet: fe });
      if (i % every !== 0) continue;
      const box = await aim(c, t.cam, base);
      await c.eval(() => window.__skate.game.render(1 / 30));
      const cx = box.mid[0] * W, cy = (box.top[1] + box.bot[1]) / 2 * H;
      const hh = Math.max(260, (box.bot[1] - box.top[1]) * H * 1.3);
      const cw = Math.min(W, hh * 0.9), ch = Math.min(H, hh);
      const x = Math.max(0, Math.min(W - cw, cx - cw / 2)), y = Math.max(0, Math.min(H - ch, cy - ch / 2));
      await c.page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 88, clip: { x, y, width: cw, height: ch } });
    }
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log, null, 0));
    const evs = log.filter((l) => l.ev.length).map((l) => `${l.f}:${l.ev.join('+')}`).join(' ');
    console.log(`${t.name}: ${evs}`);
    const pop = log.find((l) => l.ev.some((e) => e.startsWith('pop'))), land = log.find((l) => l.ev.some((e) => e.startsWith('land')));
    if (pop && land) console.log(`   pop->land ${land.f - pop.f} frames (${(land.t - pop.t).toFixed(2)} s)`);
    const last = log[log.length - 1];
    console.log(`   end ${last.mode}/${last.phase} pos ${last.pos} speed ${last.speed}`);
    await c.api('release');
    await c.api('free');
  }
}
