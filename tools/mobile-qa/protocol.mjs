// Evaluate the mobile test protocol from the JSON results in $MQA_OUT/data (no browser; see common.mjs for the default).
// Run the suites first (run_all.sh), then: node tools/mobile-qa/protocol.mjs
// Prints one PASS / FAIL line per threshold and writes data/protocol_result.json.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './common.mjs';

const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return null; } };
const rows = [];
const check = (id, what, threshold, value, pass) => rows.push({ id, what, threshold, value, result: pass == null ? 'N/A' : pass ? 'PASS' : 'FAIL' });

// ---- P1 loading (load.json: Fast 4G + CPU x4, warm CDN)
const load = read('load.json');
for (const k of ['android4g', 'iphone4g']) {
  const r = load?.[k];
  check(`P1.${k}.fcp`, `${k}: loading screen visible (FCP)`, '< 2000 ms', r?.fcpMs, r ? r.fcpMs < 2000 : null);
  check(`P1.${k}.ready`, `${k}: playable (loading overlay gone, game loop running)`, '< 8000 ms', r?.readyMs, r ? r.readyMs < 8000 : null);
  check(`P1.${k}.bytes`, `${k}: transfer before playable`, '< 2.5 MB', r?.transferBeforeReadyMB, r ? r.transferBeforeReadyMB < 2.5 : null);
  check(`P1.${k}.audio`, `${k}: all sound loaded + decoded after the first tap`, '< 3000 ms', r?.audioAllDecodedAfterTapMs, r ? r.audioAllDecodedAfterTapMs != null && r.audioAllDecodedAfterTapMs < 3000 : null);
}
const slow = load?.androidSlow;
check('P1.slow.ready', 'Slow 4G + CPU x6: playable', '< 20000 ms', slow?.readyMs, slow ? slow.readyMs < 20000 : null);

// ---- P2 performance (perf_adaptive_*.json: real build, emulated 60 Hz, auto-ride, no WebGL hooks)
const perfRuns = [...(read('perf_adaptive_sweep.json')?.runs ?? []), ...(read('perf_adaptive_profiles.json')?.runs ?? []), ...(read('perf_adaptive_android4x_repeat.json')?.runs ?? [])]
  .filter((r) => !r.glHooks && r.noGLHooks !== false);
let rep = {};
for (const r of perfRuns) { const k = `${r.profile.split(' ')[0]} ${r.orientation[0].toUpperCase()} x${r.cpu}`; rep[k] = (rep[k] || 0) + 1; r._tag = rep[k] > 1 ? `${k} #${rep[k]}` : k; }
for (const r of perfRuns) {
  const tag = r._tag;
  if (r.cpu === 4) {
    check(`P2.fps.${tag}`, `${tag}: mean fps over the run`, '>= 50', r.frames?.fps, r.frames ? r.frames.fps >= 50 : null);
    check(`P2.jank.${tag}`, `${tag}: frames missing vsync (> 20 ms)`, '<= 10 %', r.frames?.over20ms, r.frames ? r.frames.over20ms <= 10 : null);
    check(`P2.cpu.${tag}`, `${tag}: main-thread ms per frame, p95`, '<= 14 ms', r.frames?.cpuMs.p95, r.frames ? r.frames.cpuMs.p95 <= 14 : null);
    check(`P2.dpr.${tag}`, `${tag}: render scale never below DPR 1.0 (adaptive quality)`, '>= 1.0', Math.min(...r.samples.map((s) => s.dpr)), Math.min(...r.samples.map((s) => s.dpr)) >= 1.0);
  }
  if (r.cpu === 6) check(`P2.fps6.${tag}`, `${tag}: mean fps`, '>= 40', r.frames?.fps, r.frames ? r.frames.fps >= 40 : null);
  if (r.cpu === 1) check(`P2.fps1.${tag}`, `${tag}: mean fps`, '>= 59', r.frames?.fps, r.frames ? r.frames.fps >= 59 : null);
}
// ---- P3 render budget on the mobile tier (perf_tiers.json, tier 1)
const t1 = read('perf_tiers.json')?.runs?.find((r) => r.quality === 1);
check('P3.calls', 'tier 1: draw calls per frame (all passes)', '<= 150', t1?.info.calls, t1 ? t1.info.calls <= 150 : null);
check('P3.tris', 'tier 1: triangles per frame (all passes)', '<= 600k', t1?.info.triangles, t1 ? t1.info.triangles <= 600000 : null);
check('P3.renderCpu', 'tier 1 at x4: render submission ms/frame (shadows+scene+post)', '<= 7 ms', t1?.cpuMsPerFrame?.['post.render submit (shadows+scene+post)'], t1 ? t1.cpuMsPerFrame['post.render submit (shadows+scene+post)'] <= 7 : null);

// ---- P4 / P5 layout (layout.json)
const lay = read('layout.json');
if (lay) {
  const small = new Set(), over = new Set(), safe = new Set(), menuSmall = new Set(), fonts = new Set();
  for (const c of lay.configs) {
    for (const s of [c.startIssues, c.popupIssues, c.steadyIssues].filter(Boolean)) {
      s.smallTargets.forEach((x) => small.add(x.split(' ')[0]));
      s.overlaps.forEach((x) => over.add(`${c.config}: ${x.replace(/ \(.*/, '')}`));
      s.safeArea.forEach((x) => safe.add(`${c.config}: ${x.split(' ')[0]}`));
      s.smallFonts.forEach((x) => fonts.add(x.split(' ')[0]));
    }
    c.pause.small.forEach((x) => menuSmall.add(x.replace(/ [\d.]+x[\d.]+$/, '')));
    if (c.pause.panel.needsScroll && !(c.pause.scrolledTo > 0)) over.add(`${c.config}: pause panel overflows and did not scroll`);
  }
  check('P4.hud', 'HUD / touch controls: every tap target >= 44x44 CSS px', '0 below', [...small].join(', ') || 0, small.size === 0);
  check('P4.menu', 'pause menu: every control >= 44 px tall', '0 below', menuSmall.size, menuSmall.size === 0);
  check('P5.overlap', 'no overlaps between HUD, controls, trick popup, skater (all profiles x orientations)', '0', [...over].join('; ') || 0, over.size === 0);
  check('P5.safe', 'nothing inside the emulated safe-area insets', '0', [...safe].join('; ') || 0, safe.size === 0);
  check('P5.fonts', 'HUD text >= 12 px', '0 below', [...fonts].join(', ') || 0, fonts.size === 0);
  const fits = lay.configs.every((c) => !c.pause.panel.needsScroll || c.pause.scrolledTo > 0);
  check('P5.menuFit', 'pause menu reachable on every viewport (fits or touch-scrolls)', 'yes', fits, fits);
}
// ---- P6 touch suite, P7 hygiene
for (const f of fs.readdirSync(DATA).filter((x) => /^touch_.*\.json$/.test(x))) {
  const t = read(f);
  for (const c of t.cases) check(`P6.${c.id}`, `${f.replace('.json', '')}: ${c.name}`, 'PASS (NOTE = design risk)', c.status, c.status === 'FAIL' ? false : c.status === 'PASS' ? true : null);
}
for (const f of fs.readdirSync(DATA).filter((x) => /^hygiene_.*\.json$/.test(x))) {
  const h = read(f);
  for (const c of h.cases) check(`P7.${c.id}`, `${f.replace('.json', '')}: ${c.name}`, 'PASS', c.status, c.status === 'FAIL' ? false : c.status === 'PASS' ? true : null);
}
// ---- P8 memory
const lm = load?.android4g;
const audioMB = lm?.audioDecoded?.reduce((a, b) => a + b.mb, 0);
check('P8.audio', 'decoded audio PCM', '<= 40 MB', audioMB != null ? +audioMB.toFixed(1) : null, audioMB != null ? audioMB <= 40 : null);
const gpu = lm?.gpuMemEstimateMB;
const gpuTot = gpu ? gpu.tex + gpu.rb + gpu.buf : null;
check('P8.gpu', 'GPU memory estimate (textures + render targets + buffers)', '<= 120 MB', gpuTot != null ? +gpuTot.toFixed(1) : null, gpuTot != null ? gpuTot <= 120 : null);
const heap = Math.max(...perfRuns.map((r) => r.samples.at(-1)?.heapMB ?? 0));
check('P8.heap', 'JS heap after 25-30 s of play', '<= 120 MB', heap, heap <= 120);

const w = Math.max(...rows.map((r) => r.what.length));
for (const r of rows) console.log(`${r.result.padEnd(4)}  ${r.what.padEnd(Math.min(w, 90))}  ${String(r.threshold).padEnd(14)}  ${String(r.value).slice(0, 120)}`);
const sum = rows.reduce((a, r) => ((a[r.result] = (a[r.result] || 0) + 1), a), {});
console.log('\n', JSON.stringify(sum));
fs.writeFileSync(path.join(DATA, 'protocol_result.json'), JSON.stringify({ when: new Date().toISOString(), summary: sum, rows }, null, 2));
