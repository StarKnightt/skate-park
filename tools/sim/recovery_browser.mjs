// Browser check of the user's bowl case (feedback #5): ride up the main bowl's east wall, bail just under the coping,
// frame-step the recovery and log, per frame, the skater phase and the ground under his feet while he is up.
//   bash tools/heavy.sh D node tools/capture/run.mjs tools/sim/recovery_browser.mjs --nohmr --wx 40 --out E:/shots/skate-park/pass-04/recovery
import fs from 'node:fs';
import path from 'node:path';

export default async function (ctx) {
  const { page, out } = ctx;
  await ctx.api('manual', true);
  await ctx.api('setTime', 'golden', true);
  await ctx.api('hud', false);
  const report = [];
  const runs = [
    { name: 'pro_bowl_wall', fast: false, kind: 'back', pos: [-21, -2.3, 0.6], hd: 90, sp: 6.0, bailY: -0.7, every: 3, max: 420, cam: null },
    { name: 'pro_bowl_wall_side', fast: false, kind: 'face', pos: [-21, -2.3, -1.2], hd: 80, sp: 6.5, bailY: -0.5, every: 3, max: 420, cam: [-20.6, -0.9, 4.2, -16.6, -1.8, -0.4] },
    { name: 'fast_bowl_wall', fast: true, kind: 'back', pos: [-21, -2.3, 0.6], hd: 90, sp: 6.0, bailY: -0.7, every: 1, max: 150, cam: [-20.6, -0.9, 4.2, -16.6, -1.8, -0.4] },
    { name: 'fast_flat', fast: true, kind: 'face', pos: [30, 0, 22], hd: 180, sp: 5, bailY: -5, every: 1, max: 150, cam: [33.5, 1.4, 15.5, 30, 0.5, 18.5] },
  ];
  for (const r of runs) {
    await page.evaluate(([fast]) => { const g = window.__skate.game; Object.assign(g.physics.assist, { landing: false, autoGrind: false, fastRecover: fast }); }, [r.fast]);
    await ctx.api('free');
    await ctx.api('teleport', ...r.pos, r.hd, r.sp);
    if (r.cam) await ctx.api('view', ...r.cam);
    // ride up the wall, bail just under the coping
    let st;
    for (let i = 0; i < 120; i++) {
      st = await page.evaluate(([y, kind]) => {
        const g = window.__skate.game, p = g.physics;
        if (p.mode !== 'bail' && p.pos.y > y) p.toBail(kind, 'test');
        window.__skate.advance(1, 1 / 60, false);
        return { mode: p.mode, y: p.pos.y };
      }, [r.bailY, r.kind]);
      if (st.mode === 'bail') break;
    }
    const dir = path.join(out, 'frames', r.name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const log = [];
    let rideAt = null, recoveredAt = null, minNy = 1, clipFrames = 0, upFrames = 0, relocated = false;
    for (let i = 0; i < r.max; i++) {
      const s = await page.evaluate(() => {
        const g = window.__skate.game, sk = g.skater, p = g.physics;
        window.__skate.advance(1, 1 / 30, true);
        const V = p.pos.constructor, rp = sk.root.position;
        const h = g.world.raycast(new V(rp.x, rp.y + 0.6, rp.z), new V(0, -1, 0), 2);
        let clip = false;
        for (const [hh, rr] of [[0.5, 0.17], [0.95, 0.2], [1.45, 0.18]]) if (g.world.closestPoint(new V(rp.x, rp.y + hh, rp.z), rr)) clip = true;
        const bb = p.bail?.board;
        return { phase: sk.phase, mode: p.mode, t: +g.simTime.toFixed(3), root: [rp.x, rp.y, rp.z].map((v) => +v.toFixed(2)), ny: h ? +h.normal.y.toFixed(3) : null,
          clip, gliding: !!bb?.gliding, plan: sk.plan ? sk.plan.why : null };
      });
      log.push(s);
      if (s.gliding) relocated = true;
      if (['walk', 'stepon'].includes(s.phase)) { upFrames++; if (s.ny !== null) minNy = Math.min(minNy, s.ny); if (s.clip) clipFrames++; }
      if (recoveredAt === null && s.mode === 'ride') recoveredAt = i;
      if (s.phase === 'ride' && s.mode === 'ride') { rideAt = i; }
      if (i % r.every === 0 || rideAt !== null) await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 88 });
      if (rideAt !== null) break;
    }
    const first = log[0];
    const res = { run: r.name, fast: r.fast, bailT: first?.t, physicsRideAfter: recoveredAt !== null ? +(recoveredAt / 30).toFixed(2) : null,
      ridingAfter: rideAt !== null ? +(rideAt / 30).toFixed(2) : null, plan: log.find((l) => l.plan)?.plan ?? null, relocated,
      upFrames, minGroundNyWhileUp: minNy, clipFramesWhileUp: clipFrames,
      phases: log.reduce((a, l, i) => { if (!a.length || a[a.length - 1].p !== l.phase) a.push({ p: l.phase, f: i, root: l.root, ny: l.ny }); return a; }, []) };
    report.push(res);
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify(log, null, 1));
    console.log(JSON.stringify(res));
  }
  fs.writeFileSync(path.join(out, 'recovery_report.json'), JSON.stringify(report, null, 1));
}
