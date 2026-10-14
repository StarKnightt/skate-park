// Slim the character GLBs for the web (after tools/build_skater.sh has optimised them):
// - skater.glb: only the clips src/player/skater.ts plays; scale tracks and non-hips translation tracks that never leave
//   the rest pose dropped (the mixer then leaves those values alone: same pose); mesh untouched.
// - people.glb: only the crowd's clips + the baked distance levels (bake_people_lods.mjs): the crowd is built from the
//   skater's own mesh (identical bytes in both files before). Constant rest-pose tracks dropped (one action per mixer).
// - both: resampled (lossless default tolerance); quaternions as normalized int16 (core glTF) stored with the meshopt
//   QUATERNION filter (16 bit; < 5e-5 per component in all); EXT_meshopt_compression. Mesh: positions, colours, UVs and
//   indices bit-exact; normals (10-bit values) through the 12-bit OCTAHEDRAL filter (checked: < 0.15 deg).
// usage: node tools/assets/slim_glb.mjs <skater_in.glb> <people_in.glb> <out_dir>
import fs from 'node:fs';
import path from 'node:path';
import { gltfTransform } from './gltf_io.mjs';
import { bakeLods, meshParts, sameLods } from './bake_people_lods.mjs';

const [skaterIn, peopleIn, outDir] = process.argv.slice(2);
if (!outDir) { console.error('usage: node tools/assets/slim_glb.mjs <skater_in.glb> <people_in.glb> <out_dir>'); process.exit(2); }
/** clips src/player/skater.ts plays (FALLS, GETUPS, lie_shake, walk, idle fallback) */
const SKATER_CLIPS = ['bail_face', 'bail_back', 'bail_knock', 'bail_roll', 'wall_hit', 'getup_back', 'getup_stomach', 'lie_shake', 'walk', 'idle'];
const EPS = 1e-6;

const { fn, io, meshopt } = await gltfTransform();
const skater = await io.read(skaterIn), people = await io.read(peopleIn);
const rest = new Map(skater.getRoot().listNodes().map((n) => [n.getName(), { translation: n.getTranslation(), rotation: n.getRotation(), scale: n.getScale() }]));

/** drop channels whose output never leaves the target's rest value (paths allowed per file; the hips always stay) */
function dropRestTracks(doc, paths) {
  let n = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode(), p = ch.getTargetPath();
      if (!node || !paths.includes(p) || /Hips$/.test(node.getName())) continue;
      const r = rest.get(node.getName())?.[p], out = ch.getSampler().getOutput(), a = out.getArray(), k = out.getElementSize();
      if (!r || out.getNormalized()) continue;
      let flat = true;
      for (let i = 0; i < a.length && flat; i++) flat = Math.abs(a[i] - r[i % k]) < EPS;
      if (!flat) continue;
      const s = ch.getSampler();
      ch.dispose();
      if (!s.listParents().some((x) => x.propertyType === 'AnimationChannel')) s.dispose();
      n++;
    }
  }
  return n;
}
function quantizeRotations(doc) {
  let n = 0;
  for (const anim of doc.getRoot().listAnimations()) for (const ch of anim.listChannels()) {
    const out = ch.getSampler().getOutput();
    if (ch.getTargetPath() !== 'rotation' || out.getNormalized() || !(out.getArray() instanceof Float32Array)) continue;
    const a = out.getArray(), q = new Int16Array(a.length);
    for (let i = 0; i < a.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, a[i])) * 32767);
    out.setArray(q).setNormalized(true);
    n++;
  }
  return n;
}
const clipsOf = (doc) => doc.getRoot().listAnimations().map((a) => a.getName());

// ------------------------------------------------------------------ skater
const before = meshParts(skater);
// samplers outlive a disposed animation and keep its accessors alive: dispose them first
const dropClip = (a) => { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((s) => s.dispose()); a.dispose(); };
for (const a of skater.getRoot().listAnimations()) if (!SKATER_CLIPS.includes(a.getName())) dropClip(a);
const missing = SKATER_CLIPS.filter((c) => !clipsOf(skater).includes(c));
if (missing.length) throw new Error('skater.glb lacks clips the game plays: ' + missing.join(', '));
const sDrop = dropRestTracks(skater, ['scale', 'translation']);
await skater.transform(fn.resample(), fn.prune({ keepLeaves: true, keepAttributes: true, keepIndices: true }));
const sQ = quantizeRotations(skater);

// ------------------------------------------------------------------ people (clips + baked levels only)
const used = ['stand_idle', 'sit_idle', 'sit_laugh', 'clap_sit', 'stand_phone', 'wave', 'walk', 'recline'];
const missingP = used.filter((c) => !clipsOf(people).includes(c));
if (missingP.length) throw new Error('people.glb lacks clips src/world/people.ts plays: ' + missingP.join(', '));
const oldPeopleLods = await bakeLods(meshParts(people));
for (const n of people.getRoot().listNodes()) { n.setMesh(null); n.setSkin(null); }
const pDrop = dropRestTracks(people, ['scale', 'translation', 'rotation']);
await people.transform(fn.resample(), fn.prune({ keepLeaves: true, keepAttributes: true }));
const pQ = quantizeRotations(people);
const lods = await bakeLods(meshParts(skater));
if (!sameLods(lods, oldPeopleLods)) throw new Error('the skater mesh no longer gives the levels people.glb gave');

// ------------------------------------------------------------------ write, re-pack, verify
fs.mkdirSync(outDir, { recursive: true });
const sOut = path.join(outDir, 'skater.glb'), pOut = path.join(outDir, 'people.glb');
await io.write(sOut, skater);
await io.write(pOut, people);
const { MeshoptDecoder: D, MeshoptEncoder: E } = meshopt;
repack(sOut);
const levels = repack(pOut, lods);
const after = meshParts(await io.read(sOut));
const exact = before.length === after.length && before.every((p, k) => ['pos', 'col', 'uv'].every((a) => {
  const x = p[a], y = after[k][a];
  if (!x || !y) return !x && !y;
  for (let i = 0; i < x.count; i++) for (let c = 0; c < 3; c++) if (x.get(i, Math.min(c, a === 'uv' ? 1 : 2)) !== y.get(i, Math.min(c, a === 'uv' ? 1 : 2))) return false;
  return true;
}) && p.idx.every((v, i) => v === after[k].idx[i]));
let nErr = 0;
before.forEach((p, k) => { for (let i = 0; i < p.nrm.count; i++) {
  const a = [0, 1, 2].map((c) => p.nrm.get(i, c)), b = [0, 1, 2].map((c) => after[k].nrm.get(i, c));
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  nErr = Math.max(nErr, Math.acos(Math.min(1, dot)) * 180 / Math.PI);
} });
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(1) + ' KB';
console.log(`skater.glb ${kb(skaterIn)} -> ${kb(sOut)}: clips ${clipsOf(skater).length}, rest tracks dropped ${sDrop}, int16 rotations ${sQ}, `
  + `positions/colours/uvs/indices ${exact ? 'bit-exact' : 'CHANGED'}, normals max ${nErr.toFixed(3)} deg`);
if (nErr > 0.15) process.exit(1);
console.log(`people.glb ${kb(peopleIn)} -> ${kb(pOut)}: clips ${clipsOf(people).length}, rest tracks dropped ${pDrop}, int16 rotations ${pQ}, levels ${levels.map((l) => l.length).join('+')} lists`);
if (!exact) process.exit(1);

/**
 * Re-pack a meshopt GLB written by gltf-transform: rotation outputs get the meshopt QUATERNION filter (16 bit, same
 * precision class as the int16 values, far smaller), and the baked levels go in as one TRIANGLES-coded view with an
 * accessor per list (root extras.lods: { parts, levels: accessor indices per level }).
 */
function repack(file, lods = null) {
  const b = fs.readFileSync(file), jl = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bin = b.subarray(20 + jl + 8, 20 + jl + 8 + b.readUInt32LE(20 + jl));
  const dataBuf = json.buffers.findIndex((x) => !x.extensions?.EXT_meshopt_compression?.fallback);
  const fbBuf = json.buffers.findIndex((x) => x.extensions?.EXT_meshopt_compression?.fallback);
  const mo = (bv) => bv.extensions?.EXT_meshopt_compression;
  const bytes = json.bufferViews.map((bv) => { const e = mo(bv) ?? bv; return bin.subarray(e.byteOffset ?? 0, (e.byteOffset ?? 0) + e.byteLength); });
  // views holding nothing but rotation outputs (normalized int16 xyzw)
  const rot = new Set(), other = new Set();
  for (const a of json.animations ?? []) for (const c of a.channels) {
    const acc = json.accessors[a.samplers[c.sampler].output];
    (c.target.path === 'rotation' && acc.componentType === 5122 && acc.normalized ? rot : other).add(acc.bufferView);
    other.add(json.accessors[a.samplers[c.sampler].input].bufferView);
  }
  const decode = (i) => {
    const e = mo(json.bufferViews[i]), raw = new Uint8Array(e.count * 8);
    D.decodeGltfBuffer(raw, e.count, 8, bytes[i], e.mode, 'NONE');
    return Float32Array.from(new Int16Array(raw.buffer), (v) => v / 32767);
  };
  for (const i of rot) {
    const e = mo(json.bufferViews[i]);
    if (other.has(i) || !e || e.byteStride !== 8 || e.filter) continue;
    bytes[i] = E.encodeGltfBuffer(E.encodeFilterQuat(decode(i), e.count, 8, 16), e.count, 8, 'ATTRIBUTES');
    e.filter = 'QUATERNION';
  }
  // normals (10-bit values in int16 xyz_ views) through the 12-bit OCTAHEDRAL filter: error under the 10-bit step
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    const acc = json.accessors[p.attributes.NORMAL], i = acc?.bufferView, e = i !== undefined && mo(json.bufferViews[i]);
    if (!e || acc.componentType !== 5122 || !acc.normalized || e.byteStride !== 8 || e.filter || acc.byteOffset) continue;
    const f = decode(i);
    for (let k = 0; k < e.count; k++) {
      const x = f[k * 4], y = f[k * 4 + 1], z = f[k * 4 + 2], l = Math.hypot(x, y, z) || 1;
      f[k * 4] = x / l; f[k * 4 + 1] = y / l; f[k * 4 + 2] = z / l; f[k * 4 + 3] = 0;
    }
    bytes[i] = E.encodeGltfBuffer(E.encodeFilterOct(f, e.count, 8, 12), e.count, 8, 'ATTRIBUTES');
    e.filter = 'OCTAHEDRAL';
  }
  let levels = null;
  if (lods) {
    const all = lods.lists.flat(), ix = new Uint16Array(all.reduce((s, x) => s + x.length, 0));
    let o = 0;
    const fbOff = Math.ceil(json.buffers[fbBuf].byteLength / 4) * 4;
    const view = json.bufferViews.push({ buffer: fbBuf, byteOffset: fbOff, byteLength: ix.byteLength,
      extensions: { EXT_meshopt_compression: { buffer: dataBuf, byteOffset: 0, byteLength: 0, mode: 'TRIANGLES', byteStride: 2, count: ix.length } } }) - 1;
    json.buffers[fbBuf].byteLength = fbOff + Math.ceil(ix.byteLength / 4) * 4;
    levels = lods.lists.map((lv) => lv.map((x) => {
      ix.set(x, o);
      const acc = json.accessors.push({ bufferView: view, byteOffset: o * 2, componentType: 5123, count: x.length, type: 'SCALAR' }) - 1;
      o += x.length;
      return acc;
    }));
    bytes.push(E.encodeGltfBuffer(new Uint8Array(ix.buffer), ix.length, 2, 'TRIANGLES'));
    json.extras = { ...json.extras, lods: { parts: lods.parts, levels } };
  }
  // data buffer = every view's bytes, 4-byte aligned, in view order
  let size = 0;
  const offs = bytes.map((x) => { const at = size; size = Math.ceil((at + x.length) / 4) * 4; return at; });
  const out = Buffer.alloc(size);
  json.bufferViews.forEach((bv, i) => {
    out.set(bytes[i], offs[i]);
    const e = mo(bv);
    if (e) { e.byteOffset = offs[i]; e.byteLength = bytes[i].length; } else { bv.byteOffset = offs[i]; bv.byteLength = bytes[i].length; }
  });
  json.buffers[dataBuf].byteLength = size;
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + size, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(size, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, js, bh, out]));
  return levels;
}
