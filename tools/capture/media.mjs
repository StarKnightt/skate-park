// Pass media: screenshots (screens/), frame-stepped recordings (frames/<clip>/ + events json) for clips/ and sheets/.
import fs from 'node:fs';
import path from 'node:path';

const S = (c, n) => c.shot(`screens/${n}.png`);
const adv = (c, n = 1) => c.eval((k) => window.__skate.advance(k, 1 / 30), n);
const follow = async (c, yaw = 0, dist = null, pitch = 0) => { await c.api('snapCam'); await c.api('camYaw', yaw, pitch); await c.api('camDist', dist); };

async function clip(c, name, frames, setup, perFrame, preroll = 2) {
  await c.api('free');
  const script = await setup();
  await adv(c, preroll);
  if (script) await c.api('script', script);
  await c.api('events');
  const ev = [];
  const dir = path.join(c.out, 'frames', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < frames; i++) {
    if (perFrame) await perFrame(i);
    await adv(c, 1);
    const e = await c.api('events');
    for (const x of e) ev.push({ frame: i, ...x });
    await c.page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(ev, null, 1));
  await c.api('release');
  console.log('clip', name, frames, 'events', ev.map((e) => `${e.frame}:${e.type}`).join(' '));
}

export default async function (c) {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  // ---------------------------------------------------------------- (a) first frame, real time
  if (want('first')) {
    await c.wait(1200);
    await S(c, 'a_first_frame_golden');
  }
  await c.api('manual', true);
  await c.api('hud', false);

  // ---------------------------------------------------------------- (b) close-ups from the follow camera
  if (want('close')) {
    const trick = async (name, tp, script, t, yaw = 1.2, dist = 2.5) => {
      dist = Math.min(dist, 2.0);
      await c.api('teleport', ...tp);
      await follow(c, yaw, dist, 0.02);
      await adv(c, 4);
      await c.api('script', script);
      await adv(c, Math.round(t * 30));
      await S(c, name);
      await c.api('release');
    };
    await trick('b_ride', [30, 0, 20, 180, 5.5], [], 0.8, 0.85, 2.6);
    await trick('b_crouch', [30, 0, 20, 180, 4.5], [{ at: 0.1, down: ['Space'] }], 0.6, 1.1, 2.4);
    await trick('b_ollie_mid', [30, 0, 20, 180, 5], [{ at: 0.1, down: ['Space'] }, { at: 0.4, up: ['Space'] }], 0.62, 1.2, 2.6);
    await trick('b_kickflip_mid', [30, 0, 20, 180, 5], [{ at: 0.1, down: ['Space'] }, { at: 0.25, down: ['ArrowLeft'] }, { at: 0.4, up: ['Space', 'ArrowLeft'] }], 0.62, 1.2, 2.6);
    await trick('b_heelflip_mid', [30, 0, 20, 180, 5], [{ at: 0.1, down: ['Space'] }, { at: 0.25, down: ['ArrowRight'] }, { at: 0.4, up: ['Space', 'ArrowRight'] }], 0.64, 1.2, 2.6);
    await trick('b_shuvit_mid', [30, 0, 20, 180, 5], [{ at: 0.1, down: ['Space'] }, { at: 0.25, down: ['ArrowDown'] }, { at: 0.4, up: ['Space', 'ArrowDown'] }], 0.62, 1.2, 2.6);
    await trick('b_5050', [5, 0, -12.95, -90, 5.5], [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }], 1.25, -1.1, 2.5);
    await trick('b_boardslide', [0, 0, 4.0, 180, 6.0], [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }], 1.3, 1.0, 2.6);
    await trick('b_manual', [30, 0, 20, 180, 4.5], [{ at: 0.2, down: ['ShiftLeft'] }], 1.0, 1.25, 2.5);
    await trick('b_push', [30, 0, 20, 180, 1.0], [{ at: 0.0, down: ['KeyW'] }], 0.36, 1.0, 2.4);
    await trick('b_handrail', [7, 1, 17.2, 180, 5.0], [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }], 0.72, 1.3, 2.8);
    // face close-up (standing still, camera in front of the rider looking along the nose)
    await c.api('teleport', 9, 0, 3, 180, 0);
    await adv(c, 20);
    const p = await c.eval(() => { const h = window.__skate.game.skater.headWorld(window.__skate.game.physics.pos.clone()); return [h.x, h.y, h.z]; });
    await c.api('view', p[0] + 0.62, p[1] + 0.08, p[2] - 0.55, p[0], p[1] - 0.02, p[2]);
    await adv(c, 2); await S(c, 'b_face_closeup');
    await c.api('view', p[0] + 1.3, p[1] - 0.5, p[2] - 1.0, p[0], p[1] - 0.75, p[2]);
    await adv(c, 2); await S(c, 'b_upper_body');
    await c.api('view', p[0] + 0.9, p[1] - 1.35, p[2] - 0.6, p[0] - 0.05, p[1] - 1.6, p[2]);
    await adv(c, 2); await S(c, 'b_feet_on_board');
    await c.api('free');
  }

  // ---------------------------------------------------------------- (c)(d) park elements and scenery
  if (want('wide')) {
    await c.api('teleport', 40 - 3, 0, 24, 180, 0); // park the skater out of the way
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
    };
    for (const [n, v] of Object.entries(views)) {
      await c.api('view', ...v);
      await adv(c, 2);
      await S(c, n);
    }
    await c.api('free');
  }

  // ---------------------------------------------------------------- (e) times of day
  if (want('tod')) {
    await c.api('teleport', 9, 0, 3, 180, 0);
    await follow(c, 0.35, 3.4, 0.05);
    await adv(c, 20);
    const names = ['e_golden_hour', 'e_sunset', 'e_blue_hour', 'e_bright_noon'];
    for (let i = 0; i < 4; i++) {
      await c.api('setTime', i, true);
      await adv(c, 2);
      await S(c, names[i]);
    }
    for (let i = 0; i < 4; i++) {
      await c.api('setTime', i, true);
      await c.api('view', 42, 14, 40, -2, 0, -8);
      await adv(c, 2);
      await S(c, names[i] + '_wide');
    }
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  await c.api('hud', true);
  // ---------------------------------------------------------------- clips (frame stepped @30 fps)
  if (want('clip01')) await clip(c, 'clip01_push_carve_bowl', 390, async () => {
    await c.api('teleport', -2, 0, 1.5, -90, 1.5);
    await follow(c, 0.0, null);
    return [
      { at: 0.0, down: ['KeyW'] }, { at: 2.2, up: ['KeyW'] },
      { at: 4.3, down: ['KeyA'] }, { at: 5.0, up: ['KeyA'] },
      { at: 5.8, down: ['KeyD'] }, { at: 6.8, up: ['KeyD'] },
      { at: 7.4, down: ['KeyW'] }, { at: 8.6, up: ['KeyW'] },
      { at: 9.4, down: ['KeyA'] }, { at: 10.4, up: ['KeyA'] },
    ];
  });
  if (want('clip02')) await clip(c, 'clip02_flatground_flips', 300, async () => {
    await c.api('teleport', -16, 0, 10.5, 90, 5.6);
    await follow(c, -1.0, 3.0, 0.04);
    const s = [];
    ['', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].forEach((k, i) => {
      const t0 = 0.3 + i * 1.8;
      s.push({ at: t0, down: ['Space'] });
      if (k) s.push({ at: t0 + 0.15, down: [k] });
      s.push({ at: t0 + 0.32, up: ['Space'] });
      if (k) s.push({ at: t0 + 0.4, up: [k] });
      s.push({ at: t0 + 1.2, down: ['KeyW'] }, { at: t0 + 1.6, up: ['KeyW'] });
    });
    return s;
  });
  if (want('clip03')) await clip(c, 'clip03_bank_funbox_flips', 300, async () => {
    await c.api('teleport', 11, 0, -0.6, -90, 6.4);
    await follow(c, -1.0, 3.2, 0.05);
    return [
      { at: 1.15, down: ['Space'] }, { at: 1.3, down: ['ArrowLeft'] }, { at: 1.45, up: ['Space'] }, { at: 1.55, up: ['ArrowLeft'] },
      { at: 3.0, down: ['KeyD'] }, { at: 4.2, up: ['KeyD'] },
      { at: 5.3, down: ['Space'] }, { at: 5.45, down: ['ArrowDown'] }, { at: 5.6, up: ['Space'] }, { at: 5.7, up: ['ArrowDown'] },
    ];
  });
  if (want('clip04')) await clip(c, 'clip04_grinds_5050_boardslide', 210, async () => {
    await c.api('teleport', 7, 1, 17.4, 180, 5.0);
    await follow(c, 1.2, 3.0, 0.08);
    return [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }];
  }, async (i) => {
    if (i === 78) {
      await c.api('teleport', 0, 0, 4.0, 180, 6.0);
      await follow(c, 1.0, 3.0, 0.06);
      await c.api('script', [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.8, up: ['KeyE'] }]);
    }
  });
  if (want('clip05')) await clip(c, 'clip05_manual', 210, async () => {
    await c.api('teleport', 34, 0, 18, 180, 5.0);
    await follow(c, 1.15, 2.8, 0.03);
    return [{ at: 0.6, down: ['ShiftLeft'] }, { at: 4.2, up: ['ShiftLeft'] }];
  });
  if (want('clip06')) await clip(c, 'clip06_sketchy_landing_wobble', 210, async () => {
    await c.api('teleport', 34, 0, 18, 180, 5.0);
    await follow(c, 0.9, 3.0, 0.03);
    return [{ at: 0.6, down: ['Space'] }, { at: 0.9, up: ['Space'] }, { at: 1.42, down: ['KeyD'] }, { at: 1.51, up: ['KeyD'] }];
  });
  if (want('clip07')) await clip(c, 'clip07_bail_and_get_up', 360, async () => {
    await c.api('teleport', 9.5, 0, -9, 90, 7.2);
    await follow(c, 0.6, 3.6, 0.1);
  }, async (i) => { if (i === 300) await c.api('script', [{ at: 0.0, down: ['KeyW'] }, { at: 1.5, up: ['KeyW'] }]); });
  if (want('clip08')) await clip(c, 'clip08_halfpipe_vert_air', 300, async () => {
    await c.api('teleport', 22.5, 0, -9, 90, 9.6);
    await c.api('view', 24, 3.4, 4.5, 24, 1.7, -9);
    return [{ at: 2.6, down: ['KeyW'] }, { at: 3.4, up: ['KeyW'] }];
  });
  if (want('clip09')) await clip(c, 'clip09_camera_orbit_idle', 270, async () => {
    await c.api('teleport', 9, 0, 3, 180, 0);
    await c.api('snapCam');
    await c.api('camDist', null);
    await c.api('orbit', 0.78, 3.0, 0.25);
  });
  await c.api('free');
}
