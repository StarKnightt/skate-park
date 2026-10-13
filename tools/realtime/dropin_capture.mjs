// #72 proof: frame-stepped (1/FPS s), side-on, deck-level drop-ins into the main bowl and the half pipe (camera = pass-3
// clip29 'side' + deckY). Frames + per-frame state; then python tools/realtime/dropin_strip.py <out> for the contact strips.
//   bash tools/heavy.sh A2 node tools/capture/run.mjs tools/realtime/dropin_capture.mjs --nohmr --out E:/shots/skate-park/pass-04/feel/dropin
import fs from 'node:fs';
import path from 'node:path';

const FPS = Number(process.env.FPS || 30);
const CASES = [
  { name: 'bowl', at: [-12.5, 0, 0.6, -90, 4.5], cam: { heading: -90, dist: 3.2, h: 0.95, lookH: 0.55, fov: 50 } },
  { name: 'halfpipe', at: [17.6, 3.1, -9, 90, 3.0], cam: { heading: 90, dist: 3.2, h: 0.95, lookH: 0.55, fov: 50 } },
  { name: 'halfpipe_fakie', at: [30.4, 3.1, -6, -90, 3.0], fakie: true, cam: { heading: -90, dist: 3.2, h: 0.95, lookH: 0.55, fov: 50 } },
];

function installCam() {
  const s = window.__skate, g = s.game, V = g.physics.pos.constructor;
  const mem = {};
  // side-on at deck level (angle 0 = toe side), sinking with the board once it is below the coping (media3 'side' + deckY)
  window.__dcam = (spec) => {
    const ph = g.physics, cam = g.camera;
    const hips = g.skater.hipsWorld(new V());
    const h = (spec.heading * Math.PI) / 180, fwd = new V(Math.sin(h), 0, Math.cos(h));
    const dir = new V(-fwd.z, 0, fwd.x);
    const b = g.board.root.position;
    if (mem.deckY == null || spec.reset) mem.deckY = ph.pos.y;
    const gy = mem.deckY;
    const look = new V(b.x, 0, b.z);
    look.y = Math.max(gy - 1.6, Math.min(gy + spec.lookH, (b.y + hips.y) / 2));
    const pos = look.clone().addScaledVector(dir, spec.dist);
    pos.y = Math.max(look.y + 0.2, gy + spec.h - 0.5 * Math.max(0, gy - b.y));
    if (Math.abs(cam.fov - spec.fov) > 0.01) { cam.fov = spec.fov; cam.updateProjectionMatrix(); }
    s.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
  };
}

function stepFrame([cam, dt]) {
  const s = window.__skate, g = s.game;
  s.advance(1, dt, false); window.__dcam(cam); g.render(dt);
  const e = g.eventLog.slice(); g.eventLog.length = 0;
  const ph = g.physics, d = ph.dropin;
  // board pitch as seen (deck pose included): leading end up = positive
  const V = ph.pos.constructor, deck = g.board.deck;
  const nose = new V(0, 0, 1).applyQuaternion(deck.getWorldQuaternion(g.board.root.quaternion.clone()));
  return { e: e.map((x) => x.type), mode: ph.mode, t: +g.simTime.toFixed(3), speed: +ph.speed.toFixed(2),
    dropin: d ? d.phase : null, ang: d ? +((d.ang * 180) / Math.PI).toFixed(1) : null, lead: d ? d.lead : null,
    deckNosePitch: +((Math.asin(Math.max(-1, Math.min(1, nose.y))) * 180) / Math.PI).toFixed(1) };
}

export default async function (c) {
  await c.eval(installCam);
  await c.api('hud', false);
  for (const cs of CASES) {
    const dir = path.join(c.out, cs.name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await c.eval(() => { const s = window.__skate; s.free(); s.release(); s.script([]); s.manual(true); s.events(); });
    await c.api('teleport', ...cs.at);
    if (cs.fakie) await c.eval(() => { const ph = window.__skate.game.physics; ph.fwd.negate(); ph.fakie = true; });
    await c.eval(([dt]) => window.__skate.advance(2, dt, false), [1 / FPS]);
    const rows = [];
    let done = -1;
    for (let i = 0; i < 90; i++) {
      const st = await c.eval(stepFrame, [{ ...cs.cam, reset: i === 0 }, 1 / FPS]);
      st.frame = i; rows.push(st);
      await c.page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (st.e.includes('dropIn')) done = i;
      if (done >= 0 && i >= done + 10) break;
      if (st.mode !== 'ride') break;
    }
    fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ fps: FPS, case: cs, rows }, null, 1));
    const ph = rows.filter((r) => r.dropin).map((r) => `${r.frame}:${r.dropin}:${r.ang}`);
    console.log(cs.name, rows.length, 'frames | drop-in', ph[0], '...', ph[ph.length - 1], '| hand-over frame', done, '| end mode', rows[rows.length - 1].mode);
  }
  await c.eval(() => window.__skate.manual(false));
}
