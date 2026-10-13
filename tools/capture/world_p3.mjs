// Pass-3 world checks (#57 bushes, #58 kiosk window, #59/#61 people faces, #62 north QP/bank join). ONLY=a,b picks groups.
// bash tools/heavy.sh world node tools/capture/run.mjs tools/capture/world_p3.mjs --out E:/shots/skate-park/pass-03/dev/world
export default async function (c) {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);
  const adv = (n = 2, r = true) => c.eval(([k, rr]) => window.__skate.advance(k, 1 / 30, rr), [n, r]);
  await c.api('manual', true);
  await c.api('hud', false);
  await c.api('teleport', 37, 0, 24, 180, 0);
  await c.page.waitForFunction(() => window.__skate.game.scenery.people.items?.length > 0, null, { timeout: 30000 })
    .catch(() => console.log('people not loaded'));
  await adv(6);
  await c.eval(() => {
    const s = window.__skate, g = s.game;
    /** camera relative to a person (like media2's person cam): ahead/side in the person's frame */
    window.__pcam = (idx, ahead, side, h, lookH, fov) => {
      const p = g.scenery.people.items[idx];
      const hp = p.holder.position, ry = p.holder.rotation.y;
      const fx = Math.sin(ry), fz = Math.cos(ry);
      const look = [hp.x, hp.y + lookH, hp.z];
      const pos = [look[0] + fx * ahead + fz * side, hp.y + h, look[2] + fz * ahead - fx * side];
      s.view(...pos, ...look);
      const cam = g.camera;
      cam.fov = fov; cam.updateProjectionMatrix();
      cam.position.set(...pos); cam.lookAt(...look); cam.updateMatrixWorld();
      return { pos, look };
    };
    window.__lods = () => {
      const out = [];
      g.scenery.people.items.forEach((p, i) => {
        let lod = null;
        p.holder.traverse((o) => { if (o.isLOD) lod = o; });
        const wp = lod ? lod.getWorldPosition(new lod.position.constructor()) : null;
        out.push({ i, clip: p.spot.clip, level: lod ? lod.getCurrentLevel() : -1, dist: wp ? +wp.distanceTo(g.camera.position).toFixed(2) : -1 });
      });
      return out;
    };
    window.__forceLevel = (lvl) => g.scenery.people.group.traverse((o) => {
      if (!o.isLOD) return;
      o.autoUpdate = lvl < 0;
      if (lvl >= 0) o.levels.forEach((l, j) => (l.object.visible = j === lvl));
    });
  });
  const pshot = async (name, idx, ahead, side, h, lookH, fov = 45) => {
    await adv(1, false);
    const r = await c.eval((a) => { const v = window.__pcam(...a); window.__skate.game.render(1 / 30); return v; }, [idx, ahead, side, h, lookH, fov]);
    // the LOD picks its level while rendering: render once more so the shot uses the level of this camera
    await c.eval(() => window.__skate.game.render(1 / 30));
    await c.shot(`${name}.png`);
    return r;
  };
  if (want('people')) {
    const items = await c.eval(() => window.__skate.game.scenery.people.items.map((p, i) => ({ i, clip: p.spot.clip, at: p.spot.at, path: !!p.spot.path })));
    console.log('people', JSON.stringify(items));
    // clip20 f000: walker on the boardwalk (east), 5 m ahead, 1.6 m to the side
    await pshot('p_walker_clip20', 7, 5.0, 1.6, 1.5, 1.0);
    console.log('levels at clip20 cam', JSON.stringify((await c.eval(() => window.__lods()))[7]));
    await pshot('p_walker_3m', 7, 3.0, 0.6, 1.6, 1.5, 35);
    console.log('levels at 3 m', JSON.stringify((await c.eval(() => window.__lods()))[7]));
    for (let l = 0; l < 4; l++) {
      await c.eval((k) => window.__forceLevel(k), l);
      await pshot(`p_walker_lod${l}`, 7, 2.2, 0.4, 1.62, 1.55, 30);
    }
    await c.eval(() => window.__forceLevel(-1));
    await pshot('p_walker2_3m', 8, 3.0, 0.6, 1.6, 1.5, 35);
    // lifeguard (index 13): critic view + close
    await c.api('view', -5.5, 3.2, -57.5, -8, 2.9, -53.4);
    await c.eval(() => { const cam = window.__skate.game.camera; cam.fov = 56; cam.updateProjectionMatrix(); });
    await adv(2);
    await c.shot('p_lifeguard_view.png');
    console.log('lifeguard level', JSON.stringify((await c.eval(() => window.__lods()))[13]));
    await pshot('p_lifeguard_3m', 13, 2.6, 0.5, 1.15, 1.0, 35);
    for (let l = 0; l < 2; l++) {
      await c.eval((k) => window.__forceLevel(k), l);
      await pshot(`p_lifeguard_lod${l}`, 13, 1.8, 0.3, 1.05, 0.98, 30);
    }
    await c.eval(() => window.__forceLevel(-1));
  }
  if (want('zoom')) {
    // the clip20 camera position, fov narrowed to magnify the head with the same perspective; then parts in debug colours
    await c.eval(() => { const p = window.__skate.game.scenery.people.items[7]; p.s = 3; p.dir = 1; p.turn = 0; });
    await adv(24, false);
    await c.eval(() => { window.__skate.game.scenery.people.items[7].spot.speed = 0; });
    const zcam = (fov) => c.eval((f) => {
      const g = window.__skate.game, p = g.scenery.people.items[7];
      const r = window.__pcam(7, 5.0, 1.6, 1.5, 1.0, 45);
      const h = p.holder.getObjectByName('mixamorigHead'), V = g.camera.position.constructor;
      const hp = h.getWorldPosition(new V()).add(new V(0, 0.05, 0));
      const cam = g.camera; cam.fov = f; cam.updateProjectionMatrix(); cam.lookAt(hp); cam.updateMatrixWorld();
      window.__skate.view(...r.pos, hp.x, hp.y, hp.z);
      g.render(1 / 30); g.render(1 / 30);
    }, fov);
    for (const k of [0, 1, 2]) {
      await adv(7, false);
      await zcam(45); await c.shot(`z_${k}_fov45.png`);
      await zcam(9); await c.shot(`z_${k}_fov9.png`);
    }
    for (const l of [1, 2]) {
      await c.eval((k) => window.__forceLevel(k), l);
      await zcam(45); await c.shot(`z_lod${l}_fov45.png`);
      await zcam(9); await c.shot(`z_lod${l}_fov9.png`);
    }
    await c.eval(() => window.__forceLevel(-1));
    await c.eval(() => {
      const P = window.__skate.game.scenery.people, p = P.items[7];
      const dbg = { hair: [1, 0, 0], cream: [0, 1, 0], cap: [0, 0, 1], skin: [1, 1, 0], tee: [1, 0, 1] };
      p.holder.traverse((o) => {
        if (!o.isSkinnedMesh || !o.material.vertexColors) return;
        const u = window.__skate.game.renderer.properties.get(o.material).uniforms;
        if (u?.uPNew) for (const [n, c3] of Object.entries(dbg)) { const k = P.refNames.indexOf(n); if (k >= 0) u.uPNew.value[k].set(...c3); }
      });
    });
    await zcam(9); await c.shot('z_dbg_fov9.png');
  }
  if (want('hairmap')) {
    // where the hair-coloured triangles of the full-detail body sit in bind space (head region), by height band
    const r = await c.eval(() => {
      const P = window.__skate.game.scenery.people;
      const p = P.items[7];
      let body = null;
      p.holder.traverse((o) => { if (o.isSkinnedMesh && !/_lod/.test(o.name) && o.material.vertexColors) body = o; });
      const g = body.geometry, pos = g.getAttribute('position'), col = g.getAttribute('color'), ix = g.index.array;
      const k = P.refNames.indexOf('hair'), ref = P.refs[k], kc = P.refNames.indexOf('cap'), refC = P.refs[kc];
      const near = (v, rc) => (col.getX(v) - rc.r) ** 2 + (col.getY(v) - rc.g) ** 2 + (col.getZ(v) - rc.b) ** 2 < 0.0025;
      let ymin = 1e9, ymax = -1e9;
      for (let v = 0; v < pos.count; v++) if (near(v, ref)) { ymin = Math.min(ymin, pos.getY(v)); ymax = Math.max(ymax, pos.getY(v)); }
      let cy0 = 1e9;
      for (let v = 0; v < pos.count; v++) if (near(v, refC)) cy0 = Math.min(cy0, pos.getY(v));
      // hair triangles below the lowest cap vertex: locks hanging out under the brim / at the sides
      const tris = [];
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t], b = ix[t + 1], cc = ix[t + 2];
        if (!near(a, ref) || !near(b, ref) || !near(cc, ref)) continue;
        const y = (pos.getY(a) + pos.getY(b) + pos.getY(cc)) / 3;
        if (y < cy0) tris.push([+(pos.getX(a)).toFixed(3), +y.toFixed(3), +(pos.getZ(a)).toFixed(3)]);
      }
      tris.sort((u, w) => u[1] - w[1]);
      return { ymin, ymax, capMinY: cy0, nBelow: tris.length, lowest: tris.slice(0, 40), scale: body.matrixWorld.elements[0] };
    });
    console.log(JSON.stringify(r));
  }
  if (want('rimtest')) {
    // backlit walker close-up: as is, with the backlight rim off, and with the hair part painted red
    await c.eval(() => { const p = window.__skate.game.scenery.people.items[7]; p.s = 3; p.dir = 1; p.turn = 0; });
    await adv(20, false);
    const close = () => c.eval(() => { window.__pcam(7, 2.2, 0.75, 1.62, 1.5, 30); window.__skate.game.render(1 / 30); window.__skate.game.render(1 / 30); });
    await c.eval(() => { const p = window.__skate.game.scenery.people.items[7]; p.spot.speed = 0; });
    await close(); await c.shot('rim_as_is.png');
    const rim = await c.eval(async () => { const m = await import('/src/render/materials.ts'); const v = m.shared.uRimStrength.value; m.shared.uRimStrength.value = 0; return v; });
    await close(); await c.shot('rim_off.png');
    await c.eval(async (v) => { const m = await import('/src/render/materials.ts'); m.shared.uRimStrength.value = v; }, rim);
    const hairIdx = await c.eval(() => {
      const P = window.__skate.game.scenery.people, p = P.items[7];
      const k = P.refNames.indexOf('hair');
      let done = 0;
      p.holder.traverse((o) => {
        if (!o.isSkinnedMesh || !o.material.vertexColors) return;
        const u = window.__skate.game.renderer.properties.get(o.material).currentProgram ? window.__skate.game.renderer.properties.get(o.material).uniforms : null;
        if (u?.uPNew) { u.uPNew.value[k].set(1, 0, 0); done++; }
      });
      return { k, done };
    });
    console.log('hair recolour', JSON.stringify(hairIdx));
    await close(); await c.shot('rim_hair_red.png');
  }
  if (want('stretch')) {
    // triangles of a person's full-detail mesh that stretch far beyond their bind-pose size in the current pose
    const who = (process.env.WHO ?? '7').split(',').map(Number);
    for (const idx of who) {
      for (let k = 0; k < 4; k++) {
        await adv(9, false);
        const rep = await c.eval(([i, lim, yMin]) => {
          const g = window.__skate.game, p = g.scenery.people.items[i];
          p.holder.updateMatrixWorld(true);
          const meshes = [];
          p.holder.traverse((o) => { if (o.isSkinnedMesh && !/_lod/.test(o.name)) meshes.push(o); });
          const V = g.camera.position.constructor;
          const out = [];
          for (const sm of meshes) {
            sm.skeleton.update();
            const geo = sm.geometry, pos = geo.getAttribute('position'), ix = geo.index.array, si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
            const col = geo.getAttribute('color');
            const P = [], B = [];
            for (let v = 0; v < pos.count; v++) { P.push(sm.getVertexPosition(v, new V()).applyMatrix4(sm.matrixWorld)); B.push(new V().fromBufferAttribute(pos, v)); }
            const bscale = new V(); sm.matrixWorld.decompose(new V(), new sm.quaternion.constructor(), bscale);
            const bones = (v) => { let best = 0, bw = -1; for (let q = 0; q < 4; q++) if (sw.getComponent(v, q) > bw) { bw = sw.getComponent(v, q); best = si.getComponent(v, q); } return sm.skeleton.bones[best]?.name.replace('mixamorig', '') + ':' + bw.toFixed(2); };
            for (let t = 0; t < ix.length; t += 3) {
              const a = ix[t], b = ix[t + 1], cc = ix[t + 2];
              let worst = 0, len = 0;
              for (const [u, w] of [[a, b], [b, cc], [cc, a]]) {
                const L0 = B[u].distanceTo(B[w]) * bscale.x, L1 = P[u].distanceTo(P[w]);
                if (L1 > 0.02 && L1 / Math.max(L0, 1e-4) > worst) { worst = L1 / Math.max(L0, 1e-4); len = L1; }
              }
              if (worst > lim && P[a].y > yMin + p.holder.position.y) out.push({ mesh: sm.name, t: t / 3, worst: +worst.toFixed(1), len: +len.toFixed(3), bones: [a, b, cc].map(bones), col: col ? [a, b, cc].map((v) => [col.getX(v), col.getY(v), col.getZ(v)].map((q) => +q.toFixed(2)).join('/')) : null, y: +(P[a].y - p.holder.position.y).toFixed(2) });
            }
          }
          out.sort((x, y) => y.worst - x.worst);
          return { n: out.length, top: out.slice(0, 12) };
        }, [idx, Number(process.env.STRETCH ?? 2.2), Number(process.env.YMIN ?? -99)]);
        console.log(`person ${idx} frame ${k}: ${rep.n} stretched triangles`);
        for (const r of rep.top) console.log('  ', JSON.stringify(r));
      }
    }
  }
  if (want('atlas')) {
    // the painted leaf atlas as a PNG (alpha kept)
    const url = await c.eval(() => {
      let tex = null;
      window.__skate.game.scene.traverse((o) => { if (o.material?.name === 'foliage') tex = o.material.map; });
      if (!tex) return null;
      const { data, width, height } = tex.image;
      const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
      cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
      return cv.toDataURL('image/png');
    });
    if (url) (await import('node:fs')).writeFileSync(`${c.out}/foliage_atlas.png`, Buffer.from(url.split(',')[1], 'base64'));
    const face = await c.eval(() => {
      let tex = null;
      window.__skate.game.scenery.people.group.traverse((o) => { if (o.material?.name === 'personFace') tex = o.material.map; });
      return tex?.image?.toDataURL ? tex.image.toDataURL('image/png') : null;
    });
    if (face) (await import('node:fs')).writeFileSync(`${c.out}/crowd_face.png`, Buffer.from(face.split(',')[1], 'base64'));
  }
  if (want('clip20')) {
    // clip20 f000-f074 framing: walker 7 heading west towards a camera 5 m ahead, 1.6 m to his left, fov 45
    // (walking east towards the camera, so the low north-west sun is behind him as in pass 2)
    await c.eval(() => { const p = window.__skate.game.scenery.people.items[7]; p.s = 3; p.dir = 1; p.turn = 0; });
    for (let f = 0; f < 75; f++) {
      await adv(1, false);
      await c.eval(() => { window.__pcam(7, 5.0, 1.6, 1.5, 1.0, 45); window.__skate.game.render(1 / 30); });
      if (f % 12 === 0) await c.shot(`c20_f${String(f).padStart(3, '0')}.png`);
    }
    // the same at 3 m
    for (let f = 0; f < 3; f++) {
      await adv(10, false);
      await c.eval(() => { window.__pcam(7, 3.0, 0.9, 1.6, 1.45, 40); window.__skate.game.render(1 / 30); });
      await c.shot(`c20_3m_${f}.png`);
    }
  }
  if (want('orbit')) {
    // head close-ups around a person (LOD 0) through the walk cycle: who = index list
    const who = (process.env.WHO ?? '7,8,13').split(',').map(Number);
    const info = await c.eval(() => {
      const P = window.__skate.game.scenery.people;
      return { refs: P.refNames, n: P.refs.length };
    });
    console.log('palette refs', JSON.stringify(info));
    for (const idx of who) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        await adv(4, false);
        const head = await c.eval(([i, ang]) => {
          const g = window.__skate.game, p = g.scenery.people.items[i];
          const h = p.holder.getObjectByName('mixamorigHead');
          const V = h.position.constructor, hp = h.getWorldPosition(new V()).add(new V(0, 0.08, 0));
          const ry = p.holder.rotation.y + ang;
          const pos = [hp.x + Math.sin(ry) * 1.1, hp.y + 0.05, hp.z + Math.cos(ry) * 1.1];
          window.__skate.view(...pos, hp.x, hp.y, hp.z);
          const cam = g.camera; cam.fov = 30; cam.updateProjectionMatrix();
          cam.position.set(...pos); cam.lookAt(hp); cam.updateMatrixWorld();
          g.render(1 / 30); g.render(1 / 30);
          return [hp.x, hp.y, hp.z];
        }, [idx, a]);
        await c.shot(`o_${idx}_${k}.jpg`);
        if (k === 0) console.log('head', idx, JSON.stringify(head.map((v) => +v.toFixed(2))));
      }
    }
  }
  if (want('ride')) {
    // game follow camera riding the north quarter pipe over the moulded hip into the bank (and back), 30 fps frames
    const rides = [
      { name: 'ride_qp_east', tp: [-7, 0, -19.1, 90, 5.5], frames: 75 },
      { name: 'ride_qp_high_east', tp: [-6, 0, -19.6, 90, 6.5], frames: 70 },
      { name: 'ride_bank_west', tp: [3, 0, -19.3, -90, 5.5], frames: 80 },
      { name: 'ride_up_hip', tp: [-2.25, 0, -15.5, 180, 4.8], frames: 95 },
    ];
    for (const r of rides) {
      await c.api('free'); await c.api('script', []); await c.api('release');
      await c.api('teleport', ...r.tp); await c.api('snapCam');
      await c.eval(() => window.__skate.advance(2, 1 / 30, false));
      await c.api('events');
      await c.record(r.name, r.frames);
      const ev = (await c.api('events')).filter((e) => !['leaveGround', 'boardClack'].includes(e.type));
      console.log(r.name, ev.map((e) => `${e.t}:${e.type}${e.quality ? `(${e.quality})` : ''}${e.reason ? `{${e.reason}}` : ''}`).join(' ') || '-', JSON.stringify((({ mode, pos, speed }) => ({ mode, pos, speed }))(await c.api('state'))));
    }
  }
  if (want('hiptod')) {
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(4);
    for (let t = 0; t < 4; t++) {
      await c.api('setTime', t, true);
      await c.api('view', -5, 2.4, -11, -4, 0.7, -21);
      await c.eval(() => { const cam = window.__skate.game.camera; cam.fov = 56; cam.updateProjectionMatrix(); });
      await adv(2); await c.shot(`hip_t${t}.png`);
      await c.api('view', -0.5, 1.3, -15.2, -2.0, 0.5, -19.5);
      await adv(2); await c.shot(`hip_low_t${t}.png`);
    }
    await c.api('setTime', 0, true);
  }
  if (want('perf')) {
    const measure = async (label, v) => {
      await c.api('view', ...v);
      await c.eval(() => { const cam = window.__skate.game.camera; cam.fov = 56; cam.updateProjectionMatrix(); });
      await adv(2);
      const r = await c.eval(() => {
        const g = window.__skate.game, info = g.renderer.info;
        info.autoReset = false; info.reset();
        window.__skate.advance(1, 1 / 30, true);
        const res = { calls: info.render.calls, tris: info.render.triangles };
        info.autoReset = true;
        const lv = [];
        g.scenery.people.group.traverse((o) => o.isLOD && lv.push(o.getCurrentLevel()));
        return { ...res, levels: lv.join(''), programs: info.programs.length };
      });
      console.log('perf', label, JSON.stringify(r));
    };
    const mine = await c.eval(() => {
      const out = {};
      window.__skate.game.scene.traverse((o) => {
        if (!o.isMesh) return;
        const n = o.name || o.material?.name;
        if (['townBushes', 'planterBushes', 'kioskShop', 'shrubs', 'planterPlants'].includes(n)) out[n] = (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3;
      });
      return out;
    });
    console.log('mesh triangles', JSON.stringify(mine));
    await c.api('teleport', 37, 0, 24, 180, 0); await adv(4);
    await measure('spawn', [9, 1.7, 6.6, 9, 1.0, -6]);
    await measure('overview', [42, 18, 42, 0, 0, -6]);
    await measure('boardwalk', [36, 1.8, -24.5, 50, 1.0, -24.6]);
    await measure('town', [8, 5, 28, 6, 2.5, 60]);
    await measure('kiosk', [25, 3.0, 36, 25, 1.6, 27]);
  }
  if (want('kiosk')) {
    // the service window at every time of day, plus an oblique look and a close-up
    const v = { k_town_side: [25, 3.0, 36, 25, 1.6, 27], k_oblique: [21.0, 1.9, 33.5, 25.5, 1.5, 28.6], k_close: [25.6, 1.75, 31.6, 25.4, 1.5, 28.6] };
    for (let t = 0; t < 4; t++) {
      await c.api('setTime', t, true);
      for (const [n, vv] of Object.entries(v)) {
        if (t > 0 && n !== 'k_town_side') continue;
        await c.api('view', ...vv);
        await c.eval(() => { const cam = window.__skate.game.camera; cam.fov = 56; cam.updateProjectionMatrix(); });
        await adv(2); await c.shot(`${n}_t${t}.png`);
      }
    }
    await c.api('setTime', 0, true);
  }
  if (want('views')) {
    const views = {
      v_qp_bank_north: [-5, 2.4, -11, -4, 0.7, -21], v_kiosk_town_side: [25, 3.0, 36, 25, 1.6, 27],
      v_people_boardwalk: [36, 1.8, -24.5, 50, 1.0, -24.6], v_edge_east: [33.5, 1.7, 4.0, 39, 0.6, -2],
      v_town_south: [8, 5, 28, 6, 2.5, 60], v_line_sw_pad_ledge: [-7, 2.1, 15.5, -18, 0.2, 21],
      v_people_west_steps: [-33.5, 1.6, 9.5, -38.2, 0.9, 9.5], v_banks_terrace: [-9, 2.2, 7, -0.5, 0.5, 13.5],
      v_edge_north_boardwalk: [-36, 1.6, -21, -40, 0.6, -26], v_edge_south: [-22, 1.7, 19.5, -26, 0.5, 26],
      v_edge_west: [-33.5, 1.6, 14, -39, 0.6, 9],
    };
    const sel = process.env.VIEWS ? process.env.VIEWS.split(',') : Object.keys(views);
    for (const n of sel) {
      await c.api('view', ...views[n]);
      await c.eval(() => { const cam = window.__skate.game.camera; cam.fov = 56; cam.updateProjectionMatrix(); });
      await adv(2); await c.shot(`${n}.png`);
    }
  }
  await c.api('free');
}
