"""Contact strips for tools/realtime/dropin_capture.mjs: every frame from 3 before the drop-in starts to 8 after the
hand-over onto the wall, labelled with frame number, drop-in phase, board pitch (+ = leading end up) and time.

usage: python dropin_strip.py OUT_DIR     -> OUT_DIR/<case>_strip.jpg
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 15)
except OSError:
    FONT = ImageFont.load_default()
for case in sorted(os.listdir(out)):
    meta = os.path.join(out, case, 'frames.json')
    if not os.path.exists(meta):
        continue
    d = json.load(open(meta))
    rows = d['rows']
    first = next((r['frame'] for r in rows if r['dropin']), 0)
    hand = next((r['frame'] for r in rows if 'dropIn' in r['e']), rows[-1]['frame'])
    sel = [r for r in rows if first - 3 <= r['frame'] <= hand + 8]
    tiles = []
    for r in sel:
        im = Image.open(os.path.join(out, case, 'f%03d.jpg' % r['frame'])).convert('RGB')
        w, h = im.size
        im = im.crop((int(w * 0.18), int(h * 0.06), int(w * 0.82), int(h * 0.94))).resize((384, int(384 * h * 0.88 / (w * 0.64))))
        dr = ImageDraw.Draw(im)
        dr.rectangle([0, 0, im.width, 22], fill=(0, 0, 0))
        lab = 'f%02d %s pitch %+.0f%s  t %.3f' % (r['frame'], r['dropin'] or ('on wall' if r['frame'] >= hand else 'deck'), r['deckNosePitch'] * (r['lead'] or 1),
                                                   ' deg', r['t'])
        if r['frame'] == hand:
            lab += '  WHEELS ON WALL'
        dr.text((5, 3), lab, fill=(255, 255, 255), font=FONT)
        tiles.append(im)
    cols = 6
    rws = (len(tiles) + cols - 1) // cols
    tw, th = tiles[0].size
    sheet = Image.new('RGB', (cols * tw + (cols + 1) * 6, rws * th + (rws + 1) * 6 + 30), (24, 24, 28))
    ImageDraw.Draw(sheet).text((8, 6), '%s drop-in, frame-stepped 1/%d s, side-on at deck level (pitch: + = leading end up)' % (case, d['fps']), fill=(255, 255, 255), font=FONT)
    for i, t in enumerate(tiles):
        sheet.paste(t, (6 + (i % cols) * (tw + 6), 36 + (i // cols) * (th + 6)))
    p = os.path.join(out, case + '_strip.jpg')
    sheet.save(p, quality=90)
    print(p, len(tiles), 'frames', 'drop-in from f%d, wheels on the wall at f%d' % (first, hand))
