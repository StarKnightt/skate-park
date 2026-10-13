// World/scenery verification shots (pass 2, workstream world). ONLY=a,b to pick groups.
// bash tools/heavy.sh world node tools/capture/run.mjs tools/capture/world_views.mjs --out E:/shots/skate-park/pass-02/dev/world
export default async function (c) {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  const adv = (n = 2) => c.eval((k) => window.__skate.advance(k, 1 / 30), n);
  await c.api('manual', true);
  await c.api('hud', false);
  await c.api('teleport', 37, 0, 24, 180, 0);
  await c.page.waitForFunction(() => window.__skate.game.scenery.people.group.children.length > 0, null, { timeout: 30000 })
    .catch(() => console.log('people not loaded'));
  await adv(6);
  const shot = async (name, v) => { await c.api('view', ...v); await adv(2); await c.shot(`${name}.jpg`); };
  if (want('marks')) {
    const marks = await c.api('shot', '__list__');
    for (const m of marks) { await c.api('shot', m); await adv(2); await c.shot(`mark_${m}.jpg`); }
  }
  if (want('pass1')) {
    const views = {
      a_spawn_view: [9, 1.7, 6.6, 9, 1.0, -6],
      c_halfpipe: [24, 4.6, 6.5, 24, 1.0, -9], c_halfpipe_inside: [23.2, 0.9, -4.5, 25, 1.4, -11],
      c_quarterpipe_terrace: [-9.5, 4.2, 14.5, 6, 1.4, 22], c_quarterpipe_and_bank_north: [-5, 2.4, -11, -4, 0.7, -21],
      c_stairs_handrail: [11.5, 2.2, 7.5, 7, 0.6, 13.5], c_funbox_flatbar: [7.5, 2.4, 5.5, 0, 0.4, -1.5],
      c_banks_terrace: [-9, 2.2, 7, -0.5, 0.5, 13.5], c_ledges_rail: [-3, 1.9, -6.5, -2, 0.3, -12.4],
      c_bowl_main: [-15.5, 1.8, 8, -27, -1.6, -2], c_bowl_pocket: [-16.5, 1.7, 21, -27, -1.0, 13],
      c_mural_sunwaves: [8.5, 1.8, -9, 16.4, 1.5, -9], c_mural_koi: [-27, 1.9, 0.5, -36.6, 1.7, 0], c_mural_patchwork: [25, 1.8, 15.5, 25, 1.6, 24.9],
      d_ocean_glitter: [-12, 8, -36, -70, -0.5, -150], d_boardwalk: [-20, 2.0, -21, 6, 0.6, -26.5],
      d_beach_houses: [40, 4, -24, 72, 2, -38], d_palms: [-30, 1.6, -18, -47, 6, -30],
      d_overview: [42, 18, 42, 0, 0, -6], d_lighthouse_headland: [36, 3.6, -26.2, 300, 40, -300],
    };
    for (const [n, v] of Object.entries(views)) await shot(n, v);
  }
  if (want('extra')) {
    await shot('x_town_south', [8, 5, 28, 6, 2.5, 60]);
    await shot('x_town_close', [-14, 2.2, 36.5, -24, 2.2, 44]);
    await shot('x_beachhouse_close', [-52, 2.4, -29, -58, 2.4, -38]);
    await shot('x_sand_shore', [-6, 1.8, -58, -2, -1.2, -72]);
    await shot('x_footprints', [-19, 1.6, -33, -22, -0.4, -40]);
    await shot('x_palm_close', [-33.5, 1.7, -24.5, -39.1, 7.5, -19.5]);
    await shot('x_palm_crown_up', [-36.5, 2.0, 7.5, -39.0, 10.0, 8.2]);
    await shot('x_palms_far', [0, 6, 20, -10, 5, -30]);
    await shot('x_lifeguard', [-3, 3.0, -46, -8, 2.4, -53]);
    await shot('x_edge_west', [-33.5, 1.6, 14, -39, 0.6, 9]);
    await shot('x_edge_north_boardwalk', [-36, 1.6, -21, -40, 0.6, -26]);
    await shot('x_overview_top', [0, 60, 40, 0, 0, 0]);
    await shot('x_overview_hp', [40, 14, 10, 20, 0, -10]);
  }
  if (want('gulls')) {
    // park a gull in front of the camera: follow bird 0 for a few frames
    for (let i = 0; i < 3; i++) {
      const p = await c.eval((k) => {
        const g = window.__skate.game.scenery.group.children.find((o) => o.material && o.material.name === 'gulls');
        const pos = g.geometry.getAttribute('position');
        const nv = pos.count / 9, b = k * nv;
        let x = 0, y = 0, z = 0;
        for (let j = 0; j < nv; j++) { x += pos.getX(b + j); y += pos.getY(b + j); z += pos.getZ(b + j); }
        return [x / nv, y / nv, z / nv];
      }, i);
      await c.api('view', p[0] + 3.2, p[1] + 0.6, p[2] + 2.4, p[0], p[1], p[2]);
      await adv(1);
      await c.shot(`x_gull_${i}.jpg`);
    }
  }
  if (want('fix')) {
    await shot('f_shore_wet', [-20, 3.2, -57, -20, -1.25, -71]);
    await shot('f_shore_wide', [-36, 4.5, -36, -12, -1.2, -76]);
    await shot('f_headland_close', [120, 18, -150, 280, 22, -330]);
    await shot('f_umbrella_shadow', [52, 4.5, -36, 46, -0.6, -52]);
    await shot('d_lighthouse_headland', [36, 3.6, -26.2, 300, 40, -300]);
    await shot('d_beach_houses', [40, 4, -24, 72, 2, -38]);
    await shot('d_ocean_glitter', [-12, 8, -36, -70, -0.5, -150]);
    await shot('x_town_south', [8, 5, 28, 6, 2.5, 60]);
    await shot('c_halfpipe', [24, 4.6, 6.5, 24, 1.0, -9]);
  }
  if (want('people')) {
    const n = await c.eval(() => window.__skate.game.scenery.people.group.children.length);
    console.log('people objects', n);
    await shot('p_hp_deck', [26.5, 4.4, -6.5, 30.8, 3.6, -10.6]);
    await shot('p_north_deck', [-7.5, 2.4, -15.5, -10.8, 1.6, -21]);
    await shot('p_west_step', [-33.5, 1.6, 9.5, -38.2, 0.9, 9.5]);
    await shot('p_beach', [-24, 2.2, -42, -29.5, 0.4, -47.5]);
    await shot('p_lifeguard', [-5.5, 3.2, -57.5, -8, 2.9, -53.4]);
    await shot('p_boardwalk', [36, 1.8, -24.5, 50, 1.0, -24.6]);
  }
  if (want('perf')) {
    // whole-frame draw calls / triangles (shadow passes included), with and without the people
    const measure = async (label, v) => {
      await c.api('view', ...v);
      await adv(2);
      const r = await c.eval(() => {
        const g = window.__skate.game, info = g.renderer.info, ppl = g.scenery.people.group, res = {};
        for (const vis of [true, false]) {
          ppl.visible = vis;
          info.autoReset = false; info.reset();
          window.__skate.advance(1, 1 / 30, true);
          res[vis ? 'with' : 'without'] = { calls: info.render.calls, tris: info.render.triangles };
          info.autoReset = true;
        }
        ppl.visible = true;
        const lv = [];
        ppl.traverse((o) => o.isLOD && lv.push(o.getCurrentLevel()));
        return { ...res, levels: lv.join(''), geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs.length, quality: g.quality };
      });
      console.log('perf', label, JSON.stringify(r));
    };
    await measure('spawn', [9, 1.7, 6.6, 9, 1.0, -6]);
    await measure('hp', [24, 4.6, 6.5, 24, 1.0, -9]);
    await measure('overview', [42, 18, 42, 0, 0, -6]);
    await measure('boardwalk', [36, 1.8, -24.5, 50, 1.0, -24.6]);
    await measure('beach', [-24, 2.2, -42, -29.5, 0.4, -47.5]);
  }
  if (want('lod')) {
    // every distance level forced on, seen from close up (exaggerates the simplification on purpose)
    const setLevel = (k) => c.eval((lvl) => window.__skate.game.scenery.people.group.traverse((o) => {
      if (!o.isLOD) return;
      o.autoUpdate = lvl < 0;
      if (lvl >= 0) o.levels.forEach((l, j) => (l.object.visible = j === lvl));
    }), k);
    for (let l = 0; l < 4; l++) {
      await setLevel(l);
      await shot(`lod${l}_hpdeck`, [28.6, 3.9, -8.8, 30.75, 3.9, -10.6]);
      await shot(`lod${l}_west`, [-35.8, 1.3, 9.6, -38.25, 0.9, 9.6]);
    }
    await setLevel(-1);
  }
  await c.api('free');
}
