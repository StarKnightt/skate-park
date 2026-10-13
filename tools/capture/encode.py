"""Encode frame-stepped captures to MP4 (H.264 30 fps), build labelled contact sheets and export key frames.
python encode.py <pass_dir> [clip ...]
"""
import json, os, shutil, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

P = sys.argv[1]
only = set(sys.argv[2:])
FR = os.path.join(P, "frames")
os.makedirs(os.path.join(P, "clips"), exist_ok=True)
os.makedirs(os.path.join(P, "sheets"), exist_ok=True)
os.makedirs(os.path.join(P, "screens", "keyframes"), exist_ok=True)
try:
    FONT = ImageFont.truetype("arialbd.ttf", 15)
except Exception:
    FONT = ImageFont.load_default()

BELOW_NORMAL = 0x00004000
for clip in sorted(os.listdir(FR)):
    if only and clip not in only:
        continue
    d = os.path.join(FR, clip)
    frames = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))
    if not frames:
        continue
    mp4 = os.path.join(P, "clips", clip + ".mp4")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", os.path.join(d, "f%04d.jpg"), "-c:v", "libx264",
           "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart", mp4]
    subprocess.run(cmd, check=True, creationflags=BELOW_NORMAL if os.name == "nt" else 0)
    # contact sheet: ~7.5 fps
    step = 4
    sel = frames[::step]
    tw, th, cols = 320, 180, 6
    per = 48
    for si in range(0, len(sel), per):
        chunk = sel[si:si + per]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, rows * th), (20, 18, 22))
        dr = ImageDraw.Draw(sheet)
        for k, f in enumerate(chunk):
            im = Image.open(os.path.join(d, f)).convert("RGB").resize((tw, th), Image.LANCZOS)
            x, y = (k % cols) * tw, (k // cols) * th
            sheet.paste(im, (x, y))
            idx = int(f[1:5])
            label = "f%03d  %.2fs" % (idx, idx / 30)
            dr.rectangle([x, y, x + 112, y + 19], fill=(0, 0, 0))
            dr.text((x + 4, y + 2), label, fill=(255, 235, 200), font=FONT)
        sheet.save(os.path.join(P, "sheets", f"{clip}_sheet{si // per + 1}.jpg"), quality=86)
    # key frames from the event log
    ev_path = os.path.join(d, "events.json")
    keys = []
    if os.path.exists(ev_path):
        for e in json.load(open(ev_path)):
            fr, t = e["frame"], e["type"]
            if t == "pop":
                keys += [(fr, "pop"), (fr + 7, "flip_peak" if e.get("flip") else "ollie_peak")]
            elif t == "land":
                keys += [(max(0, fr - 2), "catch"), (fr + 1, "landing")]
            elif t == "grindStart":
                keys += [(fr + 2, "grind_lockin")]
            elif t == "bail":
                keys += [(fr + 6, "bail")]
            elif t == "vertAir":
                keys += [(fr + 18, "vert_peak")]
    for fr, name in keys:
        src = os.path.join(d, "f%04d.jpg" % fr)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(P, "screens", "keyframes", f"{clip}_{name}_f{fr:03d}.jpg"))
    print(clip, len(frames), "frames ->", os.path.basename(mp4), "keys", len(keys))
