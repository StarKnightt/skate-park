"""Pass-4 media (M1): key frames encode.py can't pick. Run after encode.py, before the raw frames are deleted.
python media4_keys.py <pass_dir>
- drop-in nose down: encode.py takes pivot+3, but the pass-4 pivot lasts ~13 frames (pass 3: ~4), so the nose is still
  up there; replaced by pivot+9 (nose down, front wheels at the wall; the frame of the h65 / h72 nose_down stills).
- hand-picked follow-camera frames (as in pass 3): clip22 / clip35 in the bowl, clip34 over the quarter-pipe / bank join.
"""
import json, os, shutil, sys

P = sys.argv[1]
FR, KD = os.path.join(P, "frames"), os.path.join(P, "screens", "keyframes")
PICK = {
    "clip22_bowl_carve_follow": [(45, "bowl_follow"), (75, "bowl_follow"), (110, "bowl_follow")],
    "clip35_bowl_follow_high_carve": [(40, "bowl_follow"), (88, "bowl_follow"), (176, "bowl_follow")],
    "clip34_north_qp_bank_join_follow": [(44, "join_east"), (116, "join_west"), (184, "up_the_hip")],
}
for clip in sorted(os.listdir(FR)):
    d = os.path.join(FR, clip)
    ev_path = os.path.join(d, "events.json")
    if not os.path.isfile(ev_path):
        continue
    keys = list(PICK.get(clip, []))
    for e in json.load(open(ev_path)):
        if e["type"] == "dropinPhase" and e.get("phase") == "pivot":
            for old in [x for x in os.listdir(KD) if x.startswith(clip + "_dropin_nose_down_")]:
                os.remove(os.path.join(KD, old))
            keys.append((e["frame"] + 9, "dropin_nose_down"))
    for fr, name in keys:
        src = os.path.join(d, "f%04d.jpg" % fr)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(KD, f"{clip}_{name}_f{fr:03d}.jpg"))
            print(clip, name, fr)
