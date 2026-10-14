// Scene census (?test, one load): node / mesh / bone counts (what every renderer.render and shadow pass traverses), top
// meshes by drawn triangles, triangles by group, textures by size (VRAM estimate), lights, programs; plus the cost of a bare
// scene traversal and updateMatrixWorld at CPU x4.
// bash tools/heavy.sh mobileqa node tools/mobile-qa/scene.mjs
import { launch, mobilePage, PROFILES, BASE_URL, cpu, sleep, waitReady, bundleName, save, log } from './common.mjs';

const browser = await launch();
const m = await mobilePage(browser, PROFILES.android, { cfg: { noGL: true } });
const { page, cdp } = m;
await page.goto(BASE_URL + '?test&touch&mute&mode=auto', { waitUntil: 'load', timeout: 120000 });
await waitReady(page, true);
await sleep(4000);
const census = await page.evaluate(() => {
  const g = window.__skate.game, scene = g.scene, cam = g.camera;
  let nodes = 0, meshes = 0, skinned = 0, bones = 0, instanced = 0, lods = 0, lights = 0, castShadow = 0, invisible = 0, matrixAuto = 0;
  const rows = [], mats = new Set(), texs = new Map();
  const frustum = new (cam.frustumCulled === undefined ? Object : Object)();
  const tri = (geo) => (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
  const path = (o) => { const p = []; let x = o; while (x && x !== scene && p.length < 4) { p.unshift(x.name || x.type); x = x.parent; } return p.join('/'); };
  scene.traverse((o) => {
    nodes++;
    if (o.matrixAutoUpdate) matrixAuto++;
    if (!o.visible) invisible++;
    if (o.isBone) bones++;
    if (o.isLight) lights++;
    if (o.isLOD) lods++;
    if (o.isMesh || o.isPoints || o.isLine) {
      meshes++;
      if (o.isSkinnedMesh) skinned++;
      if (o.isInstancedMesh) instanced++;
      if (o.castShadow) castShadow++;
      const n = o.isInstancedMesh ? o.count : 1;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((mm) => { if (!mm) return; mats.add(mm); for (const k of Object.keys(mm)) { const v = mm[k]; if (v && v.isTexture) texs.set(v.uuid, v); } if (mm.uniforms) for (const u of Object.values(mm.uniforms)) { const v = u?.value; if (v && v.isTexture) texs.set(v.uuid, v); } });
      rows.push({ path: path(o), type: o.isSkinnedMesh ? 'Skinned' : o.isInstancedMesh ? 'Instanced' : o.type, tris: Math.round(tri(o.geometry) * n), inst: n, shadow: o.castShadow, vis: o.visible, mat: ms.map((x) => x?.name || x?.type).join(',') });
    }
  });
  rows.sort((a, b) => b.tris - a.tris);
  // triangles grouped by the top-level scene child they belong to
  const groups = {};
  for (const c of scene.children) { let t = 0, n = 0; c.traverse((o) => { if ((o.isMesh) && o.geometry) { t += tri(o.geometry) * (o.isInstancedMesh ? o.count : 1); n++; } }); groups[(c.name || c.type) + '#' + scene.children.indexOf(c)] = { meshes: n, tris: Math.round(t) }; }
  const texList = [...texs.values()].map((t) => {
    const im = t.image || t.source?.data; const w = im?.width ?? 0, h = im?.height ?? 0;
    return { name: t.name || '', w, h, mb: +((w * h * 4 * (t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1)) / 1048576).toFixed(2), kind: t.isCanvasTexture ? 'canvas' : t.isDataTexture ? 'data' : t.isCompressedTexture ? 'compressed' : 'image' };
  }).sort((a, b) => b.mb - a.mb);
  // the people
  const people = g.scenery.people?.group; let pplNodes = 0, pplBones = 0, pplMeshes = 0; people?.traverse((o) => { pplNodes++; if (o.isBone) pplBones++; if (o.isMesh) pplMeshes++; });
  return {
    nodes, meshes, skinned, bones, instanced, lods, lights, castShadow, invisible, matrixAutoUpdate: matrixAuto, materials: mats.size,
    people: { nodes: pplNodes, bones: pplBones, meshes: pplMeshes, count: people?.children.length },
    top: rows.slice(0, 30), groups, textures: texList, texTotalMB: +texList.reduce((a, b) => a + b.mb, 0).toFixed(1),
    programs: g.renderer.info.programs?.length, memory: g.renderer.info.memory,
  };
});
// bare traversal + matrix update cost at x1 and x4 (what each extra renderer.render / shadow pass pays before drawing)
const cost = {};
for (const rate of [1, 4]) {
  await cpu(cdp, rate);
  await sleep(500);
  cost['x' + rate] = await page.evaluate(() => {
    const g = window.__skate.game, scene = g.scene, N = 60;
    let s = performance.now(); for (let i = 0; i < N; i++) { let n = 0; scene.traverse(() => { n++; }); }
    const trav = (performance.now() - s) / N;
    s = performance.now(); for (let i = 0; i < N; i++) scene.updateMatrixWorld(true);
    const umw = (performance.now() - s) / N;
    s = performance.now(); for (let i = 0; i < 20; i++) g.renderer.shadowMap.needsUpdate = true;
    return { traverseMs: +trav.toFixed(3), updateMatrixWorldMs: +umw.toFixed(3) };
  });
}
await cpu(cdp, 1);
const out = { bundle: await bundleName(page), census, cost };
save('scene_census.json', out);
log('nodes', census.nodes, 'meshes', census.meshes, 'skinned', census.skinned, 'bones', census.bones, 'lods', census.lods, 'matrixAutoUpdate', census.matrixAutoUpdate, 'people', JSON.stringify(census.people), 'programs', census.programs, 'texMB', census.texTotalMB);
log('cost', JSON.stringify(cost));
console.log(JSON.stringify(census.groups, null, 0));
for (const r of census.top.slice(0, 25)) console.log(String(r.tris).padStart(8), r.type.padEnd(10), String(r.inst).padStart(4), r.shadow ? 'S' : '-', r.vis ? 'V' : '-', r.path, '|', r.mat);
for (const t of census.textures.slice(0, 20)) console.log('tex', t.w + 'x' + t.h, t.mb, t.kind, t.name);
await browser.close();
