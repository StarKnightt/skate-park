"""Write pass-03 index.md: every file with a one-line description, fix map for #44 and #55-#67, regression set,
answers to the pass-02 critique's 'Not shown - needs capture'.
python make_index3.py <pass_dir>   (fails if a file has no description)"""
import os, re, sys

P = sys.argv[1]
TOD = {"golden": "golden hour", "sunset": "sunset", "blue_hour": "blue hour", "noon": "noon"}

# ---------------------------------------------------------------- pass-02 stills, re-shot with the same names and cameras
REG = {
    "a_first_frame_golden": "first frame after load in real time, golden hour, HUD exactly as the player sees it (controls hint, sound prompt, pills)",
    "a_hud_t02s": "HUD 2 s after start: controls hint and sound prompt up",
    "a_hud_t05s": "HUD 5 s: sound prompt gone, controls hint still up",
    "a_hud_t07s": "HUD 7.5 s: controls hint faded out completely, pills small and faint",
    "a_hud_pointer_move": "pills back to full strength after a pointer move",
    "a_hud_help_open": "help panel open (H)",
    "a_hud_help_closed": "help closed again: the controls hint shows briefly",
    "b_ride": "rolling at 5.5 m/s, follow camera close behind",
    "b_crouch": "crouched for the pop (Space held)",
    "b_ollie_mid": "ollie at the top of the pop",
    "b_kickflip_mid": "kickflip half-way through the flip, follow camera (critic's #64 frame)",
    "b_heelflip_mid": "heelflip half-way through the flip",
    "b_shuvit_mid": "pop shove-it half-way through the spin",
    "b_5050": "50-50 on the long ledge, follow camera",
    "b_boardslide": "boardslide on the funbox flat bar, follow camera",
    "b_handrail": "50-50 down the stair handrail, follow camera",
    "b_manual": "manual 1 s in: weight back, nose up",
    "b_push": "push: foot planted beside the front truck",
    "b_face_closeup": "face close-up at the on-board idle: cap panels and brim, hair tufts, freckles",
    "b_face_neutral": "face while rolling, neutral expression",
    "b_face_focus": "face at speed, focused expression",
    "b_face_wide": "face in the air after a pop, wide-eyed expression",
    "b_face_grin": "face after landing, grin",
    "b_face_grimace": "face 6 frames into a bail, grimace",
    "b_upper_body": "upper body at the idle: arms, hands, tee folds",
    "b_feet_on_board": "feet on the board at the idle: shoes, grip, trucks",
    "b_hands_relaxed": "right hand relaxed while rolling (critic's #63 regression frame)",
    "b_hands_open": "right hand open in the air after a pop (critic's #63 frame)",
    "b_cloth_still": "tee and shorts folds while rolling slowly",
    "b_cloth_speed": "cloth at 7.5 m/s",
    "b_cloth_crouch": "cloth in the pop crouch",
    "b_cloth_land": "cloth 2 frames after landing (absorb)",
    "b_grind_5050_trucks": "trucks on the long ledge in a 50-50, side-on at truck height (clip10 f039)",
    "b_grind_boardslide_trucks": "boardslide on the funbox flat bar, camera on the bar axis (clip10 f136)",
    "b_grind_boardslide_side": "boardslide on the flat bar, camera across the bar (clip10 f208)",
    "b_grind_handrail_trucks": "50-50 on the stair handrail, camera beside the rail (clip10 f269)",
    "c_banks_terrace": "bank terrace in low sun: warm sun-facing faces, cool faces turned away, planter bushes behind (#57)",
    "c_bowl_main": "main bowl from the deck: wall gradients with warm bounce, coping and teal tile band",
    "c_bowl_pocket": "bowl pocket from the deck",
    "c_bowl_coping": "bowl coping blocks, tile band and shaded deck up close (#55 camera, golden hour)",
    "c_curb_and_manualpad": "curb and manual pad",
    "c_funbox_flatbar": "funbox with its flat bar",
    "c_funbox_iron": "funbox angle iron up close",
    "c_halfpipe": "half pipe along its length: decks, railings, coping",
    "c_halfpipe_coping": "half-pipe coping and wall up close (#55 camera, golden hour)",
    "c_halfpipe_deck_stairs": "half-pipe deck stairs and railing",
    "c_halfpipe_exterior_east": "half-pipe exterior, east side",
    "c_halfpipe_inside": "inside the half pipe from the flat bottom",
    "c_ledge_wax": "ledge edge with wax and grind marks up close",
    "c_ledges_rail": "ledges and rail, north side of the park",
    "c_line_east_rail": "east line: rail",
    "c_line_ne_mini_quarter": "north-east line: mini quarter pipe",
    "c_line_ne_platform_stairs": "north-east line: platform and stairs",
    "c_line_nw_curb": "north-west line: curb",
    "c_line_nw_quarter_pyramid": "north-west line: quarter pipe and pyramid",
    "c_line_se_ledge_bank": "south-east line: ledge and bank",
    "c_line_sw_pad_ledge": "south-west line: manual pad and ledge, planter bushes behind (#57)",
    "c_mural_koi": "koi mural on the pavilion",
    "c_mural_koi_close": "koi mural up close",
    "c_mural_patchwork": "patchwork mural on the kiosk",
    "c_mural_sunwaves": "sun-and-waves mural on the half-pipe wall",
    "c_quarterpipe_and_bank_north": "north quarter pipe and bank: the join where the pass-02 notch was (#62, critic's camera)",
    "c_quarterpipe_terrace": "quarter pipe on the terrace: coping and deck",
    "c_stairs_close": "stair risers and nosings up close (#55 camera, golden hour)",
    "c_stairs_handrail": "stairs and handrail, houses behind",
    "d_beach_house_close": "beach house up close",
    "d_beach_houses": "beach houses along the shore",
    "d_boardwalk": "boardwalk",
    "d_edge_east": "east edge of the park, planter bushes (#57)",
    "d_edge_north_boardwalk": "north edge by the boardwalk, planter bushes (#57)",
    "d_edge_south": "south edge, planter bushes (#57)",
    "d_edge_west": "west edge, planter bushes (#57)",
    "d_ground_low_feet": "ground at board height beside the skater's feet (#55 camera, golden hour)",
    "d_ground_low_sand": "ground at board height towards the sand",
    "d_headland_close": "headland up close",
    "d_kiosk_town_side": "kiosk from the town side with its service window (#58, golden hour)",
    "d_lighthouse_headland": "lighthouse on the headland",
    "d_ocean_glitter": "sea glitter towards the sun, gulls",
    "d_overview": "high overview: park, beach, sea",
    "d_overview_top": "top-down overview of the park layout",
    "d_palm_close": "palm crown from below at the boardwalk end",
    "d_palm_crown_up": "palm crown looking up at the west edge",
    "d_palms": "palms by the boardwalk",
    "d_palms_far": "distant palms across the park",
    "d_people_beach": "beach couple on towel and chair",
    "d_people_boardwalk": "walker on the boardwalk, planter bushes (#57)",
    "d_people_hp_deck": "skater waiting on the half-pipe deck",
    "d_people_lifeguard": "lifeguard in the tower (critic's #61 camera)",
    "d_people_north_deck": "skater on the north deck",
    "d_people_west_steps": "pair on the west seat steps (critic's #57 / #60 camera)",
    "d_sand_footprints": "footprints in the sand",
    "d_shore_wet": "wet shore and wave line",
    "d_shore_wide": "shore, wide",
    "d_town_south": "town to the south: houses, and the scrub bush that replaced the mossy boulder (#57)",
    "d_umbrella_shadow": "beach umbrella and its shadow",
    "e_golden_hour": "golden hour, behind the idling skater",
    "e_golden_hour_wide": "golden hour, wide over the park",
    "e_sunset": "sunset, behind the skater",
    "e_sunset_wide": "sunset, wide",
    "e_sunset_bowl": "main bowl at sunset",
    "e_blue_hour": "blue hour, behind the skater",
    "e_blue_hour_wide": "blue hour, wide",
    "e_blue_hour_lamps_wide": "blue hour: lamps along the west side, warm pools, lit windows",
    "e_blue_hour_lamps_south": "blue hour: the park from the south with its lamp pools",
    "e_blue_hour_bowl": "main bowl at blue hour",
    "e_bright_noon": "bright noon, behind the skater",
    "e_bright_noon_wide": "bright noon, wide",
    "e_bright_noon_bowl": "main bowl at noon",
    "e_bright_noon_sea": "sea at noon",
    "f_mobile_portrait": "phone portrait 390x844 with touch controls",
    "f_mobile_landscape": "phone landscape 844x390 with touch controls",
    "g_backlight_golden": "skater backlit by the golden-hour sun (rim light)",
    "g_backlight_golden_close": "backlit at golden hour, close",
    "g_backlight_sunset": "skater backlit at sunset",
    "g_backlight_sunset_close": "backlit at sunset, close",
    "g_frontlight_golden": "skater front-lit at golden hour (reference for the backlit shots)",
    "g_lamp_blue_hour": "skater under a lamp at blue hour",
    "g_lamp_blue_hour_close": "under the lamp at blue hour, close",
    "g_lamp_blue_hour_pool": "lamp pool at blue hour, wider",
    "g_lamp_blue_hour_follow": "lamp light on the skater from the follow camera, blue hour",
    "g_scale_halfpipe": "skater (1.75 m) standing beside the half pipe for scale",
    "g_scale_quarterpipe": "skater standing beside a quarter pipe for scale",
}

# ---------------------------------------------------------------- pass-03 proof stills
NEW = {
    "h44_flip_peak_compare_side": "#44: kickflip / heelflip / shove-it side by side at pop+6 (clip26/27/28 f024), side-on at board height, 1:1 crops",
    "h44_flip_peak_compare_q35": "#44: the same at pop+6 from the front quarter, 35 deg (clip26/27/28 f070)",
    "h44_flip_compare_grid_side": "#44: rows kickflip / heelflip / shove-it, columns pop+2..pop+12 every 2 frames (f020-f030), side-on",
    "h44_flip_compare_grid_q35": "#44: the same grid from the front quarter (f066-f076)",
    "h44_kickflip_peak_side": "#44: kickflip at its widest leg split, side-on at board height (clip26 f026, pop+8)",
    "h44_kickflip_peak_q35": "#44: kickflip widest split, front quarter (clip26 f072, pop+8)",
    "h44_heelflip_peak_side": "#44: heelflip widest split, side-on (clip27 f023, pop+5)",
    "h44_heelflip_peak_q35": "#44: heelflip widest split, front quarter (clip27 f069, pop+5)",
    "h44_shuvit_peak_side": "#44: shove-it, knees together and feet straight up (clip28 f020, pop+2), side-on",
    "h44_shuvit_peak_q35": "#44: shove-it, front quarter (clip28 f066, pop+2)",
    "h55_compare_pass02_vs_pass03_bowl_coping_4x": "#55: the same shaded deck and coping region of c_bowl_coping, pass-02 (dot grid) vs pass-03 (smooth), 4x nearest",
    "h55_shaded_crops_4x_golden_sunset": "#55: shaded regions of the four #55 cameras at 4x nearest, golden hour and sunset",
    "h55_shaded_crops_4x_blue_hour_noon": "#55: the same at blue hour and noon",
    "h56_wall_bail_follow_f045": "#56: wall bail, default follow camera (clip07 f045): going down after the impact, shadow on the mural",
    "h56_wall_bail_follow_f120": "#56: clip07 f120, starting to get up below the wall",
    "h56_wall_bail_follow_f200": "#56: clip07 f200, walking to the board along the wall",
    "h56_wall_bail_follow_f254": "#56: clip07 f254, riding away from the wall",
    "h56_wall_ride_golden_f035": "#56 outside a bail: slow ride along the sunlit half-pipe mural wall, golden hour (clip33 f035)",
    "h56_wall_ride_close_golden_f100": "#56: closer, side-on to the mural wall, golden hour (clip33 f100)",
    "h56_wall_ride_kiosk_golden_f150": "#56: along the patchwork kiosk wall, golden hour (clip33 f150)",
    "h56_wall_ride_close_sunset_f200": "#56: the mural wall at sunset (clip33 f200)",
    "h57_bush_close_west_planter": "#57: west planter bush from about 3.5 m",
    "h57_bush_close_west_planter_2": "#57: a second west planter bush from about 3.5 m",
    "h57_bush_close_east_planter": "#57: east planter bush from about 3.5 m",
    "h57_bush_close_boardwalk_end": "#57: planter bush at the boardwalk end from about 3.8 m",
    "h57_bush_backlit_west_planter": "#57: west planter bush against the low sun (backlit outline)",
    "h57_town_bush_former_boulder": "#57: the town-side scrub bush where d_town_south's mossy boulder was",
    "h57_bush_xclose_planter_side": "#57: extreme close-up (~1.3 m) of a planter bush, side-lit: leaf clumps, painted light and shade",
    "h57_bush_xclose_flowering_side": "#57: extreme close-up of the flowering (pink) planter bush, side-lit",
    "h57_bush_xclose_planter_backlit": "#57: extreme close-up facing the sun, low: ragged see-through outline against the sky",
    "h57_bush_xclose_town_scrub": "#57: extreme close-up (~1.5 m) of the town scrub bush, side-lit",
    "h57_compare_pass02_vs_pass03_bushes": "#57: pass-02 vs pass-03 crops from the same cameras: planter bushes and the d_town_south boulder (now scrub)",
    "h58_kiosk_town_side_golden": "#58: kiosk from the town side (d_kiosk_town_side camera), golden hour",
    "h58_kiosk_town_side_blue_hour": "#58: the same at blue hour, window lit warm",
    "h58_kiosk_window_close_golden": "#58: service window close: menu board, shelves, drinks fridge, vendor; golden hour",
    "h58_kiosk_window_close_blue_hour": "#58: service window close at blue hour",
    "h58_kiosk_window_oblique_golden": "#58: service window at an angle, golden hour",
    "h58_kiosk_window_oblique_blue_hour": "#58: service window at an angle, blue hour",
    "h59_walker_face_5m_clip20_framing": "#59: the purple-shirt, blue-cap boardwalk walker at clip20's framing (~5 m)",
    "h59_walker_face_3m": "#59: the same walker's face from ~3 m",
    "h59_walker2_face_3m": "#59: the second boardwalk walker (pink shirt) from ~3 m",
    "h59_shore_walker_face_3m": "#59: the shore walker from ~3 m",
    "h59_town_walker_face_3m": "#59: the town-path walker (white cap) from ~3 m",
    "h59_hp_deck_skater_face_3m": "#59: the skater waiting on the half-pipe deck from ~3 m",
    "h59_north_deck_skater_face_3m": "#59: the north-deck skater from ~3 m",
    "h59_phone_face_3m": "#59: the person on the phone from ~3 m",
    "h59_waver_face_3m": "#59: the boardwalk waver (white shirt, blue cap) from ~3 m",
    "h59_west_steps_pair_3m": "#59/#60: the west-steps pair from ~3 m (clip32 camera)",
    "h59_beach_couple_3m": "#59: the beach couple (towel + chair) from ~3 m (clip32 camera)",
    "h59_south_steps_clapper_3m": "#59: the clapper on the south steps from ~3 m",
    "h59_kiosk_vendor_3m": "#59: the kiosk vendor from ~3.4 m",
    "h60_west_steps_above": "#60: the west-steps pair from above, golden hour",
    "h60_west_steps_above_sunset": "#60: from above, sunset",
    "h60_west_steps_above_blue_hour": "#60: from above, blue hour",
    "h60_west_steps_above_noon": "#60: from above, noon",
    "h60_west_steps_behind": "#60: from behind and above",
    "h60_west_steps_hunch_above": "#60: the left figure at his most hunched moment, from above (dark hair from the top)",
    "h60_west_steps_hunch_critic_view": "#60: the same moment from the critic's d_people_west_steps / clip20 camera",
    "h60_skater_hair_above": "#60: the skater's own cap and hair from above",
    "h61_lifeguard_face_3m": "#61: the lifeguard's face from ~2.6 m",
    "h61_lifeguard_critic_view": "#61: the lifeguard from the critic's d_people_lifeguard camera",
    "h62_qp_bank_join_close": "#62: the north quarter pipe -> bank join close, from the floor",
    "h62_qp_bank_join_from_qp_deck": "#62: the join from the quarter-pipe deck",
    "h62_qp_bank_join_from_bank_side": "#62: the join from the bank side, low",
    "h62_compare_pass02_vs_pass03_join_2x": "#62: pass-02 notch vs pass-03 join, same camera (c_quarterpipe_and_bank_north), 2x",
    "h63_hand_open_xclose": "#63: extreme close-up of the open right hand in the air, palm side",
    "h63_hand_open_xclose_back": "#63: back of the open right hand, extreme close-up",
    "h63_hand_open_left_xclose": "#63: the open left hand, extreme close-up",
    "h63_hand_relaxed_xclose": "#63: relaxed right hand while rolling, extreme close-up",
    "h63_hand_cap_face": "#63: cap-adjust fidget, hand beside the face in the same light (skin match), from the front right",
    "h63_hand_cap_face_front": "#63: the same from the face side",
    "h63_hands_follow_bail_impact": "#63: hands at normal follow-camera distance, bail impact",
    "h63_hands_follow_bail_fall": "#63: follow camera, falling in the bail",
    "h63_hands_follow_bail_lying": "#63: follow camera, lying after the bail",
    "h63_hands_follow_manual": "#63: follow camera, manual (balance moment)",
    "h63_hands_follow_manual_late": "#63: follow camera, later in the same manual",
    "h63_hands_follow_grind_5050": "#63: follow camera, 50-50 on the long ledge",
    "h64_grip_kickflip": "#64: mid-kickflip, grip side facing the camera, in shade (frame of most grip-to-camera between pop+3 and pop+13)",
    "h64_grip_heelflip": "#64: mid-heelflip, grip facing the camera, in shade",
    "h64_grip_kickflip_sunlit": "#64: mid-kickflip, grip facing the camera in direct sun",
    "h64_grip_heelflip_sunlit": "#64: mid-heelflip, grip facing the camera in direct sun",
    "h65_dropin_tail_on_coping": "#65: drop-in from the deck, side-on: tail on the coping (clip29 f018)",
    "h65_dropin_nose_down": "#65: nose pushed down onto the wall (clip29 f023)",
    "h65_dropin_crouch_on_wall": "#65: deep crouch on the wall, chest over the front truck (clip29 f032)",
    "h65_dropin_floor_tail_on_coping": "#65: seen from the bowl floor, tail on the coping (clip30 f018)",
    "h65_dropin_floor_on_wall": "#65: seen from the floor, wheels on the wall just under the coping (clip30 f029)",
    "h66_idle_front_foot_fidget": "#66: foot-nudge fidget from the front",
    "h66_compare_pass02_vs_pass03_clip09_knees": "#66: top, the critic's pass-02 clip09 knees crop (knock-kneed at f150); bottom, pass-03 clip09 at the same frames and scale",
}
H55V = {"c_bowl_coping": "shaded bowl deck and coping", "d_ground_low_feet": "shaded ground beside the feet",
        "c_halfpipe_coping": "half-pipe wall and coping", "c_stairs_close": "stair risers"}
for v, d in H55V.items():
    for t, tn in TOD.items():
        NEW[f"h55_{v}_{t}"] = f"#55: {d} ({v} camera), {tn}, 1:1"
H56B = {20: "impact with the mural wall", 22: "snap back (+2 f)", 24: "rebound (+4 f)", 28: "falling away (+8 f)",
        34: "falling (+14 f)", 46: "going down (+26 f)", 149: "getting up", 205: "walking back past the wall", 217: "walking past the wall (critic's 2x frame)"}
for f, d in H56B.items():
    NEW[f"h56_wall_bail_close_f{f:03d}"] = f"#56: wall bail, closer side camera (clip23 f{f:03d}): {d}"
for f in (60, 150, 240, 330):
    NEW[f"h66_idle_front_f{f:03d}"] = f"#66: on-board idle from the front, idle frame {f} (same camera as clip36)"
for f in (17, 32, 47, 62):
    NEW[f"n_carve_along_wall_f{f:03d}"] = f"side-on daylight carve on the steep sunlit south wall of the main bowl, camera ahead along the wall (clip31 f{f:03d})"
for f in (87, 102, 117, 132):
    NEW[f"n_carve_from_floor_f{f:03d}"] = f"the same carve from the bowl floor, level with him (clip31 f{f:03d})"

# ---------------------------------------------------------------- clips
CLIPS = {
    "clip01_push_carve_bowl": "follow cam: pushes, drops into the main bowl (tail on coping f097, nose down f103, crouch f110), carves, kickturns from f206 and f335",
    "clip02_flatground_flips": "follow cam: ollie, kickflip, heelflip, pop shove-it, tre flip (pops f018/f071/f123/f176/f228, landings f035-f245), rides on past the lamp",
    "clip04_grinds_5050_boardslide": "follow cam: 50-50 down the stair handrail (f000-f077), boardslide on the funbox flat bar (f078-f209)",
    "clip07_bail_and_get_up": "follow cam: rides into the half-pipe mural wall, wall bail f020, board rests, lies, staged get-up, walks back, steps on f220, rides away f236",
    "clip09_camera_orbit_idle": "15 s orbit around the on-board idle with fidgets",
    "clip10_grinds_trucks_side": "side-on close-ups at truck height: 50-50 on the long ledge (f000), boardslide on the flat bar along and across the bar (f100, f172), 50-50 down the handrail (f244)",
    "clip12_ollie_side": "side-on 30 fps: full-crouch ollie (pop f021, land f038), quick ollie (pop f072, land f085)",
    "clip13_kickflip_side": "side-on 30 fps: kickflip x2 (pops f021/f072, caught f033/f081, land f038/f085)",
    "clip14_heelflip_side": "side-on 30 fps: heelflip x2 (pops f021/f072, caught f033/f081, land f038/f085)",
    "clip15_shuvit_side": "side-on 30 fps: pop shove-it x2 (pops f021/f072, caught f031/f080, land f038/f085)",
    "clip16_push_side": "side-on push cycle, feet in frame (pushes f009, f034, f059, f084, f109)",
    "clip17_vert_air_close": "close follow of the half-pipe vert airs (airs f026 and f117, kickturns from f199 and f283)",
    "clip20_people_motion": "people in motion: boardwalk walker f000, waver f075, beach couple + shore-path walker f150, shore walker f225, lifeguard f300, west-steps pair f360, half-pipe deck skater f420, town-path walker f480",
    "clip21_palms_breeze": "palm crowns in the breeze: from below at the boardwalk end (f000), close at the west edge (f120)",
    "clip22_bowl_carve_follow": "follow cam carve in the main bowl at head height behind him (kickturn from f097) (#67)",
    "clip23_wall_bail_close": "closer side camera on the wall bail: impact f020, snap back, board kicks out and rests, get-up, walk back f199-f226, ride away f243",
    "clip24_manual_side": "side-on manual f012-f099: weight back, nose up, corrections",
    "clip25_sketchy_landing_side": "side-on sketchy landing: pop f027, land f044, wobble",
    "clip26_kickflip_board_height": "#44: kickflip at board height, side-on (pop f018, caught f030, land f035), then front quarter 35 deg (pop f064, land f081); front foot in frame pop to catch; HUD off",
    "clip27_heelflip_board_height": "#44: heelflip at board height, side-on (pop f018, caught f030, land f035), then front quarter (pop f064, land f081); HUD off",
    "clip28_shuvit_board_height": "#44: pop shove-it at board height, side-on (pop f018, caught f028, land f035), then front quarter (pop f064, land f081); HUD off",
    "clip29_dropin_side_deck": "#65: drop-in into the main bowl from the east deck, side-on at deck level (tail on coping f016, pivot f020, on the wall f027); HUD off",
    "clip30_dropin_bowl_floor": "#65: the same drop-in seen from the bowl floor, board and coping in frame; HUD off",
    "clip31_carve_side_steep_wall": "side-on daylight carve on the steep sunlit south wall of the main bowl: camera ahead along the wall (f000-f072), then from the bowl floor level with him (f073-f161); HUD off",
    "clip32_people_seated_close": "#59-#61: seated groups from ~3 m, 7 s each: lifeguard f000, west-steps pair f210, beach couple f420; HUD off",
    "clip33_wall_ride_shadow": "#56: slow ride along the sunlit half-pipe mural wall (f000, closer from f075), the kiosk wall (f125), the mural at sunset (f175); HUD off",
    "clip34_north_qp_bank_join_follow": "#62: follow cam along the north quarter pipe east over the join into the bank (f000), back west (f075), straight up the hip (f155, kickturn from f192); a person on the north deck passes close to the camera f144-f152",
    "clip35_bowl_follow_high_carve": "#67: follow cam on a long high carve round the main bowl (kickturn from f150)",
    "clip36_idle_front_knees": "#66: the on-board idle from the front for 10 s (knees over toes through the weight shifts); HUD off",
}
STEP = {"clip10": 2, "clip12": 2, "clip13": 2, "clip14": 2, "clip15": 2, "clip16": 2, "clip24": 2, "clip25": 2,
        "clip26": 1, "clip27": 1, "clip28": 1, "clip29": 2, "clip30": 2, "clip31": 2, "clip32": 6, "clip33": 2}

# ---------------------------------------------------------------- key frames (encode.py offsets; a few hand-picked)
EV = {
    "pop": "pop", "ollie_peak": "ollie near the top (pop+7)", "flip_peak": "mid-flip near the top (pop+7)",
    "flip_caught": "board caught (flip done)", "catch": "about to land (land-2)", "landing": "landing absorb (land+1)",
    "wobble": "sketchy-landing wobble (land+8)", "grind_lockin": "grind lock-in (grind start+2)", "bail": "bail impact (+6 f)",
    "lie": "lying after the bail", "getup": "getting up", "walk": "walking back to the board", "stepon": "stepping on",
    "ride_again": "riding away", "vert_peak": "vert air near the peak", "kickturn": "kickturn (start+6)",
    "manual": "manual, 1 s in", "manual_late": "manual, 3 s in", "push_plant": "push, foot planted",
    "dropin_tail_on_coping": "drop-in: tail on the coping", "dropin_nose_down": "drop-in: nose pushed down onto the wall",
    "dropin_crouch": "drop-in: crouched on the wall over the front truck",
    "bowl_follow": "follow camera in the bowl (hand-picked, #67)", "join_east": "riding east over the quarter pipe / bank join (hand-picked, #62)",
    "join_west": "riding west over the join (hand-picked, #62)", "up_the_hip": "riding straight up the hip (hand-picked, #62)",
}

FIX = [
    (44, "FIXED (one caveat)",
     "`h44_flip_peak_compare_side.png` (clip26/27/28 f024, pop+6) and `h44_flip_peak_compare_q35.png` (f070); `h44_flip_compare_grid_side.png` / `_q35.png` (pop+2..pop+12); "
     "`h44_kickflip_peak_side/q35.png` (clip26 f026/f072), `h44_heelflip_peak_side/q35.png` (clip27 f023/f069), `h44_shuvit_peak_side/q35.png` (clip28 f020/f066); "
     "clip26-28 f018-f036 and f064-f082 (front foot in frame pop to catch); clip13/14/15 f021-f038 (critic's camera; keyframes flip_peak f028, flip_caught f033/f031)",
     "Both flips now split the legs for about 5 frames (pop+4 to pop+8, f022-f026) with the board rolling in clear air between the feet, then the feet come back together to catch (f030). "
     "Kickflip: the front foot sweeps low and out past the nose. Heelflip: the front knee lifts and the heel kicks forward and up. Shove-it: knees together, feet straight up, flat spin. "
     "Side by side at pop+6 the three leg poses clearly differ.",
     "Seen purely side-on, the kickflip and heelflip differ mainly by front-foot height; the toe-side vs heel-side direction reads best from the front quarter (q35). "
     "In clip26-28 the cap touches the top edge at the peak because the camera is framed for the feet (clip26 f025)."),
    (55, "FIXED (minor caveat)",
     "`h55_{c_bowl_coping,d_ground_low_feet,c_halfpipe_coping,c_stairs_close}_{golden,sunset,blue_hour,noon}.png` (16 stills, 1:1); "
     "`h55_shaded_crops_4x_golden_sunset.png`, `h55_shaded_crops_4x_blue_hour_noon.png`; `h55_compare_pass02_vs_pass03_bowl_coping_4x.png`; "
     "regression `c_bowl_coping.png`, `d_ground_low_feet.png`, `c_halfpipe_coping.png`, `c_stairs_close.png`",
     "Shaded concrete has the same random grain as sunlit concrete and a smooth tonal change at all four times of day; no regular dot grid at 4x (the pass-02 grid is gone in the comparison).",
     "At 4x the shadow penumbra edges show slight stair-stepping from the shadow map (golden bowl-deck crop in `h55_shaded_crops_4x_golden_sunset.png`). "
     "Faint vertical streaks on the stair risers read as form marks, not a grid."),
    (56, "MOSTLY FIXED",
     "bail: clip23 f020-f046 and f205-f224 (`h56_wall_bail_close_f020`..`f217.png`), clip23 f149; clip07 f030-f045 and f190-f254 (`h56_wall_bail_follow_f045/f120/f200/f254.png`). "
     "Riding outside a bail: clip33 f000-f224 (`h56_wall_ride_golden_f035.png`, `h56_wall_ride_close_golden_f100.png`, `h56_wall_ride_kiosk_golden_f150.png`, `h56_wall_ride_close_sunset_f200.png`)",
     "His shadow on the wall is now a human silhouette that follows his pose: cap brim, head, shoulders and arms read (`h56_wall_bail_close_f022.png`, `h56_wall_ride_golden_f035.png`, "
     "`h56_wall_ride_close_golden_f100.png`), with no dotted rim.",
     "The torso and legs merge into the shadow where they cross the dark green wave paint (`h56_wall_bail_close_f217.png`, `h56_wall_ride_golden_f035.png`); "
     "on the kiosk wall only head and shoulders read (`h56_wall_ride_kiosk_golden_f150.png`). While riding, the legs and board fall on the ground at the wall's foot, so the board does not show on the wall."),
    (57, "FIXED (minor caveat)",
     "same cameras as pass 2: `d_edge_east/north_boardwalk/south/west.png`, `d_people_boardwalk.png`, `d_people_west_steps.png`, `c_line_sw_pad_ledge.png`, `c_banks_terrace.png`, `d_town_south.png`; "
     "`h57_compare_pass02_vs_pass03_bushes.png`; close `h57_bush_close_*.png`, `h57_bush_backlit_west_planter.png`, `h57_town_bush_former_boulder.png`; "
     "extreme close `h57_bush_xclose_planter_side/flowering_side/planter_backlit/town_scrub.png`; clip20 f000-f074",
     "Bushes are soft leaf clumps with ragged, see-through outlines and painted light and shade (some flowering pink); the mossy boulder is now a leafy scrub bush; no flat facets at any distance.",
     "At 2x the leaf-card edges show a stippled alpha-dither fringe (`h57_bush_xclose_town_scrub.png`, `h57_bush_xclose_planter_side.png`)."),
    (58, "FIXED (minor caveat)",
     "`d_kiosk_town_side.png`; `h58_kiosk_town_side_golden/blue_hour.png`, `h58_kiosk_window_close_golden/blue_hour.png`, `h58_kiosk_window_oblique_golden/blue_hour.png`",
     "The window shows a shallow, warmly lit interior: menu board, stocked shelves, drinks fridge and a vendor; warm and lit at blue hour; no black void.",
     "At blue hour the fridge glows a little over-bright and hazy, with the bottles barely readable (`h58_kiosk_window_close_blue_hour.png`)."),
    (59, "FIXED",
     "`h59_walker_face_5m_clip20_framing.png` (critic's framing), `h59_walker_face_3m.png` (the purple-shirt, blue-cap walker), the other `h59_*_3m.png` faces; clip20 f000-f074; clip32",
     "No translucent planes on him or anyone else; faces are solid with readable eyes, nose, mouth and jaw.", ""),
    (60, "FIXED",
     "`h60_west_steps_hunch_above.png`, `h60_west_steps_hunch_critic_view.png` (his most hunched moment), `h60_west_steps_above.png` (+ `_sunset/_blue_hour/_noon`), `h60_west_steps_behind.png`, "
     "`d_people_west_steps.png`; clip32 f210-f419, clip20 f360-f419; the skater: `h60_skater_hair_above.png`",
     "From above, the dark hair keeps a soft sheen band and a lighter edge in all four lights, and reads as hair, not a hole.",
     "No strand detail (an even dark cap of hair); fine at gameplay distance."),
    (61, "FIXED",
     "`h61_lifeguard_face_3m.png`, `h61_lifeguard_critic_view.png`, `d_people_lifeguard.png`; clip32 f000-f209; clip20 f300-f359",
     "Eyes, brows and a smile read at about 3 m and remain as small darks at the critic's distance.",
     "Note: in clip32 the tower railing crosses his chest; his face stays clear (framing, not a defect)."),
    (62, "FIXED (minor caveat)",
     "`c_quarterpipe_and_bank_north.png` (critic's camera); `h62_compare_pass02_vs_pass03_join_2x.png`; `h62_qp_bank_join_close.png`, `h62_qp_bank_join_from_qp_deck.png`, `h62_qp_bank_join_from_bank_side.png`; "
     "clip34 f000-f074 (east over the join, keyframe f044), f075-f154 (west, f116), f155-f224 (up the hip, f184)",
     "The box notch is gone: the quarter pipe and bank meet as one continuous moulded hip, and the follow camera rides over it both ways and straight up it with no void.",
     "A faint seam where the hip meets the quarter-pipe face, and a small light mark near the top of the join (`h62_qp_bank_join_close.png`). "
     "In clip34 the skater is only about a fifth to a quarter of the frame height on the ramps."),
    (63, "FIXED (minor caveat)",
     "`b_hands_open.png`, `b_hands_relaxed.png` (critic's frames); extreme close-ups `h63_hand_open_xclose.png`, `h63_hand_open_xclose_back.png`, `h63_hand_open_left_xclose.png`, `h63_hand_relaxed_xclose.png`; "
     "skin match `h63_hand_cap_face.png`, `h63_hand_cap_face_front.png`; gameplay distance `h63_hands_follow_bail_impact/fall/lying.png`, `h63_hands_follow_manual/manual_late.png`, `h63_hands_follow_grind_5050.png`",
     "Fingers taper and bend at the knuckles; the skin is matte and matches the face beside it. At follow-camera distance the hands read as ordinary hands in bails, manuals and grinds.",
     "Fingertips are smooth caps with no readable nails, even at 3x (`h63_hand_open_xclose_back.png`)."),
    (64, "PARTLY FIXED",
     "`h64_grip_kickflip.png`, `h64_grip_heelflip.png` (grip to camera, in shade), `h64_grip_kickflip_sunlit.png`, `h64_grip_heelflip_sunlit.png` (in direct sun); "
     "kickflip panel of `h44_flip_peak_compare_side.png`; critic's frames clip13 f028, clip14 f028, `b_kickflip_mid.png`",
     "Up close the grip has sandpaper grain and a pale lit ply edge as the board rolls.",
     "At gameplay distance in shade it still reads as a near-black pill (clip13 f028, about RGB 25/12/34; `b_kickflip_mid.png`). In direct sun it overshoots to a pale khaki sandpaper tone "
     "(about RGB 150/120/80, `h64_grip_kickflip_sunlit.png`). The prop board lying on the west steps is a flat black cut-out with no texture (`h60_west_steps_hunch_above.png`)."),
    (65, "FIXED (minor caveat)",
     "clip29 f014-f040 side-on at deck level: tail on coping f018 (`h65_dropin_tail_on_coping.png`), nose down f023 (`h65_dropin_nose_down.png`), crouch f031-f032 (`h65_dropin_crouch_on_wall.png`); "
     "clip30 f014-f035 from the bowl floor (`h65_dropin_floor_tail_on_coping.png` f018, `h65_dropin_floor_on_wall.png` f029); clip01 f094-f118 in play (keyframes f097, f103, f110)",
     "Tail set on the coping, a forward lean pushes the nose down so the wheels meet the wall just below the coping, deep crouch with the chest over the front truck; no airborne phase, no level-board float.",
     "The tail-on-coping beat is short (stall f016-f019 in clip29, f095-f099 in clip01, about 0.15 s), so it reads as a quick set-up rather than a held beat."),
    (66, "FIXED",
     "clip36 f000-f299 (idle from the front, 10 s); `h66_idle_front_f060/f150/f240/f330.png`, `h66_idle_front_foot_fidget.png`; `h66_compare_pass02_vs_pass03_clip09_knees.png`; clip09 f150",
     "The knees stay over the toes through the weight shifts and the foot fidget; at the critic's clip09 f150 the knees no longer fall inward.", ""),
    (67, "FIXED",
     "clip35 f000-f239 (keyframes f040, f088, f176; kickturn f156); clip22 f045-f110 (critic's range; keyframes f045, f075, f110; kickturn f103); clip01 f110-f230",
     "The camera follows him round the bowl at about head height a few metres behind, with the wall's curve and the horizon in frame. He fills about a third of the frame height "
     "(clip22 about 240-260 px of 720, clip35 about 30-42%), against 75-100 px in pass 2. Never top-down, no dive (#46/#47 hold). "
     "Measured by projection (`tools/capture/media3_measure67_sim.mjs` replays the exact clip22/clip35 inputs through the game's physics and camera rig "
     "with a stand-in skater): body length on screen 200-306 px in clip22 (median 215 px, 30%) and 201-302 px in clip35 (median 244 px, 34%); camera "
     "0-0.34 m above his head, 3.2-4.6 m away, never off-screen or blocked. The stand-in reads slightly small: rendered clip22 f135 measures about 284 px cap to wheels.", ""),
]

NEEDS = [
    ("Drop-in, after the fix (side-on close 30 fps, from the deck and from the bowl floor, board + coping in frame)",
     "`clip29_dropin_side_deck.mp4` (f014-f040), `clip30_dropin_bowl_floor.mp4` (f014-f035); `h65_*.png`; keyframes `clip29_*` / `clip30_*`"),
    ("Carve side-on (true side-on daylight carve close-up on a steep wall)",
     "`clip31_carve_side_steep_wall.mp4`: camera ahead along the steep sunlit south wall, side-on to the board (f000-f072), then from the bowl floor level with him (f073-f161); "
     "`n_carve_along_wall_f017..f062.png`, `n_carve_from_floor_f087..f132.png`"),
    ("Flip feet (side-on board-height kickflip and heelflip, front foot in frame from pop to catch)",
     "`clip26_kickflip_board_height.mp4`, `clip27_heelflip_board_height.mp4` (side-on f018-f036, front quarter f064-f082), plus `clip28_shuvit_board_height.mp4`; `h44_*.png`"),
    ("People up close (5-10 s of each seated group from about 3 m)",
     "`clip32_people_seated_close.mp4`: lifeguard f000-f209, west-steps pair f210-f419, beach couple f420-f629 (7 s each); `h61_lifeguard_face_3m.png`, `h59_west_steps_pair_3m.png`, `h59_beach_couple_3m.png`"),
    ("Hands in play (open hand at gameplay distance during a bail and a balance moment)",
     "`h63_hands_follow_bail_impact.png`, `h63_hands_follow_bail_fall.png`, `h63_hands_follow_bail_lying.png`, `h63_hands_follow_manual.png`, `h63_hands_follow_manual_late.png`, "
     "`h63_hands_follow_grind_5050.png`; also clip07 and clip24"),
    ("Wall shadow outside a bail (riding slowly along a sunlit wall)",
     "`clip33_wall_ride_shadow.mp4`: half-pipe mural wall at golden hour f000-f124, kiosk wall f125-f174, mural at sunset f175-f224; `h56_wall_ride_*.png`"),
    ("Notch from the riding line (follow camera riding the north quarter pipe past the bank join)",
     "`clip34_north_qp_bank_join_follow.mp4`: east over the join f000-f074, west f075-f154, straight up the hip f155-f224; keyframes `clip34_*`"),
]

REGROUPS = [
    ("First frame + HUD fade (Keep: hint, prompt and pills fade)", ["a_first_frame_golden", "a_hud_t02s", "a_hud_t05s", "a_hud_t07s", "a_hud_pointer_move", "a_hud_help_open", "a_hud_help_closed"]),
    ("Times of day, close + wide (Keep: light, blue hour, noon)", ["e_golden_hour", "e_golden_hour_wide", "e_sunset", "e_sunset_wide", "e_blue_hour", "e_blue_hour_wide",
                                                                     "e_blue_hour_lamps_wide", "e_bright_noon", "e_bright_noon_wide", "e_bright_noon_sea"]),
    ("Bowl (Keep: wall gradients, coping and tile)", ["c_bowl_main", "c_bowl_coping"]),
    ("Half pipe (Keep: coping, decks, railings, exterior)", ["c_halfpipe", "c_halfpipe_coping", "c_halfpipe_inside", "c_halfpipe_deck_stairs", "c_halfpipe_exterior_east"]),
    ("Stairs (Keep: scuffed nosings)", ["c_stairs_close", "c_stairs_handrail"]),
    ("Funbox (Keep: angle iron)", ["c_funbox_iron", "c_funbox_flatbar"]),
    ("Ledges (Keep: wax and chips)", ["c_ledge_wax", "c_ledges_rail"]),
    ("People (Keep: people with idle moves)", ["d_people_beach", "d_people_boardwalk", "d_people_hp_deck", "d_people_lifeguard", "d_people_north_deck", "d_people_west_steps"]),
    ("Palms (Keep: layered crowns)", ["d_palms", "d_palms_far", "d_palm_close", "d_palm_crown_up"]),
    ("Faces (Keep: brim, hair tufts, freckles, expressions)", ["b_face_closeup", "b_face_neutral", "b_face_focus", "b_face_wide", "b_face_grin", "b_face_grimace"]),
    ("Grinds (Keep: trucks on the metal)", ["b_grind_5050_trucks", "b_grind_boardslide_trucks", "b_grind_boardslide_side", "b_grind_handrail_trucks"]),
    ("Mobile (Keep: mobile layout)", ["f_mobile_portrait", "f_mobile_landscape"]),
]
RECLIPS = [
    ("clip01_push_carve_bowl", "push cycle, bowl camera never top-down and no dive; now with the #65 drop-in"),
    ("clip02_flatground_flips", "pop timing, tre flip ride-away past the lamp"),
    ("clip04_grinds_5050_boardslide", "low side-on camera at the stairs"),
    ("clip07_bail_and_get_up", "wall bail, board rests and stays put, staged get-up, walk back and step on; camera pulls back near the wall"),
    ("clip09_camera_orbit_idle", "idle fidgets (and #66)"),
    ("clip10_grinds_trucks_side", "50-50 and boardslide lock-ins with the trucks on the metal"),
    ("clip12_ollie_side", "crouch, tuck, extension, absorb; real hang times"),
    ("clip13_kickflip_side", "flip timing (and #44)"),
    ("clip14_heelflip_side", "flip timing (and #44)"),
    ("clip15_shuvit_side", "shove-it (and #44)"),
    ("clip16_push_side", "push cycle"),
    ("clip17_vert_air_close", "close vert airs framed against the sky, nose-up kickturn"),
    ("clip20_people_motion", "people with small idle moves"),
    ("clip21_palms_breeze", "palms sway"),
    ("clip22_bowl_carve_follow", "lean into the wall on carves (and #67)"),
    ("clip23_wall_bail_close", "wall bail snap-back, board at rest, get-up (and #56)"),
    ("clip24_manual_side", "balanced manual"),
    ("clip25_sketchy_landing_side", "sketchy wobble"),
]


def must(d, k, what):
    if k not in d:
        raise SystemExit(f"no description for {what} {k}")
    return d[k]


sc = sorted(f for f in os.listdir(os.path.join(P, "screens")) if f.endswith(".png"))
kd = os.path.join(P, "screens", "keyframes")
kf = sorted(os.listdir(kd))
cl = sorted(f for f in os.listdir(os.path.join(P, "clips")) if f.endswith(".mp4"))
sh = sorted(os.listdir(os.path.join(P, "sheets")))
reg = [f for f in sc if f[:-4] in REG]
new = [f for f in sc if f[:-4] not in REG]

L = ["# Skate park media - pass-03", "",
     "Headed Chrome on the second screen via `tools/capture/run.mjs`, `?test&fps=30&mute`, 1280x720 PNG; deterministic frame-stepped simulation at 30 fps. "
     "The 18 re-shot clips keep the pass-02 names, numbering and scripts, so their frame numbers are comparable with pass 2; clips 26-36 are new. "
     "Clips are H.264 MP4, 30 fps, 1280x720 (yuvj420p, same as pass 2). Gameplay clips (01, 02, 04, 07, 22, 34, 35) use the default follow camera with the HUD on; "
     "the others use scripted side, close, orbit and fixed cameras (HUD off in 26-33 and 36). The first frame and HUD shots ran in real time with sound (`?test&fps=30`, as in pass 2); "
     "mobile shots use touch emulation at 390x844 / 844x390.", "",
     f"Counts: {len(sc)} screens ({len(reg)} pass-02 stills re-shot with the same cameras + {len(new)} pass-03 proof stills), {len(kf)} key frames, "
     f"{len(cl)} clips (18 re-shot + {len(cl) - 18} new), {len(sh)} contact sheets. Raw frame folders have been deleted.", "",
     "Regenerate: `bash tools/heavy.sh media node tools/capture/run.mjs tools/capture/media3.mjs --nohmr --out E:/shots/skate-park/pass-03` (groups via `ONLY=`), "
     "`media2_first.mjs` (first frame + HUD), `mobile.mjs --mobile` (`TAG=portrait|landscape`), then `encode.py` (MP4, sheets, key frames). "
     "The composites (`media3_compose.py`, `media3_h55_crops.py`) need the raw frames.", "",
     "Frame references are fNNN of the named clip (30 fps, counted from 0). Verdicts below are mine, from the full-resolution files.", "",
     "## screens/: pass-02 stills re-shot (same names and cameras)", ""]
for f in reg:
    L.append(f"- `screens/{f}` - {REG[f[:-4]]}")
L += ["", "## screens/: pass-03 proof stills (h = open item, n = needs-capture)", ""]
for f in new:
    L.append(f"- `screens/{f}` - {must(NEW, f[:-4], 'screen')}")
L += ["", "## screens/keyframes/ (full-res frames at pop, peak, catch, landing, grind lock-in, bail, kickturn, drop-in; event offsets as in encode.py)", ""]
for f in kf:
    m = re.match(r"(clip\d\d_[a-z0-9_]+?)_([a-z_]+)_f(\d{3})\.jpg$", f)
    clip = next((c for c in CLIPS if f.startswith(c + "_")), None)
    if not m or not clip:
        raise SystemExit(f"keyframe name not understood: {f}")
    ev = f[len(clip) + 1:].rsplit("_f", 1)[0]
    L.append(f"- `screens/keyframes/{f}` - {clip[:6]} f{m.group(3)}: {must(EV, ev, 'keyframe event')}")
L += ["", "## clips/", ""]
for f in cl:
    L.append(f"- `clips/{f}` - {must(CLIPS, f[:-4], 'clip')}")
L += ["", "## sheets/ (contact sheets labelled with frame number + time)", ""]
for f in sh:
    m = re.match(r"(clip\d\d_.+)_sheet(\d+)\.jpg$", f)
    if not m or m.group(1) not in CLIPS:
        raise SystemExit(f"sheet name not understood: {f}")
    n = sum(1 for x in sh if x.startswith(m.group(1) + "_sheet"))
    st = STEP.get(f[:6], 4)
    L.append(f"- `sheets/{f}` - sheet {m.group(2)}/{n} of {m.group(1)}, every {'frame' if st == 1 else f'{st}th frame' if st > 3 else '2nd frame'}")

L += ["", "## Fix map (open items)", "",
      "Screens are in `screens/`; key frames are named `<clip>_<event>_fNNN.jpg`.", ""]
for i, verdict, files, shows, off in FIX:
    L.append(f"- **#{i} - {verdict}.** Files: {files}.")
    L.append(f"  - Shows: {shows}")
    if off.startswith("Note:"):
        L.append(f"  - {off}")
    elif off:
        L.append(f"  - Still off: {off}")
L += ["", "### Still off, in one place", ""]
for i, verdict, files, shows, off in FIX:
    if off and not off.startswith("Note:"):
        L.append(f"- #{i}: {off}")

L += ["", "## Regression set", "",
      f"All {len(reg)} pass-02 stills were re-shot with the same names and cameras, and 18 clips with the pass-02 names, numbering and scripts. "
      "Checked against the critic's Keep list at full resolution: nothing regressed that I could see. "
      "Clips 03, 05, 06, 08, 11, 18 and 19 were not in the requested set and were not re-shot.", ""]
listed = set()
for title, names in REGROUPS:
    for n in names:
        must(REG, n, "regression still")
    listed.update(names)
    L.append(f"- **{title}:** " + ", ".join(f"`{n}.png`" for n in names))
rest = [f[:-4] for f in reg if f[:-4] not in listed]
L.append("- **Rest of the pass-02 set (same cameras):** " + ", ".join(f"`{n}.png`" for n in rest))
L += ["", "Clips (Keep item each one guards):", ""]
for c, keep in RECLIPS:
    must(CLIPS, c, "regression clip")
    if c + ".mp4" not in cl:
        raise SystemExit(f"missing regression clip {c}")
    L.append(f"- `clips/{c}.mp4` - {keep}")

L += ["", "## Not shown - needs capture: answered by", ""]
for a, b in NEEDS:
    L.append(f"- **{a}:** {b}")
L += ["", "`dev/` holds the workstreams' scratch captures and `critic/` the critic's working files; neither is part of this set."]
open(os.path.join(P, "index.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("index.md lines", len(L), "| screens", len(sc), "(reg", len(reg), "new", len(new), ") keyframes", len(kf), "clips", len(cl), "sheets", len(sh))
