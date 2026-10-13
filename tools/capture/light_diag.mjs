// Workstream B quick diagnostics: blue hour follow view with and without bloom.
export default async function (c) {
  const S = (n) => c.shot(`diag_${n}.jpg`, { quality: 92 });
  const adv = (n = 2) => c.api('advance', n);
  await c.api('manual', true);
  await c.api('hud', false);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await adv(20);
  await c.api('free');
  await c.api('snapCam'); await c.api('camYaw', 0.35, 0.05); await c.api('camDist', 3.4);
  await adv(10);
  await c.api('setTime', 2, true); await adv(2);
  await S('blue_bloom');
  await c.eval(() => { window.__skate.game.post.bloom.intensity = 0; });
  await adv(2); await S('blue_nobloom');
  await c.api('view', 42, 14, 40, -2, 0, -8); await adv(2); await S('blue_wide_nobloom');
  await c.api('setTime', 0, true); await adv(2);
  await c.api('free');
}
