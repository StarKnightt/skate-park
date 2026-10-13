// Headless camera check (workstream cam): real park collision + SkatePhysics + CameraRig in node, no browser.
// node tools/capture/cam_sim.mjs [scenario,...] [--every 3] [--nobuild] [--rows]
// Prints per-scenario framing stats from an approximate skater (board at pos, hips at pos+up*0.9, head along up):
//   size  = head-board vertical extent as a fraction of frame height (what the browser cam_check measures)
//   box   = vertical extent of head/hips/board/nose/tail (frame-height fraction, what a viewer reads as his height)
//   len   = head-board distance on screen (frame-height fraction): body length whatever its tilt
//   side  = angle between the view ray and his body axis (90 = side-on, 0 = looking down his body)
//   occ   = board hidden behind geometry (camera -> board ray blocked)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const out = path.join(root, 'tools/capture/.cambuild');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const names = (args[0] && !args[0].startsWith('--') ? args[0] : '').split(',').filter(Boolean);

if (!flag('nobuild')) {
  const src = path.join(root, 'src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(src).filter((f) => f.endsWith('.ts'))) {
    let js = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false, isolatedModules: true },
    }).outputText;
    js = js.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (m, a, p, b) => a + (p.endsWith('.js') ? p : p + '.js') + b);
    js = js.replace(/import\.meta\.env\.BASE_URL/g, "'/'");
    const o = path.join(out, path.relative(src, f)).replace(/\.ts$/, '.js');
    fs.mkdirSync(path.dirname(o), { recursive: true });
    fs.writeFileSync(o, js);
  }
  fs.writeFileSync(path.join(out, '.gitignore'), '*\n');
}
if (flag('old')) {
  // baseline: the committed camera rig (git show HEAD:...), for before/after comparisons
  const { execSync } = await import('node:child_process');
  const code = execSync('git show HEAD:src/player/cameraRig.ts', { cwd: root, encoding: 'utf8' });
  let js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true } }).outputText;
  js = js.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (m, a, p, b) => a + (p.endsWith('.js') ? p : p + '.js') + b);
  fs.writeFileSync(path.join(out, 'player/cameraRig_old.js'), js);
}

globalThis.location = { search: '' };
const imp = (p) => import(pathToFileURL(path.join(out, p)).href);
const { Vector3, PerspectiveCamera } = await import('three');
const { buildPark } = await imp('world/park.js');
const { CollisionWorld } = await imp('world/collision.js');
const { SkatePhysics, emptyInput } = await imp('player/physics.js');
const { CameraRig } = await imp(flag('old') ? 'player/cameraRig_old.js' : 'player/cameraRig.js');
const { transitionProfile } = await imp('world/parkBuilder.js');

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120, DT = 1 / 30;

function inputMapper() {
  let wasCrouch = false, prevSpace = false, prevE = false, latch = null;
  return (keys, airborne) => {
    const inp = emptyInput();
    const down = (c) => keys.has(c);
    inp.steer = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0);
    inp.push = down('KeyW'); inp.brake = down('KeyS');
    inp.lean = (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0);
    const crouch = down('Space');
    inp.grind = down('KeyE'); inp.grindPressed = down('KeyE') && !prevE; prevE = down('KeyE');
    inp.manual = down('ShiftLeft');
    const flip = down('ArrowLeft') ? 'left' : down('ArrowRight') ? 'right' : down('ArrowDown') ? 'down' : down('ArrowUp') ? 'up' : null;
    const spacePressed = down('Space') && !prevSpace; prevSpace = down('Space');
    inp.crouch = crouch;
    const released = wasCrouch && !crouch;
    if (!airborne) { if (released) { inp.ollie = true; inp.flip = flip; } } else { if (spacePressed && flip) latch = flip; if (latch) { inp.airTrick = latch; latch = null; } }
    wasCrouch = crouch;
    return inp;
  };
}

// same scenarios as cam_check.mjs (teleport x,y,z,headingDeg,speed + key script + frames)
const K = (k, t0, d) => [{ at: t0, down: [k] }, { at: t0 + d, up: [k] }];
export const SCEN = {
  bowl: { tp: [-2, 0, 1.5, -90, 5.5], frames: 420 },
  carve: { tp: [-28, -2.3, -2.0, 90, 7.5], frames: 210, script: [...K('KeyA', 0.2, 0.4), ...K('KeyD', 1.3, 0.6), ...K('KeyA', 2.6, 0.8)] },
  // long high carve: up the SE corner and west along the south wall near the coping, down, up the west wall
  carve2: { tp: [-24, -2.3, -4.2, 90, 7.0], frames: 240, script: K('KeyA', 0.2, 1.4) },
  pocket: { tp: [-26, -1.4, 12.8, 90, 5.0], frames: 210, script: K('KeyA', 0.4, 1.4) },
  // synthetic roll-in (no physics): tail on the coping, nose down onto the wall just under it, down the transition
  rollin: { synth: 'rollin', frames: 150 },
  rollinpocket: { synth: 'rollinpocket', frames: 150 },
  pocketdrop: { tp: [-12.5, 0, 15, -90, 5.0], frames: 240 },
  vert: { tp: [22.5, 0, -9, 90, 9.6], frames: 330 },
  wall: { tp: [9.5, 0, -9, 90, 7.2], frames: 390, at: { 300: [...K('KeyW', 0, 1.5)] } },
  rail: { tp: [7, 1, 17.4, 180, 5.0], frames: 120, script: [...K('Space', 0.05, 0.37), ...K('KeyE', 0.5, 0.9)] },
  stairs: { tp: [7, 1, 19.5, 180, 5.5], frames: 90 },
  flat: { tp: [9, 0, 3, 180, 0], frames: 300, script: [...K('KeyW', 0, 2.6), ...K('KeyA', 3.2, 0.8), ...K('Space', 5.0, 0.3), { at: 7.0, down: ['Space'] }, { at: 7.15, down: ['ArrowLeft'] }, { at: 7.32, up: ['Space'] }, { at: 7.4, up: ['ArrowLeft'] }] },
};

const _p = new Vector3(), _q = new Vector3();
function project(cam, v) { _p.copy(v).project(cam); return [_p.x, _p.y, _p.z]; }

/** stand-in for the real drop-in (anim #65) on a straight east wall: roll to the coping, tail on it while the nose
 *  tips down onto the wall, ride down the transition, roll across the floor */
function rollinSubject(kind) {
  const P = kind === 'rollinpocket' ? { lipX: -18, z: 15, H: 1.4, R: 1.9 } : { lipX: -15, z: 0, H: 2.3, R: 2.1 };
  const pts = transitionProfile(P.H, P.R, 64).pts; // top (d = 0) to bottom
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].d - pts[i - 1].d, pts[i].y - pts[i - 1].y));
  const at = (s) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const k = clamp01((s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]));
    return { d: pts[i - 1].d + (pts[i].d - pts[i - 1].d) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k, b: pts[i - 1].beta + (pts[i].beta - pts[i - 1].beta) * k };
  };
  const total = cum[cum.length - 1];
  const s0 = cum.find((c, i) => pts[i].y < -0.3) ?? 0.3; // nose meets the wall ~0.3 m under the coping
  const v0 = 2.2, tA = 1.0, tB = 0.35;
  const sub = { mode: 'ride', pos: new Vector3(), vel: new Vector3(), up: new Vector3(0, 1, 0), fwd: new Vector3(-1, 0, 0), speed: v0, vert: null, grind: null, predicted: null, crouch: { x: 0 } };
  let s = s0, v = 1.0, lastT = tA + tB;
  const set = (d, y, upB, fwdB, sp, crouch) => {
    sub.pos.set(P.lipX - d, y, P.z);
    sub.up.set(-Math.sin(upB), Math.cos(upB), 0);
    sub.fwd.set(-Math.cos(fwdB), -Math.sin(fwdB), 0);
    sub.vel.copy(sub.fwd).multiplyScalar(sp); sub.speed = sp; sub.crouch.x = crouch;
  };
  return (t) => {
    if (t < tA) set(-v0 * (tA - t), 0, 0, 0, v0, 0.15);
    else if (t < tA + tB) { const k = (t - tA) / tB, e = k * k * (3 - 2 * k); set(0.05 * e, -0.3 * e, 1.05 * e, 1.05 * e, 0.6 + 0.6 * k, 0.15 + 0.6 * e); }
    else if (s < total) {
      const dt = t - lastT; lastT = t;
      const top = at(s0);
      for (let i = 0; i < 8; i++) { s += (v * dt) / 8; const q = at(Math.min(s, total)); v = 0.92 * Math.sqrt(1.0 + 2 * 9.81 * (top.y - q.y)); }
      const q = at(Math.min(s, total));
      const blend = clamp01((t - tA - tB) / 0.12);
      const b = 1.05 + (q.b - 1.05) * blend;
      set(q.d, q.y, b, b, v, 0.75 - 0.4 * clamp01((top.y - q.y) / P.H));
      sub.vel.set(-Math.cos(q.b) * v, -Math.sin(q.b) * v, 0);
    } else {
      const dt = t - lastT; lastT = t;
      sub.pos.x -= v * dt; sub.pos.y = -P.H; sub.up.set(0, 1, 0); sub.fwd.set(-1, 0, 0); sub.vel.set(-v, 0, 0); sub.crouch.x = 0.3;
    }
    return sub;
  };
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function simulate(name, spec, every = 3, onFrame = null) {
  const synth = spec.synth ? rollinSubject(spec.synth) : null;
  const ph = synth ? synth(0) : new SkatePhysics(world);
  const cam = new PerspectiveCamera(56, 1280 / 720, 0.1, 3000);
  const rig = new CameraRig(cam, world);
  if (synth) rig.snap(ph.pos, -Math.PI / 2);
  else {
    const [x, y, z, hd, sp] = spec.tp;
    ph.reset(new Vector3(x, y, z), (hd * Math.PI) / 180);
    rig.snap(ph.pos, Math.atan2(ph.fwd.x, ph.fwd.z));
    if (sp) ph.vel.copy(ph.fwd).multiplyScalar(sp);
  }
  let steps = [...(spec.script ?? [])].sort((a, b) => a.at - b.at);
  const keys = new Set(), map = inputMapper();
  const rows = [];
  let t = 0, acc = 0;
  for (let f = 0; f < spec.frames; f++) {
    if (spec.at?.[f]) steps = [...steps, ...spec.at[f].map((s) => ({ ...s, at: s.at + t }))].sort((a, b) => a.at - b.at);
    if (synth) { t += DT; synth(t); } else {
      acc += DT;
      while (acc >= STEP - 1e-9) {
        while (steps.length && steps[0].at <= t + 1e-9) { const s = steps.shift(); s.down?.forEach((k) => keys.add(k)); s.up?.forEach((k) => keys.delete(k)); }
        ph.events.length = 0;
        ph.step(STEP, map(keys, ph.mode === 'air'));
        acc -= STEP; t += STEP;
      }
    }
    const focus = ph.pos.clone().addScaledVector(ph.up, 0.88);
    rig.update(DT, focus, ph);
    cam.updateMatrixWorld();
    if (onFrame) onFrame(f, ph, cam, rig);
    if (f % every) continue;
    const up = ph.mode === 'bail' || ph.mode === 'recover' ? new Vector3(0, 1, 0) : ph.up;
    const crouch = ph.crouch?.x ?? 0;
    const head = ph.pos.clone().addScaledVector(up, 1.62 - 0.38 * crouch);
    const hips = ph.pos.clone().addScaledVector(up, 0.9);
    const board = ph.pos.clone().addScaledVector(up, 0.07);
    const nose = board.clone().addScaledVector(ph.fwd, 0.42), tail = board.clone().addScaledVector(ph.fwd, -0.42);
    const P = [head, hips, board, nose, tail].map((v) => project(cam, v));
    const ys = P.map((p) => p[1]);
    const size = (P[0][1] - P[2][1]) / 2;
    const len = Math.hypot((P[0][0] - P[2][0]) * cam.aspect, P[0][1] - P[2][1]) / 2;
    const box = (Math.max(...ys) - Math.min(...ys)) / 2;
    const toCam = _q.copy(cam.position).sub(hips).normalize();
    const sideAng = (Math.acos(Math.min(1, Math.abs(toCam.dot(up)))) * 180) / Math.PI;
    const signedUp = toCam.dot(up); // > 0: camera on his head side, < 0: on his feet side
    const bd = board.distanceTo(cam.position);
    const h = world.raycast(cam.position, board.clone().sub(cam.position).normalize(), bd);
    const occ = !!(h && h.distance < bd - 0.2 && h.surface !== 9);
    const dir = cam.getWorldDirection(new Vector3());
    rows.push({
      f, mode: ph.mode, pos: ph.pos.toArray().map((v) => +v.toFixed(2)), up: +ph.up.y.toFixed(2),
      cam: cam.position.toArray().map((v) => +v.toFixed(2)), dist: +cam.position.distanceTo(hips).toFixed(2),
      camHead: +(cam.position.y - head.y).toFixed(2), pitch: +((Math.asin(dir.y) * 180) / Math.PI).toFixed(1),
      size: +size.toFixed(3), box: +box.toFixed(3), len: +len.toFixed(3), side: +sideAng.toFixed(0), su: +signedUp.toFixed(2), occ,
      hipsY: +((1 - P[1][1]) * 50).toFixed(0), boardY: +((1 - P[2][1]) * 50).toFixed(0), headY: +((1 - P[0][1]) * 50).toFixed(0),
      hipsX: +((1 + P[1][0]) * 50).toFixed(0), offscreen: P.some((p) => Math.abs(p[0]) > 1 || Math.abs(p[1]) > 1 || p[2] > 1),
      info: Object.fromEntries(Object.entries(rig.info).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v])),
    });
  }
  return rows;
}

export function summary(name, rows) {
  const st = (k) => { const a = rows.map((r) => r[k]); return `${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)} avg ${(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2)}`; };
  const occ = rows.filter((r) => r.occ).length, off = rows.filter((r) => r.offscreen).length;
  return `${name.padEnd(10)} box ${st('box')} | len ${st('len')} | size ${st('size')} | side ${st('side')} | camHead ${st('camHead')} | pitch ${st('pitch')} | dist ${st('dist')} | occ ${occ}/${rows.length} off ${off}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const every = Number(opt('every', 3));
  if (opt('spec')) SCEN.spec = JSON.parse(opt('spec'));
  for (const n of opt('spec') ? ['spec'] : names.length ? names : Object.keys(SCEN)) {
    // smoothness: per-frame view-direction turn (deg) and camera position acceleration (m/frame^2), worst frames
    const dirs = [], ps = [];
    const rows = simulate(n, SCEN[n], every, (f, ph, cam) => { dirs.push(cam.getWorldDirection(new Vector3())); ps.push(cam.position.clone()); });
    let turn = [0, 0], acc = [0, 0];
    for (let i = 2; i < dirs.length; i++) {
      const a = (Math.acos(Math.min(1, dirs[i].dot(dirs[i - 1]))) * 180) / Math.PI;
      const j = ps[i].clone().sub(ps[i - 1]).sub(ps[i - 1].clone().sub(ps[i - 2])).length();
      if (a > turn[0]) turn = [a, i];
      if (j > acc[0]) acc = [j, i];
    }
    console.log(summary(n, rows) + ` | maxTurn ${turn[0].toFixed(1)}deg@f${turn[1]} maxAcc ${acc[0].toFixed(3)}@f${acc[1]}`);
    if (flag('rows')) for (const r of rows) {
      const i = r.info;
      console.log(` f${String(r.f).padStart(3, '0')} ${r.mode.slice(0, 4)} p${r.pos.join(',')} u${r.up} c${r.cam.join(',')} d${r.dist} ch${r.camHead} pt${r.pitch} | box${r.box} len${r.len} sz${r.size} side${r.side}${r.su < 0 ? '-' : '+'} ${r.occ ? 'OCC' : ''}${r.offscreen ? 'OFF' : ''} hip${r.hipsY}% brd${r.boardY}% hd${r.headY}% | sd${i.side} pd${i.pend} sw${i.swing} av${i.avoid} wD${i.wantD} d${i.d} cl${i.clear} fl${i.floor} yT${i.yT} el${i.elev}${i.bowl ? ' B' : ''}${i.bw != null ? ' bw' + i.bw : ''}${i.drop != null ? ' dr' + i.drop : ''}${i.carve != null ? ' cv' + i.carve : ''}`);
    }
  }
}
