// Push from standstill, frame-stepped 1/60 s, side-on at board height: frames labelled with the push clock and the
// board's acceleration, to check that the back foot plants when the physics starts driving (PUSH.T0) and lifts at the
// end of the stroke.  bash tools/heavy.sh A2 node tools/capture/run.mjs tools/realtime/push_capture.mjs --nohmr --out E:/shots/skate-park/pass-04/feel/push
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function frame(cam) {
  const s = window.__skate, g = s.game, V = g.physics.pos.constructor, ph = g.physics;
  const v0 = ph.vel.length();
  s.advance(1, 1 / 60, false);
  const h = (cam.heading * Math.PI) / 180, fwd = new V(Math.sin(h), 0, Math.cos(h)), dir = new V(-fwd.z, 0, fwd.x);
  const p = g.board.root.position, look = new V(p.x, cam.lookH, p.z), pos = look.clone().addScaledVector(dir, cam.dist);
  pos.y = cam.h;
  if (Math.abs(g.camera.fov - cam.fov) > 0.01) { g.camera.fov = cam.fov; g.camera.updateProjectionMatrix(); }
  s.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
  g.render(1 / 60);
  const foot = g.skater.b.get('RightFoot').bone.getWorldPosition(new V());
  return { pushT: +ph.pushT.toFixed(3), accel: +((ph.vel.length() - v0) * 60).toFixed(2), speed: +ph.speed.toFixed(2), footY: +foot.y.toFixed(3) };
}

export default async function (c) {
  const dir = path.join(c.out, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await c.api('hud', false);
  await c.eval(() => { const s = window.__skate; s.free(); s.release(); s.script([]); s.manual(true); });
  await c.api('teleport', 34.5, 0, 22, 180, 0);
  await c.eval(() => window.__skate.advance(30, 1 / 60, false));
  await c.api('script', [{ at: 0.0, down: ['KeyW'] }, { at: 1.7, up: ['KeyW'] }]);
  const cam = { heading: 180, dist: 2.4, h: 0.7, lookH: 0.62, fov: 46 };
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const r = await c.eval(frame, cam);
    r.frame = i; rows.push(r);
    await c.page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 90 });
  }
  await c.eval(() => { const s = window.__skate; s.release(); s.manual(false); });
  fs.writeFileSync(path.join(c.out, 'frames.json'), JSON.stringify(rows, null, 1));
  spawnSync('python', ['-c', `
import json
from PIL import Image, ImageDraw, ImageFont
rows = json.load(open(r'${path.join(c.out, 'frames.json')}'))
F = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 14)
sel = [r for r in rows if r['frame'] <= 52 and r['frame'] % 2 == 0]
tiles = []
for r in sel:
    im = Image.open(r'${dir}/f%03d.jpg' % r['frame']).convert('RGB')
    w, h = im.size
    im = im.crop((int(w * 0.3), int(h * 0.12), int(w * 0.7), int(h * 0.98))).resize((256, int(256 * h * 0.86 / (w * 0.4))))
    d = ImageDraw.Draw(im); d.rectangle([0, 0, im.width, 38], fill=(0, 0, 0))
    d.text((4, 2), 'f%02d pushT %.3f' % (r['frame'], r['pushT']), fill=(255, 255, 255), font=F)
    d.text((4, 19), 'accel %+.2f m/s2  v %.2f' % (r['accel'], r['speed']), fill=(255, 220, 120) if r['accel'] > 0.1 else (200, 200, 200), font=F)
    tiles.append(im)
cols = 9; tw, th = tiles[0].size; rws = (len(tiles) + cols - 1) // cols
s = Image.new('RGB', (cols * tw + (cols + 1) * 5, rws * th + (rws + 1) * 5 + 26), (24, 24, 28))
ImageDraw.Draw(s).text((6, 5), 'push from standstill, frame-stepped 1/60 s (every 2nd frame); the foot plants at pushT 0.09 when the drive starts', fill=(255, 255, 255), font=F)
for i, t in enumerate(tiles): s.paste(t, (5 + (i % cols) * (tw + 5), 31 + (i // cols) * (th + 5)))
s.save(r'${path.join(c.out, 'push_strip.jpg')}', quality=90)
`], { stdio: 'inherit' });
}
