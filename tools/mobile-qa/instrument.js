// Page-side instrumentation for the mobile QA scripts. Injected with page.addInitScript() before any page script runs,
// so it works on the real (non-?test) build too. Exposes window.__qa. Read-only towards the game: it only wraps browser
// APIs to observe them (rAF timing, long tasks, WebGL draw calls / allocations / extensions / context loss, AudioContext
// state + decoded buffer sizes, pointer-event user activation, visual-viewport scale, context menus, selection).
(() => {
  if (window.__qa) return;
  const now = () => performance.now();
  const qa = (window.__qa = {
    t0: now(),
    frames: [], // rAF intervals (ms)
    frameT: [], // rAF timestamps (ms), parallel to frames
    longtasks: [], // [start, duration]
    paints: [], // [name, start]
    draws: { calls: 0, tris: 0, canvas: 0, perFrame: [] }, // perFrame rows: [t, calls, tris, canvasCalls]
    firstDraw: null, firstCanvasDraw: null,
    ext: {}, // getExtension(name) -> available
    gl: null, glAttrs: null, glEvents: [], // context lost / restored
    mem: { tex: 0, texPeak: 0, rb: 0, rbPeak: 0, buf: 0, bufPeak: 0, maxDim: 0, big: [], allocs: 0 },
    audio: { ctx: [], decoded: [] },
    ptr: [], // [type, pointerType, t, userActivation.isActive, hasBeenActive, target]
    ctxmenu: [], selectstart: 0, vv: [], errors: [],
    marks: {},
  });
  addEventListener('error', (e) => qa.errors.push(String(e.message)));

  // ---------------------------------------------------------------- frames
  // every other rAF callback is timed (main-thread cost of the game's frame: simulate + render submission)
  const oRAF = window.requestAnimationFrame.bind(window);
  const oCAF = window.cancelAnimationFrame.bind(window);
  let cbAcc = 0;
  const VS = window.__QA_CFG && window.__QA_CFG.vsync;
  qa.gf = []; // vsync mode: one row per delivered page frame [ts, callback ms, draw calls, triangles]
  if (VS) {
    // emulated phone panel: page rAF callbacks are delivered on a VS Hz grid (headless Chrome ticks at the host monitor's
    // ~200 Hz). A frame whose work overruns the period misses the next vsync, exactly like a real 60 Hz panel.
    const period = 1000 / VS;
    let next = 0, idc = 0;
    const q = new Map();
    window.requestAnimationFrame = (cb) => { q.set(++idc, cb); return idc; };
    window.cancelAnimationFrame = (id) => { q.delete(id); };
    const drive = (t) => {
      if (!next) next = t;
      if (t >= next - 2.5 && q.size) {
        const ts = next, cbs = [...q.values()]; q.clear();
        const d = qa.draws, c0 = d.calls, t0 = d.tris, s = performance.now();
        for (const cb of cbs) { try { cb(ts); } catch (e) { setTimeout(() => { throw e; }); } }
        const ms = performance.now() - s;
        cbAcc += ms;
        qa.gf.push([ts, +ms.toFixed(2), d.calls - c0, d.tris - t0]);
        if (qa.gf.length > 20000) qa.gf.splice(0, 5000);
        const after = performance.now();
        next += period;
        while (next <= after) next += period; // work overran: the frame waits for the next vsync
      }
      oRAF(drive);
    };
    oRAF(drive);
  } else {
    window.requestAnimationFrame = function (cb) {
      return oRAF((ts) => { const s = performance.now(); try { cb(ts); } finally { cbAcc += performance.now() - s; } });
    };
  }
  let last = 0;
  const MAXF = 30000;
  function raf(t) {
    if (last) {
      qa.frames.push(t - last); qa.frameT.push(t);
      if (qa.frames.length > MAXF) { qa.frames.splice(0, 5000); qa.frameT.splice(0, 5000); }
    }
    last = t;
    const d = qa.draws;
    // a row per DRAWN frame (the game skips rAF callbacks under ?fps=N): [t, calls, tris, canvasCalls, callback ms]
    if (d.calls) { d.perFrame.push([t, d.calls, d.tris, d.canvas, +cbAcc.toFixed(2)]); if (d.perFrame.length > 8000) d.perFrame.splice(0, 2000); }
    d.calls = 0; d.tris = 0; d.canvas = 0; cbAcc = 0;
    oRAF(raf);
  }
  oRAF(raf);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) qa.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) qa.paints.push([e.name, e.startTime]); }).observe({ type: 'paint', buffered: true }); } catch { /* unsupported */ }

  // ---------------------------------------------------------------- input / browser hygiene probes
  for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend']) {
    addEventListener(type, (e) => {
      const ua = navigator.userActivation;
      const tg = e.target instanceof Element ? (e.target.className && typeof e.target.className === 'string' ? e.target.className.split(' ')[0] : e.target.tagName) : '?';
      qa.ptr.push([type, e.pointerType ?? '', +now().toFixed(1), ua ? ua.isActive : null, ua ? ua.hasBeenActive : null, tg]);
      if (qa.ptr.length > 400) qa.ptr.splice(0, 100);
    }, true);
  }
  addEventListener('contextmenu', (e) => { setTimeout(() => qa.ctxmenu.push({ t: now(), prevented: e.defaultPrevented, target: e.target?.className || e.target?.tagName }), 0); }, true);
  addEventListener('selectstart', () => { qa.selectstart++; }, true);
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', () => qa.vv.push([now(), visualViewport.scale, visualViewport.width, visualViewport.height]));
  }

  // ---------------------------------------------------------------- WebGL
  const oGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const c = oGet.call(this, type, attrs);
    if (c && /webgl/.test(type) && !qa.gl) {
      qa.gl = c; qa.glType = type; qa.glAttrs = attrs ?? null; qa.canvas = this;
      this.addEventListener('webglcontextlost', (e) => qa.glEvents.push(['lost', now(), e.defaultPrevented]));
      this.addEventListener('webglcontextrestored', () => qa.glEvents.push(['restored', now()]));
    }
    return c;
  };
  const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  // __QA_CFG.noGL (set by an earlier init script): skip the per-call WebGL wrappers (overhead check)
  if (P && !(window.__QA_CFG && window.__QA_CFG.noGL)) {
    const TRI = 4, STRIP = 5, FAN = 6;
    const prim = (m, n, i = 1) => (m === TRI ? n / 3 : m === STRIP || m === FAN ? Math.max(0, n - 2) : 0) * i;
    let drawFB = null;
    const oBF = P.bindFramebuffer;
    P.bindFramebuffer = function (target, fb) { if (target === 0x8d40 || target === 0x8ca9) drawFB = fb; return oBF.call(this, target, fb); };
    const wrap = (name, f) => {
      const o = P[name];
      P[name] = function (...a) {
        const d = qa.draws, t = now();
        d.calls++; d.tris += f(...a);
        if (drawFB === null) { d.canvas++; if (qa.firstCanvasDraw === null) qa.firstCanvasDraw = t; }
        if (qa.firstDraw === null) qa.firstDraw = t;
        return o.apply(this, a);
      };
    };
    wrap('drawElements', (m, n) => prim(m, n));
    wrap('drawArrays', (m, f, n) => prim(m, n));
    wrap('drawElementsInstanced', (m, n, ty, off, i) => prim(m, n, i));
    wrap('drawArraysInstanced', (m, f, n, i) => prim(m, n, i));
    wrap('drawRangeElements', (m, s, e, n) => prim(m, n));
    const oExt = P.getExtension;
    P.getExtension = function (name) { const r = oExt.call(this, name); qa.ext[name] = !!r; return r; };

    // ---- GPU memory estimate: textures, renderbuffers, buffers (bytes, tracked per object through the bindings)
    const M = qa.mem;
    const BPP = {
      0x8058: 4, 0x8c43: 4, 0x881a: 8, 0x8814: 16, 0x822f: 4, 0x822d: 2, 0x8230: 8, 0x822e: 4, 0x8229: 1, 0x822b: 2, 0x8051: 3,
      0x8c41: 3, 0x81a5: 2, 0x81a6: 4, 0x88f0: 4, 0x8cac: 4, 0x8cad: 8, 0x8c3a: 4, 0x881b: 6, 0x8815: 12, 0x8d62: 2, 0x8056: 2,
      0x8057: 2, 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190a: 2, 0x1906: 1, 0x1902: 4, 0x84f9: 4, 0x8d48: 1,
    };
    const bpp = (f) => BPP[f] ?? 4;
    let unit = 0x84c0;
    const bound = new Map(), texB = new WeakMap(), texInfo = new WeakMap();
    const oAT = P.activeTexture; P.activeTexture = function (u) { unit = u; return oAT.call(this, u); };
    const oBT = P.bindTexture; P.bindTexture = function (t, x) { bound.set(unit + ':' + t, x); return oBT.call(this, t, x); };
    const faceT = (t) => (t >= 0x8515 && t <= 0x851a ? 0x8513 : t);
    const setTex = (target, bytes, w, h, label, add = false) => {
      const tex = bound.get(unit + ':' + faceT(target)); if (!tex) return;
      const prev = texB.get(tex) || 0, next = add ? prev + bytes : bytes;
      texB.set(tex, next); M.tex += next - prev; M.texPeak = Math.max(M.texPeak, M.tex); M.allocs++;
      texInfo.set(tex, { w, h, label });
      if (Math.max(w, h) > M.maxDim) M.maxDim = Math.max(w, h);
      if (Math.max(w, h) >= 2048) M.big.push([w, h, label]);
    };
    const mipBytes = (w, h, levels, b) => { let s = 0; for (let l = 0; l < levels; l++) s += Math.max(1, w >> l) * Math.max(1, h >> l) * b; return s; };
    const oTS2 = P.texStorage2D;
    P.texStorage2D = function (t, levels, f, w, h) { setTex(t, mipBytes(w, h, levels, bpp(f)) * (t === 0x8513 ? 6 : 1), w, h, `storage2D fmt 0x${f.toString(16)} L${levels}`); return oTS2.apply(this, arguments); };
    const oTS3 = P.texStorage3D;
    P.texStorage3D = function (t, levels, f, w, h, d) { setTex(t, mipBytes(w, h, levels, bpp(f)) * d, w, h, `storage3D fmt 0x${f.toString(16)} x${d}`); return oTS3.apply(this, arguments); };
    const oTI2 = P.texImage2D;
    P.texImage2D = function (t, level, f, ...rest) {
      if (level === 0) {
        let w, h;
        if (typeof rest[0] === 'number' && typeof rest[1] === 'number' && rest.length >= 5) { w = rest[0]; h = rest[1]; }
        else { const src = rest[rest.length - 1]; w = src?.videoWidth || src?.naturalWidth || src?.width || 0; h = src?.videoHeight || src?.naturalHeight || src?.height || 0; }
        setTex(t, w * h * bpp(f), w, h, `image2D fmt 0x${f.toString(16)}`, t !== faceT(t));
      }
      return oTI2.apply(this, [t, level, f, ...rest]);
    };
    const oGM = P.generateMipmap;
    P.generateMipmap = function (t) {
      const tex = bound.get(unit + ':' + t);
      if (tex && !texInfo.get(tex)?.mipped) { const b = texB.get(tex) || 0; const add = Math.round(b / 3); texB.set(tex, b + add); M.tex += add; M.texPeak = Math.max(M.texPeak, M.tex); const i = texInfo.get(tex); if (i) i.mipped = true; }
      return oGM.call(this, t);
    };
    const oDT = P.deleteTexture; P.deleteTexture = function (x) { if (x) { M.tex -= texB.get(x) || 0; texB.set(x, 0); } return oDT.call(this, x); };
    let curRB = null; const rbB = new WeakMap();
    const oBR = P.bindRenderbuffer; P.bindRenderbuffer = function (t, x) { curRB = x; return oBR.call(this, t, x); };
    const setRB = (bytes) => { if (!curRB) return; const prev = rbB.get(curRB) || 0; rbB.set(curRB, bytes); M.rb += bytes - prev; M.rbPeak = Math.max(M.rbPeak, M.rb); };
    const oRS = P.renderbufferStorage; P.renderbufferStorage = function (t, f, w, h) { setRB(w * h * bpp(f)); return oRS.apply(this, arguments); };
    const oRSM = P.renderbufferStorageMultisample; P.renderbufferStorageMultisample = function (t, s, f, w, h) { setRB(w * h * bpp(f) * Math.max(1, s)); return oRSM.apply(this, arguments); };
    const oDR = P.deleteRenderbuffer; P.deleteRenderbuffer = function (x) { if (x) { M.rb -= rbB.get(x) || 0; rbB.set(x, 0); } return oDR.call(this, x); };
    const bufBound = new Map(), bufB = new WeakMap();
    const oBB = P.bindBuffer; P.bindBuffer = function (t, x) { bufBound.set(t, x); return oBB.call(this, t, x); };
    const oBD = P.bufferData;
    P.bufferData = function (t, d) {
      const x = bufBound.get(t);
      if (x) { const bytes = typeof d === 'number' ? d : d?.byteLength ?? 0; const prev = bufB.get(x) || 0; bufB.set(x, bytes); M.buf += bytes - prev; M.bufPeak = Math.max(M.bufPeak, M.buf); }
      return oBD.apply(this, arguments);
    };
    const oDB = P.deleteBuffer; P.deleteBuffer = function (x) { if (x) { M.buf -= bufB.get(x) || 0; bufB.set(x, 0); } return oDB.call(this, x); };
  }

  // ---------------------------------------------------------------- audio
  const AC = window.AudioContext;
  if (AC) {
    const Wrapped = class extends AC {
      constructor(...a) {
        super(...a);
        const ua = navigator.userActivation;
        const rec = { t: +now().toFixed(1), state0: this.state, sampleRate: this.sampleRate, activeAtCreate: ua ? ua.isActive : null, beenActive: ua ? ua.hasBeenActive : null, states: [] };
        qa.audio.ctx.push(rec); qa.audio.last = this;
        console.log(`QA_AUDIO created ${this.state} active=${rec.activeAtCreate}`);
        this.addEventListener('statechange', () => { rec.states.push([+now().toFixed(1), this.state]); console.log(`QA_AUDIO state ${this.state}`); });
      }
    };
    window.AudioContext = Wrapped;
    const oDec = AC.prototype.decodeAudioData;
    AC.prototype.decodeAudioData = function (...a) {
      const p = oDec.apply(this, a);
      p?.then?.((b) => {
        qa.audio.decoded.push({ dur: +b.duration.toFixed(2), ch: b.numberOfChannels, sr: b.sampleRate, mb: +((b.length * b.numberOfChannels * 4) / 1048576).toFixed(2) });
        console.log(`QA_AUDIO decoded ${qa.audio.decoded.length}`);
      }, () => {});
      return p;
    };
    // a streamed track (an <audio> element routed into the graph) has no decode: 'playing' is when it is audible
    qa.audio.streams = [];
    const oMES = AC.prototype.createMediaElementSource;
    if (oMES) AC.prototype.createMediaElementSource = function (el) {
      const rec = { t: +now().toFixed(1), src: el.currentSrc || el.src, playing: null };
      qa.audio.streams.push(rec);
      console.log(`QA_AUDIO stream ${qa.audio.streams.length}`);
      el.addEventListener('playing', () => { if (rec.playing == null) { rec.playing = +now().toFixed(1); console.log('QA_AUDIO stream playing'); } });
      return oMES.call(this, el);
    };
    // the first sounds started (buffers longer than 10 ms: not the 1-sample iOS unlock buffer)
    qa.audio.plays = [];
    const oStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      const b = this.buffer;
      if (b && b.duration > 0.01 && qa.audio.plays.length < 40) { qa.audio.plays.push([+now().toFixed(1), +b.duration.toFixed(2)]); console.log(`QA_AUDIO play ${b.duration.toFixed(2)}`); }
      return oStart.apply(this, a);
    };
  }
  // audio files the page fetches: load.mjs waits until that many buffers are decoded
  qa.audio.fetches = 0;
  const oFetch = window.fetch;
  if (oFetch) window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : (input && input.url) || '';
    if (/\/audio\/[^/?#]+\.(mp3|m4a|aac|ogg|opus|wav|webm|flac)([?#]|$)/i.test(u)) console.log(`QA_AUDIO fetch ${++qa.audio.fetches}`);
    return oFetch.apply(this, arguments);
  };

  // ---------------------------------------------------------------- loading progress timeline
  const watchLoading = () => {
    const bar = document.querySelector('.loading .bar i'), l = document.querySelector('.loading');
    qa.loadSamples = [];
    if (!bar) return;
    const iv = setInterval(() => {
      const done = !document.querySelector('.loading') || document.querySelector('.loading').classList.contains('done');
      qa.loadSamples.push([+now().toFixed(0), bar.style.width || '0%', done]);
      if (done) { if (qa.marks.loadingDone == null) { qa.marks.loadingDone = now(); console.log('QA_READY'); } clearInterval(iv); }
    }, 100);
    if (l) new MutationObserver(() => { if (l.classList.contains('done') && qa.marks.loadingDone == null) { qa.marks.loadingDone = now(); console.log('QA_READY'); } }).observe(l, { attributes: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLoading); else watchLoading();

  // ---------------------------------------------------------------- summaries (called from node)
  qa.frameStats = (fromT = 0, toT = Infinity) => {
    const f = [];
    for (let i = 0; i < qa.frames.length; i++) if (qa.frameT[i] >= fromT && qa.frameT[i] <= toT) f.push(qa.frames[i]);
    if (!f.length) return null;
    const s = [...f].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const sum = f.reduce((a, b) => a + b, 0);
    return {
      n: f.length, fps: +(1000 * f.length / sum).toFixed(1), medianFps: +(1000 / q(0.5)).toFixed(1),
      p50: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(1),
      over20: +(f.filter((x) => x > 20).length / f.length * 100).toFixed(1), over33: +(f.filter((x) => x > 34).length / f.length * 100).toFixed(1),
      over50: f.filter((x) => x > 50).length,
    };
  };
  qa.drawStats = (fromT = 0, toT = Infinity) => {
    const r = qa.draws.perFrame.filter((x) => x[0] >= fromT && x[0] <= toT);
    if (!r.length) return null;
    const avg = (i) => Math.round(r.reduce((a, b) => a + b[i], 0) / r.length);
    const mx = (i) => Math.max(...r.map((x) => x[i]));
    return { frames: r.length, calls: avg(1), callsMax: mx(1), tris: avg(2), trisMax: mx(2), canvasCalls: avg(3) };
  };
  /** drawn-frame intervals (game frames, not rAF ticks) + main-thread callback time per drawn frame */
  qa.gameFrameStats = (fromT = 0, toT = Infinity) => {
    // vsync mode: delivered frames that drew something (paused frames draw at ~10 fps and are skipped);
    // rows are reshaped to the perFrame layout [t, calls, tris, canvas, cbMs]
    const src = VS ? qa.gf.filter((x) => x[2] > 0 || (window.__QA_CFG && window.__QA_CFG.noGL)).map((x) => [x[0], x[2], x[3], 0, x[1]]) : qa.draws.perFrame;
    const r = src.filter((x) => x[0] >= fromT && x[0] <= toT);
    if (r.length < 3) return null;
    const iv = []; for (let i = 1; i < r.length; i++) iv.push(r[i][0] - r[i - 1][0]);
    const cb = r.map((x) => x[4]);
    const st = (a) => { const s = [...a].sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { p50: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(1) }; };
    const span = (r[r.length - 1][0] - r[0][0]) / 1000;
    return {
      frames: r.length, fps: +((r.length - 1) / span).toFixed(1), interval: st(iv), medianFps: +(1000 / st(iv).p50).toFixed(1),
      over20ms: +(iv.filter((x) => x > 20).length / iv.length * 100).toFixed(1), over33ms: +(iv.filter((x) => x > 34).length / iv.length * 100).toFixed(1),
      hitches50ms: iv.filter((x) => x > 50).length, cpuMs: st(cb), cpuMean: +(cb.reduce((a, b) => a + b, 0) / cb.length).toFixed(2),
    };
  };
})();
