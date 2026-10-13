"""Write <pass>/index.md listing every media file with a one-line description."""
import os, sys, json

P = sys.argv[1]
NN = os.path.basename(P.rstrip("/\\"))
D = {
    "a_first_frame_golden": "first frame after load (real-time, golden hour, default follow camera, HUD hint + sound toast visible)",
    "b_ride": "follow-cam close-up: riding at speed, relaxed stance, feet on the bolts",
    "b_crouch": "follow-cam close-up: crouching (Space held), back foot sliding to the tail",
    "b_ollie_mid": "follow-cam close-up: mid-ollie, knees tucked, front foot dragged up the deck",
    "b_kickflip_mid": "follow-cam close-up: mid-kickflip, board rolling (deck graphic visible), feet lifted",
    "b_heelflip_mid": "follow-cam close-up: mid-heelflip (opposite roll)",
    "b_shuvit_mid": "follow-cam close-up: mid pop shove-it (board yawing under the lifted feet)",
    "b_5050": "follow-cam close-up: 50-50 grind on the yellow long ledge",
    "b_boardslide": "follow-cam close-up: boardslide on the funbox flat bar",
    "b_manual": "follow-cam close-up: manual (nose up, weight back, arms out)",
    "b_push": "follow-cam close-up: pushing (back foot planted on the ground, toe side)",
    "b_handrail": "follow-cam close-up: 50-50 down the stair handrail",
    "b_face_closeup": "character close-up: face (painted eyes, brows, freckles, blush), cap, hair",
    "b_upper_body": "character close-up: tee with ringer collar / cuffs, arms, hands",
    "b_feet_on_board": "character close-up: sneakers glued to the deck, trucks, wheels",
    "c_bowl_main": "park: main pool bowl (2.3 m, tile band, metal coping)",
    "c_bowl_pocket": "park: shallower pocket bowl (1.4 m)",
    "c_halfpipe": "park: 3 m half pipe with decks and the sun-and-waves mural",
    "c_halfpipe_inside": "park: inside the half pipe (transition, vert, coping)",
    "c_quarterpipe_terrace": "park: terrace quarter pipe (1.4 m) on the raised terrace",
    "c_quarterpipe_and_bank_north": "park: north quarter pipe (1.2 m) + 30 deg bank sharing a deck",
    "c_stairs_handrail": "park: six-stair with centre handrail off the terrace",
    "c_funbox_flatbar": "park: funbox (banks + hips) with flat bar and angle-iron edges",
    "c_banks_terrace": "park: 30 deg bank up to the terrace",
    "c_ledges_rail": "park: long painted ledge + flat rail",
    "c_curb_and_manualpad": "park: blue manual pad (red curb further east)",
    "c_mural_sunwaves": "mural 1: sun and waves (half pipe back wall)",
    "c_mural_koi": "mural 2: koi and octopus (west wall)",
    "c_mural_patchwork": "mural 3: tropical patchwork (south-east wall)",
    "d_ocean_glitter": "scenery: ocean with sun-path glitter, beach, lifeguard tower",
    "d_boardwalk": "scenery: wooden boardwalk with railing, benches, lamps",
    "d_beach_houses": "scenery: beach houses on stilts",
    "d_palms": "scenery: palms (wind sway in vertex shader)",
    "d_overview": "scenery: elevated overview of the whole park",
    "d_lighthouse_headland": "scenery: headland with lighthouse across the water",
    "e_golden_hour": "time of day: golden hour (default)", "e_sunset": "time of day: sunset",
    "e_blue_hour": "time of day: blue hour night, park lamps on", "e_bright_noon": "time of day: bright noon",
    "e_golden_hour_wide": "time of day wide: golden hour", "e_sunset_wide": "time of day wide: sunset",
    "e_blue_hour_wide": "time of day wide: blue hour", "e_bright_noon_wide": "time of day wide: bright noon",
    "f_mobile_portrait": "mobile emulation 390x844 portrait with touch controls",
    "f_mobile_landscape": "mobile emulation 844x390 landscape with touch controls",
}
C = {
    "clip01_push_carve_bowl": "push x3 across the plaza, drop into the main bowl, carve, ride the far wall, kickturn",
    "clip02_flatground_flips": "flat ground: ollie, kickflip, heelflip, pop shove-it, tre flip with pushes between",
    "clip03_bank_funbox_flips": "funbox: up the bank, kickflip off the top onto the bank; later a pop shove-it",
    "clip04_grinds_5050_boardslide": "50-50 down the stair handrail, then a boardslide on the funbox flat bar",
    "clip05_manual": "3.6 s manual on flat ground",
    "clip06_sketchy_landing_wobble": "ollie with a late over-rotation -> sketchy landing (wobble, yaw error 35 deg)",
    "clip07_bail_and_get_up": "ride into the half pipe back wall -> bail (fall backwards), board tumbles, get up, board returns, step on, push away",
    "clip08_halfpipe_vert_air": "half pipe: vert airs out of both walls with assisted 180 rotation, kickturns",
    "clip09_camera_orbit_idle": "camera orbit 400 deg around the idle skater (breathing idle)",
}
lines = [f"# Skate park media - {NN}", "", "All captures: headed Chrome on the second screen, `?test&fps=30&mute`, 1280x720,",
         "deterministic frame-stepped simulation at 30 fps (manual clock). Clips: H.264 MP4 30 fps.", ""]
lines += ["## screens/", ""]
for f in sorted(os.listdir(os.path.join(P, "screens"))):
    if f.endswith(".png"):
        k = os.path.splitext(f)[0]
        lines.append(f"- `screens/{f}` - {D.get(k, k)}")
kd = os.path.join(P, "screens", "keyframes")
if os.path.isdir(kd):
    lines += ["", "## screens/keyframes/ (full-res frames at key moments: pop, flip/ollie/vert peak, catch, landing, grind lock-in, bail)", ""]
    for f in sorted(os.listdir(kd)):
        lines.append(f"- `screens/keyframes/{f}`")
lines += ["", "## clips/", ""]
for f in sorted(os.listdir(os.path.join(P, "clips"))):
    k = os.path.splitext(f)[0]
    lines.append(f"- `clips/{f}` - {C.get(k, k)}")
lines += ["", "## sheets/ (contact sheets, every 4th frame = 7.5 fps, labelled with frame number and time)", ""]
for f in sorted(os.listdir(os.path.join(P, "sheets"))):
    k = f.rsplit("_sheet", 1)[0]
    lines.append(f"- `sheets/{f}` - {C.get(k, k)}")
if os.path.isdir(os.path.join(P, "dev")):
    lines += ["", "## dev/", "", "- `dev/` - builder scratch captures from iteration (character previews, debug views); not part of the protocol."]
open(os.path.join(P, "index.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("index.md", len(lines), "lines")
