"""Trim a frame-stepped capture to its first N frames (frames/<clip>/, events.json, meta.json).
python trim_clip.py <pass_dir> <clip> <frames>
"""
import json, os, sys

P, clip, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = os.path.join(P, "frames", clip)
for f in os.listdir(d):
    if f.endswith(".jpg") and int(f[1:5]) >= n:
        os.remove(os.path.join(d, f))
ev = os.path.join(d, "events.json")
if os.path.exists(ev):
    json.dump([e for e in json.load(open(ev)) if e["frame"] < n], open(ev, "w"), indent=1)
mp = os.path.join(d, "meta.json")
if os.path.exists(mp):
    m = json.load(open(mp))
    m["frames"] = n
    m["marks"] = [x for x in m.get("marks", []) if x["frame"] < n]
    json.dump(m, open(mp, "w"), indent=1)
print(clip, "trimmed to", n, "frames")
