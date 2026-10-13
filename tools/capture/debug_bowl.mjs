export default async function (c) {
  await c.api('manual', true);
  const info = await c.eval(() => {
    const g = window.__skate.game;
    const out = [];
    g.scene.traverse((o) => {
      if (o.isMesh && o.material && (o.material.name === 'concrete' || o.material.name === 'wall')) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        out.push(o.material.name + ' ' + b.min.toArray().map((v) => v.toFixed(2)) + ' / ' + b.max.toArray().map((v) => v.toFixed(2)) + ' verts ' + o.geometry.attributes.position.count);
      }
    });
    return out;
  });
  console.log(info.join('\n'));
  await c.api('view', -22, -1.2, 1, -33, -0.6, 0);
  await c.api('advance', 2); await c.shot('dev/bowl_inside.jpg');
  await c.api('view', -24, 6, 12, -24, -2, 0);
  await c.api('advance', 2); await c.shot('dev/bowl_above.jpg');
}
