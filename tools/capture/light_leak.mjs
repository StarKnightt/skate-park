// Workstream B diag: find what (if anything) blocks the sun for pixels on a bright streak in a shadowed area.
export default async function (c) {
  await c.api('manual', true);
  await c.api('hud', false);
  await c.api('teleport', 37, 0, 24, 180, 0);
  await c.api('advance', 10);
  await c.api('setTime', 0, true);
  await c.api('view', -6, 1.7, -14, -2, 0.0, -23);
  await c.api('advance', 2);
  await c.shot('analysis/leak_view.png');
  const px = [[60, 412], [300, 383], [520, 352], [300, 395], [300, 370]];
  const res = await c.eval(async (px) => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const g = window.__skate.game;
    const cam = g.camera;
    const W = innerWidth, H = innerHeight;
    const rc = new T.Raycaster();
    const sun = g.tod.cur.lightDir.clone().normalize();
    const meshes = [];
    g.scene.traverse((o) => { if (o.isMesh && o.visible && o.castShadow) meshes.push(o); });
    const out = [];
    for (const [x, y] of px) {
      const ndc = new T.Vector2((x / 1024) * 2 - 1, -((y / 576) * 2 - 1));
      rc.setFromCamera(ndc, cam);
      const hit = rc.intersectObjects(g.scene.children, true).find((h) => h.object.visible && h.object.isMesh);
      if (!hit) { out.push({ x, y, hit: null }); continue; }
      const p = hit.point.clone();
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      rc.set(p.clone().addScaledVector(sun, 0.02), sun);
      rc.far = 200;
      const occ = rc.intersectObjects(meshes, true)[0];
      out.push({ x, y, p: p.toArray().map((v) => +v.toFixed(3)), n: n?.toArray().map((v) => +v.toFixed(2)), recv: hit.object.name || hit.object.material?.name,
        occ: occ ? { name: occ.object.name, mat: occ.object.material?.name, d: +occ.distance.toFixed(2), p: occ.point.toArray().map((v) => +v.toFixed(2)) } : null });
    }
    return { sun: sun.toArray(), out };
  }, px);
  console.log(JSON.stringify(res, null, 1));
}
