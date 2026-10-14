// Shared helpers for the real-time protocol (read-only against the game; outputs go under E:/shots/skate-park/pass-04).
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';

const require = createRequire('C:/Code/skate-park/package.json');
export const { chromium } = require('playwright-core');

export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// test windows live on the portrait second monitor (DISPLAY2: x 1920..3000, work area 1080x1862), never at x < 1920
export const SCREEN = { x: 1920, y: 0, w: 1080, h: 1862 };

export async function launch({ url, winW = 880, winH = 640, wx = 1930, wy = 20, nohmr = true }) {
  wx = Math.max(1930, wx); wy = Math.max(0, wy); winW = Math.min(winW, 1060); winH = Math.min(winH, 1840);
  const browser = await chromium.launch({
    executablePath: CHROME, headless: false,
    args: [`--window-position=${wx},${wy}`, `--window-size=${winW},${winH}`, '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', '--no-first-run',
      '--no-default-browser-check', '--disable-features=CalculateNativeWinOcclusion', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  if (nohmr) {
    // inert Vite HMR socket: another helper's save can't reload the page mid-run
    await page.addInitScript(() => {
      const Real = window.WebSocket;
      window.WebSocket = function (u, protocols) {
        if (String(protocols).includes('vite-hmr')) return { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
        return new Real(u, protocols);
      };
    });
  }
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__skate && window.__skate.ready, null, { timeout: 60000 });
      break;
    } catch (e) {
      // another helper's file may be mid-edit: wait and retry
      if (attempt >= 3) throw e;
      logs.push('[harness] load failed, retrying in 20 s: ' + String(e?.message ?? e).slice(0, 200));
      await page.waitForTimeout(20000);
    }
  }
  await page.waitForTimeout(500);
  return { browser, page, logs };
}

/** start a 60 fps real-time recording of a screen region with gdigrab; returns { stop() } */
export function ffmpegRecord(file, r, fps = 60) {
  const w = r.w - (r.w % 2), h = r.h - (r.h % 2);
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '0',
    '-offset_x', String(r.x), '-offset_y', String(r.y), '-video_size', `${w}x${h}`, '-i', 'desktop',
    '-threads', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res) => ff.on('exit', res));
  return { async stop() { try { ff.stdin.write('q'); ff.stdin.end(); } catch { /* already gone */ } await done; } };
}

export function py(script, ...args) {
  return execFileSync('python', [script, ...args], { encoding: 'utf8' });
}

/**
 * Page-side instrumentation. One log row per DISPLAYED frame, written when game.render() starts, i.e. after simulate()
 * has placed the board, skater, camera and every other visual transform for that frame. Also:
 *  - D.steps: one row per physics step (wall time, sim time, speed, velocity, heading, steer input/filter, push, brake)
 *  - D.keys: every real key event with its performance.now() time (capture phase, before the game sees it)
 *  - a 16-bit frame barcode in the page corner (maps recorded video frames onto log rows)
 * Hooks: game.simulate, game.render, physics.step, rig.frameGuard (if present). Knee bend directions are computed here
 * in the skater root frame (unit vector from the hip-ankle line to the knee) for both legs (Left = front, Right = back).
 */
export function installDiag() {
  if (window.__diag) return window.__diag.header;
  const s = window.__skate, g = s.game, ph = g.physics, sk = g.skater, cam = g.camera, rig = g.rig;
  const V = ph.pos.constructor, Q = cam.quaternion.constructor, M = sk.root.matrixWorld.constructor;
  const MODES = { ride: 0, air: 1, grind: 2, bail: 3, recover: 4 };
  const BONES = ['Hips', 'Spine', 'Spine2', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
  const bones = BONES.map((n) => sk.b.get(n).bone);
  const legs = [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']].map((l) => l.map((n) => sk.b.get(n).bone));
  const header = ['t', 'dt', 'n', 'acc', 'mode', 'speed', 'px', 'py', 'pz', 'vx', 'vy', 'vz', 'ux', 'uy', 'uz', 'fx', 'fy', 'fz',
    'bx', 'by', 'bz', 'bqx', 'bqy', 'bqz', 'bqw', 'rx', 'ry', 'rz', 'rqx', 'rqy', 'rqz', 'rqw',
    'cx', 'cy', 'cz', 'cqx', 'cqy', 'cqz', 'cqw', 'Lx', 'Ly', 'Lz', 'yaw', 'userYaw', 'userPitch', 'elev', 'fov', 'guard',
    'steer', 'push', 'brake', 'crouch', 'pushT', 'hsx', 'hsy', 'bsx', 'bsy', 'esx', 'esy', 'simMs', 'renderMs', 'camDist', 'interp',
    'avoid', 'clear', 'pend', 'side', 'W', 'H', 'dqx', 'dqy', 'dqz', 'dqw', 'flipP',
    'steerS', 'brakeAmt', 'dropin', 'locked', 'kLx', 'kLy', 'kLz', 'kLh', 'kRx', 'kRy', 'kRz', 'kRh'];
  for (const b of BONES) for (const k of ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw']) header.push(b + '_' + k);
  const stepHeader = ['t', 'time', 'mode', 'speed', 'vx', 'vy', 'vz', 'fx', 'fy', 'fz', 'ux', 'uy', 'uz', 'steer', 'steerS', 'push', 'brake', 'pushT', 'brakeAmt', 'crouch', 'dropin'];
  const D = { header, stepHeader, rows: [], steps: [], keys: [], on: false, interp: false, n: 0 };
  window.__diag = D;
  const DROP = { roll: 1, stall: 2, pivot: 3 };
  for (const type of ['keydown', 'keyup']) {
    addEventListener(type, (e) => { if (D.on && !e.repeat) D.keys.push([performance.now(), type === 'keydown' ? 1 : 0, e.code]); }, true);
  }
  // 16-bit frame barcode (LSB first) in the top-left corner
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;top:0;height:14px;width:164px;z-index:99999;background:#000;pointer-events:none';
  const bits = [];
  for (let i = 0; i < 16; i++) {
    const b = document.createElement('div');
    b.style.cssText = `position:absolute;top:2px;left:${2 + i * 10}px;width:8px;height:10px;background:#000`;
    bar.appendChild(b); bits.push(b);
  }
  document.body.appendChild(bar);
  D.setBar = (n) => { for (let i = 0; i < 16; i++) bits[i].style.background = (n >> i) & 1 ? '#fff' : '#000'; };

  const origStep = ph.step.bind(ph);
  ph.step = (dt, inp) => {
    origStep(dt, inp);
    if (!D.on) return;
    D.steps.push([performance.now(), ph.time, MODES[ph.mode] ?? 9, ph.speed, ph.vel.x, ph.vel.y, ph.vel.z, ph.fwd.x, ph.fwd.y, ph.fwd.z,
      ph.up.x, ph.up.y, ph.up.z, inp?.steer ?? 0, ph.steerS ?? NaN, inp?.push ? 1 : 0, inp?.brake ? 1 : 0, ph.pushT, ph.brakeAmt ?? 0,
      ph.crouch?.x ?? 0, ph.dropin ? DROP[ph.dropin.phase] ?? 9 : 0]);
  };
  let guard = 0;
  if (typeof rig.frameGuard === 'function') {
    const origFG = rig.frameGuard.bind(rig);
    rig.frameGuard = (...a) => { const q0 = cam.quaternion.clone(); const r = origFG(...a); guard += q0.angleTo(cam.quaternion); return r; };
  }

  const v = new V(), q = new Q(), sp = new V(), inv = new M(), a0 = new V(), a1 = new V(), a2 = new V();
  const scr = (p, W, H) => { sp.copy(p).project(cam); return [(sp.x + 1) / 2 * W, (1 - sp.y) / 2 * H]; };
  const bend = (leg) => {
    leg[0].getWorldPosition(a0).applyMatrix4(inv); leg[1].getWorldPosition(a1).applyMatrix4(inv); leg[2].getWorldPosition(a2).applyMatrix4(inv);
    a2.sub(a0).normalize(); a1.sub(a0);
    a1.addScaledVector(a2, -a1.dot(a2));
    const h = a1.length();
    return h > 1e-6 ? [a1.x / h, a1.y / h, a1.z / h, h] : [0, 0, 0, 0];
  };
  let pend = null;
  const origSim = g.simulate.bind(g);
  g.simulate = (dt, ...rest) => {
    const t0 = performance.now(), st0 = g.simTime;
    guard = 0;
    const r = origSim(dt, ...rest);
    pend = { t0, dt, n: Math.round((g.simTime - st0) * 120), simMs: performance.now() - t0 };
    return r;
  };
  const origRender = g.render.bind(g);
  g.render = (dt, ...rest) => {
    if (D.on && pend) {
      const { t0, n } = pend;
      cam.updateMatrixWorld();
      sk.root.updateMatrixWorld(true);
      inv.copy(sk.root.matrixWorld).invert();
      const W = g.renderer.domElement.clientWidth, H = g.renderer.domElement.clientHeight;
      const br = g.board.root, rt = sk.root, li = g.lastInput ?? {};
      const hips = sk.hipsWorld(new V()), head = sk.headWorld(new V());
      const row = [t0, pend.dt, n, g.acc, MODES[ph.mode] ?? 9, ph.speed, ...ph.pos.toArray(), ...ph.vel.toArray(), ...ph.up.toArray(), ...ph.fwd.toArray(),
        ...br.position.toArray(), ...br.quaternion.toArray(), ...rt.position.toArray(), ...rt.quaternion.toArray(),
        ...cam.position.toArray(), ...cam.quaternion.toArray(), ...(rig.target?.x?.toArray?.() ?? [0, 0, 0]), rig.yaw ?? 0, rig.userYaw ?? 0, rig.userPitch ?? 0,
        rig.pitch ?? 0, cam.fov, guard,
        li.steer ?? 0, li.push ? 1 : 0, li.brake ? 1 : 0, li.crouch ? 1 : 0, ph.pushT,
        ...scr(hips, W, H), ...scr(br.position, W, H), ...scr(head, W, H), pend.simMs, 0, rig.dist ?? 0, g.view ? 1 : 0,
        rig.info?.avoid ?? 0, rig.info?.clear ?? 0, rig.info?.pend ?? 0, rig.info?.side ?? 0, W, H,
        ...g.board.deck.getWorldQuaternion(q).toArray(), ph.flip ? ph.flipProgress() : -1,
        ph.steerS ?? NaN, ph.brakeAmt ?? 0, ph.dropin ? DROP[ph.dropin.phase] ?? 9 : 0,
        document.pointerLockElement === g.renderer.domElement ? 1 : 0, ...bend(legs[0]), ...bend(legs[1])];
      for (const b of bones) { b.getWorldPosition(v); b.getWorldQuaternion(q); row.push(v.x, v.y, v.z, q.x, q.y, q.z, q.w); }
      D.rows.push(row);
      D.setBar(D.rows.length);
      pend = null;
      const t1 = performance.now();
      const r = origRender(dt, ...rest);
      row[header.indexOf('renderMs')] = performance.now() - t1;
      return r;
    }
    return origRender(dt, ...rest);
  };
  return header;
}
