// Camera / HUD checks (workstream cam). Default follow camera, no view override.
// bash tools/heavy.sh cam node tools/capture/run.mjs tools/capture/cam_check.mjs --out E:/shots/skate-park/pass-02/dev/cam
// ONLY=bowl,vert,wall,rail,stairs,flat,hud  TAG=<subfolder>  EVERY=<save every n-th frame>
import fs from 'node:fs';
import path from 'node:path';

const adv = (c, n = 1, render = true) => c.eval(([k, r]) => window.__skate.advance(k, 1 / 30, r), [n, render]);

/** reset the camera to the plain follow camera (undo camYaw pinning / camDist / orbit / view) */
const plainCam = (c) => c.eval(() => {
  const s = window.__skate; s.free();
  const r = s.game.rig; r.userYaw = 0; r.userPitch = 0; r.idleT = 0; r.distOverride = null;
});

/** framing metrics of the skater in the current camera */
const metrics = (c) => c.eval(() => {
  const g = window.__skate.game, cam = g.camera, ph = g.physics;
  const Vector3 = ph.pos.constructor;
  const head = g.skater.headWorld(new Vector3()).add(new Vector3(0, 0.16, 0));
  const board = g.board.root.position.clone();
  const hips = g.skater.hipsWorld(new Vector3());
  cam.updateMatrixWorld();
  const pr = (v) => { const p = v.clone().project(cam); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; };
  const ph_ = pr(head), pb = pr(board), pp = pr(hips);
  const dir = cam.getWorldDirection(new Vector3());
  return {
    t: +g.simTime.toFixed(2), mode: ph.mode, pos: ph.pos.toArray().map((v) => +v.toFixed(2)),
    cam: cam.position.toArray().map((v) => +v.toFixed(2)),
    lookPitchDeg: +(Math.asin(Math.max(-1, Math.min(1, dir.y))) * 57.3).toFixed(1),
    camAboveBoard: +(cam.position.y - board.y).toFixed(2),
    dist: +cam.position.distanceTo(hips).toFixed(2),
    // screen: % from top for head / hips / board, skater height as fraction of frame height
    headTop: +((1 - ph_[1]) * 50).toFixed(1), hipsY: +((1 - pp[1]) * 50).toFixed(1), boardY: +((1 - pb[1]) * 50).toFixed(1),
    hipsX: +((1 + pp[0]) * 50).toFixed(1),
    size: +((ph_[1] - pb[1]) / 2).toFixed(3), fov: +cam.fov.toFixed(1),
    rig: g.rig.info ? Object.fromEntries(Object.entries(g.rig.info).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v])) : null,
  };
});

async function run(c, name, frames, setup, perFrame, every = 3) {
  const tag = process.env.TAG || 'cur';
  every = Number(process.env.EVERY || every);
  const dir = path.join(c.out, tag, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await plainCam(c);
  await setup();
  await c.api('events');
  const rows = [];
  for (let i = 0; i < frames; i++) {
    if (perFrame) await perFrame(i);
    await adv(c, 1, i % every === 0);
    if (i % every === 0) {
      const m = await metrics(c);
      m.f = i;
      rows.push(m);
      await c.page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 85 });
    }
  }
  const ev = await c.api('events');
  fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify({ rows, events: ev }, null, 0));
  await c.api('release');
  const sizes = rows.map((r) => r.size), hy = rows.map((r) => r.hipsY), by = rows.map((r) => r.boardY), lp = rows.map((r) => r.lookPitchDeg);
  const st = (a) => `${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)} avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)}`;
  console.log(`${name}: size ${st(sizes)} | hipsY% ${st(hy)} | boardY% ${st(by)} | lookPitch ${st(lp)} | events ${ev.map((e) => e.t + ':' + e.type).join(' ')}`);
}

export default async function (c) {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  await c.api('manual', true);
  if (!want('hud')) await c.api('hud', false);

  if (want('bowl')) await run(c, 'bowl', 420, async () => {
    await c.api('teleport', -2, 0, 1.5, -90, 5.5);
  });
  if (want('carve')) await run(c, 'carve', 210, async () => {
    // on the main bowl floor heading east, steering left into the south wall: carve along the curve
    await c.api('teleport', -28, -2.3, -2.0, 90, 7.5);
    await c.api('script', [{ at: 0.2, down: ['KeyA'] }, { at: 0.6, up: ['KeyA'] }, { at: 1.3, down: ['KeyD'] }, { at: 1.9, up: ['KeyD'] },
      { at: 2.6, down: ['KeyA'] }, { at: 3.4, up: ['KeyA'] }]);
  }, null, 2);
  if (want('vert')) await run(c, 'vert', 330, async () => {
    await c.api('teleport', 22.5, 0, -9, 90, 9.6);
  });
  if (want('wall')) await run(c, 'wall', 390, async () => {
    await c.api('teleport', 9.5, 0, -9, 90, 7.2);
  }, async (i) => { if (i === 300) await c.api('script', [{ at: 0.0, down: ['KeyW'] }, { at: 1.5, up: ['KeyW'] }]); });
  // #49: back to the mural wall (x = 16.4) so the camera starts jammed against it, then push away from it
  if (want('wall2')) await run(c, 'wall2', 120, async () => {
    await c.api('teleport', 15.7, 0, -9, -90, 0);
    await c.api('script', [{ at: 0.5, down: ['KeyW'] }, { at: 2.5, up: ['KeyW'] }]);
  }, null, 2);
  // #49: riding along the mural wall at arm's length
  if (want('wallside')) await run(c, 'wallside', 90, async () => {
    await c.api('teleport', 15.5, 0, -13, 0, 5.0);
  }, null, 2);
  if (want('rail')) await run(c, 'rail', 120, async () => {
    await c.api('teleport', 7, 1, 17.4, 180, 5.0);
    await c.api('script', [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }]);
  }, null, 2);
  if (want('stairs')) await run(c, 'stairs', 90, async () => {
    await c.api('teleport', 7, 1, 19.5, 180, 5.5);
  }, null, 2);
  if (want('flat')) await run(c, 'flat', 300, async () => {
    await c.api('teleport', 9, 0, 3, 180, 0);
    await c.api('script', [
      { at: 0.0, down: ['KeyW'] }, { at: 2.6, up: ['KeyW'] }, { at: 3.2, down: ['KeyA'] }, { at: 4.0, up: ['KeyA'] },
      { at: 5.0, down: ['Space'] }, { at: 5.3, up: ['Space'] }, { at: 7.0, down: ['Space'] }, { at: 7.15, down: ['ArrowLeft'] },
      { at: 7.32, up: ['Space'] }, { at: 7.4, up: ['ArrowLeft'] },
    ]);
  });
  if (want('hud')) {
    const tag = process.env.TAG || 'cur';
    const dir = path.join(c.out, tag, 'hud');
    fs.mkdirSync(dir, { recursive: true });
    await c.api('hud', true);
    await plainCam(c);
    await c.api('teleport', 9, 0, 3, 180, 0);
    // fresh start, as on page load: controls hint + sound prompt (run without &mute to see the real prompt)
    await c.eval(() => { const h = window.__skate.game.hud; h.showHint(); h.soundPrompt(); });
    await c.api('script', [{ at: 0.0, down: ['KeyW'] }, { at: 2.0, up: ['KeyW'] }]);
    const shotAt = { 15: 'hud_00.5s', 60: 'hud_02s', 120: 'hud_04s', 150: 'hud_05s', 210: 'hud_07s', 300: 'hud_10s' };
    for (let i = 0; i <= 300; i++) {
      await adv(c, 1, !!shotAt[i]);
      // CSS fades run on wall-clock time: let them settle so each shot shows the state at that sim time
      if (shotAt[i]) { await c.wait(1400); await c.page.screenshot({ path: path.join(dir, shotAt[i] + '.png') }); }
    }
    // the sound prompt also goes away on the first key press
    await c.eval(() => window.__skate.game.hud.soundPrompt());
    await adv(c, 1); await c.wait(700);
    await c.page.screenshot({ path: path.join(dir, 'hud_prompt_again.png') });
    await c.page.keyboard.press('KeyX');
    await c.wait(900); await adv(c, 1);
    await c.page.screenshot({ path: path.join(dir, 'hud_prompt_after_key.png') });
    // pointer move over the page reveals the top-right pills
    await c.page.mouse.move(640, 300); await c.page.mouse.move(700, 320);
    await c.wait(250); await adv(c, 1);
    await c.page.screenshot({ path: path.join(dir, 'hud_10s_pointermove.png') });
    await c.page.mouse.move(1180, 30); await c.wait(300); await adv(c, 1);
    await c.page.screenshot({ path: path.join(dir, 'hud_10s_hover.png') });
    await c.page.mouse.move(640, 400); await c.wait(3200); await adv(c, 1);
    await c.page.screenshot({ path: path.join(dir, 'hud_13s_idle.png') });
    await c.page.keyboard.press('KeyH'); await adv(c, 2);
    await c.page.screenshot({ path: path.join(dir, 'hud_help_open.png') });
    await c.page.keyboard.press('KeyH'); await adv(c, 2); await c.wait(800);
    await c.page.screenshot({ path: path.join(dir, 'hud_help_closed.png') });
    console.log('hud shots in', dir);
  }
  if (want('api')) {
    // capture hooks other workstreams rely on: camYaw + camDist + snapCam, orbit, view / free
    const dir = path.join(c.out, process.env.TAG || 'cur', 'api');
    fs.mkdirSync(dir, { recursive: true });
    const rel = () => c.eval(() => {
      const g = window.__skate.game, p = g.physics.pos, cp = g.camera.position;
      return { yaw: +Math.atan2(cp.x - p.x, cp.z - p.z).toFixed(3), distH: +Math.hypot(cp.x - p.x, cp.z - p.z).toFixed(2), cam: cp.toArray().map((v) => +v.toFixed(2)) };
    });
    await plainCam(c);
    await c.api('teleport', 9, 0, 3, 180, 0);
    await c.api('snapCam'); await c.api('camYaw', 1.2, 0.1); await c.api('camDist', 3.0); // same order as media.mjs
    await adv(c, 15);
    console.log('camYaw(1.2)+camDist(3) heading 180 ->', JSON.stringify(await rel()), '(expect yaw ~1.2, distH < 3)');
    await c.page.screenshot({ path: path.join(dir, 'camyaw.jpg'), type: 'jpeg', quality: 85 });
    await c.api('camDist', null); await c.api('orbit', 0.6, 3.2, 0.2);
    const o = [];
    for (let i = 0; i < 4; i++) { await adv(c, 15); o.push((await rel()).yaw); }
    console.log('orbit yaw steps', o.join(' '), '(expect steady ~0.3 rad steps)');
    await c.page.screenshot({ path: path.join(dir, 'orbit.jpg'), type: 'jpeg', quality: 85 });
    await c.api('free'); await c.api('view', 9, 3, 8, 9, 1, 3); await adv(c, 1);
    console.log('view(9,3,8) ->', JSON.stringify((await rel()).cam));
    await c.page.screenshot({ path: path.join(dir, 'view.jpg'), type: 'jpeg', quality: 85 });
    await plainCam(c);
  }
  if (want('mobile')) {
    const tag = process.env.TAG || 'cur';
    const dir = path.join(c.out, tag, 'mobile');
    fs.mkdirSync(dir, { recursive: true });
    const mtag = process.env.MTAG || 'portrait';
    await c.api('hud', true);
    await c.api('touch', true);
    await plainCam(c);
    await c.api('teleport', 9, 0, 3, 180, 0);
    await c.eval(() => window.__skate.game.hud.showHint());
    await adv(c, 20); await c.wait(700);
    await c.page.screenshot({ path: path.join(dir, `m_${mtag}_start.png`) });
    await c.api('script', [{ at: 0.0, down: ['KeyW'] }, { at: 2.0, up: ['KeyW'] }]);
    await adv(c, 240, false); await adv(c, 1); await c.wait(1400);
    await c.page.screenshot({ path: path.join(dir, `m_${mtag}_8s.png`) });
    const m = {};
    await c.api('teleport', -2, 0, 1.5, -90, 5.5); await c.api('snapCam');
    await adv(c, 105, false); await adv(c, 1);
    await c.page.screenshot({ path: path.join(dir, `m_${mtag}_bowl.png`) }); m.bowl = await metrics(c);
    await c.api('teleport', 22.5, 0, -9, 90, 9.6); await c.api('snapCam');
    await adv(c, 41, false); await adv(c, 1);
    await c.page.screenshot({ path: path.join(dir, `m_${mtag}_vertair.png`) }); m.vert = await metrics(c);
    await c.api('teleport', 7, 1, 17.4, 180, 5.0); await c.api('snapCam');
    await c.api('script', [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }]);
    await adv(c, 29, false); await adv(c, 1);
    await c.page.screenshot({ path: path.join(dir, `m_${mtag}_rail.png`) }); m.rail = await metrics(c);
    for (const [k, v] of Object.entries(m)) console.log(mtag, k, v.mode, 'size', v.size, 'headTop', v.headTop, 'hipsY', v.hipsY, 'boardY', v.boardY, 'pitch', v.lookPitchDeg);
    console.log('mobile shots in', dir);
  }
}
