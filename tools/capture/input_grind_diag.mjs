// Short diagnostic for the ledge + F case of input_check.mjs: state timeline from the teleport through the F pop-off.
import fs from 'node:fs';
import path from 'node:path';

export default async function (ctx) {
  const { page, api, wait, out } = ctx;
  // (no bringToFront: test windows must never take focus from the user)
  const runs = [];
  for (let k = 0; k < 3; k++) {
    await page.evaluate(() => { const g = window.__skate.game; if (g.paused) g.setPaused(false, true); });
    await api('teleport', 3.2, 0, -12.95, -90, 5.5); await api('events');
    const tl = [];
    const snap = async (tag) => { const s = await api('state'); tl.push([tag, s.t, s.mode, s.pos.map((v) => +v.toFixed(2)), s.speed, s.grind]); };
    await snap('tp');
    await page.keyboard.down('Space'); await snap('spaceDown'); await wait(250); await snap('preRelease');
    await page.keyboard.up('Space'); await page.keyboard.down('KeyE');
    let gm = null; const t0 = Date.now();
    while (Date.now() - t0 < 1500) { const s = await api('state'); if (s.mode === 'grind') { gm = s.grind; break; } await wait(25); }
    await snap('grindWait');
    await wait(120); await page.keyboard.press('KeyF'); await page.keyboard.up('KeyE'); await wait(900);
    const e = await api('events');
    runs.push({ grind: gm, timeline: tl, events: e.map((x) => [x.t, x.type, x.charge ?? x.kind ?? x.name ?? x.quality ?? '', x.fromGrind ? 'fromGrind' : '']) });
    await wait(300);
  }
  fs.writeFileSync(path.join(out, 'grind_diag.json'), JSON.stringify(runs, null, 1));
  for (const r of runs) console.log(JSON.stringify(r));
}
