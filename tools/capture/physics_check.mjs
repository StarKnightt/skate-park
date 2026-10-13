// Scripted mechanics checks (no screenshots): prints events, pop->land air times and end state per test.
// bash tools/heavy.sh <you> node tools/capture/run.mjs tools/capture/physics_check.mjs --out E:/shots/skate-park/pass-02/dev/<you>
// ONLY=<substring> runs matching tests.
import { isolate } from './anim_check.mjs';

const FLIP = (key, hold = 0.32) => [{ at: 0.2, down: ['Space'] }, ...(key ? [{ at: 0.3, down: [key] }] : []), { at: 0.2 + hold, up: ['Space'] }, ...(key ? [{ at: 0.6, up: [key] }] : [])];
const tests = [
  { name: 'ollie flat (full crouch)', tp: [9, 0, 3, 180, 5], script: FLIP(null), dur: 2.0, air: [0.5, 0.62] },
  { name: 'ollie flat (quick tap)', tp: [9, 0, 3, 180, 5], script: [{ at: 0.2, down: ['Space'] }, { at: 0.25, up: ['Space'] }], dur: 2.0, air: [0.34, 0.42] },
  { name: 'kickflip', tp: [9, 0, 3, 180, 5], script: FLIP('ArrowLeft'), dur: 2.0, air: [0.5, 0.62] },
  { name: 'heelflip', tp: [9, 0, 3, 180, 5], script: FLIP('ArrowRight'), dur: 2.0, air: [0.5, 0.62] },
  { name: 'shuvit', tp: [9, 0, 3, 180, 5], script: FLIP('ArrowDown'), dur: 2.0, air: [0.5, 0.62] },
  { name: 'treflip', tp: [9, 0, 3, 180, 5], script: FLIP('ArrowUp'), dur: 2.0, air: [0.5, 0.62] },
  { name: 'ledge 5050', tp: [3.2, 0, -12.95, -90, 5.5], script: [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }, { at: 1.2, up: ['KeyE'] }], dur: 3.0, want: 'grindStart' },
  { name: 'manual', tp: [9, 0, 3, 180, 4.5], script: [{ at: 0.2, down: ['ShiftLeft'] }, { at: 1.6, up: ['ShiftLeft'] }], dur: 2.2, want: 'manualEnd' },
  { name: 'bowl drop-in + kickturn', tp: [-11, 0, 0, -90, 5.5], script: [], dur: 7.0, want: 'kickturn' },
  { name: 'halfpipe vert', tp: [24, 0, -9, 90, 9.0], script: [], dur: 6.0, want: 'vertAir' },
  { name: 'stairs drop', tp: [7, 1, 17.5, 180, 5.5], script: [], dur: 2.5, want: 'land' },
  { name: 'handrail', tp: [7, 1, 17.2, 180, 5.0], script: [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.3, up: ['KeyE'] }], dur: 3.0, want: 'grindStart' },
  { name: 'funbox flat bar', tp: [0, 0, 4.0, 180, 6.0], script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.6, up: ['KeyE'] }], dur: 3.0, want: 'grindStart' },
  { name: 'push from stop', tp: [9, 0, 3, 180, 0], script: [{ at: 0.0, down: ['KeyW'] }, { at: 3.0, up: ['KeyW'] }], dur: 3.2, want: 'push' },
  { name: 'wall bail -> recover -> ride', tp: [12, 0, -9, 90, 7.5], script: [], dur: 16.0, want: 'bail', after: [{ at: 15.0, down: ['KeyW'] }, { at: 15.9, up: ['KeyW'] }], endMode: 'ride' },
  { name: 'boardwalk fence (barrier: bounce, no bail)', tp: [6, 0, -22.3, 180, 7.5], script: [], dur: 2.0, noBail: true, want: 'bonk' },
  { name: 'east seat step (visible trip, multi-frame fall)', tp: [33, 0, 0, 90, 7.5], script: [], dur: 3.0, want: 'bail', minFall: 0.5 },
];
export default async function (c) {
  await isolate(c);
  await c.api('manual', true);
  const only = process.env.ONLY;
  let fails = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    await c.api('teleport', ...t.tp);
    await c.api('events');
    await c.api('script', [...t.script, ...(t.after ?? [])]);
    const frames = Math.round(t.dur * 30);
    const trace = [], phases = [];
    let lastPh = '';
    for (let i = 0; i < frames; i += 3) {
      await c.eval(() => window.__skate.advance(3, 1 / 30, false));
      const s = await c.api('state');
      trace.push(`${s.mode[0]}${s.pos.map((v) => v.toFixed(1)).join(',')}`);
      const k = `${s.mode}/${s.phase}`;
      if (k !== lastPh) { phases.push(`${(i / 30).toFixed(1)}:${k}`); lastPh = k; }
    }
    const ev = await c.api('events');
    const st = await c.api('state');
    const pop = ev.find((e) => e.type === 'pop'), land = ev.find((e) => e.type === 'land' && (!pop || e.t >= pop.t));
    const air = pop && land ? +(land.t - pop.t).toFixed(2) : null;
    let ok = true;
    if (t.air) ok &&= air !== null && air >= t.air[0] && air <= t.air[1] && land.quality !== 'bail';
    if (t.want) ok &&= ev.some((e) => e.type === t.want);
    if (t.noBail) ok &&= !ev.some((e) => e.type === 'bail');
    if (t.endMode) ok &&= st.mode === t.endMode && st.phase === 'ride';
    if (t.minFall) {
      // the fall (bail phase before lying) must last several frames
      const b = phases.findIndex((p) => p.endsWith('bail/bail')), l = phases.findIndex((p) => p.endsWith('bail/lie'));
      const fall = b >= 0 && l > b ? parseFloat(phases[l]) - parseFloat(phases[b]) : 0;
      ok &&= fall >= t.minFall;
    }
    if (!ok) fails++;
    console.log(`\n== ${ok ? 'OK  ' : 'FAIL'} ${t.name}: end ${st.mode}/${st.phase} pos ${st.pos} speed ${st.speed}${air !== null ? ` | pop->land ${air} s (${Math.round(air * 30)} frames)` : ''}`);
    const flip = ev.find((e) => e.type === 'flip'), done = ev.find((e) => e.type === 'flipDone');
    if (flip && done && land) console.log(`   flip ${flip.kind}: rotation ${flip.dur} s after a ${flip.delay} s flick delay, caught ${(land.t - done.t).toFixed(2)} s before landing`);
    console.log('   events:', ev.filter((e) => !['leaveGround', 'boardClack'].includes(e.type)).map((e) => `${e.t}:${e.type}${e.quality ? '(' + e.quality + ' up' + e.upErr + ' yaw' + e.yawErr + ' imp' + (e.impact ?? 0).toFixed(1) + ')' : ''}${e.name ? '[' + e.name + ']' : ''}${e.kind ? '<' + e.kind + '>' : ''}${e.reason ? '{' + e.reason + '}' : ''}`).join(' '));
    console.log('   phases:', phases.join(' '));
    console.log('   trace:', trace.filter((_, i) => i % 3 === 0).join(' '));
    await c.api('release');
  }
  console.log(`\n${fails ? fails + ' FAILED' : 'all passed'}`);
}
