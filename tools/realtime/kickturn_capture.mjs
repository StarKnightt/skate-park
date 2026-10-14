// Fakie and forward kickturns on the north quarter pipe, frame-stepped 1/30 s, side-on: frames + a strip of the turn.
//   bash tools/heavy.sh A2 node tools/capture/run.mjs tools/realtime/kickturn_capture.mjs --nohmr --out E:/shots/skate-park/pass-04/feel/kickturn
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function frame(cam) {
  const s = window.__skate, g = s.game, V = g.physics.pos.constructor, ph = g.physics;
  s.advance(1, 1 / 30, false);
  const look = new V(ph.pos.x, ph.pos.y + 0.7, -18.3), pos = new V(ph.pos.x + cam.side, 1.1, -16.2);
  if (Math.abs(g.camera.fov - 50) > 0.01) { g.camera.fov = 50; g.camera.updateProjectionMatrix(); }
  s.view(pos.x, pos.y, pos.z, look.x, look.y, look.z);
  g.render(1 / 30);
  const e = g.eventLog.slice(); g.eventLog.length = 0;
  return { kt: +ph.kickturn.t.toFixed(3), fakie: ph.fakie, e: e.map((x) => x.type), speed: +ph.speed.toFixed(2) };
}

export default async function (c) {
  await c.api('hud', false);
  const all = [];
  for (const cs of [{ name: 'fakie', at: [-3, 0, -15.5, 0, 0], fakie: true, side: 3.2 }, { name: 'forward', at: [-8, 0, -15.5, 180, 4.8], side: 3.2 }]) {
    const dir = path.join(c.out, cs.name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await c.eval(() => { const s = window.__skate; s.free(); s.release(); s.script([]); s.manual(true); s.events(); });
    await c.api('teleport', ...cs.at);
    if (cs.fakie) await c.eval(() => { const ph = window.__skate.game.physics; ph.vel.copy(ph.fwd).multiplyScalar(-4.8); ph.fakie = true; });
    const rows = [];
    for (let i = 0; i < 75; i++) {
      const r = await c.eval(frame, cs);
      r.frame = i; rows.push(r);
      await c.page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 90 });
    }
    fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(rows, null, 1));
    const ks = rows.filter((r) => r.kt >= 0);
    console.log(cs.name, 'kickturn frames', ks.length ? `${ks[0].frame}-${ks[ks.length - 1].frame}` : 'none', 'fakie during', [...new Set(ks.map((r) => r.fakie))].join(','));
    all.push({ name: cs.name, frames: ks.map((r) => r.frame) });
  }
  await c.eval(() => window.__skate.manual(false));
  fs.writeFileSync(path.join(c.out, 'turns.json'), JSON.stringify(all));
  spawnSync('python', ['-c', `
import json
from PIL import Image, ImageDraw, ImageFont
F = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 14)
for t in json.load(open(r'${path.join(c.out, 'turns.json')}')):
    fr = t['frames']
    if not fr: continue
    sel = list(range(max(0, fr[0] - 2), fr[-1] + 3, 2))
    tiles = []
    for i in sel:
        im = Image.open(r'${c.out}/%s/f%03d.jpg' % (t['name'], i)).convert('RGB')
        w, h = im.size
        im = im.crop((int(w * 0.25), int(h * 0.1), int(w * 0.75), int(h * 0.95))).resize((300, int(300 * h * 0.85 / (w * 0.5))))
        d = ImageDraw.Draw(im); d.rectangle([0, 0, im.width, 20], fill=(0, 0, 0)); d.text((4, 2), '%s f%02d%s' % (t['name'], i, ' kickturn' if i in fr else ''), fill=(255, 255, 255), font=F)
        tiles.append(im)
    tw, th = tiles[0].size; cols = min(8, len(tiles)); rows = (len(tiles) + cols - 1) // cols
    s = Image.new('RGB', (cols * tw + (cols + 1) * 5, rows * th + (rows + 1) * 5), (24, 24, 28))
    for i, im in enumerate(tiles): s.paste(im, (5 + (i % cols) * (tw + 5), 5 + (i // cols) * (th + 5)))
    s.save(r'${c.out}/%s_strip.jpg' % t['name'], quality=90)
`], { stdio: 'inherit' });
}
