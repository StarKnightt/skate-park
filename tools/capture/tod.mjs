export default async function (c) {
  await c.api('manual', true);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await c.api('advance', 20);
  for (const [i, n] of ['golden', 'sunset', 'blue', 'noon'].entries()) {
    await c.api('setTime', i, true);
    await c.api('advance', 3);
    await c.shot(`dev/tod_${n}.jpg`);
  }
  await c.api('setTime', 0, true);
  await c.api('shot', 'bowl'); await c.api('advance', 2); await c.shot('dev/bowl2.jpg');
}
