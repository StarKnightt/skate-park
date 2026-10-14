// Static asset audit of the LIVE build (no browser): bundle name, transfer sizes per encoding, cache headers, GLB contents
// (texture sizes, vertex counts, compression extensions), audio durations / decoded PCM memory.
// node tools/mobile-qa/static.mjs [--url https://starknightt.github.io/skate-park/]
import zlib from 'node:zlib';
import { BASE_URL, save, log } from './common.mjs';

const base = BASE_URL.endsWith('/') ? BASE_URL : BASE_URL + '/';
const html = await (await fetch(base)).text();
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
const abs = (u) => new URL(u, base).href;
const bundle = assets.find((u) => /assets\/index-.*\.js/.test(u));
const css = assets.find((u) => /assets\/index-.*\.css/.test(u));
log('bundle', bundle, 'css', css);

async function sizes(url) {
  const out = { url: url.replace(base, '') };
  for (const enc of ['identity', 'gzip', 'br']) {
    const r = await fetch(url, { headers: { 'accept-encoding': enc } });
    const buf = Buffer.from(await r.arrayBuffer());
    // node fetch decompresses; measure what came over the wire via content-length when present, else recompress
    const cl = r.headers.get('content-length');
    out[enc] = { status: r.status, encoding: r.headers.get('content-encoding') ?? 'identity', wire: cl ? Number(cl) : null, decoded: buf.length };
    out.cache = r.headers.get('cache-control'); out.type = r.headers.get('content-type');
    if (enc === 'identity') { out.gzip9 = zlib.gzipSync(buf, { level: 9 }).length; out.br11 = zlib.brotliCompressSync(buf).length; out.body = buf; }
  }
  return out;
}

const files = [
  bundle, css, 'models/skater.glb', 'models/people.glb',
  ...['music', 'waves', 'roll_concrete', 'seagulls', 'grind_concrete', 'land', 'grind_metal', 'roll_wood', 'clack', 'bail_thud', 'pop'].map((n) => `audio/${n}.mp3`),
  ...['concrete_detail', 'wood_planks', 'mural_koi', 'mural_sunwaves', 'deck_graphic', 'clouds', 'mural_patchwork', 'face_wide', 'face_grin', 'face_neutral', 'face_grimace', 'face_focus'].map((n) => `textures/${n}.webp`),
];
const rows = [];
for (const f of files) {
  const s = await sizes(abs(f));
  rows.push(s);
  log(f, s.identity.decoded, 'gzip wire', s.gzip.wire, s.gzip.encoding, 'br', s.br.encoding, s.cache);
}

// ---------------------------------------------------------------- WebP + GLB parsing
function webpSize(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = b.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff, 'lossy'];
  if (fourcc === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1, 'lossless']; }
  if (fourcc === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3), 'extended'];
  return null;
}
function pngSize(b) { return b.readUInt32BE(16) ? [b.readUInt32BE(16), b.readUInt32BE(20), 'png'] : null; }
function glb(b) {
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8;
  const images = (json.images ?? []).map((im, i) => {
    const bv = json.bufferViews[im.bufferView];
    const data = b.subarray(binStart + (bv.byteOffset ?? 0), binStart + (bv.byteOffset ?? 0) + bv.byteLength);
    const d = im.mimeType === 'image/webp' ? webpSize(data) : im.mimeType === 'image/png' ? pngSize(data) : null;
    return { i, name: im.name, mime: im.mimeType, bytes: bv.byteLength, w: d?.[0], h: d?.[1], kind: d?.[2], gpuMB: d ? +((d[0] * d[1] * 4 * 4 / 3) / 1048576).toFixed(1) : null };
  });
  let verts = 0, tris = 0, prims = 0;
  for (const m of json.meshes ?? []) for (const p of m.primitives) {
    prims++;
    verts += json.accessors[p.attributes.POSITION]?.count ?? 0;
    tris += p.indices != null ? (json.accessors[p.indices]?.count ?? 0) / 3 : 0;
  }
  return {
    extensionsUsed: json.extensionsUsed, extensionsRequired: json.extensionsRequired, meshes: json.meshes?.length, primitives: prims, verts, tris: Math.round(tris),
    skins: json.skins?.length, animations: json.animations?.length, animNames: (json.animations ?? []).map((a) => a.name).slice(0, 40), materials: json.materials?.length, textures: json.textures?.length, images,
  };
}
const glbs = {};
for (const r of rows.filter((x) => x.url.endsWith('.glb'))) glbs[r.url] = glb(r.body);
const webps = rows.filter((x) => x.url.endsWith('.webp')).map((r) => { const d = webpSize(r.body); return { url: r.url, bytes: r.body.length, w: d?.[0], h: d?.[1], kind: d?.[2], gpuMB: d ? +((d[0] * d[1] * 4 * 4 / 3) / 1048576).toFixed(1) : null }; });

// ---------------------------------------------------------------- MP3 frame header -> bitrate, sample rate, channels, duration estimate
function mp3(b) {
  let i = 0;
  if (b.toString('ascii', 0, 3) === 'ID3') i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  for (; i < b.length - 4; i++) if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) break;
  const h = b.readUInt32BE(i);
  const ver = (h >> 19) & 3, layer = (h >> 17) & 3, bri = (h >> 12) & 15, sri = (h >> 10) & 3, mode = (h >> 6) & 3;
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const br = (ver === 3 ? BR1 : BR2)[bri] * 1000, sr = SR[ver]?.[sri];
  // Xing/Info header: frame count -> exact duration for VBR
  const side = ver === 3 ? (mode === 3 ? 17 : 32) : (mode === 3 ? 9 : 17);
  const x = i + 4 + side; let frames = null;
  const tag = b.toString('ascii', x, x + 4);
  if ((tag === 'Xing' || tag === 'Info') && (b.readUInt32BE(x + 4) & 1)) frames = b.readUInt32BE(x + 8);
  const spf = ver === 3 ? 1152 : 576;
  const dur = frames ? frames * spf / sr : (b.length - i) * 8 / br;
  const ch = mode === 3 ? 1 : 2;
  return { kbps: br / 1000, vbrTag: tag === 'Xing' || tag === 'Info' ? tag : null, sampleRate: sr, channels: ch, seconds: +dur.toFixed(1),
    decodedMB48k: +((dur * 48000 * ch * 4) / 1048576).toFixed(1) };
}
const audio = rows.filter((x) => x.url.endsWith('.mp3')).map((r) => ({ url: r.url, bytes: r.body.length, ...mp3(r.body) }));

const summary = {
  base, bundle, css,
  transfer: rows.map(({ body, ...r }) => r),
  totals: {
    initialDecodedKB: Math.round(rows.filter((r) => !r.url.startsWith('audio/')).reduce((a, r) => a + r.identity.decoded, 0) / 1024),
    initialWireKB: Math.round(rows.filter((r) => !r.url.startsWith('audio/')).reduce((a, r) => a + (r.gzip.wire ?? r.identity.decoded), 0) / 1024),
    audioKB: Math.round(audio.reduce((a, r) => a + r.bytes, 0) / 1024),
    audioDecodedMB48k: +audio.reduce((a, r) => a + r.decodedMB48k, 0).toFixed(1),
  },
  glbs, webps, audio,
};
save('static_assets.json', summary);
console.log(JSON.stringify({ totals: summary.totals, glbs: Object.fromEntries(Object.entries(glbs).map(([k, v]) => [k, { ...v, animNames: undefined }])), webps, audio }, null, 1));
