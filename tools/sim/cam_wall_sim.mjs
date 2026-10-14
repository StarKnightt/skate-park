// Headless auto-ride camera framing check (c-cam, pass 5 #76): autopilot + physics + CameraRig at 60 fps, flags frames
// where his head or board leaves the frame, he fills > 0.7 of the frame height, or the boom jumps.
// node tools/sim/build_src.mjs tools/sim/.build-c-cam && node tools/sim/cam_wall_sim.mjs [--secs 200] [--seeds 1,2] [--old]
//   [--rows x0,x1,z0,z1] (print every frame inside that box) [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
globalThis.location = { search: '' };
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes('--' + k);
const B = path.resolve(arg('build', 'tools/sim/.build-c-cam'));
const imp = (p) => import(pathToFileURL(path.join(B, p)).href);
const { Vector3, PerspectiveCamera } = await import('three');
const { buildPark } = await imp('world/park.js');
const { CollisionWorld } = await imp('world/collision.js');
const { SkatePhysics } = await imp('player/physics.js');
const { Autopilot } = await imp('player/autopilot.js');
const { CameraRig } = await imp(flag('old') ? 'player/cameraRig_old.js' : 'player/cameraRig.js');

const park = buildPark();
const world = new CollisionWorld(park.builder.collisionGeometry(), park.builder.cSurf, park.grindLines);
const STEP = 1 / 120, FPS = +arg('fps', 60), DT = 1 / FPS;
const secs = +arg('secs', 200), seeds = String(arg('seeds', '1')).split(',').map(Number);
const box = arg('rows', '') ? arg('rows').split(',').map(Number) : null;
const teleport = arg('tp', '') ? arg('tp').split(',').map(Number) : null; // x,y,z,headingDeg,speed
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const _p = new Vector3();
const ndc = (cam, v) => { _p.copy(v).applyMatrix4(cam.matrixWorldInverse); const behind = _p.z > -0.05; _p.copy(v).project(cam); return { x: _p.x, y: _p.y, behind }; };
const out = { seeds: [] };
// --scan x0,x1,z0,z1: each seed starts at a random spot in that box (random heading / speed), autopilot reacquires
const scan = arg('scan', '') ? arg('scan').split(',').map(Number) : null;
for (const seed of seeds) {
  Math.random = mulberry(seed * 7919 + 1);
  const ph = new SkatePhysics(world);
  if (ph.assist) Object.assign(ph.assist, { landing: true, autoGrind: true, fastRecover: true });
  if (scan) {
    const R = mulberry(seed * 31 + 7);
    for (let k = 0; k < 500; k++) {
      const p = new Vector3(scan[0] + R() * (scan[1] - scan[0]), 6, scan[2] + R() * (scan[3] - scan[2]));
      const h = world.raycast(p, new Vector3(0, -1, 0), 12);
      if (!h || h.normal.y < 0.97) continue;
      ph.reset(h.point.clone(), R() * Math.PI * 2);
      const sp = 1 + R() * 4; ph.vel.copy(ph.fwd).multiplyScalar(sp); ph.speed = sp;
      break;
    }
  } else if (teleport) ph.reset(new Vector3(teleport[0], teleport[1], teleport[2]), (teleport[3] * Math.PI) / 180);
  else ph.reset(park.spawn.pos.clone(), park.spawn.heading);
  if (teleport && teleport[4]) { ph.vel.copy(ph.fwd).multiplyScalar(teleport[4]); ph.speed = teleport[4]; }
  const ap = new Autopilot(ph, { seed });
  if (scan) ap.reset();
  const cam = new PerspectiveCamera(56, 1280 / 720, 0.08, 4000);
  const rig = new CameraRig(cam, world);
  rig.snap(ph.pos, Math.atan2(ph.fwd.x, ph.fwd.z));
  let t = 0, acc = 0, f = 0, prevD = -1, prevCam = null;
  const bad = [], stats = { frames: 0, headOut: 0, boardOut: 0, big: 0, jump: 0, minD: 99, maxBig: 0, maxJump: 0, maxCamStep: 0 };
  while (t < secs) {
    acc += DT;
    while (acc >= STEP) {
      acc -= STEP;
      ph.events.length = 0;
      ph.step(STEP, ap.sample(STEP, ph.mode === 'air'));
      t += STEP;
      if (ph.mode === 'bail' && ph.bail && ph.bail.t > 2.0 && (ph.bail.board.asleep || ph.bail.t > 6)) {
        const p = new Vector3(), fw = new Vector3(), u = new Vector3();
        ph.bail.board.ridePose(p, fw, u);
        ph.finishRecover(p, fw);
      }
    }
    f++;
    const focus = ph.pos.clone().addScaledVector(ph.up, 0.88);
    rig.update(DT, focus, ph);
    cam.updateMatrixWorld();
    if (ph.mode !== 'ride' && ph.mode !== 'air' && ph.mode !== 'grind') { prevD = -1; continue; }
    const crouch = ph.crouch?.x ?? 0;
    const head = ndc(cam, ph.pos.clone().addScaledVector(ph.up, 1.7 - 0.38 * crouch)); // cap top
    const board = ndc(cam, ph.pos.clone().addScaledVector(ph.up, -0.02));
    const size = (head.y - board.y) / 2;
    const d = rig.dist, jump = prevD < 0 ? 0 : Math.abs(d - prevD);
    const camStep = prevCam ? cam.position.distanceTo(prevCam) : 0;
    prevD = d; prevCam = cam.position.clone();
    stats.frames++;
    const hOut = head.behind || head.y > 1.0 || Math.abs(head.x) > 1.0, bOut = board.behind || board.y < -1.0 || Math.abs(board.x) > 1.0;
    const big = Math.abs(size) > 0.7;
    if (hOut) stats.headOut++; if (bOut) stats.boardOut++; if (big) stats.big++;
    if (jump > 0.12) stats.jump++;
    stats.minD = Math.min(stats.minD, d); stats.maxBig = Math.max(stats.maxBig, Math.abs(size)); stats.maxJump = Math.max(stats.maxJump, jump);
    stats.maxCamStep = Math.max(stats.maxCamStep, camStep);
    const i = rig.info;
    const row = `f${f} t${t.toFixed(2)} ${ph.mode.slice(0, 4)} p${ph.pos.x.toFixed(1)},${ph.pos.y.toFixed(1)},${ph.pos.z.toFixed(1)} upY${ph.up.y.toFixed(2)} v${ph.speed.toFixed(1)} [${ap.lineName}] `
      + `hd${head.y.toFixed(2)} bd${board.y.toFixed(2)} sz${size.toFixed(2)} d${d.toFixed(2)} wD${i.wantD.toFixed(2)} cl${i.clear.toFixed(2)} jmp${jump.toFixed(3)} cs${camStep.toFixed(3)} `
      + `el${i.elev.toFixed(2)} sw${i.swing.toFixed(2)} av${i.avoid.toFixed(2)} pd${i.pend.toFixed(2)} sd${i.side.toFixed(2)} bw${i.bw.toFixed(2)} fov${cam.fov.toFixed(1)}`
      + ` c0${(i.clear0 ?? 0).toFixed(2)} yaw${rig.yaw.toFixed(2)} base${(((i.base % 6.2832) + 9.42) % 6.2832 - 3.14).toFixed(2)} hdv${Math.atan2(ph.vel.x, ph.vel.z).toFixed(2)} ri${(i.rise ?? 0).toFixed(2)}` + `${hOut ? ' HEAD-OUT' : ''}${bOut ? ' BOARD-OUT' : ''}${big ? ' BIG' : ''}${jump > 0.12 ? ' JUMP' : ''}`;
    if (box && ph.pos.x >= box[0] && ph.pos.x <= box[1] && ph.pos.z >= box[2] && ph.pos.z <= box[3]) console.log(row);
    if (hOut || bOut || big || jump > 0.12) bad.push({ f, t: +t.toFixed(2), x: +ph.pos.x.toFixed(1), z: +ph.pos.z.toFixed(1), line: ap.lineName, row });
  }
  // group bad frames into spans
  const spans = [];
  for (const b of bad) {
    const s = spans[spans.length - 1];
    if (s && b.f - s.f1 <= 6) { s.f1 = b.f; s.n++; s.rows.push(b.row); } else spans.push({ f0: b.f, f1: b.f, n: 1, t: b.t, x: b.x, z: b.z, line: b.line, rows: [b.row] });
  }
  console.log(`seed ${seed}: ${JSON.stringify(stats, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v))}`);
  for (const s of spans) {
    console.log(` span f${s.f0}-f${s.f1} (${s.n} fr, ${((s.f1 - s.f0 + 1) / FPS).toFixed(2)} s) t${s.t} @${s.x},${s.z} [${s.line}]`);
    if (flag('v')) for (const r of s.rows) console.log('   ' + r);
    else console.log('   ' + s.rows[Math.floor(s.rows.length / 2)]);
  }
  out.seeds.push({ seed, stats, spans: spans.map(({ rows, ...r }) => r) });
}
if (arg('json', '')) fs.writeFileSync(arg('json'), JSON.stringify(out, null, 1));
