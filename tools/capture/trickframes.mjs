// quick key-frame grabs for tricks (dev check)
const T = [
  { name: 'ollie', tp: [9, 0, 3, 180, 5], script: [{ at: 0.1, down: ['Space'] }, { at: 0.4, up: ['Space'] }], grab: [0.35, 0.47, 0.6, 0.75, 1.0, 1.32] },
  { name: 'kickflip', tp: [9, 0, 3, 180, 5], script: [{ at: 0.1, down: ['Space'] }, { at: 0.25, down: ['ArrowLeft'] }, { at: 0.4, up: ['Space'] }, { at: 0.5, up: ['ArrowLeft'] }], grab: [0.5, 0.6, 0.7, 0.8, 0.95, 1.32] },
  { name: 'ledge5050', tp: [5, 0, -12.95, -90, 5.5], script: [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }, { at: 1.2, up: ['KeyE'] }], grab: [0.5, 0.8, 1.2, 1.6] },
  { name: 'boardslide', tp: [0, 0, 4.0, 180, 6.0], script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.6, up: ['KeyE'] }], grab: [1.0, 1.2, 1.4, 1.75] },
  { name: 'manual', tp: [9, 0, 3, 180, 4.5], script: [{ at: 0.2, down: ['ShiftLeft'] }, { at: 1.6, up: ['ShiftLeft'] }], grab: [0.6, 1.0, 1.4] },
  { name: 'push', tp: [9, 0, 3, 180, 1.0], script: [{ at: 0.0, down: ['KeyW'] }, { at: 1.2, up: ['KeyW'] }], grab: [0.1, 0.2, 0.3, 0.4, 0.55, 0.7] },
  { name: 'bail', tp: [12, 0, -9, 90, 7.5], script: [], grab: [0.6, 0.9, 1.3, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 7.6] },
];
export default async function (c) {
  await c.api('manual', true);
  const only = process.env.ONLY;
  for (const t of T) {
    if (only && !only.split(',').includes(t.name)) continue;
    await c.api('teleport', ...t.tp);
    await c.api('snapCam');
    await c.api('camYaw', 1.15, 0.05);
    await c.api('camDist', 2.7);
    await c.api('script', t.script);
    let tt = 0;
    for (const g of t.grab) {
      const n = Math.round((g - tt) * 30);
      if (n > 0) await c.eval((k) => window.__skate.advance(k, 1 / 30), n);
      tt += n / 30;
      const s = await c.api('state');
      await c.shot(`dev/tricks/${t.name}_${g.toFixed(2)}.jpg`);
      console.log(t.name, g, s.mode, s.phase, s.flip, s.grind, JSON.stringify(await c.api('feetError')));
    }
    await c.api('release');
  }
  await c.api('camDist', null);
}
