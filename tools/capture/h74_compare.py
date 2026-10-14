# Pass-5 c-trick (#74): side-by-side of the rolling-F kickflip, pass-04 (rt_feat_f_flips, critic's ff_kickflip_quickpop.jpg)
# vs pass-05 (h74_f_flips_pro), aligned on the pop, 2-frame steps, same crop.
#   bash tools/heavy.sh c-trick python tools/capture/h74_compare.py
import json, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont

P4, P5 = 'E:/shots/skate-park/pass-04', 'E:/shots/skate-park/pass-05'
FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 15)
FONT_T = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 21)
W, H = 1280, 720
CROP = (440, 150, 840, 650)
TH = 200
TW = int((CROP[2] - CROP[0]) * TH / (CROP[3] - CROP[1]))


def frames(src, idx):
    lo, hi = min(idx), max(idx)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', f"select='between(n,{lo},{hi})'", '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    n = len(raw) // (W * H * 3)
    a = np.frombuffer(raw[:n * W * H * 3], np.uint8).reshape(n, H, W, 3)
    return {lo + i: a[i] for i in range(n)}


m = json.load(open(f'{P5}/dev/c-trick/h74_measure.json'))['pro'][0]
rows = [
    ('pass-04  rt_feat_f_flips.mp4  (F while rolling: no crouch, pop f063, catch ~f076, charge 0.35, air 0.438 s, pop->catch 0.275 s)',
     f'{P4}/clips/rt_feat_f_flips.mp4', 63, None),
    (f"pass-05  h74_f_flips_pro.mp4  (F while rolling: wind-up f{m['f_windup']:03d}-f{m['f_pop'] - 1:03d}, pop f{m['f_pop']:03d}, catch f{m['f_catch']:03d}, land f{m['f_land']:03d}; charge {m['charge']}, air {m['air']} s, pop->catch {m['popToCatch']} s)",
     f'{P5}/clips/h74_f_flips_pro.mp4', m['f_pop'], m),
]
rel = list(range(-10, 36, 2))
sheet = Image.new('RGB', (len(rel) * TW // 2 + 4, 44 + len(rows) * (TH // 1 + 46) + 10), (24, 24, 24))
# two tile rows per clip (half the frames each) keep the sheet readable
cols = len(rel) // 2 + len(rel) % 2
sheet = Image.new('RGB', (cols * TW + 4, 44 + len(rows) * (2 * TH + 52)), (24, 24, 24))
d = ImageDraw.Draw(sheet)
d.text((6, 10), '#74 rolling F kickflip, side-on, real time 60 fps: pass-04 (critic ff_kickflip_quickpop) vs pass-05, aligned on the pop, 2-frame steps',
       font=FONT_T, fill=(255, 255, 255))
y = 44
for title, src, pop, meas in rows:
    fr = frames(src, [pop + r for r in rel])
    d.text((6, y + 2), title, font=FONT, fill=(255, 211, 77))
    y += 22
    for j, r in enumerate(rel):
        n = pop + r
        if n not in fr: continue
        im = Image.fromarray(fr[n]).crop(CROP).resize((TW, TH), Image.LANCZOS)
        di = ImageDraw.Draw(im)
        if meas:
            ph = 'rolling' if n < meas['f_windup'] else 'crouch' if n < meas['f_pop'] else 'pop' if n == meas['f_pop'] else 'air' if n < meas['f_land'] else 'landed'
        else:
            ph = 'stands tall' if n < pop else 'pop' if n == pop else 'air/catch' if n <= pop + 13 else 'air (feet on)' if n < pop + 26 else 'landed'
        di.rectangle([0, 0, TW, 19], fill=(0, 0, 0))
        di.text((4, 2), f'f{n:03d}  {r / 60:+.2f}s  {ph}', font=FONT, fill=(255, 255, 255))
        sheet.paste(im, (2 + (j % cols) * TW, y + (j // cols) * (TH + 2)))
    y += 2 * TH + 30
out = f'{P5}/sheets/h74_kickflip_p4_vs_p5_strip.jpg'
sheet.save(out, quality=88)
# the critic's own sheet next to the pass-05 sheet at the same height
crit = Image.open(f'{P4}/critic/ff_kickflip_quickpop.jpg')
mine = Image.open(out)
hh = 760
a = crit.resize((int(crit.width * hh / crit.height), hh), Image.LANCZOS)
b = mine.resize((int(mine.width * hh / mine.height), hh), Image.LANCZOS)
sb = Image.new('RGB', (a.width + b.width + 12, hh + 36), (24, 24, 24))
dd = ImageDraw.Draw(sb)
dd.text((6, 8), 'left: critic pass-04 ff_kickflip_quickpop.jpg (f046-f082)   |   right: pass-05 h74_kickflip_p4_vs_p5_strip.jpg', font=FONT_T, fill=(255, 255, 255))
sb.paste(a, (0, 36)); sb.paste(b, (a.width + 12, 36))
sb.save(f'{P5}/sheets/h74_kickflip_side_by_side_vs_critic.jpg', quality=88)
print('wrote', out, f'{P5}/sheets/h74_kickflip_side_by_side_vs_critic.jpg')
