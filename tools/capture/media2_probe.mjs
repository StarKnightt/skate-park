// Pass-2 media probe: capture speed + wall bail recovery direction (scratch output).
import fs from 'node:fs';
import path from 'node:path';

const adv = (c, n = 1, render = true) => c.eval(([k, r]) => window.__skate.advance(k, 1 / 30, r), [n, render]);
const plainCam = (c) => c.eval(() => {
  const s = window.__skate; s.free();
  const r = s.game.rig; r.userYaw = 0; r.userPitch = 0; r.idleT = 0; r.distOverride = null;
});
const info = (c) => c.eval(() => {
  const g = window.__skate.game, p = g.physics;
  return { mode: p.mode, phase: g.skater.phase, pos: p.pos.toArray().map((v) => +v.toFixed(2)), fwd: p.fwd.toArray().map((v) => +v.toFixed(2)), speed: +p.speed.toFixed(2), t: +g.simTime.toFixed(2) };
});

export default async function (c) {
  await c.api('manual', true);
  await c.api('hud', false);
  const dir = path.join(c.out, 'probe');
  fs.mkdirSync(dir, { recursive: true });
  // capture speed
  await c.api('teleport', 9, 0, 3, 180, 0);
  await plainCam(c);
  let t0 = Date.now();
  for (let i = 0; i < 30; i++) { await adv(c, 1); await c.page.screenshot({ path: path.join(dir, 'speed.jpg'), type: 'jpeg', quality: 92 }); }
  console.log('30 frames (advance+jpg) ms', Date.now() - t0);
  t0 = Date.now();
  for (let i = 0; i < 30; i++) { await adv(c, 1); await c.api('events'); await c.api('state'); await c.page.screenshot({ path: path.join(dir, 'speed.jpg'), type: 'jpeg', quality: 92 }); }
  console.log('30 frames (advance+events+state+jpg) ms', Date.now() - t0);

  // wall bail -> recover
  for (const [tag, tp] of [['a', [12, 0, -9, 90, 7.5]], ['b', [9.5, 0, -9, 90, 7.2]]]) {
    await c.api('teleport', ...tp);
    await plainCam(c);
    await c.api('events');
    let last = '';
    for (let i = 0; i < 420; i++) {
      await adv(c, 1, i % 30 === 0);
      const s = await info(c);
      const k = s.mode + '/' + s.phase;
      if (k !== last) { console.log(tag, 'f' + i, k, JSON.stringify(s)); last = k; }
      if (i % 30 === 0) await c.page.screenshot({ path: path.join(dir, `wall_${tag}_f${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 80 });
    }
    console.log(tag, 'events', JSON.stringify((await c.api('events')).map((e) => e.t + ':' + e.type)));
    console.log(tag, 'final', JSON.stringify(await info(c)));
  }
}
