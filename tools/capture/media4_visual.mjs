// Pass-4 visual polish (helper F): the pass-03 cameras for #68-#71, #73 and their Keep shots, plus the grip at noon and
// at board height in direct sun. Stills only.
// bash tools/heavy.sh F node tools/capture/run.mjs tools/capture/media4_visual.mjs --nohmr --out E:/shots/skate-park/pass-04/visual --url http://127.0.0.1:5188/
// TAG=<subfolder> (default after), ONLY=<comma list> of: grip kiosk people boards bush tod
const TAG = process.env.TAG ?? 'after';
const adv = (c, n = 1, render = true) => c.eval(([k, r]) => window.__skate.advance(k, 1 / 30, r), [n, render]);
const render = (c) => c.eval(() => window.__skate.game.render(1 / 30));
const S = (c, n) => c.shot(`${TAG}/${n}.png`);
const pinCam = async (c, yaw, dist, pitch = 0) => { await c.api('snapCam'); await c.api('camYaw', yaw, pitch); await c.api('camDist', dist); };
const setFov = (c, f) => c.eval((f) => { const cam = window.__skate.game.camera; cam.fov = f; cam.updateProjectionMatrix(); }, f);
const view = async (c, v, fov = 56) => { await c.api('view', ...v); await setFov(c, fov); await adv(c, 2); };
const clearInput = async (c) => { await c.api('script', []); await c.api('release'); await adv(c, 1, false); };
const TOD = ['golden', 'sunset', 'blue_hour', 'noon'];
/** kickflip: crouch on Space, F pops at the current charge and flips (no WASD held = kickflip) */
const FLIP = (t0) => [{ at: t0, down: ['Space'] }, { at: t0 + 0.28, down: ['KeyF'] }, { at: t0 + 0.32, up: ['Space'] }, { at: t0 + 0.38, up: ['KeyF'] }];

async function until(c, cond, max = 120) {
  for (let i = 0; i <= max; i++) {
    const ok = await c.eval((src) => { const g = window.__skate.game; return !!new Function('g', 'ph', 'sk', `return (${src});`)(g, g.physics, g.skater); }, cond);
    if (ok) { await render(c); return i; }
    await adv(c, 1, false);
  }
  await render(c);
  return -1;
}

function installCam() {
  const s = window.__skate, g = s.game, V = g.physics.pos.constructor;
  const mem = {};
  const head = (i) => g.scenery.people.items[i].holder.getObjectByName('mixamorigHead').getWorldPosition(new V());
  window.__mcam = (spec) => {
    const ph = g.physics, cam = g.camera;
    let pos, look;
    if (spec.kind === 'side') {
      const h = (spec.heading * Math.PI) / 180, fwd = new V(Math.sin(h), 0, Math.cos(h));
      const a = ((spec.angle ?? 0) * Math.PI) / 180;
      const dir = new V(-fwd.z, 0, fwd.x).multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
      const src = spec.track === 'board' ? g.board.root.position : ph.pos;
      const gy = spec.trackY ? ph.pos.y : 0;
      look = new V(src.x, gy + spec.lookH, src.z);
      pos = look.clone().addScaledVector(dir, spec.dist); pos.y = gy + spec.h;
    } else if (spec.kind === 'group') {
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
    } else { pos = new V(...spec.pos); look = new V(...spec.look); }
    if (spec.fov && Math.abs(cam.fov - spec.fov) > 0.01) { cam.fov = spec.fov; cam.updateProjectionMatrix(); }
    cam.position.copy(pos); cam.lookAt(look); cam.updateMatrixWorld();
    s.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
  };
  window.__probe = () => {
    const cam = g.camera, mw = g.board.deck.matrixWorld, rot = mw.clone().extractRotation(mw);
    const up = new V(0, 1, 0).applyMatrix4(rot).normalize();
    const toCam = cam.position.clone().sub(new V().setFromMatrixPosition(mw)).normalize();
    return { grip: +up.dot(toCam).toFixed(3) };
  };
}

function stepFrame(cam) {
  const s = window.__skate, g = s.game;
  if (cam) { s.advance(1, 1 / 30, false); window.__mcam(cam); g.render(1 / 30); } else s.advance(1, 1 / 30, true);
  const e = g.eventLog.slice(); g.eventLog.length = 0;
  return { e, mode: g.physics.mode };
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

  // ---------------------------------------------------------------- #68 grip in direct sun (golden + noon), #64 keep (shade)
  if (want('grip')) {
    const trick = async (name, tp, script, cond, yaw, extra = 0, max = 90, dist = 2.0, pitch = 0.02, after) => {
      await clearInput(c); await c.api('free');
      await c.api('teleport', ...tp);
      await pinCam(c, yaw, dist, pitch);
      await adv(c, 4);
      await c.api('script', script);
      const n = await until(c, cond, max);
      if (extra) { await adv(c, extra, false); await render(c); }
      await S(c, name);
      const st = await c.api('state');
      console.log('grip', name, n, st.mode, st.phase ?? '');
      if (after) await after(name);
      await c.api('release');
    };
    const T = (sec) => `g.simTime >= ${sec}`;
    const now = () => c.eval(() => window.__skate.game.simTime);
    const lowCams = async (name) => {
      // board height with the sun behind the camera (riding away from the low sun, the raised deck's grip faces it):
      // from behind the tail on either side
      for (const [tag, angle, h, dist] of [['heel', -125, 0.3, 1.4], ['toe', -55, 0.3, 1.4]]) {
        await c.eval((sp) => { window.__mcam(sp); window.__skate.game.render(1 / 30); },
          { kind: 'side', heading: 0, angle, dist, h, lookH: 0.12, fov: 42, track: 'board', trackY: true });
        await S(c, `${name}_${tag}`);
      }
    };
    for (const t of [0, 3]) {
      await c.api('setTime', t, true);
      const sfx = t ? '_noon' : '';
      await trick(`b_5050${sfx}`, [3.2, 0, -12.95, -90, 5.5], [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }], `ph.mode==='grind'`, -1.1, 22);
      let t0 = await now();
      await trick(`b_manual${sfx}`, [30, 0, 20, 180, 4.5], [{ at: 0.2, down: ['ShiftLeft'] }], T(t0 + 1.0 + 4 / 30), 1.25);
      t0 = await now();
      await trick(`manual_board_height_sun${sfx}`, [33, 0, 12.5, 0, 4.5], [{ at: 0.2, down: ['ShiftLeft'] }], T(t0 + 1.0 + 4 / 30), 2.6, 0, 90, 2.0, 0.02, lowCams);
    }
    await c.api('setTime', 0, true);
    const midFlip = `ph.flip && ph.flip.t >= ph.flip.delay + ph.flip.dur * 0.5`;
    await trick('b_kickflip_mid', [30, 0, 20, 180, 5], FLIP(0.1), midFlip, 1.2);
    // mid-flip with the grip towards the camera in sun (pass-03 h64 recipe: side camera at 200 deg, best grip-to-camera frame)
    await clearInput(c); await c.api('free');
    await c.api('teleport', 30, 0, 22, 180, 4.5);
    await adv(c, 2, false);
    await c.api('events');
    await c.api('script', FLIP(0.3));
    let pop = -1, best = -2;
    for (let i = 0; i < 45; i++) {
      const st = await c.eval(stepFrame, { kind: 'side', heading: 180, angle: 200, dist: 1.6, h: 0.5, lookH: 0.3, fov: 40, track: 'board', trackY: true });
      if (pop < 0 && st.e.some((e) => e.type === 'pop')) pop = i;
      if (pop < 0 || i < pop + 3 || i > pop + 13) continue;
      const p = await c.eval(() => window.__probe());
      if (p.grip > best) { best = p.grip; await S(c, 'h64_grip_kickflip_sunlit'); }
    }
    console.log('grip kickflip sunlit: pop', pop, 'grip-to-camera', best);
    await c.api('release'); await c.api('free');
    // backlight (pass-03 g_backlight_golden_close)
    await clearInput(c);
    await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 12);
    const sk = await c.eval(() => { const p = window.__skate.game.skater.root.position; const s = window.__skate.game.tod.cur.lightDir; return [p.x, p.y, p.z, s.x, s.z]; });
    const [x, y, z, sx, sz] = sk; const l = Math.hypot(sx, sz), dx = sx / l, dz = sz / l;
    await view(c, [x - dx * 1.6 + dz * 0.4, y + 1.3, z - dz * 1.6 - dx * 0.4, x, y + 1.1, z]); await S(c, 'g_backlight_golden_close');
    await view(c, [x + dx * 3.0, y + 1.25, z + dz * 3.0, x, y + 0.95, z]); await S(c, 'g_frontlight_golden');
    await c.api('free');
  }

  // ---------------------------------------------------------------- #69 kiosk town side at blue hour (+ golden keep)
  if (want('kiosk')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    const v = { town_side: [25, 3.0, 36, 25, 1.6, 27], window_close: [25.6, 1.75, 31.6, 25.4, 1.5, 28.6], window_oblique: [21.0, 1.9, 33.5, 25.5, 1.5, 28.6] };
    for (const t of [0, 1, 2]) {
      await c.api('setTime', t, true);
      for (const [n, vv] of Object.entries(v)) { await view(c, vv); await S(c, `h58_kiosk_${n}_${TOD[t]}`); }
    }
    await c.api('setTime', 2, true);
    await view(c, [-31, 4.0, 27.5, -37.3, 0, 0]); await S(c, 'e_blue_hour_lamps_wide');
    await view(c, [0, 7.5, 27.5, -2, 0, -6]); await S(c, 'e_blue_hour_lamps_south');
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  // ---------------------------------------------------------------- #71 hair under caps (3 m faces), #60 keep (hair from above)
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
        g.render(1 / 30); g.render(1 / 30);
      }, [idx, ahead, side, h, lookH, fov]);
      await S(c, name);
    };
    await pshot('h59_walker_face_3m', 7, 3.0, 0.6, 1.6, 1.5, 35);
    await pshot('h59_shore_walker_face_3m', 9, 3.0, 0.6, 1.6, 1.5, 35);
    await pshot('h59_hp_deck_skater_face_3m', 0, 3.0, 0.5, 1.6, 1.5, 35);
    await pshot('h59_north_deck_skater_face_3m', 1, 3.0, 0.5, 1.6, 1.5, 35);
    const grp = async (name, spec) => {
      await adv(c, 1, false);
      await c.eval((sp) => { window.__mcam({ ...sp, reset: true }); window.__skate.game.render(1 / 30); window.__skate.game.render(1 / 30); }, spec);
      await S(c, name);
    };
    await grp('h59_kiosk_vendor_3m', { kind: 'group', idx: [14], dist: 3.4, dy: 0.0, fov: 35 });
    await grp('h59_west_steps_pair_3m', { kind: 'group', idx: [2, 3], dist: 3.0, dy: 0.05, fov: 40 });
    const A = [-36.0, 2.6, 9.6, -38.25, 1.0, 9.55];
    for (const t of [0, 2, 3]) { await c.api('setTime', t, true); await view(c, A, 45); await S(c, `h60_west_steps_above${t ? '_' + TOD[t] : ''}`); }
    await c.api('setTime', 0, true);
    await c.api('teleport', 9, 0, 3, 180, 0); await adv(c, 20);
    const hp = await c.eval(() => { const h = window.__skate.game.skater.headWorld(window.__skate.game.physics.pos.clone()); return [h.x, h.y, h.z]; });
    await view(c, [hp[0] + 0.35, hp[1] + 0.95, hp[2] + 0.25, hp[0], hp[1], hp[2]], 45); await S(c, 'h60_skater_hair_above');
    await view(c, [hp[0] + 0.62, hp[1] + 0.08, hp[2] - 0.55, hp[0], hp[1] - 0.02, hp[2]]); await S(c, 'b_face_closeup');
    await c.api('free');
  }

  // ---------------------------------------------------------------- #70 background skaters' boards
  if (want('boards')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    const views = {
      d_people_west_steps: [-33.5, 1.6, 9.5, -38.2, 0.9, 9.5], d_people_north_deck: [-7.5, 2.4, -15.5, -10.8, 1.6, -21],
      d_people_hp_deck: [26.5, 4.4, -6.5, 30.8, 3.6, -10.6],
      board_west_steps_close: [-37.2, 1.25, 7.3, -38.25, 0.5, 8.25], board_north_deck_close: [-9.6, 1.95, -20.2, -10.45, 1.25, -21.2],
      board_hp_deck_lean_close: [30.2, 3.9, -9.0, 31.18, 3.3, -10.05], board_north_deck_far: [-1.5, 2.6, -12.0, -10.45, 1.3, -21.2],
    };
    for (const [n, v] of Object.entries(views)) { await view(c, v, n.endsWith('close') ? 40 : 56); await S(c, n); }
    await c.api('setTime', 2, true);
    await view(c, views.board_west_steps_close, 40); await S(c, 'board_west_steps_close_blue_hour');
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  // ---------------------------------------------------------------- #71 leaf edges, #73 agave, #57 keep
  if (want('bush')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(c, 2);
    const vs = {
      d_edge_east: [33.5, 1.7, 4.0, 39, 0.6, -2], d_edge_west: [-33.5, 1.6, 14, -39, 0.6, 9],
      h57_bush_close_west_planter: [-36.3, 1.35, 15.8, -39.05, 0.95, 18.0], h57_bush_backlit_west_planter: [-40.8, 1.4, 21.5, -39.05, 0.95, 18.6],
    };
    for (const [n, v] of Object.entries(vs)) { await view(c, v, n.startsWith('d_') ? 56 : 45); await S(c, n); }
    const xclose = async (name, mesh, gx, gz, mode, dist = 1.3, r0 = 0.55) => {
      const r = await c.eval(([mesh, gx, gz, mode, dist, r0]) => {
        const g = window.__skate.game, V = g.physics.pos.constructor, m = g.scene.getObjectByName(mesh);
        if (!m) return null;
        m.updateMatrixWorld();
        const pa = m.geometry.getAttribute('position'), p = new V();
        let cx = gx, cz = gz, cy = 0, top = -9, n = 0;
        for (let it = 0; it < 4; it++) {
          let ax = 0, az = 0, ay = 0; n = 0; top = -9;
          for (let i = 0; i < pa.count; i++) {
            p.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
            if (Math.hypot(p.x - cx, p.z - cz) > r0) continue;
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
      }, [mesh, gx, gz, mode, dist, r0]);
      if (!r) { console.log('xclose', name, 'nothing near', gx, gz); return; }
      console.log('xclose', name, 'centre', r.c, 'top', r.top, 'verts', r.n);
      await view(c, [...r.pos, ...r.look], 45); await S(c, name);
    };
    await xclose('h57_bush_xclose_planter_side', 'planterBushes', -39.05, 18.0, 'side2');
    await xclose('h57_bush_xclose_flowering_side', 'planterBushes', -39.05, 17.0, 'side2');
    await xclose('h57_bush_xclose_planter_backlit', 'planterBushes', -39.05, 18.0, 'back');
    await xclose('h57_bush_xclose_town_scrub', 'townBushes', 5.9, 37.3, 'side2', 1.5);
    // the agave nearest the flowering bush of h57_bush_xclose_flowering_side (its bottom-right corner in pass 3)
    const ag = await c.eval(() => {
      const m = window.__skate.game.scene.getObjectByName('planterAgaves');
      if (!m) return null;
      const pa = m.geometry.getAttribute('position');
      let best = 1e9, bx = 0, bz = 0;
      for (let i = 0; i < pa.count; i += 5) { const d = Math.hypot(pa.getX(i) + 39.05, pa.getZ(i) - 17.0); if (d < best) { best = d; bx = pa.getX(i); bz = pa.getZ(i); } }
      return [bx, bz, best];
    });
    console.log('agave nearest', ag);
    if (ag) {
      await xclose('agave_xclose_side', 'planterAgaves', ag[0], ag[1], 'side2', 1.1, 0.45);
      await xclose('agave_xclose_side_b', 'planterAgaves', ag[0], ag[1], 'side', 0.9, 0.45);
      await xclose('agave_xclose_back', 'planterAgaves', ag[0], ag[1], 'back', 1.2, 0.45);
      await c.api('setTime', 3, true);
      await xclose('agave_xclose_side_noon', 'planterAgaves', ag[0], ag[1], 'side2', 1.1, 0.45);
    }
    await c.api('setTime', 0, true);
    await c.api('free');
  }

  // ---------------------------------------------------------------- the four times of day (no global regression)
  if (want('tod')) {
    const names = ['e_golden_hour', 'e_sunset', 'e_blue_hour', 'e_bright_noon'];
    await c.api('free');
    await c.api('teleport', 9, 0, 3, 180, 0);
    await pinCam(c, 0.35, 3.4, 0.05);
    await adv(c, 20);
    for (let i = 0; i < 4; i++) { await c.api('setTime', i, true); await adv(c, 2); await S(c, names[i]); }
    for (let i = 0; i < 4; i++) { await c.api('setTime', i, true); await view(c, [42, 14, 40, -2, 0, -8]); await S(c, names[i] + '_wide'); }
    await c.api('setTime', 0, true);
    await c.api('free');
  }
}
