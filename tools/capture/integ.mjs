// integration check: first frame, skater close-up, perf sample
export default async function (c) {
  await c.wait(1500);
  await c.shot('integ_first.png');
  const perf = await c.eval(async () => {
    const t0 = performance.now(); let n = 0;
    await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const r = window.__skate.game.renderer.info.render;
    return { fpsRaf: +(n / 3).toFixed(1), calls: r.calls, tris: r.triangles };
  });
  console.log('perf', JSON.stringify(perf));
  await c.api('manual', true);
  await c.api('hud', false);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await c.eval(() => window.__skate.advance(20, 1 / 30));
  const p = await c.eval(() => { const h = window.__skate.game.skater.hipsWorld(window.__skate.game.physics.pos.clone()); return [h.x, h.y, h.z]; });
  await c.api('view', p[0] + 1.1, p[1] + 0.1, p[2] - 0.5, p[0], p[1] - 0.05, p[2]);
  await c.eval(() => window.__skate.advance(2, 1 / 30));
  await c.shot('integ_close.png');
}
