# Architecture

Golden Hour Skatepark is about 13,800 lines of TypeScript in 33 files under `src/`, plus one stylesheet, built with
Vite and drawn with three.js r186 through its `WebGLRenderer`. Three libraries do work at run time: `three-mesh-bvh`
answers the collision queries, `postprocessing` runs the post chain, and `@fontsource/nunito` supplies the UI font.
Everything else, from the park's geometry to the skater's pose on every frame, is the game's own code. This document
walks through it in the order a frame touches it. [TESTING.md](TESTING.md) covers the tools that measured it and
[MAKING-OF.md](MAKING-OF.md) the passes that shaped it.

## The frame

`src/main.ts` creates a `Game` (`src/game.ts`) and calls `start()`. Loading runs in this order:

1. The skater's GLB starts downloading (it is also preloaded from `index.html`), and its bytes drive the loading bar
   from 5 to 70 %. The deck graphic, the cloud sheet and the three murals load alongside it.
2. The park is built in code, then the beach and town around it, the lights, the physics, the input layer, the
   autopilot, the board, the skater, the camera rig, the HUD, the post chain and the skater's own shadow map.
3. Static objects stop recomputing their matrices (`freezeStatic`), and the time of day is applied.
4. A warm-up compiles every shader variant before the first frame: it makes every object visible, turns off distance
   levels and frustum culling, compiles for the composer's half-float target (not the canvas), and then draws one full
   frame through the real pipeline, including the shadow maps and the post passes. On a cold shader cache that takes
   about 3.3 s, and with a warm one about 0.5 s. Without it, the first view of each area stalled for 100 to 250 ms.
5. The game becomes playable. Only then does the crowd's GLB download; the crowd is compiled before it is shown.

Every displayed frame then runs `frameInput` (gamepad polling, input events such as pause and time of day, camera
look), `simulate(dt)` (fixed physics steps and every visual layer), `render(dt)`, and `adaptQuality`. While paused,
only the input runs and the scene is redrawn at about 10 fps.

## Rendering and the painterly look

### Materials

Almost every surface is a `MeshLambertMaterial` made by `toonMaterial()` in `src/render/materials.ts`, which patches
three.js's shader chunks in `onBeforeCompile`:

- **Wrapped, banded light.** Diffuse light wraps past the terminator and falls into soft bands, and a backlight rim
  lights the edges that face away from the camera toward the sun.
- **A sky that knows where the sun is.** Ambient light comes from four colours set by the time of day: the zenith,
  the horizon toward the sun, the horizon away from it, and the bounce from the ground. A wall facing the sunset glows
  warm, and one facing away goes cool lilac.
- **Procedural surface detail.** The concrete has stains, slab tones, control joints, cracks, patches, wheel marks,
  blown-in sand and pores; bowls darken with depth and carry a tile band. Painted ledges chip, murals take the light
  of the wall they are on and weather, and wood and sand have their own code. One CC0 concrete map adds fine detail.
- **Hair.** Character vertex colours mark the hair, which gets a sheen and a soft outline that fade on fine tufts.
- **Wind.** Palms and leaves sway from a per-vertex wind attribute.
- **Street lamps.** Each of the 21 lamps lights a warm pool computed in the fragment shader (the shader array holds up
  to 28). On High, the lamp nearest the skater is also a real spot light with a shadow map, and the shader skips its
  pool. The kiosk's lit service window spills warm light as a line source.

### Shadows

The sun is three.js's `SunLight` addon with two cascades (2048² on High). Each filter tap compares against the
receiver's own plane, so wide soft kernels stay free of acne at a grazing golden-hour sun without a large bias that
would detach contact shadows. The filter is a separable tent of 3 by 3 bilinear taps, fixed in texture space: a
kernel rotated per pixel printed a regular dot grid into every soft shadow, which the critic caught in pass 2. The
shadow radius follows the time of day: long and soft at sunset, short and crisp at noon.

The skater has a shadow map of his own (`src/render/heroShadow.ts`): a box about 3 m across around him, 1024² on High,
so a few millimetres per texel instead of the centimetres of the park cascades. It is rendered from a nested scene
that holds only the skater and the board, and the receivers filter it by the distance behind the caster, crisp at the
feet and softer further away. While it is on, he leaves the sun cascades. That is why his shadow on a wall reads as a
person with a cap and a board instead of a smudge.

### Sky, clouds and sea

`src/render/environment.ts` holds three camera-following pieces. The sky is a dome with a zenith, middle and horizon
gradient, a glow around the sun, brushy cirrus made of fractal noise, and stars at blue hour. The clouds are painted
cumulus billboards around the horizon, cut from a generated sheet and tinted lit and shaded per time of day. The sea is
a stylised shader with summed wave normals, a glitter path toward the sun, a sky reflection by Fresnel, shore foam and
painterly banding; it starts north of the beach, because the bowls are dug deeper than sea level.

### Post

`src/render/post.ts` uses `postprocessing`'s `EffectComposer` with a half-float frame buffer (4x MSAA on High) and one
merged effect pass: FXAA first when it is on (it reads raw neighbours, so after the grade it would paste ungraded
pixels), then bloom, neutral tone mapping, and a custom grade: exposure, saturation, a gentle contrast curve, a lift, a
warm vignette that never goes black, and a fine triangular dither against banding in the sky.

### Times of day

`src/render/timeOfDay.ts` defines four presets of about forty values each: the sun's direction and the shadow-casting
light's direction, colour and strength, the four sky-ambient colours, the sky gradient and glow, the lit and shaded
cloud colours, the fog, the sea's deep and shallow colours, how bright the lamps, stars and windows are, the rim light,
the exposure, bloom, saturation and contrast, and the shadow softness.

| Preset | Sun elevation | Notes |
|---|---|---|
| Golden hour (default) | 9° | warm key light at 11°, lilac fill |
| Sunset | 1.8° | the key light at 4.5°, lamps at half strength |
| Blue hour | below the horizon | a cool key light from high up, lamps, lit windows and stars |
| Bright noon | 62° | short crisp shadows, saturated sky and sea |

T (or the pause menu) blends from one preset to the next with a smoothstep over 2.6 s; every value interpolates, and
the shaders read shared uniforms, so nothing recompiles.

### Quality tiers and adaptation

`src/render/quality.ts` defines three complete profiles: **M-low**, **M** and **high**, shown in the menu as Low,
Medium and High. Each sets the pixel ratio range, the sun-shadow map size, distance and refresh interval, the lamp spot
light, how many lamp pools the shader loops over, the skater's shadow map size, bloom, MSAA or FXAA, a lighter shader
path (`TOON_MOBILE`: four shadow taps and one cascade per pixel), the sky and sea noise, the sea's mesh density, the
crowd's size, distance levels, animation rate and shadows, and the share of leaf clumps per bush. The README's table
lists the values.

On Auto, `adaptQuality` in `src/game.ts` keeps the last 6 s of frame times and checks them every half second, ignoring
the first 5 s after a start, a resume or a return to the tab. When the 90th percentile misses a 60 Hz refresh (over
20 ms), it steps down a ladder built from the starting profile: bloom off, then the sun shadow refreshed one frame
less often, then the smaller crowd, then the lower profiles. After the ladder it lowers the render scale, but never
below 1.0 on phones (0.85 on computers), and only then caps the game at a steady 30 fps. After 20 s with frame work
under 12 ms at the 90th percentile it steps back up. Changing a profile rebuilds what it touches: the shadow maps, the
lamp light, the skater's map, the post passes, the shader path and the crowd.

The phone audit found the game CPU-bound, so the cheaper frame also comes from work that never shows: one world-matrix
update per frame for every pass, static subtrees skipped by that update, the skater's shadow pass drawing only his own
scene, and on the phone profiles, the crowd's animations staggered off the frames that redraw the sun shadow.

## The park, built in code, with exact collision

`src/world/parkBuilder.ts` accumulates two things at once: visual buckets, one mesh per material (concrete, wall,
paint, wood), and a single collision mesh with smooth vertex normals and a surface id per triangle (concrete, wood,
sand, or an invisible barrier). `src/world/park.ts` builds every feature through it, so **the triangles you see are
the triangles you ride**:

- **Bowls.** A rounded-rectangle path swept with a transition profile of height and radius. The main bowl is 18 by
  14 m and 2.3 m deep with a 2.1 m transition; the pocket bowl is 12 by 9 m and 1.4 m deep. Each coping is a closed
  grind line.
- **Quarter pipes and the half pipe.** One quarter-pipe function with a deck, optional open sides and walls; the half
  pipe is two 3.0 m quarter pipes with a 2.8 m radius facing each other over 12 m, so the top 0.2 m is vertical. It
  has decks, railings, access stairs, a ladder and a shade sail.
- **The moulded hip.** The north quarter pipe flows into a 30° bank through a hip in which every row of the grid blends
  the transition profile into the bank line with a smoothstep, so both seams are tangent-continuous and the collision
  is the same surface.
- **The south terrace.** A 1 m terrace with a 30° bank up to it, a six-stair (risers of 1/6 m, treads of 0.32 m) with a
  handrail, a 1.4 m quarter pipe on its back and side banks.
- **Street features.** A funbox (a 0.6 m truncated pyramid with angle iron and a flat bar), painted ledges (the long
  ledge is 10 m long and 0.45 m high), a red curb, a manual pad, a flat rail, and the lines that fill the flat: a
  north-west quarter pipe and a pyramid, a north-east platform with a three-stair, a rail, ledges and a bank, and a
  south-east ledge.
- **Edges and buildings.** Seat steps, planters, benches and bins; a koi-mural pavilion, the snack kiosk with the
  patchwork mural, the sun-and-waves mural on the half pipe's outer wall; lamp posts with colliders; invisible fences
  just behind the visible railings, which block and bounce but never bail.

`src/world/parkDetail.ts` adds visual-only detail: the chunky pool coping blocks, angle iron, waxed ledge edges,
abstract tags, planter plants (with `src/world/foliage.ts`'s leaf-clump bushes and agaves) and the shade sails.
`src/world/scenery.ts` builds everything beyond the park: the sand, the boardwalk, the town and beach houses, the
headland and lighthouse, palms with ringed trunks, feathered fronds and dead-frond skirts, the kiosk's lit interior and
vendor, the umbrellas, the lifeguard tower and the gulls.

`src/world/collision.ts` wraps the collision mesh in a `MeshBVH`. The physics casts front-face rays (every collision
triangle faces the open side), interpolates the smooth normal at the hit from the triangle's vertex normals, and asks
for the closest points to the body's collision spheres. The grind lines (rails, ledges and copings, each with a metal
flag and the direction into its ramp) travel with it.

`src/world/people.ts` places fifteen people: skaters waiting on decks, friends on the seat steps, walkers, a couple on
the beach, the lifeguard and the kiosk's vendor. They are clones of the skater's own mesh, recoloured per person, with
their clips from `people.glb`, and four baked distance levels (switching at 9, 22 and 45 m).

## The board physics

`src/player/physics.ts` is a kinematic skateboard controller, stepped at a fixed 1/120 s. Its state is the wheels'
contact point, the velocity, the board's normal and nose direction, and a mode: ride, air, grind, bail or recover.

### Riding

- **Following the ground.** Each step probes the surface along the board's normal. A convex change of more than about
  41° (a lip) or a drop of more than 6 cm with no change of slope (stairs, a ledge's end) sends him into the air. On a
  surface, the velocity and heading are carried onto the new tangent plane, which keeps the speed through transitions.
  Rolling into a step over 7 cm bonks him back, or bails him above 5.2 m/s.
- **Momentum.** Gravity along the slope, rolling resistance (more on wood than on concrete) and a little air drag. A
  push is a smooth sine-shaped impulse on a 0.74 s stroke shared with the animation, worth about 1.8 m/s from a
  standstill and about 0.5 m/s at 7 m/s, so pushing gives less the faster you go. Holding W going downhill on a
  transition pumps, adding up to 1.6 m/s² along the travel; on the flat it adds nothing. The brake builds to 3.4 m/s²
  over 0.15 s and lets go over 0.1 s.
- **Steering.** Key presses ramp the filtered steering in at 7 per second and out at 10, so a turn reaches 90 % in
  about 130 ms; a stick is filtered lightly. The turn rate is capped by a lateral acceleration of 7.6 m/s² (a 3.3 m
  radius at 5 m/s), plus gravity's help on a banked wall. On banks steeper than about 53°, a turn that would hold the
  line up the wall loses that help, so the line peaks and falls back instead of sticking to the top.
- **Grip.** The wheels remove sideways sliding, but only as far as friction on the load allows, so a slow skater on a
  near-vertical wall slides down instead of creeping along it.
- **Kickturns.** Riding up a transition and slower than 0.55 m/s, he pivots 180° in 0.44 s on the downhill truck (the
  back truck going forward, the front one fakie). That truck stays planted, and the height the board's centre swings
  down is handed back as speed on the way down, so a well-pumped half pipe climbs to the lip.
- **Drop-ins.** Rolling off a flat deck toward a steep coping, he rolls to a stop with the trailing truck on the
  coping and the leading end raised about 35°, holds for a beat, then pivots nose-down about the trailing wheels until
  the leading wheels meet the wall, and rides on. He is never airborne.
- **Manuals.** Shift on flat ground above 0.6 m/s holds an unstable balance with a slow wobble in it, which W and S
  counter; past the limit he drops into a sketchy wobble.

### Airs, flips and landings

- **Pops.** The pop speed runs from 1.85 to 2.8 m/s (0.38 to 0.57 s of air on flat ground) with the crouch time, or
  from a minimum charge the input sets (the quick F pop uses 0.85).
- **Air.** Ballistic flight with a little drag and spin control from A and D. Leaving a steep wall upward without W
  held, a vert assist keeps him over the ramp and keyframes a half turn about the wall's normal through a peak with
  the deck to the sky, stretched to 90 % of the predicted air time. A landing prediction traces the arc against the
  collision mesh (every step once the landing is near) and turns the board toward the ground it will meet.
- **Flips.** Kickflip, heelflip, pop shove-it and tre flip. Popped from the ground, the flick comes 0.03 to 0.075 s
  after the pop, the board turns for 0.19 to 0.34 s (stretched to fill the air), and the feet catch it 0.17 s before
  touchdown, as in the real footage. In the air, a late flip starts if at least 0.2 s of air is left.
- **Landing judgement.** Each landing compares the board's normal with the ground's, the heading with the travel (in
  either direction, so fakie is fine), how far the flip got, and the impact speed:

  | | Board vs ground | Heading vs travel | Flip done | Impact |
  |---|---|---|---|---|
  | Wobble beyond | 22° | 22° | 96 % | 7.8 m/s |
  | Bail beyond | 55° | 52° | 72 % | 11.5 m/s |

  A wobble keeps 86 % of the speed, a clean landing 97 %. The Easy landing assist turns a would-be bail into a wobble
  unless he lands nearly upside down (150° off) or more than sideways (95°) after a drop with an impact over 7 m/s.

### Grinds

Rails, ledges and copings are polylines. A grind catches from the air (within 0.62 m sideways, including a pop that
falls just short, which snaps on at its peak) or from the ground for ledges and copings. Lined up within about 52° it
is a 50-50, otherwise a boardslide; the names are 50-50 Grind, Coping 50-50, Boardslide and Ledge Slide. The grind
runs along the polyline segment by segment, losing speed to friction (less on metal) and gaining or losing it on a
slope, with a balance that steering adjusts; he falls off past the limit, pops off with Space (back into the ramp from
a coping) or rides off the end. The Easy and auto-ride auto-grind only catches approaches that run along the line, never
a carve or an ollie over a ledge, never during a vert air, and not the same line again within 1 s and 0.8 m, and it
refuses a catch with less than 0.35 m of line left in the direction of travel.

### Bails and recovery

Four collision spheres along his body look a little ahead of him. Running into something at more than 4.2 m/s bails
him: a chest-high wall snaps him back, a low one trips him over it. With bad landings and fast curbs, there are five
kinds of bail: on his face, on his back, knocked down, rolling, and off a wall. The body slides on, keeping any motion
along a slope, and the board becomes a small rigid body of its own (2.4 kg, with contact points on the wheels, the deck
edges and the kicks) that tumbles, skids and rolls, falls over onto a flat side if it lands more than about 41° off
flat, and goes to sleep once it is still.

`src/player/recovery.ts` decides where he gets up and how he gets back on. A spot is standable when it is level enough
(25° banks are, 30° banks and transitions are not), has room for a standing body and nothing overhead. If he comes
to rest on a wall he shuffles to the nearest standable spot. The board stays where it lies if he can use it and walk
to it; a board that has to change level (from the bowl floor to the deck) rolls along the ground to its spot instead
of hopping. In Easy he walks to the board at 1.7 times the normal pace and flips it over with his foot if it lies
upside down. In the headless sim, all 483 test bails (bowls, half pipe, quarter pipes, banks, stairs, ledges, rails,
funbox, walls, fences and 400 random spots) end with the body on level ground, against 347 of 483 before the rewrite.

## Fixed-step physics with render interpolation

The physics only ever advances in steps of exactly 1/120 s. `simulate()` adds the frame's time to an accumulator and
runs whole steps out of it, at most 12 per frame; after a longer hitch the remainder is capped at one step, so a hitch
becomes a brief slow-down instead of a jump.

The visual layers never read the physics. After each step it writes a `PhysView` snapshot, and every frame draws the
state a fraction `accumulator / step` of the way between the last two snapshots:

- positions lerp, the board's normal and nose normalise after a lerp, and the board's orientation slerps;
- in the air, positions follow a cubic Hermite curve with the step velocities as tangents, so the arc stays smooth
  between steps;
- the clocks the animation reads (time since the pop, the push stroke, the flip's progress, the kickturn, the wobble)
  interpolate within the same phase, and the predicted time to landing counts down to the view's own time;
- discrete fields (the mode, the grind line, events) come from the newer step.

Nothing interpolates across a jump: a teleport, a respawn or getting back on the board re-syncs both snapshots, and a
grind catch, which snaps the board onto the rail, is eased out over a few frames instead. On the ground, a lag-free
filter (it follows the view's velocity and pulls toward the samples with a 12 ms time constant) removes the
sub-millimetre noise of snapping to the collision facets. The springs in `src/core/util.ts` take an exact critically
damped step, so they move the same at any frame rate.

This is the fix for the "vibration" the user reported. A 200 Hz monitor showed a physics step on 60 % of the frames
and none on the other 40 %, so he moved 0 mm, then 47 mm, then 0 mm while the camera glided: 3.04 px of jitter side-on
at 1080p, and up to 14 px in the half pipe. Any refresh rate that divides 120 hides it, which is why the 30 fps review
captures never showed it. With interpolation it measures 0.01 px.

## The character

### Modelling

Sol is original and was modelled by scripts, not by hand. `tools/character/sdf_skater.py` builds every body and
clothing part as a signed distance field fitted to the Mixamo reference skeleton's rest pose (its bone positions were
dumped once by `tools/blender/dump_skeleton.py`) and polygonises each part with marching cubes. `cloth_masks.py` writes
per-vertex flutter and fold masks for the clothes, `hand_rig.py` the finger chains and their weights, and
`paint_face.py` paints the five face textures. `tools/blender/build_skater.py` then runs headless in Blender: it
assembles the parts, rigs them to the skeleton, imports the clips, and exports `skater.glb` and the crowd's
`people.glb`. glTF-Transform resamples, prunes and compresses them (WebP textures, meshopt geometry), and
`tools/assets/slim_glb.mjs` keeps only the clips the game plays, with 16-bit quaternions. `bash tools/build_skater.sh`
runs the whole chain; it needs Blender and the raw Mixamo files, which are not in the repository.

### Animation

`src/player/skater.ts` poses 22 bones every frame. While he rides, the whole pose is procedural: a `Pose` holds the
hips' height and offset, the pelvis and spine, the head, and arm parameters in the chest frame, and whole poses can be
cross-faded between contexts. The pose reads the interpolated physics (crouch, pop, flick, tuck, absorb, the push
stroke, carve lean from the filtered steering, the kickturn, the manual's balance, grinds, the drop-in) and drives:

- **legs** by two-bone IK to anchors on the deck, so the feet stay on the board through everything; each knee's bend
  direction follows its target through a critically damped spring, and a knee-over-toe constraint keeps the stance
  from going knock-kneed;
- **arms** aimed from the chest, with fingers that curl when relaxed and open and spread for balance;
- **the body's tilt**, which follows the board through a filtered angular rate, so the start and end of a transition
  never jolt his hips;
- **the face**, which swaps between five painted expressions: focused on approaches, grinds and manuals, wide-eyed in
  the air or a wobble, a grin after a landing, a grimace in a bail;
- **the cloth**, through the vertex masks: the tee's hem and sleeves flutter with speed and fold in a crouch.

Mixamo clips play only where hand animation would not convince: five falls (face, back, knocked down, a roll and a
wall impact), two get-ups (from the back, and from the stomach through the hands and knees), a shake-off while lying
down, a walk back to the board and idles. The mixer's output is captured and blended with the procedural pose, and the
clips are aligned to where his hips are, so a fall starts from the riding pose. Easy's quick recovery plays the fall in
about 0.6 s and starts the get-up halfway.

The board (`src/player/board.ts`) is built in code: an 81 by 21 cm deck with kicks and a concave, charcoal grip with
grain, the deck graphic, trucks and wheels that spin with the speed.

## The camera rig

`src/player/cameraRig.ts` follows the skater's hips, with a lead from his velocity so the follow spring never pushes him
off centre. The heading follows his horizontal travel, damped, and is held on walls and while slow. The player's look
input (mouse, drag, touch or stick) goes on top as offsets applied directly; each event is spread over 12 ms for a
locked mouse and 30 ms for drags and sticks, so 50 to 125 Hz input never steps a 200 Hz display.

It picks views by context:

- **side-on** for back-and-forth riding (the half pipe's pendulum, a straight climb toward a vert air or kickturn) and
  along the coping for a drop-in, so the board tipping over the lip stays in view;
- **low and side-on** at rails, ledges and stairs, so the steps and the rail's slope read;
- **in a bowl**, a little above his head and rising with him up the walls, never top-down and never diving in;
- **swung out** toward the open side of a wall.

The vertical field of view is 56° in landscape and 74° in portrait, widening a little with speed, and the distance
keeps him at about a third of the frame height (a little over a fifth in portrait, where the view is wider). Both
follow a smoothed speed, so they do not pump with each push. Clearance rays run from the look target now and from
where it will be in 0.3 s; a blocked view first tries swinging round or rising (never above 0.85 rad of elevation),
and only then pulls the boom in, on a critically damped spring. A shortened boom widens the view so cap to board
still fits about two thirds of the frame, and an eased frame guard keeps his head and board in frame. With the mouse
locked, the view holds until the player moves it, with an optional gentle recenter after 3 s of riding without
looking.

## Input, modes and auto-ride

### Input

`src/core/input.ts` merges five sources into one `SkateInput` per physics step:

- **Keyboard**, by key code, with no arrow keys anywhere. In Pro, the most recently pressed of the held W, A, S and D
  keys picks the flip when F is pressed.
- **Mouse.** A click on the canvas requests pointer lock with raw (unaccelerated) movement, retrying without it where
  that is unsupported, and drops the spikes Chrome emits on lock and unlock. One Esc both releases the lock and
  pauses. Without a lock, a drag orbits.
- **Gamepad**, standard mapping: a radial deadzone of 0.12 rescaled beyond it, an expo response, hysteresis on the push
  and brake thresholds and on the analog triggers, and a right stick capped at 180° a second of yaw and 100° of pitch
  that ramps to full speed in 0.15 s.
- **Touch** from `src/ui/hud.ts`: the floating stick (lower-left 45 % by 55 % of the screen, an 8 px dead zone), OLLIE
  with its swipe window, TRICK, AUTO, GRIND, MANUAL, the pause button and camera drags.
- **Scripted** input from the test API.

`poll()` runs once per displayed frame, even while paused, and turns button presses into events (pause, time of day,
respawn, recenter, help, auto-ride). `sample()` runs once per physics step. When the input notices it is paused (no
step for several frames), it drops every pending press, so nothing fires on resume.

### Modes

`src/core/settings.ts` stores the control mode, mouse sensitivity, invert-Y, the two volumes, the graphics level and
auto-recenter in `localStorage` under `skate.<key>`; `?mode=`, `?sens=` and `?invertY` override them for one visit, and
`?test` or `?debug` leave storage alone. The game maps the mode onto three physics assists: Easy and Auto-ride turn on
the landing assist, the auto-grind and the fast recovery; Pro turns them off. The input layer adds Easy's own rules:
the cruise (it pushes below 3.8 m/s and keeps pushing up to 4.3 on flat ground, stops after S brings him to a halt, and
gives up after 2 s of pushing against something), a 0.8 steering scale on the keyboard, a tapped ollie that crouches
for at least 0.1 s and pops at a charge of at least 0.7, and one flip button that cycles the four flips. In every mode
a rolling F press crouches automatically for 0.1 s before the pop, which the critic asked for in pass 4.

### Auto-ride

The autopilot (`src/player/autopilot.ts`) is an input source like any other: it reads the physics and returns a
`SkateInput` per step. `src/player/lines.ts` describes the lap as a chain of hand-made lines, each a list of waypoints
with a target speed and an optional action: ollie (with a random flip), grind, a flush-edge grind, manual, a wall hit
(with the usable width beside it), a bowl exit over the coping, and a half-pipe session.

- **Steering** is pure pursuit to a point 1.7 to 4.6 m ahead (further at speed), normalised by the physics' own turn
  cap, with a cross-track correction on the flat.
- **Speed**: push below the line's target, brake above it, pump on downhill transitions.
- **The half-pipe session** rides straight passes between the walls, pumps every descent until the walls are cleared,
  takes two to four vert airs, and hands back onto an exit line into the mini quarter pipe, once per visit.
- **Robustness**: it pivots and pushes when stalled, pops off a wall it is stuck on, and after a bail, a respawn or a
  takeover it finds the nearest point on the lap that a straight ride can reach.

Any movement or trick input takes over at once; the camera, T, R, Esc and Q never count. After 4 s without input,
while rolling, it carries on. The start screen runs it as an attract mode: a short intro from the spawn, then the same
lap, a little slower, with calmer tricks (mostly plain ollies and longer manuals). In pass 4 the headless sim rode 27
of 27 laps clean per mode; after the last physics change in pass 5, nine of nine per mode.

## Audio

`src/audio/audio.ts` is a Web Audio graph:

```
roll and grind loops → motion → sfx ← one-shots
sfx + ambience → sound bus (sound volume) ─────────────────────────────┐
music <audio> → 9 kHz low-pass → fade-in → music bus (music volume) → low-pass ─┤
                                                                     master (mute) → pause duck → speakers
```

- **Wheels.** Two loops, concrete and wooden planks, crossfaded by the surface under the board, with gain, pitch and a
  low-pass that follow the speed. Grinds play a metal or a concrete loop whose pitch follows the grind's speed.
- **One-shots.** The pop (louder with the charge), landings (two slices, with a clack on hard ones), board clacks and a
  body thud for bails, and gulls every 9 to 23 s, panned at random. The waves loop on the ambience bus.
- **Streaming.** `start()` runs synchronously inside the first user gesture: it creates the context, plays a
  one-sample silent buffer (older iPhones unlock audio only that way), builds the graph and fetches the sounds in the
  order they matter (pop, land, the wheel rolls, waves, grinds, clack, thud, gulls). Each loop starts as soon as its
  own file decodes. The music streams through an `<audio>` element into the same graph instead of decoding 36 MB of
  PCM, which brought the decoded audio from 98.1 MB to 21.7 MB.
- **Buses.** The pause ducks everything to a quarter, puts a 1 kHz low-pass on the music and silences the wheel loops.
- **iOS.** While the context is not running (created on a key that is not a user activation, or "interrupted" by a
  call), every pointer up, touch end, click or key retries it. A hidden page suspends the context and the music.

The shipped files are trimmed by `tools/assets/audio_trim.sh` to exactly the slices the game plays: each loop body
carries 50 ms of itself on both sides so it loops seamlessly whatever a decoder does at the edges, and the loops are
mono, except the waves, whose stereo channels are out of phase and would cancel in a mono sum.

## Phones and the web app

- **Device facts** (`src/core/device.ts`): iOS, a coarse pointer, the mobile flag (`?mobile`, a coarse pointer, iOS or a
  mobile user agent), phone size and whether it runs from the home screen.
- **Page lifecycle** (`src/core/platform.ts`): audio unlock on every gesture; a hidden page pauses the game, suspends
  the audio and releases the wake lock, and it stays paused on return; a screen wake lock on phones and tablets while
  not paused (auto-ride included); a pinch guard for iOS, which ignores `user-scalable=no`; and a "Restoring graphics…"
  note while the WebGL context is lost.
- **The web app**: `public/manifest.webmanifest` (fullscreen with a standalone fallback, any orientation, the theme
  colour #f6c49e, icons at 192, 512, a maskable 512 and Apple's 180), the Apple web-app tags in `index.html`, and on an
  iPhone outside the home screen, a tip in the pause menu where the fullscreen switch would be.
- **The load path**: the skater's GLB is preloaded and the crowd's fetched only once the game is playable (fetching
  both at once delayed the skater by 2.7 s on Slow 4G); the crowd reuses the skater's mesh, cloned before he is dressed
  and posed, and its distance levels are baked offline; the sounds wait for the first tap.
- **Touch UI**: the floating stick, the swipe window, a cancelled OLLIE that never pops, 44 px tap targets, safe-area
  insets, toasts at the top instead of under the buttons, and a modal help panel.

## Test hooks

With `?test` or `?debug`, `src/debug/testHooks.ts` exposes `window.__skate`: teleports, the time of day, scripted key
timelines, a manual clock with `advance(frames, dt)` for frame-stepped captures, fixed camera views and landmarks, the
physics state, the interpolated view, the last frame's step count and interpolation fraction, raw mouse-look counts,
pause, and the event log. [TESTING.md](TESTING.md) has the full list and the tools built on it.

## File map

```
index.html                 page, loading screen, PWA and social meta tags, the skater GLB preload
vite.config.ts             base /skate-park/ for build and preview; fixed ports 5188 (dev) and 5189 (preview)
src/main.ts                creates the Game and starts it
src/game.ts                load order, warm-up, fixed-step loop and interpolated view, board sync, events, pause,
                           time of day, quality adaptation and profiles, static matrix freezing, attract mode
src/core/input.ts          keyboard, mouse and pointer lock, gamepad, touch and scripted input; Easy rules; auto-ride takeover
src/core/settings.ts       persisted settings and URL overrides
src/core/device.ts         iOS, coarse pointer, mobile, phone, standalone
src/core/platform.ts       audio unlock, pause when hidden, wake lock, pinch guard, context-loss note
src/core/util.ts           URL params, exact critically damped springs, helpers, seeded random
src/player/physics.ts      the kinematic controller, the bail board's rigid body, PhysView
src/player/recovery.ts     standable ground, walk paths, board spots and the recovery plan
src/player/skater.ts       Sol's procedural pose, IK, clips, faces, bails, get-ups and the walk back
src/player/board.ts        the board's geometry and materials, the background boards
src/player/cameraRig.ts    the follow camera, its context views and clearance
src/player/autopilot.ts    auto-ride and attract mode
src/player/lines.ts        the hand-made auto-ride lines
src/player/tricks.ts       trick names, points and combos
src/world/parkBuilder.ts   visual buckets and the collision mesh, transition profiles
src/world/park.ts          every park feature, grind lines, murals, lamps, fences, landmarks and the spawn
src/world/parkDetail.ts    pool coping, angle iron, wax, tags, plants, shade sails
src/world/collision.ts     the BVH, smooth-normal raycasts, closest points
src/world/scenery.ts       beach, boardwalk, town, houses, headland, lighthouse, palms, kiosk, lamp posts, gulls
src/world/foliage.ts       leaf-clump bushes with a painted atlas, agaves
src/world/people.ts        the crowd: clones, recolours, baked distance levels, profiles
src/render/materials.ts    the toon material, shadow filtering, lamp pools, surface detail
src/render/environment.ts  sky, clouds, sea, lamp glow
src/render/timeOfDay.ts    the four presets and their blend
src/render/post.ts         composer, bloom, tone mapping, grade, FXAA
src/render/heroShadow.ts   Sol's own shadow map
src/render/quality.ts      the three profiles and the adaptive ladder
src/ui/hud.ts              HUD, title card, help, control tables, touch controls
src/ui/pauseMenu.ts        the pause menu
src/ui/style.css           all UI styles, safe areas, touch sizing
src/audio/audio.ts         the Web Audio engine
src/debug/testHooks.ts     window.__skate
public/                    models, textures, sounds, icons, manifest, og-image.jpg
assets_src/                generated art and CC0 texture sources (tools/textures/prep_textures.py makes the WebPs)
tools/                     see TESTING.md: character, assets, capture, realtime, sim, mobile-qa, heavy.sh
.github/workflows/deploy.yml  build with pnpm on Node 22 and deploy to GitHub Pages on every push to main
```
