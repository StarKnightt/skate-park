// Sampling CPU profile of steady gameplay (?test, auto-ride, mobile tier 1, CPU x4, emulated 60 Hz): self time by function.
// bash tools/heavy.sh mobileqa node tools/mobile-qa/profile.mjs [--q 1] [--secs 8]
import { launch, mobilePage, PROFILES, BASE_URL, cpu, sleep, waitReady, save, log, opt } from './common.mjs';

const q = Number(opt('q', 1)), secs = Number(opt('secs', 8));
const browser = await launch();
const m = await mobilePage(browser, PROFILES.android, { cfg: { vsync: 60, noGL: true } });
const { page, cdp } = m;
await page.goto(BASE_URL + `?test&touch&mute&mode=auto&quality=${q}`, { waitUntil: 'load', timeout: 120000 });
await waitReady(page, true);
await sleep(3000);
await cpu(cdp, 4);
await sleep(2000);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
await cdp.send('Profiler.start');
await sleep(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
await cpu(cdp, 1);
// self time per node -> aggregate per function (name + line:col in the bundle)
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i]; self.set(id, (self.get(id) || 0) + (dt[i] || 0)); }
const total = [...self.values()].reduce((a, b) => a + b, 0);
const agg = new Map();
for (const [id, us] of self) {
  const n = byId.get(id), cf = n.callFrame;
  const file = cf.url ? cf.url.split('/').pop() : '';
  const key = `${cf.functionName || '(anonymous)'} ${file}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
  agg.set(key, (agg.get(key) || 0) + us);
}
const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, us]) => ({ fn: k, ms: +(us / 1000).toFixed(1), pct: +(us / total * 100).toFixed(1) }));
// inclusive time for a few known entry points (sum of self time of all descendants)
const children = new Map(profile.nodes.map((n) => [n.id, n.children || []]));
const incl = (id) => (self.get(id) || 0) + children.get(id).reduce((a, c) => a + incl(c), 0);
const named = {};
for (const n of profile.nodes) {
  const f = n.callFrame.functionName;
  if (['render', 'simulate', 'step', 'update', 'renderBufferDirect', 'projectObject', 'renderObjects', 'setProgram', 'updateMatrixWorld', 'sample', 'raycast', 'frame'].includes(f)) {
    named[f] = (named[f] || 0) + incl(n.id);
  }
}
const idle = top.find((t) => t.fn.startsWith('(idle)'))?.pct ?? 0;
const out = { quality: q, cpu: 4, secs, totalMs: +(total / 1000).toFixed(0), idlePct: idle, top, inclusiveMsByName: Object.fromEntries(Object.entries(named).map(([k, v]) => [k, +(v / 1000).toFixed(1)])) };
save(`profile_q${q}.json`, out);
for (const t of top.slice(0, 30)) console.log(String(t.pct).padStart(5) + '%', String(t.ms).padStart(7), t.fn);
log('inclusive (ms over', secs, 's, nested names double-count):', JSON.stringify(out.inclusiveMsByName));
await browser.close();
