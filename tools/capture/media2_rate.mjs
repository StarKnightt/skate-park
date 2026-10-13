// Probe: real-time frame rate / sim-time progress after load (no screenshots).
export default async function (c) {
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < 24; i++) {
    const r = await c.eval(() => ({ sim: window.__skate.game.simTime, ppl: window.__skate.game.scenery.people.group.children.length }));
    rows.push(`${((Date.now() - t0) / 1000).toFixed(1)}s sim ${r.sim.toFixed(2)} ppl ${r.ppl}`);
    await c.wait(500);
  }
  console.log(rows.join('\n'));
}
