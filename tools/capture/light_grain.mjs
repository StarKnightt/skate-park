// Diagnose the grainy patch in the mobile portrait sky: toggle scene parts (grain off in every shot) and compare.
export default async function (c) {
  await c.api('manual', true);
  await c.api('touch', true);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await c.api('advance', 20);
  await c.api('hud', false);
  const set = (hide) => c.eval((h) => {
    const g = window.__skate.game;
    g.post.grade.uniforms.get('uGrain').value = 0;
    g.clouds.group.visible = !h.includes('clouds');
    g.sky.mesh.visible = !h.includes('sky');
    g.ocean.mesh.visible = !h.includes('ocean');
    g.lampGlow.visible = !h.includes('glow');
    g.scene.traverse((o) => { if (o.isMesh && o.material?.name) o.visible = !h.includes(o.material.name); });
  }, hide);
  const cases = {
    nosky: ['sky'],
    nosky_ocean: ['sky', 'ocean'],
    nosky_glow: ['sky', 'glow'],
    nosky_hills: ['sky', 'hills'],
    nosky_sand: ['sky', 'sand'],
  };
  for (const [n, h] of Object.entries(cases)) {
    await set(h);
    await c.api('advance', 1, 1 / 30, true);
    await c.shot(`grain/${n}.png`);
  }
  const info = await c.eval(() => {
    const g = window.__skate.game;
    const cam = g.camera;
    return { cam: cam.position.toArray().map((v) => +v.toFixed(2)), dir: cam.getWorldDirection(cam.position.clone()).toArray().map((v) => +v.toFixed(3)), aspect: cam.aspect, fov: cam.fov };
  });
  console.log(JSON.stringify(info));
  await set([]);
}
