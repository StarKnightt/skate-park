// Batch of headless route checks for media.mjs clips: node tools/capture/route_batch.mjs [name,...]
import { run } from './route_sim.mjs';

const T = (t0, key, hold = 0.32) => [{ at: t0, down: ['Space'] }, ...(key ? [{ at: t0 + Math.min(0.15, hold - 0.02), down: [key] }] : []),
  { at: t0 + hold, up: ['Space'] }, ...(key ? [{ at: t0 + hold + 0.08, up: [key] }] : [])];
const W = (t0, d) => [{ at: t0, down: ['KeyW'] }, { at: t0 + d, up: ['KeyW'] }];
const K = (k, t0, d) => [{ at: t0, down: [k] }, { at: t0 + d, up: [k] }];

export const SPECS = {
  clip02: { tp: [-20, 0, 10.5, 90, 5.6], dur: 10, script: ['', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].flatMap((k, i) => [...T(0.3 + i * 1.8, k), ...W(0.3 + i * 1.8 + 1.2, 0.4)]) },
  clip01: { tp: [-2, 0, 1.5, -90, 1.5], dur: 13, script: [...W(0, 2.2), ...K('KeyA', 4.3, 0.7), ...K('KeyD', 5.8, 1.0), ...W(7.4, 1.2), ...K('KeyA', 9.4, 1.0)] },
  clip01b: { tp: [-2, 0, 0, -90, 1.5], dur: 13, script: [...W(0, 2.4)] },
  clip03: { tp: [11, 0, -0.6, -90, 6.4], dur: 10, script: [...T(1.15, 'ArrowLeft', 0.3), ...K('KeyD', 3.0, 1.2), ...T(5.3, 'ArrowDown', 0.3)] },
  clip04a: { tp: [7, 1, 17.4, 180, 5.0], dur: 3, script: [{ at: 0.05, down: ['Space'] }, { at: 0.42, up: ['Space'] }, { at: 0.5, down: ['KeyE'] }, { at: 1.4, up: ['KeyE'] }] },
  clip04b: { tp: [0, 0, 4.0, 180, 6.0], dur: 4, script: [{ at: 0.55, down: ['Space'] }, { at: 0.8, up: ['Space'] }, { at: 0.85, down: ['KeyE'] }, { at: 1.8, up: ['KeyE'] }] },
  clip05: { tp: [34, 0, 18, 180, 5.0], dur: 7, script: K('ShiftLeft', 0.6, 3.6) },
  clip06: { tp: [30, 0, 20, 180, 4.5], dur: 4, script: [{ at: 0.6, down: ['Space'] }, { at: 0.92, up: ['Space'] }, { at: 1.25, down: ['KeyD'] }, { at: 1.34, up: ['KeyD'] }] },
  clip07: { tp: [12, 0, -9, 90, 7.5], dur: 3, script: [] },
  clip08: { tp: [22.5, 0, -9, 90, 9.6], dur: 11, script: W(2.6, 0.8) },
  ledge5050: { tp: [3.2, 0, -12.95, -90, 5.5], dur: 4, script: [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.45, down: ['KeyE'] }, { at: 1.2, up: ['KeyE'] }] },
  ledgeslide: { tp: [3.2, 0, -12.95, -90, 5.5], dur: 4, script: [{ at: 0.1, down: ['Space'] }, { at: 0.35, up: ['Space'] }, { at: 0.36, down: ['KeyE', 'ArrowDown'] }, { at: 1.2, up: ['KeyE', 'ArrowDown'] }] },
  side_ollie: { tp: [30, 0, 22, 180, 4.5], dur: 5, script: [...T(0.4, null, 0.32), ...T(2.6, null, 0.12)] },
  side_kick: { tp: [30, 0, 22, 180, 4.5], dur: 5, script: [...T(0.4, 'ArrowLeft', 0.32), ...T(2.6, 'ArrowLeft', 0.12)] },
  push: { tp: [30, 0, 22, 180, 0], dur: 5, script: W(0.3, 3.4) },
};

const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(SPECS);
for (const k of only) {
  const r = run(SPECS[k]);
  console.log(`\n== ${k}\nevents: ${r.events.join(' ')}\ntrace: ${r.trace.join(' | ')}\nend: ${JSON.stringify(r.end)}`);
}
