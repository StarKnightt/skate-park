// People distance levels, baked offline: the exact index lists src/world/people.ts used to make at load time with the
// meshopt simplifier (same library build, same inputs, same LODS table, read from people.ts), per level and part.
// Used by slim_glb.mjs; on its own it checks that two GLBs give identical lists:
//   node tools/assets/bake_people_lods.mjs <a.glb> [b.glb]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gltfTransform } from './gltf_io.mjs';
import { MeshoptSimplifier as S } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** the LODS table of src/world/people.ts (single source of truth) */
export function lodTable() {
  const src = fs.readFileSync(path.join(root, 'src/world/people.ts'), 'utf8');
  const rows = [...src.matchAll(/\{ d: ([\d.]+), keep: ([\d.]+), err: ([\d.]+), face: ([\d.]+), merge: (true|false) \}/g)];
  if (rows.length < 2) throw new Error('LODS table not found in people.ts');
  return rows.map((m) => ({ d: +m[1], keep: +m[2], err: +m[3], face: +m[4], merge: m[5] === 'true' }));
}

// BufferAttribute.getX of three for a normalized integer array
const denorm = (a) => a instanceof Int16Array ? (v) => Math.max(v / 32767, -1) : a instanceof Uint16Array ? (v) => v / 65535
  : a instanceof Int8Array ? (v) => Math.max(v / 127, -1) : a instanceof Uint8Array ? (v) => v / 255 : (v) => v;
function attr(acc) {
  if (!acc) return null;
  const arr = acc.getArray(), size = acc.getElementSize(), f = acc.getNormalized() ? denorm(arr) : (v) => v;
  return { count: acc.getCount(), get: (i, k) => f(arr[i * size + k]) };
}

/** skinned parts of the first skinned mesh, in GLTFLoader order (one SkinnedMesh per primitive) */
export function meshParts(doc) {
  const node = doc.getRoot().listNodes().find((n) => n.getMesh() && n.getSkin());
  if (!node) throw new Error('no skinned mesh');
  return node.getMesh().listPrimitives().map((p) => ({
    pos: attr(p.getAttribute('POSITION')), nrm: attr(p.getAttribute('NORMAL')), col: attr(p.getAttribute('COLOR_0')),
    uv: attr(p.getAttribute('TEXCOORD_0')), idx: new Uint32Array(p.getIndices().getArray()),
    textured: !!p.getMaterial()?.getBaseColorTexture(),
  }));
}

/** lists[level - 1][part] as Uint16Array, exactly as People.buildLods made them at runtime */
export async function bakeLods(parts) {
  await S.ready;
  const LODS = lodTable();
  const src = parts.map((m) => {
    const face = m.textured && !!m.uv;
    const n = m.pos.count, pos = new Float32Array(n * 3), att = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = m.pos.get(i, 0); pos[i * 3 + 1] = m.pos.get(i, 1); pos[i * 3 + 2] = m.pos.get(i, 2);
      if (m.col) { att[i * 8] = m.col.get(i, 0); att[i * 8 + 1] = m.col.get(i, 1); att[i * 8 + 2] = m.col.get(i, 2); }
      att[i * 8 + 3] = m.nrm.get(i, 0); att[i * 8 + 4] = m.nrm.get(i, 1); att[i * 8 + 5] = m.nrm.get(i, 2);
      if (face) { att[i * 8 + 6] = m.uv.get(i, 0); att[i * 8 + 7] = m.uv.get(i, 1); }
    }
    return { pos, att, face, idx: m.idx };
  });
  const lists = [];
  for (let l = 1; l < LODS.length; l++) {
    const { keep, err, face } = LODS[l];
    lists.push(src.map((s) => {
      const r = S.simplifyWithAttributes(s.idx, s.pos, 3, s.att, 8, [1, 1, 1, 0.35, 0.35, 0.35, s.face ? 3 : 0, s.face ? 3 : 0], null,
        Math.floor((s.idx.length * (s.face ? face : keep)) / 3) * 3, err, [])[0];
      return new Uint16Array(r);
    }));
  }
  return { parts: parts.map((m) => ({ vertices: m.pos.count, indices: m.idx.length })), lists };
}

const same = (a, b) => a.lists.length === b.lists.length && a.lists.every((lv, l) => lv.length === b.lists[l].length
  && lv.every((x, k) => x.length === b.lists[l][k].length && x.every((v, i) => v === b.lists[l][k][i])));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { io } = await gltfTransform();
  const bakes = [];
  for (const f of process.argv.slice(2)) {
    const b = await bakeLods(meshParts(await io.read(f)));
    bakes.push(b);
    console.log(path.basename(f), 'parts', JSON.stringify(b.parts), 'indices per level', b.lists.map((lv) => lv.map((x) => x.length).join('+')).join(' | '));
  }
  if (bakes.length === 2) { const ok = same(bakes[0], bakes[1]); console.log(ok ? 'IDENTICAL lists' : 'LISTS DIFFER'); process.exit(ok ? 0 : 1); }
}
export { same as sameLods };
