// landmark views + skater close-ups into <out>/dev/views
export default async function (c) {
  await c.api('manual', true);
  await c.api('advance', 10);
  const marks = await c.api('shot', '__list__');
  for (const m of marks) {
    await c.api('shot', m);
    await c.api('advance', 2);
    await c.shot(`dev/views/${m}.jpg`);
  }
  await c.api('free');
  // close-ups of the skater standing at spawn
  await c.api('teleport', 9, 0, 3, 180, 0);
  await c.api('advance', 15);
  const sk = await c.eval(() => { const p = window.__skate.game.skater.root.position; return [p.x, p.y, p.z]; });
  const [x, y, z] = sk;
  // rider faces +X (toe side) when the nose points -Z
  await c.api('view', x + 1.25, y + 1.5, z - 0.25, x, y + 1.35, z);
  await c.api('advance', 2); await c.shot('dev/views/close_face.jpg');
  await c.api('view', x + 1.6, y + 0.5, z + 0.6, x, y + 0.35, z);
  await c.api('advance', 2); await c.shot('dev/views/close_feet.jpg');
  await c.api('view', x + 2.6, y + 1.2, z - 1.2, x, y + 0.9, z);
  await c.api('advance', 2); await c.shot('dev/views/close_body.jpg');
  await c.api('view', x - 2.2, y + 1.3, z + 1.6, x, y + 0.9, z);
  await c.api('advance', 2); await c.shot('dev/views/close_back.jpg');
}
