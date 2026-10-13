// Workstream B: verification for the character self-shadow fix (no dot grid on curved shapes, no #8 banding, no
// ramp-toe leak). Output: fix2/<view>_<time>.png (lossless, full resolution)
export default async function (c) {
  const T = ['golden', 'sunset', 'blue', 'noon'];
  const S = (n) => c.shot(`fix2/${n}.png`);
  const frame = () => c.eval(() => { window.__skate.advance(1, 0); window.__skate.advance(1, 0); });
  await c.api('manual', true);
  await c.api('hud', false);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await c.eval(() => window.__skate.advance(20, 1 / 30));
  const hips = await c.eval(() => { const h = window.__skate.game.skater.hipsWorld(window.__skate.game.physics.pos.clone()); return [h.x, h.y, h.z]; });
  for (const t of [0, 1, 3]) {
    await c.api('setTime', t, true);
    const [sx, sz] = await c.eval(() => { const d = window.__skate.game.tod.cur.lightDir; const l = Math.hypot(d.x, d.z); return [d.x / l, d.z / l]; });
    const [x, y, z] = hips;
    const at = (dx, dz, d, up = 0.15) => c.api('view', x + dx * d, y + up, z + dz * d, x, y + 0.05, z);
    await c.api('view', x + 1.1, y + 0.1, z - 0.5, x, y - 0.05, z); await frame(); await S(`skater_integ_${T[t]}`);
    await at(sx, sz, 1.6); await frame(); await S(`skater_front_${T[t]}`);
    await at(-sz, sx, 1.6); await frame(); await S(`skater_side_${T[t]}`);
    await at(-sx, -sz, 1.6, 0.3); await frame(); await S(`skater_back_${T[t]}`);
  }
  await c.api('setTime', 0, true);
  // a walking person, a palm trunk and the board, golden hour
  const person = await c.eval(() => {
    const g = window.__skate.game.scene.getObjectByName('people');
    let best = null, bd = 1e9;
    g?.traverse((o) => { if (o.isSkinnedMesh) { const p = o.getWorldPosition(o.position.clone()); const d = Math.hypot(p.x - 9, p.z - 3); if (d < bd) { bd = d; best = [p.x, p.y, p.z]; } } });
    return best;
  });
  if (person) { const [px, py, pz] = person; await c.api('view', px + 1.2, py + 1.1, pz + 1.2, px, py + 0.9, pz); await frame(); await S('person_golden'); }
  const trunk = await c.eval(() => {
    let mesh = null; window.__skate.game.scene.traverse((o) => { if (o.isMesh && o.material?.name === 'palmTrunk') mesh = o; });
    if (!mesh) return null;
    const pa = mesh.geometry.getAttribute('position'); let best = null, bd = 1e9;
    for (let i = 0; i < pa.count; i += 7) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); if (y > 0.4) continue; const d = Math.hypot(x - 9, z - 3); if (d < bd && d > 4) { bd = d; best = [x, y, z]; } }
    return best;
  });
  if (trunk) { const [tx, ty, tz] = trunk; await c.api('view', tx + 1.6, 1.6, tz + 1.6, tx, 1.5, tz); await frame(); await S('palm_trunk_golden'); }
  await c.api('view', hips[0] + 0.9, 0.45, hips[2] - 0.6, hips[0], 0.15, hips[2]); await frame(); await S('board_feet_golden');
  // the slab: wide, low, and the ramp toe that used to leak
  await c.api('teleport', 37, 0, 24, 180, 0); await c.eval(() => window.__skate.advance(4, 1 / 30));
  await c.api('view', 42, 14, 40, -2, 0, -8); await frame(); await S('slab_wide_golden');
  await c.api('view', 6, 1.2, 8, -4, 0.0, -6); await frame(); await S('slab_low_golden');
  await c.api('view', -6, 1.7, -14, -2, 0.0, -23); await frame(); await S('ramp_toe_golden');
  await c.api('setTime', 1, true);
  await c.api('view', 42, 14, 40, -2, 0, -8); await frame(); await S('slab_wide_sunset');
  await c.api('setTime', 0, true);
  await c.api('teleport', 9, 0, 3, 180, 0);
}
