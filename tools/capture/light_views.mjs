// Lighting / materials verification shots (workstream B). ONLY=tod,wide,park,back,lamp,sea,low (comma list) picks groups.
// bash tools/heavy.sh light node tools/capture/run.mjs tools/capture/light_views.mjs --out E:/shots/skate-park/pass-02/dev/light
const TAG = process.env.TAG ? process.env.TAG + '_' : '';
export default async function (c) {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  const S = (n) => c.shot(`${TAG}${n}.jpg`, { quality: 92 });
  const adv = (n = 2) => c.api('advance', n);
  const T = ['golden', 'sunset', 'blue', 'noon'];
  await c.api('manual', true);
  await c.api('hud', false);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await adv(20);
  const follow = async (yaw = 0.35, dist = 3.4, pitch = 0.05) => { await c.api('snapCam'); await c.api('camYaw', yaw, pitch); await c.api('camDist', dist); };

  if (want('tod')) {
    await c.api('free');
    await follow();
    await adv(10);
    for (let i = 0; i < 4; i++) { await c.api('setTime', i, true); await adv(2); await S(`tod_${T[i]}`); }
  }
  if (want('wide')) {
    for (let i = 0; i < 4; i++) {
      await c.api('setTime', i, true);
      await c.api('view', 42, 14, 40, -2, 0, -8); await adv(2); await S(`wide_${T[i]}`);
    }
    await c.api('setTime', 0, true);
    await c.api('view', 42, 18, 42, 0, 0, -6); await adv(2); await S('overview_golden');
  }
  if (want('park')) {
    await c.api('teleport', 37, 0, 24, 180, 0); // park the skater out of the way
    const views = {
      bowl_main: [-15.5, 1.8, 8, -27, -1.6, -2], bowl_pocket: [-16.5, 1.7, 21, -27, -1.0, 13],
      bowl_lip: [-19.5, 1.3, 4.0, -24, -0.6, -6.5],
      mural_koi: [-27, 1.9, 0.5, -36.6, 1.7, 0], mural_sunwaves: [8.5, 1.8, -9, 16.4, 1.5, -9],
      mural_patchwork: [25, 1.8, 15.5, 25, 1.6, 24.9], mural_koi_close: [-33.2, 1.0, 1.5, -36.6, 0.9, 0.2],
      banks_terrace: [-9, 2.2, 7, -0.5, 0.5, 13.5], ledges: [-3, 1.9, -6.5, -2, 0.3, -12.4],
      north_qp_bank: [-5, 2.4, -11, -4, 0.7, -21], stairs: [11.5, 2.2, 7.5, 7, 0.6, 13.5],
      halfpipe_inside: [23.2, 0.9, -4.5, 25, 1.4, -11], boardwalk_sand: [-6, 1.7, -14, -2, 0.0, -23],
    };
    for (const t of process.env.PARK_TIMES ? process.env.PARK_TIMES.split(',').map(Number) : [0]) {
      await c.api('setTime', t, true);
      for (const [n, v] of Object.entries(views)) { await c.api('view', ...v); await adv(2); await S(`${n}_${T[t]}`); }
    }
    await c.api('setTime', 0, true);
  }
  if (want('back')) {
    // skater between the camera and the low sun (rim light), plus a front-lit reference
    await c.api('setTime', 0, true);
    await c.api('teleport', 9, 0, 3, 180, 0);
    await adv(12);
    const sk = await c.eval(() => { const p = window.__skate.game.skater.root.position; const s = window.__skate.game.tod.cur.lightDir; return [p.x, p.y, p.z, s.x, s.z]; });
    const [x, y, z, sx, sz] = sk; const l = Math.hypot(sx, sz), dx = sx / l, dz = sz / l;
    await c.api('view', x - dx * 3.0, y + 1.25, z - dz * 3.0, x, y + 0.95, z); await adv(2); await S('back_golden');
    await c.api('view', x - dx * 1.6 + dz * 0.4, y + 1.3, z - dz * 1.6 - dx * 0.4, x, y + 1.1, z); await adv(2); await S('back_golden_close');
    await c.api('view', x + dx * 3.0, y + 1.25, z + dz * 3.0, x, y + 0.95, z); await adv(2); await S('front_golden');
    await c.api('setTime', 1, true);
    await c.api('view', x - dx * 3.0, y + 1.25, z - dz * 3.0, x, y + 0.95, z); await adv(2); await S('back_sunset');
    await c.api('setTime', 0, true);
  }
  if (want('lamp')) {
    // blue hour: skater next to the lamp at (10,0,-22.4) -> warm light and a lamp shadow
    await c.api('setTime', 2, true);
    await c.api('teleport', 10.6, 0, -19.6, 200, 0);
    await adv(12);
    await c.api('view', 14.5, 1.9, -15.5, 10.4, 0.8, -20.5); await adv(2); await S('lamp_skater_blue');
    await c.api('view', 4.0, 2.6, -12.0, 10.0, 0.4, -21.0); await adv(2); await S('lamp_pool_blue');
    await c.api('free'); await follow(0.35, 3.4, 0.05); await adv(6); await S('lamp_follow_blue');
    await c.api('teleport', 9, 0, 3, 180, 0); await adv(4);
    await c.api('view', -8, 3.0, 14, -26, -0.8, 0); await adv(2); await S('bowl_blue');
    await c.api('setTime', 0, true);
  }
  if (want('sea')) {
    await c.api('setTime', 3, true);
    await c.api('view', -12, 8, -36, -70, -0.5, -150); await adv(2); await S('sea_noon');
    await c.api('view', 0, 30, -20, 0, -1, -160); await adv(2); await S('sea_noon_high');
    await c.api('setTime', 0, true);
    await c.api('view', -12, 8, -36, -70, -0.5, -150); await adv(2); await S('sea_golden');
  }
  if (want('low')) {
    await c.api('setTime', 0, true);
    await c.api('teleport', 9, 0, 3, 180, 0); await adv(10);
    await c.api('view', 9.9, 0.45, 2.4, 8.95, 0.2, 3.0); await adv(2); await S('low_feet_golden');
    await c.api('view', 2, 0.35, -16, -6, 0.05, -21); await adv(2); await S('low_sand_golden');
    await c.api('free'); await follow(0.0, 3.4, 0.02); await adv(6); await S('first_golden');
  }
  await c.api('free');
}
