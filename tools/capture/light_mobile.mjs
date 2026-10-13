// Workstream B: mobile portrait check (item #10 sky rectangle, #8 banding). Run with
// --mobile --w 390 --h 844 --q "test&fps=30&mute&touch"
export default async function (c) {
  const T = ['golden', 'sunset', 'blue', 'noon'];
  await c.api('manual', true);
  await c.api('touch', true);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await c.api('advance', 20);
  // same framing as pass-01 f_mobile_portrait.png (HUD on), then every time of day with the HUD off
  await c.shot('mobile/portrait_spawn_golden_hud.png');
  await c.api('hud', false);
  for (let i = 0; i < 4; i++) {
    await c.api('setTime', i, true);
    await c.api('advance', 2);
    await c.shot(`mobile/portrait_spawn_${T[i]}.png`);
  }
  // rolling: two consecutive frames so grain / moire flicker can be compared
  await c.api('setTime', 0, true);
  await c.api('teleport', 9, 0, 3, 180, 4);
  await c.api('advance', 24);
  await c.shot('mobile/portrait_roll_a.png');
  await c.api('advance', 1);
  await c.shot('mobile/portrait_roll_b.png');
  await c.api('teleport', 9, 0, 3, 180, 0);
}
