export default async function (c) {
  const r = await c.eval(() => {
    const g = window.__skate.game;
    const V = g.physics.pos.constructor;
    const out = [];
    const line = (label, pts) => {
      const rows = [];
      for (const [x, y, z] of pts) {
        const h = g.world.raycast(new V(x, y, z), new V(0, -1, 0), 6);
        rows.push(h ? `${x.toFixed(2)},${z.toFixed(2)}: y=${h.point.y.toFixed(3)} n=${h.normal.toArray().map((v) => v.toFixed(2)).join('/')}` : `${x.toFixed(2)},${z.toFixed(2)}: MISS`);
      }
      out.push(label + '\n  ' + rows.join('\n  '));
    };
    const a = []; for (let x = -29.5; x >= -33.2; x -= 0.3) a.push([x, 0.5, 0]); line('main bowl west wall (z=0)', a);
    const b = []; for (let x = 25.5; x <= 29.2; x += 0.3) b.push([x, 3.5, -9]); line('HP east (z=-9)', b);
    const d = []; for (let x = -16.5; x <= -14.0; x += 0.25) d.push([x, 0.5, 0]); line('main bowl east lip', d);
    return out.join('\n');
  });
  console.log(r);
}
