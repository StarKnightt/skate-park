// Batch 2 browser check in Easy mode (assists from the control mode): an ollie along the long ledge (auto-grind without
// E, rides off the end without re-catching it) and a bail just under the main bowl's coping (quick recovery).
//   bash tools/heavy.sh D node tools/capture/run.mjs tools/sim/recovery_b2_browser.mjs --nohmr --wx 40 --q "test&mute&mode=easy" --out E:/shots/skate-park/pass-04/recovery/b2
import fs from 'node:fs';
import path from 'node:path';

export default async function (ctx) {
  const { page, out } = ctx;
  await ctx.api('manual', true);
  await ctx.api('setTime', 'golden', true);
  await ctx.api('hud', false);
  const assist = await page.evaluate(() => ({ ...window.__skate.game.physics.assist }));
  console.log('assist from the control mode:', JSON.stringify(assist));
  const runs = [
    { name: 'easy_long_ledge', pos: [-12, 0, -11.75], hd: 90, sp: 5, frames: 120, cam: [-4.5, 2.2, -6.2, -5.5, 0.3, -12.3],
      script: [{ at: 0.1, down: ['Space'] }, { at: 0.16, up: ['Space'] }] },
    { name: 'easy_bowl_bail', pos: [-21, -2.3, 0.6], hd: 90, sp: 6, frames: 90, bailY: -0.7, cam: [-20.6, -0.9, 4.2, -16.6, -1.8, -0.4] },
    // forced setup to show the level change: once the body lies still in the bowl it is put on the deck behind the coping
    // (the board stays on the bowl floor), so the board has to come up to him
    { name: 'forced_deck_board_in_bowl', pos: [-21, -2.3, 0.6], hd: 90, sp: 6, frames: 120, bailY: -0.7, deck: [-13.6, 0, 1.2], cam: [-20.2, 0.9, 5.2, -15.2, -1.2, 0.6] },
  ];
  const report = [];
  for (const r of runs) {
    await ctx.api('free');
    await ctx.api('teleport', ...r.pos, r.hd, r.sp);
    await ctx.api('events');
    await ctx.api('view', ...r.cam);
    if (r.script) await ctx.api('script', r.script);
    if (r.bailY !== undefined) {
      for (let i = 0; i < 120; i++) {
        const m = await page.evaluate(([y]) => {
          const p = window.__skate.game.physics;
          if (p.mode !== 'bail' && p.pos.y > y) p.toBail('back', 'test');
          window.__skate.advance(1, 1 / 60, false);
          return p.mode;
        }, [r.bailY]);
        if (m === 'bail') break;
      }
    }
    if (r.deck) {
      // let the body come to rest in the bowl (not drawn), then put it on the deck
      await page.evaluate(([d]) => {
        const g = window.__skate.game, p = g.physics;
        for (let i = 0; i < 200 && p.bail && !(p.bail.still > 0.04); i++) window.__skate.advance(1, 1 / 60, false);
        if (p.bail) { p.bail.body.set(d[0], d[1], d[2]); p.bail.bodyVel.set(0, 0, 0); p.bail.checked = false; }
      }, [r.deck]);
    }
    const dir = path.join(out, 'frames', r.name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const log = [];
    for (let i = 0; i < r.frames; i++) {
      const s = await page.evaluate(() => {
        const g = window.__skate.game, sk = g.skater, p = g.physics;
        window.__skate.advance(1, 1 / 30, true);
        const V = p.pos.constructor, rp = sk.root.position;
        const h = g.world.raycast(new V(rp.x, rp.y + 0.6, rp.z), new V(0, -1, 0), 2);
        return { phase: sk.phase, mode: p.mode, t: +g.simTime.toFixed(3), root: [rp.x, rp.y, rp.z].map((v) => +v.toFixed(2)), ny: h ? +h.normal.y.toFixed(3) : null,
          grind: p.grind?.name ?? null, gliding: !!p.bail?.board?.gliding, plan: sk.plan ? sk.plan.why : null };
      });
      log.push(s);
      await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 88 });
      if (r.bailY !== undefined && i > 10 && s.phase === 'ride' && s.mode === 'ride') break;
    }
    const ev = await ctx.api('events');
    const starts = ev.filter((e) => e.type === 'grindStart'), ends = ev.filter((e) => e.type === 'grindEnd');
    const firstRide = log.findIndex((l, i) => i > 0 && l.mode === 'ride' && log[i - 1].mode !== 'ride');
    const res = { run: r.name, grindStarts: starts.length, grindEnds: ends.length, grinds: starts.map((e) => e.name), bails: ev.filter((e) => e.type === 'bail').length,
      lands: ev.filter((e) => e.type === 'land').map((e) => e.quality), plan: log.find((l) => l.plan)?.plan ?? null, rolled: log.some((l) => l.gliding),
      ridingAfter: r.bailY !== undefined && firstRide >= 0 ? +(firstRide / 30).toFixed(2) : null,
      minNyUp: Math.min(...log.filter((l) => ['walk', 'stepon'].includes(l.phase) && l.ny !== null).map((l) => l.ny), 1) };
    report.push(res);
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log, null, 1));
    console.log(JSON.stringify(res));
  }
  fs.writeFileSync(path.join(out, 'b2_report.json'), JSON.stringify({ assist, report }, null, 1));
}
