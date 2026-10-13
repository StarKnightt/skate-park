"""Encode frame-stepped captures to MP4 (H.264 30 fps), build labelled contact sheets and export key frames.
python encode.py <pass_dir> [clip ...]
frames/<clip>/meta.json (optional): {"sheetStep": 4, "marks": [{"frame": n, "label": "..."}]}
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
    SMALL = ImageFont.truetype("arial.ttf", 13)
except Exception:
    FONT = SMALL = ImageFont.load_default()

# phase changes logged by media2.mjs (skater phase after a bail) -> frame offset into the phase
PHASE_KEYS = {"lie": 15, "getup": 30, "walk": 12, "stepon": 6}


def keys_for(clip, events):
    keys = []
    bailed = False
    pushes = 0
    for e in events:
        fr, t = e["frame"], e["type"]
        if t == "pop":
            keys += [(fr, "pop"), (fr + 7, "flip_peak" if e.get("flip") else "ollie_peak")]
        elif t == "land":
            keys += [(max(0, fr - 2), "catch"), (fr + 1, "landing")]
            if e.get("quality") in ("wobble", "sketchy"):
                keys += [(fr + 8, "wobble")]
        elif t == "flipDone":
            keys += [(fr, "flip_caught")]
        elif t == "grindStart":
            keys += [(fr + 2, "grind_lockin")]
        elif t == "bail":
            bailed = True
            keys += [(fr + 6, "bail")]
        elif t == "vertAir":
            keys += [(fr + 18, "vert_peak")]
        elif t == "kickturnStart":
            keys += [(fr + 6, "kickturn")]
        elif t == "manualStart":
            keys += [(fr + 30, "manual"), (fr + 90, "manual_late")]
        elif t == "bonk":
            keys += [(fr + 2, "bonk")]
        elif t == "dropinPhase" and e.get("phase") == "stall":
            keys += [(fr + 2, "dropin_tail_on_coping")]
        elif t == "dropinPhase" and e.get("phase") == "pivot":
            keys += [(fr + 3, "dropin_nose_down")]
        elif t == "dropIn":
            keys += [(fr + 4, "dropin_crouch")]
        elif t == "push" and "push" in clip and pushes < 3:
            pushes += 1
            keys += [(fr + 9, "push_plant")]
        elif t == "phase" and bailed:
            ph = e.get("phase")
            if ph in PHASE_KEYS:
                keys += [(fr + PHASE_KEYS[ph], ph)]
            elif ph == "ride":
                keys += [(fr + 10, "ride_again")]
                bailed = False
    return keys


BELOW_NORMAL = 0x00004000
for clip in sorted(os.listdir(FR)):
    if only and clip not in only:
        continue
    d = os.path.join(FR, clip)
    if not os.path.isdir(d):
        continue
    frames = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))
    if not frames:
        continue
    meta = {}
    if os.path.exists(os.path.join(d, "meta.json")):
        meta = json.load(open(os.path.join(d, "meta.json")))
    mp4 = os.path.join(P, "clips", clip + ".mp4")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", os.path.join(d, "f%04d.jpg"), "-c:v", "libx264",
           "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30", "-threads", "4", "-movflags", "+faststart", mp4]
    subprocess.run(cmd, check=True, creationflags=BELOW_NORMAL if os.name == "nt" else 0)
    # contact sheets: every 4th frame (7.5 fps) by default, every 2nd for the fast side-on trick clips
    step = int(meta.get("sheetStep", 4))
    labels = {m["frame"]: m["label"] for m in meta.get("marks", []) if m.get("label")}
    sel = frames[::step]
    tw, th, cols = 320, 180, 6
    per = 48
    for f in list(labels):
        # a segment start that is not on the sheet grid is labelled on the next sheet frame
        if f % step:
            labels[f - f % step + step] = labels.pop(f)
    for old in [x for x in os.listdir(os.path.join(P, "sheets")) if x.startswith(clip + "_sheet")]:
        os.remove(os.path.join(P, "sheets", old))
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
            if idx in labels:
                txt = labels[idx][:44]
                dr.rectangle([x, y + th - 19, x + tw, y + th], fill=(0, 0, 0))
                dr.text((x + 4, y + th - 17), txt, fill=(170, 230, 255), font=SMALL)
        sheet.save(os.path.join(P, "sheets", f"{clip}_sheet{si // per + 1}.jpg"), quality=86)
    # key frames from the event log
    ev_path = os.path.join(d, "events.json")
    keys = keys_for(clip, json.load(open(ev_path))) if os.path.exists(ev_path) else []
    kd = os.path.join(P, "screens", "keyframes")
    for old in [x for x in os.listdir(kd) if x.startswith(clip + "_")]:
        os.remove(os.path.join(kd, old))
    n = 0
    for fr, name in keys:
        src = os.path.join(d, "f%04d.jpg" % fr)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(P, "screens", "keyframes", f"{clip}_{name}_f{fr:03d}.jpg"))
            n += 1
    print(clip, len(frames), "frames ->", os.path.basename(mp4), "sheets step", step, "keys", n)
