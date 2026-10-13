// Pass-4 helper F: where the people's hair sits in the rest pose (bind-space units), to place the fringe band.
// bash tools/heavy.sh F node tools/capture/run.mjs tools/capture/media4_visual_probe.mjs --nohmr --out E:/shots/skate-park/pass-04/visual
export default async function (c) {
  await c.page.waitForFunction(() => window.__skate.game.scenery.people.group.children.length > 0, null, { timeout: 30000 });
  const r = await c.eval(() => {
    const ppl = window.__skate.game.scenery.people;
    const out = { fringe: ppl.fringe, meshes: [] };
    const sm = [];
    ppl.group.children[0].traverse((o) => { if (o.isSkinnedMesh && !sm.some((m) => m.geometry === o.geometry)) sm.push(o); });
    for (const m of sm.slice(0, 2)) {
      const p = m.geometry.getAttribute('position'), col = m.geometry.getAttribute('color');
      const st = { name: m.name, n: p.count, hair: 0, y: [9, -9], z: [9, -9], all: { y: [9, -9], z: [9, -9] }, scale: m.matrixWorld.elements.slice(0, 3) };
      const hz = [];
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), z = p.getZ(i);
        st.all.y = [Math.min(st.all.y[0], y), Math.max(st.all.y[1], y)]; st.all.z = [Math.min(st.all.z[0], z), Math.max(st.all.z[1], z)];
        if (!col) continue;
        const dr = col.getX(i) - 0.0667, dg = col.getY(i) - 0.0275, db = col.getZ(i) - 0.0118;
        if (dr * dr + dg * dg + db * db < 0.0004) { st.hair++; st.y = [Math.min(st.y[0], y), Math.max(st.y[1], y)]; st.z = [Math.min(st.z[0], z), Math.max(st.z[1], z)]; hz.push([z, y]); }
      }
      hz.sort((a, b) => b[0] - a[0]);
      st.frontHair = hz.slice(0, 8).map((v) => v.map((x) => +x.toFixed(3)));
      st.backHair = hz.slice(-4).map((v) => v.map((x) => +x.toFixed(3)));
      out.meshes.push(st);
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
}
