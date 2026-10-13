"""Write pass-02 index.md: every file with a one-line description + fix map for critique items 1-54."""
import os, re, sys

P = sys.argv[1]
PRE = {"a": "first frame / HUD", "b": "skater close-up", "c": "park", "d": "scenery", "e": "time of day",
       "f": "mobile", "g": "skater lighting / scale"}
SPECIAL = {
    "a_first_frame_golden": "first frame after load in real time, golden hour, HUD exactly as the player sees it",
    "a_hud_t02s": "HUD 2 s after start: controls hint + sound prompt visible", "a_hud_t05s": "HUD 5 s: sound prompt gone",
    "a_hud_t07s": "HUD 7 s: controls hint faded out completely, pills faint", "a_hud_pointer_move": "pills fully visible after a pointer move",
    "a_hud_help_open": "help panel open (H)", "a_hud_help_closed": "help closed: hint shows briefly again",
    "g_scale_halfpipe": "skater (1.75 m) standing beside the 3 m half pipe for scale",
    "g_scale_quarterpipe": "skater standing beside a quarter pipe for scale",
}
CLIPS = {
    "clip01_push_carve_bowl": "follow cam: pushes, drop into the main bowl, carve, ride the wall, kickturns",
    "clip02_flatground_flips": "follow cam: ollie, kickflip, heelflip, pop shove-it, tre flip (full-crouch pops, 17 f air), rides on",
    "clip03_bank_funbox_flips": "follow cam: up the funbox bank, kickflip off the top, later a pop shove-it",
    "clip04_grinds_5050_boardslide": "follow cam: 50-50 down the stair handrail, then a boardslide on the funbox flat bar",
    "clip05_manual": "follow cam: manual with growing balance corrections",
    "clip06_sketchy_landing_wobble": "follow cam: over-rotated ollie -> wobble (windmill, hip sway, fishtail, shuffle)",
    "clip07_bail_and_get_up": "follow cam: ride into the half-pipe wall -> wall_hit bail, board skids away and rests, lie + shake off, staged get-up, walk to the board, step on, ride away",
    "clip08_halfpipe_vert_air": "follow cam: half-pipe vert airs (side-on, no 180 swings), kickturns",
    "clip09_camera_orbit_idle": "orbit around the relaxed on-board idle with fidgets",
    "clip10_grinds_trucks_side": "side-on close-up: trucks on the ledge (50-50), boardslide, handrail and bar",
    "clip11_bowl_carve_side": "side-on close carve along the bowl wall (lean, pump, kickturn)",
    "clip12_ollie_side": "side-on 30 fps: full-crouch ollie (17 f) then a quick ollie (13 f), pop to landing",
    "clip13_kickflip_side": "side-on 30 fps: kickflip x2 (toe-edge flick, legs split, fast roll, catch, land)",
    "clip14_heelflip_side": "side-on 30 fps: heelflip x2 (heel-edge kick, opposite roll)",
    "clip15_shuvit_side": "side-on 30 fps: pop shove-it x2 (feet straight up, flat spin)",
    "clip16_push_side": "side-on push cycle, feet in frame (deep knee, plant beside the front truck, sweep back)",
    "clip17_vert_air_close": "close follow of the half-pipe vert airs (skater ~1/3 of frame)",
    "clip18_funbox_kickflip_side": "side-on funbox kickflip, drop timing onto the bank",
    "clip19_blue_hour_lamp_pass": "blue hour: skater rides through a lamp pool, lit warm, lamp shadow",
    "clip20_people_motion": "people in motion: walkers on the boardwalk, wave, beach couple, lifeguard, deck skaters",
    "clip21_palms_breeze": "palms up close in the breeze (frond tips flutter independently)",
    "clip22_bowl_carve_follow": "follow cam carve in the bowl at deck height (camera never top-down / never dives)",
    "clip23_wall_bail_close": "closer view of the wall bail: impact, snap back, board kicks out and rests, get-up",
    "clip24_manual_side": "side-on manual: weight back, nose up ~15 deg, bent arms, corrections",
    "clip25_sketchy_landing_side": "side-on sketchy landing wobble",
}
FIX = {
    1: "a_first_frame_golden.png, e_golden_hour_wide.png, d_overview.png, c_banks_terrace.png, c_line_se_ledge_bank.png (sun-facing faces warm, away faces lilac-grey, patchy slabs)",
    2: "c_bowl_main.png, c_bowl_pocket.png, c_bowl_coping.png, e_sunset_bowl.png; clip22 f000-f150, clip01 f096-f150",
    3: "g_backlight_golden.png, g_backlight_golden_close.png, g_backlight_sunset.png, g_backlight_sunset_close.png (vs g_frontlight_golden.png)",
    4: "c_mural_koi.png, c_mural_koi_close.png, c_mural_sunwaves.png, c_mural_patchwork.png; clip23 f000-f040",
    5: "e_blue_hour.png, e_blue_hour_wide.png, e_blue_hour_lamps_wide.png, e_blue_hour_lamps_south.png, e_blue_hour_bowl.png, g_lamp_blue_hour*.png; clip19 f000-f150",
    6: "e_bright_noon.png, e_bright_noon_wide.png, e_bright_noon_bowl.png",
    7: "e_bright_noon_sea.png, e_bright_noon_wide.png",
    8: "a_first_frame_golden.png, d_overview.png, e_sunset_wide.png, f_mobile_landscape.png (no stripe/moire bands); clip02 (moving camera)",
    9: "d_palms_far.png, d_overview.png, e_golden_hour_wide.png (solid far crowns)",
    10: "f_mobile_portrait.png (smooth sky, no grainy rectangle)",
    11: "d_ocean_glitter.png (the pass-01 object was a gull; gulls now read as gulls, slim body + angled dark-tipped wings)",
    12: "d_people_beach.png, d_people_boardwalk.png, d_people_hp_deck.png, d_people_lifeguard.png, d_people_north_deck.png, d_people_west_steps.png; clip20 f000-f555",
    13: "d_overview.png, d_overview_top.png, c_line_east_rail.png, c_line_ne_mini_quarter.png, c_line_ne_platform_stairs.png, c_line_nw_curb.png, c_line_nw_quarter_pyramid.png, c_line_se_ledge_bank.png, c_line_sw_pad_ledge.png, d_edge_east/north_boardwalk/south/west.png",
    14: "d_beach_houses.png, d_beach_house_close.png, d_town_south.png, d_kiosk_town_side.png, c_stairs_handrail.png (no floating roof)",
    15: "d_sand_footprints.png, d_shore_wet.png, d_shore_wide.png, d_umbrella_shadow.png, d_lighthouse_headland.png (shadow now has its umbrella)",
    16: "d_headland_close.png, d_lighthouse_headland.png",
    17: "d_palm_close.png, d_palm_crown_up.png, d_palms.png; clip21 f000-f240",
    18: "a_first_frame_golden.png, c_mural_koi.png (pavilion), c_mural_patchwork.png (kiosk), c_mural_sunwaves.png (half-pipe wall)",
    19: "d_ground_low_feet.png, b_feet_on_board.png, d_ground_low_sand.png, c_ledge_wax.png, c_curb_and_manualpad.png",
    20: "c_halfpipe.png, c_halfpipe_exterior_east.png, c_halfpipe_deck_stairs.png",
    21: "c_halfpipe_coping.png, c_halfpipe_inside.png, c_quarterpipe_terrace.png, c_quarterpipe_and_bank_north.png, c_banks_terrace.png; clip08/clip17",
    22: "c_bowl_coping.png, c_bowl_main.png, c_bowl_pocket.png",
    23: "c_funbox_iron.png, c_funbox_flatbar.png",
    24: "c_ledge_wax.png, c_ledges_rail.png, c_curb_and_manualpad.png",
    25: "c_stairs_close.png, c_stairs_handrail.png; clip04 f000-f040",
    26: "b_face_closeup.png, b_face_neutral.png, b_face_focus.png, b_face_wide.png, b_face_grin.png, b_face_grimace.png (cap panels/brim/button, tapered neck, expressions)",
    27: "b_cloth_still.png, b_cloth_crouch.png, b_cloth_speed.png, b_cloth_land.png, b_upper_body.png, b_crouch.png",
    28: "b_hands_relaxed.png, b_hands_open.png, b_upper_body.png",
    29: "b_face_closeup.png, b_face_neutral.png (warmer ears/nose/cheeks, brim shadow)",
    30: "clip23 f020-f080 and clip07 f020-f080: board kicks out, skids, rests on the ground; keyframes clip07/clip23 bail",
    31: "clip07 f190-f290: board lies still until he walks over and steps on (ride away from f296)",
    32: "clip02 events: every pop->land 17 f (0.57 s, full crouch); clip12-15 second pops 13 f (0.43 s, quicker pop); quick tap = 11 f (0.37 s) per tools/capture/physics_check.mjs; drops scale with height (clip04 handrail 28-36 f)",
    33: "clip12 f015-f046, clip13 f015-f046 (crouch, pop with straight back leg + front foot slide, tuck, extend, absorb); keyframes clip12/13 pop/peak/catch/landing",
    34: "clip12 f038-f048, clip02 f035-f045 (knees bend over 2-3 frames, arms dip, rise)",
    35: "clip16 f000-f150, b_push.png",
    36: "clip11 f000-f150, clip22 f000-f150, clip01 f115-f230 (lean into the wall, pump, arms/knees moving, no waist fold)",
    37: "clip11 f100-f125 (kickturn@f110), clip01 f215-f235, clip08 f205-f225 (pivot on the back wheels, nose up)",
    38: "clip24 f012-f099, clip05 f018-f126, b_manual.png",
    39: "clip25 f044-f090, clip06 f044-f090 (arm windmill, hip sway, board fishtail, foot shuffle)",
    40: "clip23 f015-f045, clip07 f015-f045 (no penetration, snap back, arms up, rebound, board kicks out)",
    41: "clip07 f040-f290, clip23 f040-f190 (slide, lie + shake off, staged get-up, walk, step on)",
    42: "clip02 f228-f286: tre flip lands clean at f245 and rides on; any bail now needs a visible obstacle (barriers bounce only)",
    43: "clip09 f000-f450 (weight on one leg, soft knees, cap adjust / glance / foot nudge)",
    44: "clip13 vs clip14 vs clip15 f021-f038; b_kickflip_mid.png, b_heelflip_mid.png, b_shuvit_mid.png",
    45: "clip13 f021-f038 (roll ~0.2 s, catch, land 0.14-0.17 s later)",
    46: "clip01 f096-f230, clip22 f000-f150 (deck-height, behind and above, never top-down)",
    47: "clip01 f110-f130 and f320-f345 (no dive, board + ground stay in frame)",
    48: "clip08 f020-f150, clip17 (side-on close follow, skater ~1/3 frame)",
    49: "clip07 f290-f340 (camera swings out from the wall on the ride away)",
    50: "clip04 f000-f045 (low, side-on on the stairs/handrail), clip10",
    51: "clip02, clip06 (skater ~1/3 of frame height, just below centre)",
    52: "a_hud_t02s.png -> a_hud_t07s.png (hint fades out completely), a_hud_help_open.png, a_hud_help_closed.png",
    53: "a_hud_t02s.png (prompt) -> a_hud_t05s.png (gone after ~3.5 s or first input)",
    54: "a_hud_t07s.png (small, faint pills) vs a_hud_pointer_move.png (full on pointer move)",
}
NEEDS = [
    ("Grinds up close (trucks on rail/ledge)", "clip10_grinds_trucks_side; b_grind_5050_trucks.png, b_grind_boardslide_trucks.png, b_grind_boardslide_side.png, b_grind_handrail_trucks.png"),
    ("Carve up close", "clip11_bowl_carve_side, clip22_bowl_carve_follow"),
    ("Trick landings side-on 30 fps", "clip12_ollie_side, clip13_kickflip_side, clip14_heelflip_side, clip15_shuvit_side"),
    ("Push cycle side-on", "clip16_push_side"),
    ("Vert scale", "clip17_vert_air_close; g_scale_halfpipe.png, g_scale_quarterpipe.png"),
    ("Skater lighting", "g_lamp_blue_hour*.png, clip19_blue_hour_lamp_pass; g_backlight_sunset*.png, g_backlight_golden*.png"),
    ("Funbox kickflip side-on", "clip18_funbox_kickflip_side"),
    ("Signs of life", "clip20_people_motion; d_people_*.png; gulls in d_ocean_glitter.png"),
    ("Palms up close", "clip21_palms_breeze; d_palm_close.png, d_palm_crown_up.png"),
]


def desc_screen(k):
    if k in SPECIAL:
        return SPECIAL[k]
    p = k.split("_", 1)
    words = p[1].replace("_", " ") if len(p) > 1 else k
    return f"{PRE.get(p[0], 'shot')}: {words}"


L = ["# Skate park media - pass-02", "",
     "Headed Chrome on the second screen, `?test&fps=30&mute`, 1280x720; gameplay clips use the default follow camera;",
     "deterministic frame-stepped simulation at 30 fps (frame numbers comparable with pass-01). Clips: H.264 MP4 30 fps.", "",
     "## screens/", ""]
for f in sorted(os.listdir(os.path.join(P, "screens"))):
    if f.endswith(".png"):
        L.append(f"- `screens/{f}` - {desc_screen(os.path.splitext(f)[0])}")
kd = os.path.join(P, "screens", "keyframes")
L += ["", "## screens/keyframes/ (full-res frames at pop, peak, catch, landing, grind lock-in, bail, vert peak)", ""]
for f in sorted(os.listdir(kd)):
    L.append(f"- `screens/keyframes/{f}`")
L += ["", "## clips/", ""]
for f in sorted(os.listdir(os.path.join(P, "clips"))):
    k = os.path.splitext(f)[0]
    L.append(f"- `clips/{f}` - {CLIPS.get(k, k)}")
L += ["", "## sheets/ (contact sheets, labelled frame number + time; every 4th frame, every 2nd for short side-on clips)", ""]
for f in sorted(os.listdir(os.path.join(P, "sheets"))):
    k = re.sub(r"_sheet\d+\.jpg$", "", f)
    L.append(f"- `sheets/{f}` - {CLIPS.get(k, k)}")
L += ["", "## Fix map (critique items 1-54)", "", "Frames are fNNN of the named clip (30 fps); screens are in `screens/`.", ""]
for i in range(1, 55):
    L.append(f"- **#{i}** - {FIX[i]}")
L += ["", "## Not shown - needs capture: answered by", ""]
for a, b in NEEDS:
    L.append(f"- **{a}** - {b}")
L += ["", "`dev/` holds the workstreams' scratch/verification captures (not part of the protocol)."]
open(os.path.join(P, "index.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("index.md lines", len(L))
