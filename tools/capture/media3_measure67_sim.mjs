// #67 measurement without a browser: replays the clip22 / clip35 recipes in cam_sim (real physics + CameraRig,
// approximate skater) and prints the skater's on-screen size in px of the 720 px frame for the recorded frame range.
// node tools/capture/media3_measure67_sim.mjs   (run cam_sim.mjs once first to build tools/capture/.cambuild)
process.argv = [process.argv[0], 'media3_measure67_sim', '--nobuild'];
const { simulate, SCEN } = await import('./cam_sim.mjs');

const px = (v) => Math.round(v * 720);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const [clip, scen, frames] of [['clip22_bowl_carve_follow', 'carve', 150], ['clip35_bowl_follow_high_carve', 'carve2', 240]]) {
  const rows = simulate(scen, { ...SCEN[scen], frames }, 1);
  const len = rows.map((r) => r.len), box = rows.map((r) => r.box);
  const upright = rows.filter((r) => r.up > 0.7), wall = rows.filter((r) => r.up <= 0.7);
  const s = (a) => `min ${px(q(a, 0))} / median ${px(q(a, 0.5))} / max ${px(q(a, 0.999))} px`;
  console.log(`${clip}: body length on screen ${s(len)} (median ${(q(len, 0.5) * 100).toFixed(0)}% of frame height)`);
  console.log(`   vertical figure height (box): upright n=${upright.length} ${s(upright.map((r) => r.box))}; on steep wall n=${wall.length} ${wall.length ? s(wall.map((r) => r.box)) : ''}`);
  console.log(`   camera above his head ${q(rows.map((r) => r.camHead), 0).toFixed(2)}..${q(rows.map((r) => r.camHead), 0.999).toFixed(2)} m, distance ${q(rows.map((r) => r.dist), 0).toFixed(1)}..${q(rows.map((r) => r.dist), 0.999).toFixed(1)} m, pitch ${q(rows.map((r) => r.pitch), 0).toFixed(0)}..${q(rows.map((r) => r.pitch), 0.999).toFixed(0)} deg, off-screen ${rows.filter((r) => r.offscreen).length}, occluded ${rows.filter((r) => r.occ).length}`);
  console.log('   every 15 f (len px): ' + rows.filter((r) => r.f % 15 === 0).map((r) => `f${String(r.f).padStart(3, '0')}:${px(r.len)}`).join(' '));
}
