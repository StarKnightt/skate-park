// Scripted mechanics checks (no screenshots): prints events + end state per test.
const tests = [
  { name: 'ollie flat', tp: [9, 0, 3, 180, 5], script: [{ at: 0.2, down: ['Space'] }, { at: 0.5, up: ['Space'] }], dur: 2.0 },
  { name: 'kickflip', tp: [9, 0, 3, 180, 5], script: [{ at: 0.2, down: ['Space'] }, { at: 0.35, down: ['ArrowLeft'] }, { at: 0.5, up: ['Space'] }, { at: 0.6, up: ['ArrowLeft'] }], dur: 2.0 },
  { name: 'heelflip', tp: [9, 0, 3, 180, 5], script: [{ at: 0.2, down: ['Space'] }, { at: 0.35, down: ['ArrowRight'] }, { at: 0.5, up: ['Space'] }, { at: 0.6, up: ['ArrowRight'] }], dur: 2.0 },
  { name: 'shuvit', tp: [9, 0, 3, 180, 5], script: [{ at: 0.2, down: ['Space'] }, { at: 0.35, down: ['ArrowDown'] }, { at: 0.5, up: ['Space'] }, { at: 0.6, up: ['ArrowDown'] }], dur: 2.0 },
  { name: 'treflip', tp: [9, 0, 3, 180, 5], script: [{ at: 0.2, down: ['Space'] }, { at: 0.3, down: ['ArrowUp'] }, { at: 0.55, up: ['Space'] }, { at: 0.6, up: ['ArrowUp'] }], dur: 2.0 },
  { name: 'ledge 5050', tp: [5, 0, -12.95, -90, 5.5], script: [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }, { at: 1.2, up: ['KeyE'] }], dur: 3.0 },
  { name: 'manual', tp: [9, 0, 3, 180, 4.5], script: [{ at: 0.2, down: ['ShiftLeft'] }, { at: 1.6, up: ['ShiftLeft'] }], dur: 2.2 },
  { name: 'bowl drop-in', tp: [-11, 0, 0, -90, 5.5], script: [], dur: 7.0 },
  { name: 'halfpipe vert', tp: [24, 0, -9, 90, 9.0], script: [], dur: 6.0 },
  { name: 'stairs drop', tp: [7, 1, 17.5, 180, 5.5], script: [], dur: 2.5 },
  { name: 'handrail', tp: [7, 1, 17.2, 180, 5.0], script: [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.3, up: ['KeyE'] }], dur: 3.0 },
  { name: 'wall bail', tp: [12, 0, -9, 90, 7.5], script: [], dur: 9.0 },
  { name: 'funbox flat bar', tp: [0, 0, 4.0, 180, 6.0], script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.6, up: ['KeyE'] }], dur: 3.0 },
  { name: 'push from stop', tp: [9, 0, 3, 180, 0], script: [{ at: 0.0, down: ['KeyW'] }, { at: 3.0, up: ['KeyW'] }], dur: 3.2 },
];
export default async function (c) {
  await c.api('manual', true);
  const only = process.env.ONLY;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    await c.api('teleport', ...t.tp);
    await c.api('events');
    await c.api('script', t.script);
    const frames = Math.round(t.dur * 30);
    const trace = [];
    for (let i = 0; i < frames; i += 3) {
      await c.eval(() => window.__skate.advance(3, 1 / 30, false));
      const s = await c.api('state');
      trace.push(`${s.mode[0]}${s.pos.map((v) => v.toFixed(1)).join(',')}`);
    }
    const ev = await c.api('events');
    const st = await c.api('state');
    console.log(`\n== ${t.name}: end ${st.mode}/${st.phase} pos ${st.pos} speed ${st.speed}`);
    console.log('   events:', ev.filter((e) => !['leaveGround'].includes(e.type)).map((e) => `${e.t}:${e.type}${e.quality ? '(' + e.quality + ' up' + e.upErr + ' yaw' + e.yawErr + ' imp' + (e.impact ?? 0).toFixed(1) + ')' : ''}${e.name ? '[' + e.name + ']' : ''}${e.kind ? '<' + e.kind + '>' : ''}${e.reason ? '{' + e.reason + '}' : ''}`).join(' '));
    console.log('   trace:', trace.filter((_, i) => i % 2 === 0).join(' '));
    await c.api('release');
  }
}
