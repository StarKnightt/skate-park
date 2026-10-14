// Trim + re-encode the game's sounds to exactly the slices src/audio/audio.ts plays, from the untouched originals.
// Loops: mono, the loop body [loopStart, loopEnd] with its own last PAD s in front and its first PAD s behind (a periodic
// window, so a decoder that does not strip the MP3 encoder delay still loops seamlessly), plus an 8 ms equal-power seam
// crossfade into the audio that precedes loopStart when the original seam steps. One-shots: mono, each played slice with
// PAD s before and POST s after, 10 ms fades at the outer edges, slices back to back. The mono downmix keeps the
// per-channel RMS of the stereo original over the used region. music.mp3 is copied unchanged (it streams).
//   node tools/assets/audio_trim.mjs build <origDir> <outDir>     (run through tools/heavy.sh: it encodes)
//   node tools/assets/audio_trim.mjs check <origDir> [<outDir>]   (decode-only analysis)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PAD = 0.05, POST = 0.1, XFADE = 0.008, EDGE = 0.01;
/** what audio.ts plays from the ORIGINAL files: loops [loopStart, loopEnd] s, one-shot slices [offset, duration] s */
export const FILES = {
  roll_concrete: { loop: [1.1, 5.1], kbps: 80 },
  roll_wood: { loop: [0.05, 3.1], kbps: 80 },
  // L/R correlation -0.65 (largely anti-phase): a mono downmix would cancel most of it, so it keeps both channels
  waves: { loop: [0.5, 44], kbps: 80, stereo: true },
  grind_metal: { loop: [0.15, 1.55], kbps: 80 },
  grind_concrete: { loop: [19.6, 21.6], kbps: 80 },
  pop: { shots: [[0.1, 0.35]], kbps: 96 },
  land: { shots: [[2.45, 0.45], [7.8, 0.45]], kbps: 96 },
  clack: { shots: [[0.86, 0.35]], kbps: 96 },
  bail_thud: { shots: [[0.4, 0.6]], kbps: 96 },
  seagulls: { shots: [[0.45, 5.5], [9.0, 5.5], [19.45, 5.5]], kbps: 64, post: 0.35 },
};

const probe = (f) => {
  const o = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'json', f]).toString();
  const s = JSON.parse(o).streams[0];
  return { sr: +s.sample_rate, ch: +s.channels };
};
export function decode(f) {
  const { sr, ch } = probe(f);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { maxBuffer: 1 << 30 });
  const all = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const n = all.length / ch;
  const chans = Array.from({ length: ch }, (_, c) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = all[i * ch + c]; return a; });
  const mono = ch === 1 ? chans[0] : chans[0].map((v, i) => 0.5 * (v + chans[1][i]));
  return { sr, ch, n, chans, mono, dur: n / sr };
}
const rms = (a, s = 0, e = a.length) => { let q = 0; for (let i = s; i < e; i++) q += a[i] * a[i]; return Math.sqrt(q / Math.max(1, e - s)); };
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const S = (t, sr) => Math.round(t * sr);
/** regions of the original that are played, in samples */
const regions = (spec, sr) => spec.loop ? [[S(spec.loop[0], sr), S(spec.loop[1], sr)]] : spec.shots.map(([o, d]) => [S(o, sr), S(o + d, sr)]);

/** per-channel RMS of the stereo original vs the (L+R)/2 downmix over the played regions; gain that keeps it */
export function monoGain(d, spec) {
  if (d.ch === 1) return { gain: 1, corr: 1 };
  let qL = 0, qR = 0, qM = 0, lr = 0, n = 0;
  for (const [s, e] of regions(spec, d.sr)) for (let i = s; i < Math.min(e, d.n); i++) {
    const l = d.chans[0][i], r = d.chans[1][i], m = d.mono[i];
    qL += l * l; qR += r * r; qM += m * m; lr += l * r; n++;
  }
  const corr = lr / Math.sqrt(qL * qR || 1);
  return { gain: Math.sqrt((qL + qR) / 2 / (qM || 1e-12)), corr };
}
/** seam step at a loop [s, e): the jump m[e-1] -> m[s] against the local sample-to-sample steps and amplitude */
export function seam(a, s, e, sr) {
  const w = S(0.005, sr), dif = [];
  for (let i = e - w; i < e; i++) dif.push(a[i] - a[i - 1]);
  for (let i = s + 1; i < s + w; i++) dif.push(a[i] - a[i - 1]);
  const sd = Math.sqrt(dif.reduce((q, v) => q + v * v, 0) / dif.length) || 1e-9;
  const amp = (rms(a, e - w, e) + rms(a, s, s + w)) / 2 || 1e-9;
  const j = Math.abs(a[s] - a[e - 1]);
  return { step: +(j / sd).toFixed(2), rel: +(j / amp).toFixed(2) };
}
const needsXfade = (z) => z.step > 2.5 || z.rel > 0.8;

/** the PCM to encode (mono, or the original channels for `stereo`) + where audio.ts plays it from */
export function build(d, spec) {
  const { sr } = d, g = spec.stereo ? 1 : monoGain(d, spec).gain;
  const src = spec.stereo ? d.chans : [d.mono];
  if (spec.loop) {
    const s = S(spec.loop[0], sr), e = S(spec.loop[1], sr), L = e - s, P = S(PAD, sr), X = S(XFADE, sr);
    const zs = src.map((m) => seam(m, s, e, sr)), z = zs.reduce((a, b) => (b.step > a.step ? b : a));
    const xf = zs.some(needsXfade) && s >= X;
    const pcm = src.map((m) => {
      const body = new Float32Array(L);
      for (let i = 0; i < L; i++) body[i] = m[s + i] * g;
      if (xf) for (let i = 0; i < X; i++) {
        const t = (i + 0.5) / X, k = L - X + i;
        body[k] = body[k] * Math.cos(t * Math.PI / 2) + m[s - X + i] * g * Math.sin(t * Math.PI / 2);
      }
      const out = new Float32Array(L + 2 * P);
      for (let i = 0; i < out.length; i++) out[i] = body[(i - P + L) % L];
      return out;
    });
    return { pcm, play: { loop: [+(P / sr).toFixed(6), +((P + L) / sr).toFixed(6)] }, gain: g, seam: z, xfade: xf };
  }
  const offs = [], segs = [];
  let len = 0;
  for (const [o, dur] of spec.shots) {
    const a = Math.max(0, S(o - PAD, sr)), b = Math.min(d.n, S(o + dur + (spec.post ?? POST), sr));
    offs.push(+((len + S(o, sr) - a) / sr).toFixed(6)); segs.push([a, b]); len += b - a;
  }
  const E = S(EDGE, sr);
  const pcm = src.map((m) => {
    const out = new Float32Array(len);
    let k = 0;
    for (const [a, b] of segs) {
      for (let i = a; i < b; i++) {
        let v = m[i] * g;
        if (a > 0 && i - a < E) v *= (i - a) / E;
        if (b < d.n && b - 1 - i < E) v *= (b - 1 - i) / E;
        out[k++] = v;
      }
    }
    return out;
  });
  return { pcm, play: { offsets: offs }, gain: g };
}

function encode(pcm, sr, kbps, file) {
  const tmp = path.join(os.tmpdir(), `audio_trim_${process.pid}_${path.basename(file)}.f32`);
  const ch = pcm.length, n = pcm[0].length, il = new Float32Array(n * ch);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) il[i * ch + c] = pcm[c][i];
  fs.writeFileSync(tmp, Buffer.from(il.buffer));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(sr), '-ac', String(ch), '-i', tmp,
      '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-compression_level', '0', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', file]);
  } finally { fs.rmSync(tmp, { force: true }); }
}

/** best alignment of b against a (lag in samples, normalised correlation) */
function align(a, as, b, bs, n, maxLag) {
  let best = { lag: 0, c: -2 };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < n; i++) { const x = a[as + i + lag] ?? 0, y = b[bs + i]; ab += x * y; aa += x * x; bb += y * y; }
    const c = ab / Math.sqrt(aa * bb || 1);
    if (c > best.c) best = { lag, c };
  }
  return { lag: best.lag, c: +best.c.toFixed(4) };
}

const [mode, origDir, outDir] = process.argv.slice(2);
if (import.meta.url.endsWith(path.basename(process.argv[1] ?? '')) && (mode === 'build' || mode === 'check')) {
  const rows = [];
  if (mode === 'build') fs.mkdirSync(outDir, { recursive: true });
  for (const [name, spec] of Object.entries(FILES)) {
    const d = decode(path.join(origDir, name + '.mp3'));
    const r = build(d, spec), mg = monoGain(d, spec);
    const row = { name, sr: d.sr, ch: d.ch, origS: +d.dur.toFixed(3), corrLR: +mg.corr.toFixed(3), outCh: r.pcm.length, gain: +r.gain.toFixed(3),
      peak: +Math.max(...r.pcm.map(peak)).toFixed(3), outS: +(r.pcm[0].length / d.sr).toFixed(3), play: r.play, seam: r.seam, xfade: r.xfade };
    if (mode === 'build') encode(r.pcm, d.sr, spec.kbps, path.join(outDir, name + '.mp3'));
    if (outDir && fs.existsSync(path.join(outDir, name + '.mp3'))) {
      const n = decode(path.join(outDir, name + '.mp3'));
      row.newS = +n.dur.toFixed(4); row.newCh = n.ch; row.kb = +(fs.statSync(path.join(outDir, name + '.mp3')).size / 1024).toFixed(1);
      row.pcmMB48k = +(n.dur * 48000 * n.ch * 4 / 1048576).toFixed(2);
      // the played audio against the original (gain-matched downmix, or channel 0 for stereo): same content at lag 0
      const ref = (spec.stereo ? d.chans[0] : d.mono).map((v) => v * r.gain), got = n.chans[0];
      if (spec.loop) {
        const [ls, le] = r.play.loop.map((t) => S(t, n.sr)), L = le - ls, X = S(XFADE, n.sr);
        row.newSeam = n.chans.map((c) => seam(c, ls, le, n.sr));
        row.vsOrig = align(ref, S(spec.loop[0], d.sr), got, ls, L - X - S(0.01, n.sr), 40);
      } else {
        row.vsOrig = spec.shots.map(([o, dur], i) => align(ref, S(o, d.sr), got, S(r.play.offsets[i], n.sr), S(dur, n.sr), 40));
      }
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  if (mode === 'build') fs.copyFileSync(path.join(origDir, 'music.mp3'), path.join(outDir, 'music.mp3'));
}
