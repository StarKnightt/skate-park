// Prints hips height / root motion / orientation over time for every clip of an uncompressed skater GLB.
// node tools/sim/clip_tracks.mjs [.agent-notes/build/skater_raw.glb] [clipName]
import fs from 'node:fs';
const file = process.argv[2] ?? '.agent-notes/build/skater_raw.glb';
const only = process.argv[3];
const b = fs.readFileSync(file);
const len = b.readUInt32LE(12);
const j = JSON.parse(b.slice(20, 20 + len).toString());
const bin = b.slice(20 + len + 8);
const acc = (i) => {
  const a = j.accessors[i], bv = j.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * 4;
  const out = new Float32Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = bin.readFloatLE(off + k * stride + c * 4);
  return { n, arr: out, count: a.count };
};
const hips = j.nodes.findIndex((n) => n.name === 'mixamorig:Hips');
const rot = (q, v) => { // rotate v by quaternion q (x,y,z,w)
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
for (const a of j.animations) {
  if (only && a.name !== only) continue;
  const chT = a.channels.find((c) => c.target.node === hips && c.target.path === 'translation');
  const chR = a.channels.find((c) => c.target.node === hips && c.target.path === 'rotation');
  const t = acc(a.samplers[chT.sampler].input), v = acc(a.samplers[chT.sampler].output);
  const tr = acc(a.samplers[chR.sampler].input), r = acc(a.samplers[chR.sampler].output);
  console.log(`${a.name} [${t.arr[t.count - 1].toFixed(2)} s]`);
  const step = Math.max(1, Math.round(t.count / 22));
  let line = '';
  for (let i = 0; i < t.count; i += step) {
    const ti = t.arr[i];
    let k = 0; while (k < tr.count - 1 && tr.arr[k + 1] <= ti) k++;
    const q = [r.arr[k * 4], r.arr[k * 4 + 1], r.arr[k * 4 + 2], r.arr[k * 4 + 3]];
    const f = rot(q, [0, 0, 1]), u = rot(q, [0, 1, 0]);
    line += `  t${ti.toFixed(2)} y${v.arr[i * 3 + 1].toFixed(2)} xz(${v.arr[i * 3].toFixed(2)},${v.arr[i * 3 + 2].toFixed(2)}) fwdY${f[1].toFixed(2)} upY${u[1].toFixed(2)} head${(Math.atan2(u[0], u[2]) * 57.3).toFixed(0)}\n`;
  }
  console.log(line);
}
