// Workstream light, pass 3: #55 soft-shadow interiors, #56 skater shadow on walls, #60 dark hair.
// bash tools/heavy.sh light node tools/capture/run.mjs tools/capture/light_p3.mjs --nohmr --out E:/shots/skate-park/pass-03/dev/light/<tag>
// ONLY=still,wall,ride,people (comma list; default: everything). Lossless PNGs at the window resolution.
const adv = (c, n = 1, render = true) => c.eval(([k, r]) => window.__skate.advance(k, 1 / 30, r), [n, render]);
const render = (c) => c.eval(() => window.__skate.game.render(1 / 30));
const S = (c, n) => c.shot(`${n}.png`);
const setFov = (c, f) => c.eval((f) => { const cam = window.__skate.game.camera; cam.fov = f; cam.updateProjectionMatrix(); }, f);
const view = async (c, v, fov = 56) => { await c.api('view', ...v); await setFov(c, fov); await adv(c, 2); };
const clearInput = async (c) => { await c.api('script', []); await c.api('release'); await adv(c, 1, false); };
const TIMES = ['golden', 'sunset', 'blue', 'noon'];

/** page side: camera placed relative to the skater each frame (hips tracked), then one rendered frame */
function installCam() {
  const s = window.__skate, g = s.game, V = g.physics.pos.constructor;
  window.__lcam = (spec) => {
    const ph = g.physics, cam = g.camera;
    const hips = g.skater.hipsWorld(new V());
    let pos, look;
    if (spec.kind === 'side') {
      const h = (spec.heading * Math.PI) / 180, fwd = new V(Math.sin(h), 0, Math.cos(h));
      const a = ((spec.angle ?? 0) * Math.PI) / 180;
      const dir = new V(-fwd.z, 0, fwd.x).multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
      look = new V(hips.x, spec.lookH, hips.z);
      pos = look.clone().addScaledVector(dir, spec.dist); pos.y = spec.h;
    } else if (spec.kind === 'rel') {
      // offset from the hips in world space, looking at hips + lookOff
      pos = hips.clone().add(new V(...spec.off));
      look = hips.clone().add(new V(...spec.lookOff));
      if (spec.y != null) pos.y = spec.y;
      if (spec.lookY != null) look.y = spec.lookY;
    } else { pos = new V(...spec.pos); look = new V(...spec.look); }
    if (spec.fov && Math.abs(cam.fov - spec.fov) > 0.01) { cam.fov = spec.fov; cam.updateProjectionMatrix(); }
    s.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
    cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
  };
  window.__lstep = (spec) => {
    s.advance(1, 1 / 30, false);
    if (spec) window.__lcam(spec);
    g.render(1 / 30);
    const ph = g.physics;
    return { mode: ph.mode, phase: g.skater.phase, pos: ph.pos.toArray().map((v) => +v.toFixed(2)), speed: +ph.speed.toFixed(2) };
  };
}

async function run(c, name, frames, cam, keep, setup) {
  await clearInput(c);
  await c.eval(() => window.__skate.free());
  if (setup) await setup();
  await adv(c, 2, false);
  const log = [];
  for (let i = 0; i < frames; i++) {
    const st = await c.eval((spec) => window.__lstep(spec), typeof cam === 'function' ? cam(i) : cam);
    if (keep(i)) { await S(c, `${name}_f${String(i).padStart(3, '0')}`); log.push(`${i}:${st.mode}/${st.phase}@${st.pos.join(',')}`); }
  }
  console.log(name, log.join(' | '));
  await c.api('release');
}

export default async function (c) {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  await c.api('manual', true);
  await c.api('hud', false);
  await c.eval(installCam);
  await c.page.waitForFunction(() => window.__skate.game.scenery.people.group.children.length > 0, null, { timeout: 30000 })
    .catch(() => console.log('people not loaded'));
  await adv(c, 4);

  // ---------------------------------------------------------------- #55: the critique's views, all four times of day
  if (want('still')) {
    const views = {
      bowl_coping: [-19.6, 1.0, 5.8, -23, -0.4, 7.4], halfpipe_coping: [21.2, 3.6, -6.2, 19.2, 2.9, -9.5],
      stairs_close: [9.6, 0.7, 10.6, 7, 0.45, 13.4], ground_low_feet: [9.9, 0.45, 2.4, 8.95, 0.2, 3.0],
      bowl_main: [-15.5, 1.8, 8, -27, -1.6, -2], banks_terrace: [-9, 2.2, 7, -0.5, 0.5, 13.5],
    };
    for (let t = 0; t < 4; t++) {
      await c.api('setTime', t, true);
      for (const [n, v] of Object.entries(views)) {
        if (n === 'ground_low_feet') { await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 10); }
        else { await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2); }
        await view(c, v);
        await S(c, `still_${n}_${TIMES[t]}`);
      }
    }
    // blue hour lamp shadow (spot light) next to the lamp at (10, 0, -22.4)
    await c.api('setTime', 2, true);
    await c.api('teleport', 10.6, 0, -19.6, 200, 0); await adv(c, 12);
    await view(c, [12.6, 1.35, -17.6, 10.5, 0.95, -19.9]); await S(c, 'still_lamp_blue_close');
    await view(c, [4.0, 2.6, -12.0, 10.0, 0.4, -21.0]); await S(c, 'still_lamp_blue_pool');
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  // ---------------------------------------------------------------- #56: wall bail into the half pipe mural wall
  if (want('wall')) {
    await c.api('setTime', 0, true);
    const keepW = (i) => [14, 18, 20, 22, 24, 28, 34, 46, 120, 149, 170, 190, 205, 217].includes(i);
    await run(c, 'wall_bail', 225, { kind: 'side', heading: 90, angle: -60, dist: 3.6, h: 1.3, lookH: 0.85, fov: 50 }, keepW,
      () => c.api('teleport', 9.5, 0, -9, 90, 7.2));
  }
  // ---------------------------------------------------------------- #56: slow ride along the sunlit west face of the half pipe (x = 16.4)
  if (want('ride')) {
    for (const t of [0, 1]) {
      await c.api('setTime', t, true);
      // heading +z, 1.1 m off the wall; the low sun (from -x, -z) throws his shadow onto the wall ahead of him
      await run(c, `ride_wall_${TIMES[t]}`, 70, { kind: 'rel', off: [-3.4, 0, -1.2], lookOff: [1.1, 0, 1.4], y: 1.45, lookY: 1.0, fov: 50 },
        (i) => i % 10 === 5, () => c.api('teleport', 15.3, 0, -14.2, 0, 2.6));
      // closer, side-on to the wall: silhouette detail
      await run(c, `ride_wall_close_${TIMES[t]}`, 40, { kind: 'rel', off: [-2.0, 0, 0.6], lookOff: [1.1, 0, 1.6], y: 1.25, lookY: 1.05, fov: 50 },
        (i) => i % 13 === 12, () => c.api('teleport', 15.3, 0, -13.8, 0, 2.2));
    }
    // the patchwork kiosk wall (faces the sun, z = 24.9): riding east 1.0 m off it
    await c.api('setTime', 0, true);
    await run(c, 'ride_kiosk', 40, { kind: 'rel', off: [-1.0, 0, -3.6], lookOff: [0.6, 0, 1.2], y: 1.5, lookY: 1.0, fov: 50 },
      (i) => i % 13 === 12, () => c.api('teleport', 21.5, 0, 23.9, 90, 2.2));
  }

  // ---------------------------------------------------------------- #60: dark hair from every angle
  if (want('people')) {
    await c.api('setTime', 0, true);
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    // the west seat steps pair over a few seconds (the left figure hunches forward and sits up)
    await view(c, [-33.5, 1.6, 9.5, -38.2, 0.9, 9.5]);
    for (let k = 0; k < 6; k++) { await S(c, `people_west_steps_${k}`); await adv(c, 22); }
    // from above and behind the pair
    await view(c, [-36.0, 2.6, 9.6, -38.25, 1.0, 9.55], 45); await S(c, 'people_west_steps_above');
    await view(c, [-40.2, 2.2, 8.4, -38.25, 1.0, 9.55], 45); await S(c, 'people_west_steps_behind');
    for (const t of [1, 2, 3]) { await c.api('setTime', t, true); await view(c, [-36.0, 2.6, 9.6, -38.25, 1.0, 9.55], 45); await S(c, `people_west_steps_above_${TIMES[t]}`); }
    await c.api('setTime', 0, true);
    // the skater's hair: from above, from behind, side, against the sun
    await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 20);
    const hp = await c.eval(() => { const h = window.__skate.game.skater.headWorld(window.__skate.game.physics.pos.clone()); return [h.x, h.y, h.z]; });
    const [x, y, z] = hp;
    await view(c, [x + 0.35, y + 0.95, z + 0.25, x, y, z], 45); await S(c, 'hair_skater_above');
    await view(c, [x - 0.2, y + 0.25, z + 0.9, x, y - 0.05, z], 45); await S(c, 'hair_skater_back');
    await view(c, [x + 0.9, y + 0.1, z - 0.1, x, y, z], 45); await S(c, 'hair_skater_side');
    const sd = await c.eval(() => { const s = window.__skate.game.tod.cur.lightDir; return [s.x, s.z]; });
    const l = Math.hypot(sd[0], sd[1]);
    await view(c, [x - (sd[0] / l) * 0.9, y + 0.15, z - (sd[1] / l) * 0.9, x, y, z], 45); await S(c, 'hair_skater_backlit');
    // a person seen from above in the open: the lifeguard and the beach couple
    await view(c, [-24, 2.2, -42, -29.5, 0.4, -47.5]); await S(c, 'people_beach');
    await c.api('free');
  }
}
