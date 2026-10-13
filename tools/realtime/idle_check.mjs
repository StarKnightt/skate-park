// Keep check "knees over the toes at idle": the pass-3 h66_idle_front still recipe (frame-stepped 1/30 s), saved next to
// the pass-3 image as a side-by-side.
//   bash tools/heavy.sh A2 node tools/capture/run.mjs tools/realtime/idle_check.mjs --nohmr --out E:/shots/skate-park/pass-04/feel/idle
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function frame(cam) {
  const s = window.__skate, g = s.game, V = g.physics.pos.constructor;
  s.advance(1, 1 / 30, false);
  const h = (cam.heading * Math.PI) / 180, fwd = new V(Math.sin(h), 0, Math.cos(h)), dir = new V(-fwd.z, 0, fwd.x);
  const p = g.physics.pos, look = new V(p.x, cam.groundY + cam.lookH, p.z), pos = look.clone().addScaledVector(dir, cam.dist);
  pos.y = cam.groundY + cam.h;
  if (Math.abs(g.camera.fov - cam.fov) > 0.01) { g.camera.fov = cam.fov; g.camera.updateProjectionMatrix(); }
  s.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
  g.render(1 / 30);
}

export default async function (c) {
  await c.api('hud', false);
  await c.eval(() => { const s = window.__skate; s.free(); s.release(); s.script([]); s.manual(true); });
  await c.api('teleport', 9, 0, 3, 180, 0);
  const cam = { heading: 180, dist: 2.5, h: 1.0, lookH: 0.95, fov: 50, groundY: 0 };
  for (let i = 0; i <= 150; i++) {
    await c.eval(frame, cam);
    if (i === 60 || i === 150) await c.shot(`h66_idle_front_f${String(i).padStart(3, '0')}_p4.png`);
  }
  await c.eval(() => window.__skate.manual(false));
  spawnSync('python', ['-c', `
from PIL import Image, ImageDraw
a = Image.open(r'E:/shots/skate-park/pass-03/screens/h66_idle_front_f060.png').convert('RGB')
b = Image.open(r'${path.join(c.out, 'h66_idle_front_f060_p4.png')}').convert('RGB').resize(a.size)
s = Image.new('RGB', (a.width * 2 + 8, a.height), (20, 20, 24)); s.paste(a, (0, 0)); s.paste(b, (a.width + 8, 0))
d = ImageDraw.Draw(s); d.text((10, 10), 'pass-03', fill=(255, 255, 255)); d.text((a.width + 18, 10), 'pass-04 A2', fill=(255, 255, 255))
s.save(r'${path.join(c.out, 'cmp_idle_knees_p3_vs_p4.jpg')}', quality=90)
`], { stdio: 'inherit' });
}
