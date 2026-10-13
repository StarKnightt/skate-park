// Workstream B diag: fine dot grid on the skater at golden hour. Same framing as tools/capture/integ.mjs (integ_close),
// then runtime toggles (pose frozen) to isolate the cause. Output: fix2/diag_<tag><case>.png
export default async function (c) {
  await c.api('manual', true);
  await c.api('hud', false);
  await c.api('setTime', Number(process.env.TOD ?? 0), true);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await c.eval(() => window.__skate.advance(20, 1 / 30));
  const p = await c.eval(() => { const h = window.__skate.game.skater.hipsWorld(window.__skate.game.physics.pos.clone()); return [h.x, h.y, h.z]; });
  await c.api('view', p[0] + 1.1, p[1] + 0.1, p[2] - 0.5, p[0], p[1] - 0.05, p[2]);
  const set = (k) => c.eval((k) => {
    const g = window.__skate.game;
    const props = g.renderer.properties;
    const skMeshes = g.skater.meshes;
    const mats = []; for (const m of skMeshes) for (const mm of [].concat(m.material)) mats.push(mm);
    const U = (name, v) => { for (const m of mats) { const u = props.get(m).uniforms; if (u && u[name]) u[name].value = v; } };
    for (const m of skMeshes) { m.castShadow = true; m.receiveShadow = true; }
    U('uShDbg', 0);
    if (k === 'nocast') for (const m of skMeshes) m.castShadow = false;
    if (k.startsWith('dbg')) U('uShDbg', Number(k.slice(3)));
  }, k);
  for (const k of (process.env.CASES ?? 'base,nocast,dbg1,dbg2,dbg3,dbg4,dbg5').split(',')) {
    await set(k);
    await c.eval(() => { window.__skate.advance(1, 0); window.__skate.advance(1, 0); });
    await c.shot(`fix2/diag_${process.env.TAG ?? ''}${k}.png`);
  }
  await set('base');
}
