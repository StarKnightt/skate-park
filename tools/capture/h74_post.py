# Pass-5 c-trick (#74): sync the h74_clips.mjs frame logs to the canvas recordings (teleport frame), measure crouch
# frames / air per pop from the log, encode the captioned 60 fps clips, 1-frame strips and the side-by-side vs pass-04.
#   bash tools/heavy.sh c-trick python tools/capture/h74_post.py
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

P5 = 'E:/shots/skate-park/pass-05'
DEV, CLIPS, SHEETS = f'{P5}/dev/c-trick', f'{P5}/clips', f'{P5}/sheets'
os.makedirs(SHEETS, exist_ok=True)
FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 15)
FONT_S = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 13)
FONT_T = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 20)
W, H = 1280, 720


def decode(src, gray=True, scale=None):
    vf = 'fps=60' + (f',scale={scale[0]}:{scale[1]}' if scale else '')
    w, h = scale or (W, H)
    pix, ch = ('gray', 1) if gray else ('rgb24', 3)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', pix, '-'], capture_output=True).stdout
    n = len(raw) // (w * h * ch)
    a = np.frombuffer(raw[:n * w * h * ch], np.uint8)
    return a.reshape(n, h, w) if gray else a.reshape(n, h, w, 3)


def dtext(text, x, y, a=None, b=None, size=28, color='white', box='black@0.55'):
    t = str(text).replace("'", ' ').replace(':', ' ').replace('\\', ' ').replace('%', ' ')
    en = '' if a is None else f":enable='between(t,{a:.3f},{b:.3f})'"
    return f"drawtext=fontfile=arialbd.ttf:text='{t}':x={x}:y={y}:fontsize={size}:fontcolor={color}:box=1:boxcolor={box}:boxborderw=8{en}"


def process(name, title, out_clip):
    log = json.load(open(f'{DEV}/h74_{name}_log.json'))
    raw = log['rawFile']
    fr = log['frames']  # [perf, mode, x, y, z, hip, crouchS, sim]
    g = decode(raw, scale=(320, 180)).astype(np.int16)
    diffs = np.abs(g[1:] - g[:-1]).mean(axis=(1, 2))
    # sync: the teleport (camera jumps 45 m) is the biggest frame change in the first 1.5 s
    lim = min(len(diffs), 90)
    n_sync = int(np.argmax(diffs[:lim])) + 1
    first = next(f for f in fr if f[0] > log['sync'] and abs(f[4] - 23.5) < 3)
    off = n_sync / 60 - (first[0] - log['recT0']) / 1000
    vt = lambda perf: (perf - log['recT0']) / 1000 + off
    vf = lambda perf: int(round(vt(perf) * 60))
    print(name, 'sync video frame', n_sync, 'diff', round(float(diffs[n_sync - 1]), 1), 'offset vs recorder start event', round(off, 3), 's')
    ev = log['ev']
    pops = [e for e in ev if e['type'] == 'pop']
    rows = []
    for p in pops:
        wu = [e for e in ev if e['type'] == 'windup' and e['wall'] <= p['wall'] and p['wall'] - e['wall'] < 0.5 * 1000]
        land = next((e for e in ev if e['type'] == 'land' and e['wall'] > p['wall']), None)
        done = next((e for e in ev if e['type'] == 'flipDone' and e['wall'] > p['wall'] and (not land or e['wall'] <= land['wall'])), None)
        flip = next((e for e in ev if e['type'] == 'flip' and e['wall'] >= p['wall'] - 1 and (not land or e['wall'] <= land['wall'])), None)
        w0 = wu[-1]['wall'] if wu else p['wall']
        base = [f for f in fr if w0 - 250 < f[0] < w0 - 30]
        hip0 = float(np.median([f[5] for f in base])) if base else fr[0][5]
        y0 = float(np.median([f[3] for f in base])) if base else 0
        cr = [f for f in fr if w0 <= f[0] < p['wall']]
        drops = [round((hip0 - f[5]) * 100, 1) for f in cr]
        vis = sum(1 for d in drops if d >= 3)
        popf = next(f for f in fr if f[0] >= p['wall'])
        crouchMax = max(drops) if drops else 0
        air = [f for f in fr if p['wall'] <= f[0] < (land['wall'] if land else p['wall'] + 600) and f[1] == 'air']
        peak = max((f[3] - y0 for f in air), default=0)
        rows.append(dict(name=name, flip=(flip or {}).get('kind') or ('ollie' if not flip else None), windup=bool(wu), charge=round(p.get('charge', 0), 2),
            crouchFrames=len(cr), crouchVisible3cm=vis, hipDropCm=drops, hipDropAtPop=round((hip0 - popf[5]) * 100, 1), crouchMaxCm=crouchMax,
            windupToPop_ms=round(p['wall'] - w0), popToCatch=round((done['sim'] - p['sim']), 3) if done else None,
            air=round(land['sim'] - p['sim'], 3) if land else None, airFrames=len(air), boardPeakCm=round(peak * 100, 1), land=(land or {}).get('quality'),
            f_windup=vf(w0), f_pop=vf(p['wall']), f_catch=vf(done['wall']) if done else None, f_land=vf(land['wall']) if land else None))
    # ---- clip with captions
    end = len(g) / 60
    vfl = [dtext(title, 'w-tw-18', 16, size=19, color='white@0.85', box='black@0.45')]
    k0 = vt(log['sync']) + 0.5  # keys started 0.5 s after the sync call (approx; the key viewer uses the real key log)
    for t, l in log['labels']:
        kt = next((vt(k[0]) for k in log['keys'] if k[1] == 1 and abs(vt(k[0]) - (k0 + t)) < 0.4), k0 + t)
        vfl.append(dtext(l, 20, 16, kt - 0.15, kt + 1.5, size=30))
    for e in ev:
        if e['type'] == 'windup': vfl.append(dtext('(game) wind-up crouch', 20, 62, vt(e['wall']), vt(e['wall']) + 0.25, size=24, color='0x9BE8FF'))
        if e['type'] == 'pop': vfl.append(dtext(f"(game) pop {e.get('flip') or 'ollie'}", 20, 102, vt(e['wall']), vt(e['wall']) + 0.6, size=24, color='0xFFD34D'))
        if e['type'] == 'land': vfl.append(dtext(f"(game) land {e.get('quality', '')}", 20, 142, vt(e['wall']), vt(e['wall']) + 0.8, size=24))
        if e['type'] == 'bail': vfl.append(dtext('BAIL', 20, 142, vt(e['wall']), vt(e['wall']) + 1.5, size=30, color='0xFF5050'))
    # key viewer
    label = {'KeyW': 'W', 'KeyA': 'A', 'KeyS': 'S', 'KeyD': 'D', 'Space': 'Space', 'KeyF': 'F'}
    x = 20
    for c in ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF']:
        L = label[c]
        vfl.append(dtext(L, x, 'h-58', size=26, color='white@0.45', box='black@0.35'))
        down = None
        for t, d, code in log['keys']:
            if code != c: continue
            if d and down is None: down = vt(t)
            elif not d and down is not None: vfl.append(dtext(L, x, 'h-58', down, max(vt(t), down + 0.1), size=26, color='0x1a1a1a', box='0xFFD34D@0.95')); down = None
        x += 30 + 15 * len(L) if len(L) > 1 else 46
    flt = os.path.join(DEV, f'h74_{name}_vf.txt')
    open(flt, 'w').write('fps=60,' + ','.join(vfl) + ',format=yuv420p')
    r = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-filter_script:v', flt, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
                        '-threads', '4', '-movflags', '+faststart', out_clip], cwd='C:/Windows/Fonts')
    print('encoded', out_clip, r.returncode)
    return log, rows, vf


def tile(img, lab1, lab2, lab3=None, col=(255, 211, 77)):
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, img.width, 20], fill=(0, 0, 0))
    d.text((4, 2), lab1, font=FONT, fill=col)
    d.rectangle([0, img.height - 34, img.width, img.height], fill=(0, 0, 0))
    d.text((4, img.height - 33), lab2, font=FONT_S, fill=(255, 255, 255))
    if lab3: d.text((4, img.height - 17), lab3, font=FONT_S, fill=(155, 232, 255))
    return img


def build_strip(name, title, log, rows, vfun, out_prefix, crop=(440, 150, 840, 650), th=250):
    full = decode(log['rawFile'], gray=False)
    fr = log['frames']
    hipBase = {}
    outs = []
    for i, row in enumerate(rows):
        a, p, l = row['f_windup'], row['f_pop'], row['f_land']
        c = row['f_catch']
        hip0 = fr[0][5]
        base = [f for f in fr if 0 < (a - vfun(f[0])) <= 12]
        hip0 = float(np.median([f[5] for f in base])) if base else hip0
        y0 = float(np.median([f[3] for f in base])) if base else 0
        groups = [('wind-up crouch -> pop (1 frame steps)', list(range(a - 2, p + 5))),
                  ('air (2 frame steps)', list(range(p + 6, l - 6, 2))),
                  ('catch -> landing -> absorb (1 frame steps)', list(range(l - 6, l + 6)))]
        tw = int((crop[2] - crop[0]) * th / (crop[3] - crop[1]))
        ncol = max(len(gr[1]) for gr in groups)
        sheet = Image.new('RGB', (ncol * tw + 4, 40 + len(groups) * (th + 22)), (24, 24, 24))
        d = ImageDraw.Draw(sheet)
        ttl = f"{title}  |  {row['flip']}  |  wind-up {row['windupToPop_ms']} ms = {row['crouchFrames']} frames (hips down >= 3 cm in {row['crouchVisible3cm']}, {row['hipDropAtPop']} cm at the pop)  |  air {row['air']} s, pop->catch {row['popToCatch']} s, board peak {row['boardPeakCm']} cm  |  {row['land']}"
        d.text((6, 8), ttl, font=FONT_T if len(ttl) < 150 else FONT, fill=(255, 255, 255))
        y = 40
        for gname, idx in groups:
            d.text((6, y + 2), gname, font=FONT, fill=(255, 211, 77))
            y += 20
            for j, n in enumerate(idx):
                if n < 0 or n >= len(full): continue
                im = Image.fromarray(full[n]).crop(crop).resize((tw, th), Image.LANCZOS)
                st = min(fr, key=lambda f: abs(vfun(f[0]) - n))
                ph = 'crouch' if a <= n < p else ('pop' if n == p else ('air' if st[1] == 'air' else st[1]))
                lab3 = f"hips {(hip0 - st[5]) * 100:+.0f} cm down" if n <= p + 1 else f"board {(st[3] - y0) * 100:.0f} cm up"
                tile(im, f'f{n:04d}  {ph}', f'{(n - p) / 60:+.3f} s from pop', lab3)
                sheet.paste(im, (2 + j * tw, y))
            y += th + 2
        fn = f'{SHEETS}/{out_prefix}_{i + 1}_{row["flip"]}_strip.jpg'
        sheet.save(fn, quality=88)
        outs.append(fn)
    return outs


def main():
    meas = {}
    for name, title, clip in [('pro', 'PRO  |  pass-05 #74 quick pop  |  real time 60 fps canvas capture  |  side-on camera', f'{CLIPS}/h74_f_flips_pro.mp4'),
                              ('easy', 'EASY  |  pass-05 #74 tap ollie + F  |  real time 60 fps canvas capture  |  side-on camera', f'{CLIPS}/h74_easy_ollie_flips.mp4')]:
        if not os.path.exists(f'{DEV}/h74_{name}_log.json'): continue
        log, rows, vfun = process(name, title, clip)
        meas[name] = rows
        for r in rows: print(json.dumps({k: v for k, v in r.items() if k != 'hipDropCm'}), 'hipDrop', r['hipDropCm'])
        build_strip(name, name.upper(), log, rows, vfun, f'h74_{name}')
    json.dump(meas, open(f'{DEV}/h74_measure.json', 'w'), indent=1)


main()
