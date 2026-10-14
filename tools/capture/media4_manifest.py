"""Pass-4 media (M1): write <pass>/m1_manifest.md (every file with a one-line description, pass-03/index.md style).
python media4_manifest.py <pass_dir>   (after encode.py + media4_keys.py; reads frames/<clip>/ or, once the raw frames are
deleted, the events.json / meta.json copies in <pass>/dev/m1/frames_meta/<clip>/)
Descriptions: pass-03 twins reuse pass-03/index.md lines; new files from NEW below; clips get their event frames from
events.json; the "no longer matches" notes are <pass>/dev/m1/manifest_notes.md (hand-written, appended verbatim).
"""
import json, os, re, sys

P = sys.argv[1]
P3 = os.path.join(os.path.dirname(P.rstrip("/\\")), "pass-03", "index.md")
HERE = os.path.dirname(os.path.abspath(__file__))
old = {}
for line in open(P3, encoding="utf8"):
    m = re.match(r"- `((?:screens|clips|sheets)/[^`]+)` - (.*)", line.strip())
    if m:
        old[m.group(1)] = m.group(2)

NEW = {
    "b_5050_noon": "50-50 on the long ledge at noon, follow camera (b_5050 recipe and camera): grip in the brightest sun (#68)",
    "b_manual_noon": "manual 1 s in at noon (b_manual recipe and camera): sunlit nose half of the deck (#68)",
    "h68_b_5050_golden": "#68: the critic's b_5050 frame re-shot (same as b_5050.png): grip on the sunlit nose at golden hour",
    "h68_b_5050_noon": "#68: the same at noon (same as b_5050_noon.png)",
    "h68_b_manual_golden": "#68: the critic's b_manual frame re-shot (same as b_manual.png): sunlit and shaded halves of one deck",
    "h68_b_manual_noon": "#68: the same at noon (same as b_manual_noon.png)",
    "h68_g_backlight_golden_close": "#68: the critic's g_backlight_golden_close frame re-shot (same as g_backlight_golden_close.png)",
    "h68_grip_kickflip_sunlit": "#68: mid-kickflip, grip facing the camera in direct golden sun (same as h64_grip_kickflip_sunlit.png)",
    "h68_compare_pass03_vs_pass04_grip_sun": "#68: helper F's composite (F's 04:33 capture): pass-03 vs pass-04 grip in sun, same cameras, with median RGB",
    "h69_kiosk_town_side_blue_hour": "#69: kiosk from the town side at blue hour (critic's h58 camera; same as h58_kiosk_town_side_blue_hour.png)",
    "h69_kiosk_window_oblique_blue_hour": "#69: the service window at an angle, blue hour (same as h58_kiosk_window_oblique_blue_hour.png)",
    "h69_kiosk_window_close_blue_hour": "#69: the service window close, blue hour (same as h58_kiosk_window_close_blue_hour.png)",
    "h69_compare_pass03_vs_pass04_kiosk_blue_hour": "#69: helper F's composite: pass-03 vs pass-04 kiosk at blue hour, same cameras",
    "h69_compare_dark_masks_kiosk_blue_hour": "#69: helper F's composite: pixels darker than 18/255 painted magenta, pass-03 vs pass-04 (share of frame printed)",
    "h70_west_steps_hunch_above": "#70: the critic's h60_west_steps_hunch_above frame re-shot (same file): the board lying on the west steps",
    "h70_west_steps_board_above": "#70: the west-steps board from above (h60_west_steps_above camera)",
    "h70_west_steps_board_close": "#70: the west-steps board close, from the front: grip, edge, wheels",
    "h70_north_deck_skater_board": "#70: the north-deck NPC skater's board beside his feet (clip34's background skater), ~2.5 m",
    "h70_north_deck_skater_board_close": "#70: the same board closer (~1.5 m)",
    "h70_hp_deck_skater_board": "#70: the half-pipe deck skater's board leaning on the railing",
    "h70_compare_pass03_vs_pass04_background_boards": "#70: helper F's composite: pass-03 vs pass-04 background boards",
    "h71_north_deck_skater_face_3m": "#71: the north-deck skater from ~3 m (critic's h59 frame re-shot; same as h59_north_deck_skater_face_3m.png): hair rim under the cap",
    "h71_kiosk_vendor_3m": "#71: the kiosk vendor from ~3.4 m (same as h59_kiosk_vendor_3m.png)",
    "h71_shore_walker_face_3m": "#71: the shore walker from ~3 m (same as h59_shore_walker_face_3m.png): blonde fringe",
    "h71_bush_xclose_town_scrub": "#71: the town scrub bush, extreme close-up (critic's frame re-shot; same as h57_bush_xclose_town_scrub.png): leaf edges",
    "h71_compare_pass03_vs_pass04_hair_3x": "#71: helper F's composite: hair edges pass-03 vs pass-04 at 3x",
    "h71_compare_pass03_vs_pass04_leaf_edges": "#71: helper F's composite: leaf-card edges pass-03 vs pass-04",
    "h72_dropin_bowl_setup_nose_up": "#72: bowl drop-in set-up, side-on at deck level: tail on the coping, nose up (clip29, stall frame 3; same frame as h65_dropin_tail_on_coping)",
    "h72_dropin_bowl_pivot_level": "#72: bowl drop-in, the nose passing level as the front foot drives it down (clip29, pivot frame 5)",
    "h72_dropin_bowl_nose_down": "#72: bowl drop-in, nose down onto the wall (clip29, pivot frame 10; same frame as h65_dropin_nose_down)",
    "h72_dropin_bowl_wheels_on_wall": "#72: bowl drop-in, all four wheels on the wall (clip29, the dropIn frame)",
    "h72_dropin_bowl_crouch": "#72: bowl drop-in, crouched on the wall (clip29, dropIn+5; same frame as h65_dropin_crouch_on_wall)",
    "h72_dropin_bowl_floor_pivot": "#72: the bowl drop-in pivot seen from the bowl floor (clip30, pivot frame 5)",
    "h72_dropin_halfpipe_setup_nose_up": "#72: half-pipe drop-in set-up, side-on at deck level: tail on the coping, nose up (clip41, stall frame 3)",
    "h72_dropin_halfpipe_pivot_level": "#72: half-pipe drop-in, the nose passing level (clip41, pivot frame 5)",
    "h72_dropin_halfpipe_nose_down": "#72: half-pipe drop-in, nose down onto the wall (clip41, pivot frame 10)",
    "h72_dropin_halfpipe_wheels_on_wall": "#72: half-pipe drop-in, wheels on the wall (clip41, the dropIn frame)",
    "h72_dropin_halfpipe_crouch": "#72: half-pipe drop-in, crouched on the wall (clip41, dropIn+5)",
    "h72_dropin_strip_bowl_A2": "#72: helper A2's frame strip of the bowl drop-in (feel/dropin, side-on deck level, every frame of the set-up and pivot)",
    "h72_dropin_strip_halfpipe_A2": "#72: helper A2's strip of the half-pipe drop-in",
    "h72_dropin_strip_halfpipe_fakie_A2": "#72: helper A2's strip of the fakie half-pipe drop-in",
    "h73_bush_xclose_flowering_side": "#73: the critic's h57_bush_xclose_flowering_side frame re-shot (same file): agaves in the bottom-right corner",
    "h73_agave_corner_2x": "#73: bottom-right corner of h73_bush_xclose_flowering_side (x 800-1280, y 450-720) at 2x nearest: agave blades",
    "h73_compare_pass03_vs_pass04_agave": "#73: helper F's composite: agave blades pass-03 vs pass-04",
    "n_funbox_kickflip_peak": "kickflip off the funbox's west edge at pop+6, side-on (clip38)",
    "n_bank_kickflip_peak": "kickflip off the terrace bank at pop+6, side-on (clip40)",
    "n_funbox_heelflip_peak": "heelflip off the funbox's west edge at pop+6, side-on (clip39)",
    "n_carve_from_floor_f124": "the clip31 carve along the south wall from the bowl floor, level with him (clip31 f124; pass-3 twins were f087-f132)",
    "n_carve_from_floor_f139": "the clip31 carve along the south wall from the bowl floor, level with him (clip31 f139; pass-3 twins were f087-f132)",
    "n_carve_from_floor_f154": "the clip31 carve along the south wall from the bowl floor, level with him (clip31 f154; pass-3 twins were f087-f132)",
    "n_carve_from_floor_f169": "the clip31 carve along the south wall from the bowl floor, level with him (clip31 f169; pass-3 twins were f087-f132)",
    "h68_manual_board_height_sun_f036": "#68: manual in direct golden sun at board height from behind the tail, nose up (clip42 f036)",
    "h68_manual_board_height_sun_f066": "#68: the same manual 1 s later (clip42 f066)",
}
CLIPS = {
    "clip01_push_carve_bowl": "follow cam: pushes, drops into the main bowl (new nose-up set-up), carves, kickturns",
    "clip02_flatground_flips": "follow cam: ollie, kickflip, heelflip, pop shove-it, tre flip (F + D / S / W), rides on past the lamp",
    "clip04_grinds_5050_boardslide": "follow cam: 50-50 down the stair handrail, then a boardslide on the funbox flat bar",
    "clip07_bail_and_get_up": "follow cam: rides into the half-pipe mural wall, wall bail, board rests, get-up, walks back, steps on, rides away",
    "clip09_camera_orbit_idle": "15 s orbit around the on-board idle with fidgets",
    "clip10_grinds_trucks_side": "side-on close-ups at truck height: 50-50 on the long ledge, boardslide on the flat bar along and across the bar, 50-50 down the handrail",
    "clip12_ollie_side": "side-on: full-crouch ollie, then a quick ollie",
    "clip13_kickflip_side": "side-on: kickflip x2 (crouch + F)",
    "clip14_heelflip_side": "side-on: heelflip x2 (crouch + D+F)",
    "clip15_shuvit_side": "side-on: pop shove-it x2 (crouch + S+F)",
    "clip16_push_side": "side-on push cycle from rest, feet in frame",
    "clip17_vert_air_close": "close follow of the half-pipe vert airs, then kickturns",
    "clip20_people_motion": "people in motion: boardwalk walker, waver, beach couple + shore-path walker, shore walker, lifeguard, west-steps pair, half-pipe deck skater, town-path walker",
    "clip21_palms_breeze": "palm crowns in the breeze: from below at the boardwalk end, close at the west edge",
    "clip22_bowl_carve_follow": "follow cam carve in the main bowl at head height behind him, kickturn on the east wall (#67)",
    "clip23_wall_bail_close": "closer side camera on the wall bail: impact, snap back, board rests, get-up, walk back, ride away",
    "clip24_manual_side": "side-on manual: weight back, nose up, corrections",
    "clip25_sketchy_landing_side": "side-on sketchy landing (A/D spin in the air): wobble",
    "clip26_kickflip_board_height": "#44: kickflip at board height, side-on, then front quarter 35 deg; HUD off",
    "clip27_heelflip_board_height": "#44: heelflip at board height, side-on, then front quarter; HUD off",
    "clip28_shuvit_board_height": "#44: pop shove-it at board height, side-on, then front quarter; HUD off",
    "clip29_dropin_side_deck": "#65/#72: drop-in into the main bowl from the east deck, side-on at deck level; HUD off",
    "clip30_dropin_bowl_floor": "#65/#72: the same drop-in seen from the bowl floor; HUD off",
    "clip31_carve_side_steep_wall": "side-on daylight carve round the SE corner and along the steep sunlit south wall of the main bowl (new line): camera ahead along the wall, then from the bowl floor level with him; HUD off",
    "clip32_people_seated_close": "#59-#61: seated groups from ~3 m, 7 s each: lifeguard, west-steps pair, beach couple; HUD off",
    "clip33_wall_ride_shadow": "#56: slow ride along the sunlit half-pipe mural wall (then closer), the kiosk wall, the mural at sunset; HUD off",
    "clip34_north_qp_bank_join_follow": "#62: follow cam along the north quarter pipe east over the join into the bank, back west, straight up the hip",
    "clip35_bowl_follow_high_carve": "#67: follow cam on a long carve round the main bowl (new line), kickturn at the end",
    "clip36_idle_front_knees": "#66: the on-board idle from the front for 10 s; HUD off",
    "clip37_blue_hour_kiosk_ride": "blue hour in motion: follow cam south past the east-side lamp pool, west along the kiosk's park-side mural and past the lamp pool at its west end; then a dolly along the kiosk's town side (outside the park fence, not rideable) level with him as he rides past behind it: lit service window and vendor, readable town-side wall",
    "clip38_funbox_kickflip_side": "kickflip off the funbox's west edge, side-on (pass-2 clip18 camera), lands on the flat; HUD off",
    "clip39_funbox_heelflip_side": "heelflip off the funbox's west edge, side-on; HUD off",
    "clip40_bank_kickflip_side": "kickflip up and off the 30 deg terrace bank, popped at the coping, landing on the terrace, side-on from the east; HUD off",
    "clip41_halfpipe_dropin_side_deck": "#72: half-pipe drop-in from the west deck, side-on at deck level (clip29 camera): tail on the coping, nose up, nose down onto the wall; HUD off",
    "clip42_manual_board_height_sun": "#68: manual in direct golden sun at board height from behind the tail (sun behind the camera); HUD off",
}
KEYDESC = {
    "pop": "pop", "flip_peak": "mid-flip near the top (pop+7)", "ollie_peak": "ollie near the top (pop+7)", "catch": "about to land (land-2)",
    "landing": "landing absorb (land+1)", "wobble": "sketchy-landing wobble (land+8)", "flip_caught": "board caught (flip done)",
    "grind_lockin": "grind lock-in (grind start+2)", "bail": "bail impact (+6 f)", "vert_peak": "vert air near the peak",
    "kickturn": "kickturn (start+6)", "manual": "manual, 1 s in", "manual_late": "manual, 3 s in", "bonk": "bonk",
    "dropin_tail_on_coping": "drop-in: tail on the coping, nose up (stall+2)", "dropin_nose_down": "drop-in: nose down onto the wall (pivot+9)",
    "dropin_crouch": "drop-in: crouched on the wall (dropIn+4)", "push_plant": "push, foot planted (push+9)", "lie": "lying after the bail",
    "getup": "getting up", "walk": "walking back to the board", "stepon": "stepping on", "ride_again": "riding away",
    "bowl_follow": "follow camera in the bowl (hand-picked, #67)", "join_east": "riding east over the quarter pipe / bank join (hand-picked, #62)",
    "join_west": "riding west over the join (hand-picked, #62)", "up_the_hip": "riding straight up the hip (hand-picked, #62)",
}


FRM = os.path.join(P, "frames") if os.path.isdir(os.path.join(P, "frames")) else os.path.join(P, "dev", "m1", "frames_meta")


def events_summary(clip):
    p = os.path.join(FRM, clip, "events.json")
    if not os.path.exists(p):
        return ""
    ev = json.load(open(p))
    out = []
    mp = os.path.join(FRM, clip, "meta.json")
    if os.path.exists(mp):
        meta = json.load(open(mp))
        segs = [m["frame"] for m in meta.get("marks", []) if m.get("label")]
        if len(segs) > 1:
            out.append("segments start " + "/".join("f%03d" % f for f in segs) + f", {meta.get('frames')} frames")
        elif meta.get("frames"):
            out.append(f"{meta['frames']} frames")
    f3 = lambda e: "f%03d" % e["frame"]
    if "push" in clip:
        out.append("pushes " + "/".join(f3(e) for e in ev if e["type"] == "push"))
    pops = [e for e in ev if e["type"] == "pop"]
    if pops:
        out.append("pops " + "/".join(f3(e) + (f" ({e['flip']})" if e.get("flip") else "") for e in pops))
    lands = [e for e in ev if e["type"] == "land"]
    if lands:
        out.append("landings " + "/".join(f3(e) + ("" if e.get("quality") == "clean" else f" {e.get('quality')}") for e in lands))
    for t, name in [("grindStart", "grinds"), ("vertAir", "vert airs"), ("kickturnStart", "kickturns from"), ("bail", "bail"), ("manualStart", "manual from"),
                    ("manualEnd", "manual ends"), ("dropInStart", "drop-in starts"), ("dropIn", "wheels on the wall")]:
        xs = [e for e in ev if e["type"] == t]
        if xs:
            out.append(name + " " + "/".join(f3(e) + (f" {e['style']}" if e.get("style") else "") for e in xs))
    st = [e for e in ev if e["type"] == "dropinPhase"]
    if st:
        out.append("set-up " + ", ".join(f"{e['phase']} {f3(e)}" for e in st))
    ph = [e for e in ev if e["type"] == "phase" and e.get("phase") in ("getup", "walk", "stepon")]
    if ph:
        out.append(", ".join(f"{e['phase']} {f3(e)}" for e in ph))
    return "; ".join(out)


L = ["# Skate park media - pass-04, helper M1 manifest (frame-stepped media)", ""]
L.append("Headed Chrome on the second screen via `tools/capture/run.mjs`, `?test&fps=30&mute` (Pro controls: no auto-push, no attract), "
         "1280x720 PNG, deterministic frame-stepped simulation at 30 fps (`tools/capture/media4.mjs`; key timelines in `media4_cases.mjs`, "
         "checked headless with `media4_sim.mjs`). No arrow keys exist any more: every flip is Space crouch + F, with D / S / W held at the "
         "F press for heelflip / pop shove-it / tre flip. Clips are H.264 MP4, 30 fps, 1280x720, encoded by `encode.py` (contact sheets and "
         "key frames too; `media4_keys.py` adds the drop-in nose-down and hand-picked follow-camera key frames). First frame + HUD ran in "
         "real time (`media2_first.mjs`, `?test&fps=30`); mobile with touch emulation at 390x844 / 844x390 (`mobile.mjs`). "
         "Frame references are fNNN of the named clip (30 fps, counted from 0). Raw frame folders were deleted after encoding.")
L.append("")
groups = {}
for sub in ["screens", "screens/keyframes", "clips", "sheets"]:
    d = os.path.join(P, sub)
    groups[sub] = sorted(f for f in os.listdir(d) if os.path.isfile(os.path.join(d, f))) if os.path.isdir(d) else []
# other helpers write into the same folders: keep M1's files only (pass-03 names, NEW, and M1's clips)
mine = lambda f: any(f.startswith(c + "_") or f.startswith(c + ".") for c in CLIPS)
groups["clips"] = [f for f in groups["clips"] if os.path.splitext(f)[0] in CLIPS]
groups["sheets"] = [f for f in groups["sheets"] if mine(f)]
groups["screens/keyframes"] = [f for f in groups["screens/keyframes"] if mine(f)]
groups["screens"] = [f for f in groups["screens"] if f"screens/{f}" in old or os.path.splitext(f)[0] in NEW]
p3_stills = [f for f in groups["screens"] if f"screens/{f}" in old]
new_stills = [f for f in groups["screens"] if f"screens/{f}" not in old]
L.append(f"Counts: {len(groups['screens'])} screens ({len(p3_stills)} with pass-03 names + {len(new_stills)} new), "
         f"{len(groups['screens/keyframes'])} key frames, {len(groups['clips'])} clips, {len(groups['sheets'])} contact sheets.")
L.append("")
L.append("## screens/: pass-03 names, same cameras")
L.append("")
for f in p3_stills:
    L.append(f"- `screens/{f}` - {old['screens/' + f]}")
L.append("")
L.append("## screens/: pass-04 proofs (#68-#73) and new stills")
L.append("")
for f in new_stills:
    n = os.path.splitext(f)[0]
    L.append(f"- `screens/{f}` - {NEW.get(n, n)}")
L.append("")
L.append("## screens/keyframes/")
L.append("")
for f in groups["screens/keyframes"]:
    m = re.match(r"(clip\d+)_.*?_([a-z_]+?)_f(\d+)\.jpg$", f)
    kd = None
    if m:
        for k in sorted(KEYDESC, key=len, reverse=True):
            if f[: -len(f"_f{m.group(3)}.jpg")].endswith("_" + k):
                kd = KEYDESC[k]
                break
    L.append(f"- `screens/keyframes/{f}` - {m.group(1) if m else ''} f{m.group(3) if m else ''}: {kd or ''}")
L.append("")
L.append("## clips/")
L.append("")
for f in groups["clips"]:
    n = os.path.splitext(f)[0]
    s = events_summary(n)
    L.append(f"- `clips/{f}` - {CLIPS.get(n, n)}" + (f" ({s})" if s else ""))
L.append("")
L.append("## sheets/ (contact sheets labelled with frame number + time)")
L.append("")
for f in groups["sheets"]:
    m = re.match(r"(.+)_sheet(\d+)\.jpg$", f)
    n = m.group(1)
    tot = len([x for x in groups["sheets"] if x.startswith(n + "_sheet")])
    meta = os.path.join(FRM, n, "meta.json")
    step = json.load(open(meta)).get("sheetStep", 4) if os.path.exists(meta) else 4
    every = {1: "every frame", 2: "every 2nd frame", 3: "every 3rd frame"}.get(step, f"every {step}th frame")
    L.append(f"- `sheets/{f}` - sheet {m.group(2)}/{tot} of {n}, {every}")
L.append("")
notes = os.path.join(P, "dev", "m1", "manifest_notes.md")
if os.path.exists(notes):
    L.append(open(notes, encoding="utf8").read().rstrip())
open(os.path.join(P, "m1_manifest.md"), "w", encoding="utf8").write("\n".join(L) + "\n")
print("m1_manifest.md:", len(groups["screens"]), "screens,", len(groups["screens/keyframes"]), "keys,", len(groups["clips"]), "clips,", len(groups["sheets"]), "sheets")
