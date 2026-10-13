export default async function (c) {
  await c.api('manual', true);
  await c.api('advance', 5);
  const r = await c.eval(() => {
    const sk = window.__skate.game.skater;
    const V = sk.root.position.constructor;
    const rp = (n) => { const p = new V(); sk.b.get(n).bone.getWorldPosition(p); return sk.root.worldToLocal(p); };
    const out = {};
    for (const s of ['Left', 'Right']) {
      const a = rp(s + 'Arm'), f = rp(s + 'ForeArm'), h = rp(s + 'Hand');
      out[s] = { upper: f.clone().sub(a).normalize().toArray().map((v) => +v.toFixed(2)), fore: h.clone().sub(f).normalize().toArray().map((v) => +v.toFixed(2)), shoulder: a.toArray().map((v) => +v.toFixed(2)) };
    }
    out.hips = rp('Hips').toArray().map((v) => +v.toFixed(2));
    out.rootQ = sk.root.quaternion.toArray().map((v) => +v.toFixed(3));
    out.modelChildren = sk.model.children.map((ch) => ch.name + ' ' + ch.quaternion.toArray().map((v) => +v.toFixed(2)).join(',') + ' s' + ch.scale.x.toFixed(3));
    out.restU = sk.restDir('LeftArm', 'LeftForeArm').toArray().map((v) => +v.toFixed(3));
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
}
