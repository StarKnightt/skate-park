# Pass 5 c-cam (#76): encode the real-time takes to constant 60 fps, strips every 0.1 s through the wall pass (from the
# per-frame camera log), side-by-side with the critic's frames.  python tools/capture/c_cam_post.py <rt dir> <pass-05 dir>
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

RT, P5 = sys.argv[1], sys.argv[2]
CRIT = 'E:/shots/skate-park/pass-04/critic'
NAMES = {'hp': 'h76_hp_side_wall', 'bowl': 'h76_bowl_wall', 'se': 'needs_autoride_se_pocket'}
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 15)
except OSError:
    FONT = ImageFont.load_default()


def encode(raw, out):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-vf', 'fps=60', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], check=True)


def frames_at(mp4, times, w=384):
    ims = []
    for t in times:
        p = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(0, t):.3f}', '-i', mp4, '-frames:v', '1', '-vf', f'scale={w}:-1',
                            '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True, check=True).stdout
        from io import BytesIO
        ims.append(Image.open(BytesIO(p)).convert('RGB'))
    return ims


def strip(name, mp4, rows, cols, t0, t1, out, title):
    C = {c: i for i, c in enumerate(cols)}
    times = [t0 + 0.1 * k for k in range(int(round((t1 - t0) / 0.1)) + 1)]
    ims = frames_at(mp4, times)
    w, h = ims[0].size
    n = len(ims); per = 6; nr = (n + per - 1) // per
    sheet = Image.new('RGB', (per * w, nr * (h + 18) + 26), (16, 16, 16))
    d = ImageDraw.Draw(sheet)
    d.text((6, 4), title, fill=(255, 230, 120), font=FONT)
    for k, (t, im) in enumerate(zip(times, ims)):
        r = min(rows, key=lambda r: abs(r[C['t']] - t))
        x, y = (k % per) * w, 26 + (k // per) * (h + 18)
        sheet.paste(im, (x, y))
        hy, by = r[C['headY']], r[C['boardY']]
        ok = not r[C['behind']] and hy <= 1 and by >= -1 and abs(r[C['headX']]) <= 1 and abs(r[C['boardX']]) <= 1
        d.text((x + 4, y + h + 1), f"{t:5.2f}s boom {r[C['d']]:.2f}/{r[C['wantD']]:.2f} fov {r[C['fov']]:.0f} {'whole' if ok else 'CROP'}",
               fill=(200, 255, 200) if ok else (255, 120, 120), font=FONT)
    sheet.save(out, quality=88)
    return out


def window(name, rows, cols):
    C = {c: i for i, c in enumerate(cols)}
    if os.environ.get(name.upper() + '_WIN'):  # e.g. BOWL_WIN=9.4,12.4
        a, b = map(float, os.environ[name.upper() + '_WIN'].split(','))
        return a, b
    if name == 'bowl':  # the handoff: from auto-ride resuming, 3 s on (the critic's clip51 f548 moment)
        sus = [r[C['t']] for r in rows if r[C['suspended']]]
        if sus:
            return sus[-1] - 0.2, sus[-1] + 2.8
    ride = [r for r in rows if r[C['mode']] in ('ride', 'air', 'grind')]
    if name == 'hp':  # passing the west quarter pipe's south end face (z = -15, x 16..22)
        near = [r for r in ride if 15.5 < r[C['x']] < 23.5 and -18 < r[C['z']] < -13.5]
        if near:
            return near[0][C['t']] - 0.3, near[-1][C['t']] + 0.3
    # the span where the boom was shortest (most pulled in), 2.4 s around it
    m = min(ride, key=lambda r: r[C['d']] - r[C['wantD']])
    return m[C['t']] - 1.2, m[C['t']] + 1.2


summary = json.load(open(os.path.join(RT, 'summary.json')))
outs = {}
only = os.environ.get('ONLY', '').split(',') if os.environ.get('ONLY') else None
for key, name in NAMES.items():
    raw = os.path.join(RT, key + '_raw.mp4')
    if not os.path.exists(raw) or (only and key not in only):
        continue
    mp4 = os.path.join(P5, 'clips', name + '.mp4')
    if not os.environ.get('NOENC'):
        encode(raw, mp4)
    lg = json.load(open(os.path.join(RT, key + '_log.json')))
    rows, cols = lg['rows'], lg['cols']
    C = {c: i for i, c in enumerate(cols)}
    if key == 'se':
        s = summary.get('se', {})
        t0 = s.get('autoOnAt', 0.5)
        t1 = s.get('backOnLineAt') or rows[-1][0]
        k = max(1, int((t1 - t0) / 16 * 10)) / 10
        times = [t0 + k * i for i in range(16)]
        ims = frames_at(mp4, times, 320)
        w, h = ims[0].size
        sheet = Image.new('RGB', (4 * w, 4 * (h + 18) + 26), (16, 16, 16))
        d = ImageDraw.Draw(sheet)
        d.text((6, 4), f"AUTO-RIDE on behind the SE ledge (15.8, 20.7): back on the line ({s.get('line')}) after {s.get('secsToLine')} s", fill=(255, 230, 120), font=FONT)
        for i, (t, im) in enumerate(zip(times, ims)):
            r = min(rows, key=lambda r: abs(r[C['t']] - t))
            x, y = (i % 4) * w, 26 + (i // 4) * (h + 18)
            sheet.paste(im, (x, y))
            d.text((x + 4, y + h + 1), f"+{t - t0:5.1f}s ({r[C['x']]:.0f},{r[C['z']]:.0f}) {r[C['line']]}", fill=(220, 220, 220), font=FONT)
        outs['se_sheet'] = os.path.join(P5, 'sheets', name + '_sheet.jpg')
        sheet.save(outs['se_sheet'], quality=88)
        outs[key] = mp4
        continue
    t0, t1 = window(key, rows, cols)
    st = summary[key]
    title = f"{name}: real time, auto-ride, every 0.1 s  (take: {st['headOut']} head-out / {st['boardOut']} board-out of {st['rideFrames']} frames, min boom {st['minBoom']} m, max boom step {st['maxBoomStepPerFrame']} m/frame)"
    outs[key + '_strip'] = strip(key, mp4, rows, cols, t0, t1, os.path.join(P5, 'sheets', name + '_strip.jpg'), title)
    outs[key] = mp4
    # side by side: the critic's pass-04 frames on top, the pass-05 strip below
    crit = {'hp': ['c50_tight_legs.jpg'], 'bowl': ['c51_tight_legs.jpg', 'c51_tight_head_cut.jpg']}[key]
    tops = [Image.open(os.path.join(CRIT, c)).convert('RGB') for c in crit]
    bot = Image.open(outs[key + '_strip'])
    W = max([bot.width] + [t.width for t in tops])
    H = sum(t.height + 24 for t in tops) + bot.height + 24
    sbs = Image.new('RGB', (W, H), (16, 16, 16))
    d = ImageDraw.Draw(sbs)
    y = 0
    for c, t in zip(crit, tops):
        d.text((6, y + 4), f'BEFORE (pass 04, critic): {c}', fill=(255, 140, 140), font=FONT)
        sbs.paste(t, (0, y + 24)); y += t.height + 24
    d.text((6, y + 4), 'AFTER (pass 05, real time, same auto-ride moment)', fill=(160, 255, 160), font=FONT)
    sbs.paste(bot, (0, y + 24))
    outs[key + '_sbs'] = os.path.join(P5, 'sheets', name + '_vs_pass04.jpg')
    sbs.save(outs[key + '_sbs'], quality=88)
print(json.dumps(outs, indent=1))
