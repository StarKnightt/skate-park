// Pass-4 media (M1): headless line search for clips whose pass-3 line no longer works (media4_sim.mjs replay).
//   node tools/capture/media4_search.mjs <what>
import { replay, world, Vector3 } from './media4_sim.mjs';
const what = process.argv[2];
const KEY = (k, t0, d) => [{ at: t0, down: [k] }, { at: t0 + d, up: [k] }];
if (what === 'probe') {
  // obstacles along the south edge: first hit of a horizontal ray at knee height heading +x
  for (const z of [21.5, 22.5, 23.4, 24.2]) {
    const hits = [];
    for (let x = 0; x < 38; x += 0.5) {
      const h = world.raycast(new Vector3(x, 3, z), new Vector3(0, -1, 0), 6);
      hits.push(h ? h.point.y.toFixed(1) : 'x');
    }
    console.log('z', z, hits.join(' '));
  }
}
const stats = (seg, wallTest) => {
  let on = 0, x0 = 1e9, x1 = -1e9, ymax = -9, vmin = 99, bail = false, first = -1, last = -1;
  const r = replay({ ...seg, onFrame: (ph, f) => {
    if (ph.mode === 'bail') bail = true;
    if (wallTest(ph)) { on++; x0 = Math.min(x0, ph.pos.x); x1 = Math.max(x1, ph.pos.x); ymax = Math.max(ymax, ph.pos.y); vmin = Math.min(vmin, ph.speed); if (first < 0) first = f; last = f; }
  } });
  return { on, span: +(x1 - x0).toFixed(2), ymax: +ymax.toFixed(2), vmin: +vmin.toFixed(2), bail, first, last, ev: r.ev.join(' '), end: r.end };
};
if (what === 'carve31') {
  // side-on carve on the steep sunlit south wall of the main bowl (z > 2.5 = on the south wall)
  const res = [];
  for (const x of [-27, -26, -25, -24]) for (const z of [-1, 0, 1]) for (const h of [40, 50, 60, 70]) for (const v of [6.5, 7.5]) for (const d of [0, 0.4, 0.8, 1.2]) {
    const seg = { tp: [x, -2.3, z, h, v], script: d ? KEY('KeyD', 0.1, d) : [], frames: 120 };
    const s = stats(seg, (ph) => ph.pos.z > 2.4 && ph.up.y < 0.9 && ph.mode === 'ride');
    if (!s.bail && s.on > 25 && s.vmin > 2.2) res.push({ x, z, h, v, d, ...s });
  }
  res.sort((a, b) => b.span - a.span);
  for (const r of res.slice(0, 12)) console.log(JSON.stringify(r));
}
if (what === 'carve35') {
  // a long high carve round the main bowl: total heading change and time on the walls without a stall
  const res = [];
  for (const x of [-25, -24, -23]) for (const z of [-4.2, -3, -2, 0]) for (const h of [70, 90, 110]) for (const v of [6.5, 7.0, 7.5]) for (const d of [0.6, 1.0, 1.4, 2.0, 2.8]) {
    const seg = { tp: [x, -2.3, z, h, v], script: KEY('KeyA', 0.2, d), frames: 240 };
    let turn = 0, prev = null, wall = 0, vmin = 99, bail = false, kt = 0;
    const r = replay({ ...seg, onFrame: (ph, f) => {
      if (ph.mode === 'bail') bail = true;
      const a = Math.atan2(ph.vel.x, ph.vel.z);
      if (prev != null && ph.speed > 1) { let da = a - prev; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; turn += da; }
      prev = a;
      if (ph.up.y < 0.9) wall++;
      if (f < 200) vmin = Math.min(vmin, ph.speed);
    } });
    kt = r.ev.filter((e) => e.includes('kickturnStart')).length;
    if (!bail) res.push({ x, z, h, v, d, turn: +(turn * 57.3).toFixed(0), wall, vmin: +vmin.toFixed(2), kt, end: r.end.speed });
  }
  res.sort((a, b) => (b.vmin > 2 ? 1 : 0) - (a.vmin > 2 ? 1 : 0) || Math.abs(b.turn) - Math.abs(a.turn));
  for (const r of res.slice(0, 14)) console.log(JSON.stringify(r));
}
if (what === 'carve31b') {
  const res = [];
  for (const x of [-28, -27, -26, -25]) for (const z of [0.5, 1.0, 1.5]) for (const h of [70, 75, 80, 85, 90]) for (const v of [6, 6.5, 7, 7.5]) for (const d of [0, 0.3, 0.6, 1.0, 1.5]) {
    const seg = { tp: [x, -2.3, z, h, v], script: d ? KEY('KeyD', 0.1, d) : [], frames: 120 };
    const s = stats(seg, (ph) => ph.pos.z > 2.4 && ph.up.y < 0.9 && ph.mode === 'ride');
    if (!s.bail && !s.ev.includes('vertAir') && !s.ev.includes('kickturn') && s.on > 25 && s.vmin > 2.5 && s.ymax < -0.4) res.push({ x, z, h, v, d, ...s });
  }
  res.sort((a, b) => b.span - a.span);
  for (const r of res.slice(0, 12)) console.log(JSON.stringify(r));
}
if (what === 'carve35b') {
  const res = [];
  for (const x of [-26, -24, -22]) for (const z of [-4.2, -3, -1.5, 0, 1.5]) for (const h of [60, 75, 90, 105, 120]) for (const v of [6.0, 6.5, 7.0, 7.5]) for (const d of [0.8, 1.4, 2.0, 2.8, 3.6]) {
    const seg = { tp: [x, -2.3, z, h, v], script: KEY('KeyA', 0.2, d), frames: 240 };
    let turn = 0, prev = null, wall = 0, vmin = 99, bail = false, ymax = -9;
    const r = replay({ ...seg, onFrame: (ph, f) => {
      if (ph.mode === 'bail' || ph.mode === 'air') bail = bail || ph.mode === 'bail';
      const a = Math.atan2(ph.vel.x, ph.vel.z);
      if (f < 150) {
        if (prev != null && ph.speed > 1) { let da = a - prev; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; turn += da; }
        if (ph.up.y < 0.9) wall++;
        vmin = Math.min(vmin, ph.speed); ymax = Math.max(ymax, ph.pos.y);
      }
      prev = a;
    } });
    const early = r.ev.filter((e) => /kickturnStart|vertAir/.test(e) && parseInt(e) < 150).length;
    if (!bail && !early && vmin > 2.2) res.push({ x, z, h, v, d, turn: +(turn * 57.3).toFixed(0), wall, vmin: +vmin.toFixed(2), ymax: +ymax.toFixed(2), ev: r.ev.join(' '), end: r.end.speed });
  }
  res.sort((a, b) => Math.abs(b.turn) + b.wall - Math.abs(a.turn) - a.wall);
  for (const r of res.slice(0, 12)) console.log(JSON.stringify(r));
}
if (what === 'carve31c') {
  const res = [];
  for (const x of [-28, -27, -26, -25, -24]) for (const z of [0, 0.75, 1.5]) for (const h of [65, 75, 85, 95, 105]) for (const v of [5, 5.5, 6, 6.5, 7]) for (const d of [0, 0.4, 0.8, 1.2, 1.8]) {
    const seg = { tp: [x, -2.3, z, h, v], script: d ? KEY('KeyD', 0.1, d) : [], frames: 120 };
    const s = stats(seg, (ph) => ph.pos.z > 2.6 && ph.up.y < 0.85 && ph.mode === 'ride');
    if (!s.bail && !s.ev.includes('vertAir') && !s.ev.includes('kickturn') && s.on > 12 && s.vmin > 1.8) res.push({ x, z, h, v, d, ...s });
  }
  res.sort((a, b) => b.span * Math.min(1, b.on / 30) - a.span * Math.min(1, a.on / 30));
  for (const r of res.slice(0, 12)) console.log(JSON.stringify(r));
}
if (what === 'trace') {
  const [x, z, h, v, d, key, frames] = process.argv.slice(3).map((a, i) => (i === 5 ? a : Number(a)));
  const r = replay({ tp: [x, -2.3, z, h, v], script: d ? KEY(key || 'KeyD', 0.1, d) : [], frames: frames || 150, trace: 5,
    onFrame: (ph, f) => { if (f % 5 === 0) process.stdout.write(`${f}:(${ph.pos.x.toFixed(1)},${ph.pos.y.toFixed(1)},${ph.pos.z.toFixed(1)}) up${ph.up.y.toFixed(2)} v${ph.speed.toFixed(1)} hd${(Math.atan2(ph.vel.x, ph.vel.z) * 57.3).toFixed(0)}  `); } });
  console.log('\n', r.ev.join(' '));
}
if (what === 'seg') {
  // node media4_search.mjs seg '<json seg>'
  const seg = JSON.parse(process.argv[3]);
  const r = replay({ ...seg, onFrame: (ph, f) => { if (f % 10 === 0) process.stdout.write(`${f}:${ph.mode[0]}(${ph.pos.x.toFixed(1)},${ph.pos.y.toFixed(1)},${ph.pos.z.toFixed(1)}) v${ph.speed.toFixed(1)} hd${(Math.atan2(ph.fwd.x, ph.fwd.z) * 57.3).toFixed(0)}  `); } });
  console.log('\n ', r.ev.join(' '), '| end', JSON.stringify(r.end));
}
if (what === 'crawl') {
  replay({ tp: [-24, -2.3, -4.2, 90, 7.0], script: KEY('KeyA', 0.2, 1.4), frames: 240,
    onFrame: (ph, f) => { if (f % 15 === 0 && f >= 30) process.stdout.write(`${f}: y${ph.pos.y.toFixed(2)} up.y ${ph.up.y.toFixed(2)} v${ph.speed.toFixed(2)} vy${ph.vel.y.toFixed(2)} steerS ${(ph.steerS ?? 0).toFixed(2)} | `); } });
  console.log();
}
