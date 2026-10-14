# Golden Hour Skatepark

A cosy third-person skateboarding game that runs in the browser: a sunny beachside flow park at golden hour,
painted in a soft, warm, hand-made animated-film style. Push, carve the bowls, air out of the half pipe,
flip tricks, grind rails and ledges, manual, bail and get back up, then flip the sky to sunset, blue hour or noon.

Everything in the game is original: the park, the skater "Sol", the board and its graphic, the murals and the UI.

## Play

- **Live:** https://starknightt.github.io/skate-park/
- **Code:** https://github.com/StarKnightt/skate-park
- **Local:** `pnpm install` then `pnpm dev` and open http://127.0.0.1:5188/

On load he skates the park by himself behind the title (attract mode); press any key or tap to take over.
Three control modes, switched in the pause menu (Esc) and remembered: **Easy** (default: he keeps rolling, one-button
flips, auto-grind, landing assist), **Auto-ride** (he rides authored lines through the whole park on his own; any input
takes over, he picks it back up after a few idle seconds) and **Pro** (the full manual scheme).

### Controls
Three control modes. Switch them in the pause menu; the choice is remembered.

- **Easy** (the default on every device): he keeps rolling at a comfortable cruise by himself (W / stick up for more
  speed, S / stick down slows down and stops), the steering is forgiving, a tap of Space pops a good ollie (hold for
  higher), one flip button (F, or Space again in the air) cycles kickflip, heelflip, pop shove-it and tre flip, grinds
  lock on by themselves near rails and ledges (E still works), landings straighten themselves and bails are short.
- **Auto-ride**: he skates the park on his own, flowing through hand-made lines. Any movement or trick input takes over
  instantly (with the Easy controls); about 4 s after you let go, while rolling, he carries on. Q, gamepad Y or the
  touch AUTO button toggles auto-ride in any mode.
- **Pro**: the full manual scheme: flips picked by direction, E grinds, Shift manuals, real bails.

#### Keyboard + mouse (no arrow keys needed)
| Input | Pro | Easy / Auto-ride |
|---|---|---|
| W | push / pump transitions | faster (he cruises by himself) |
| S | brake | slow down / stop |
| A / D | steer and carve; spin in the air | the same, softer |
| Space | hold to crouch, release to ollie (longer = higher) | tap to ollie (hold for higher); in the air: flip trick |
| F | flip trick. The WASD key held when you press F picks it: none or A kickflip, D heelflip, S pop shove-it, W tre flip. Rolling: quick pop + flip · crouched on Space: pops now at the current charge + flip · in the air: late flip | flip trick, cycling kickflip, heelflip, pop shove-it, tre flip (pops one when rolling) |
| E | grind / slide a rail, ledge, curb or coping (50-50 when aligned, boardslide when across) | grinds lock on by themselves; E still works |
| Shift | manual (W / S to keep your balance) | the same |
| Q | auto-ride on / off | the same |
| T · R · C · H | time of day · respawn · recenter camera · help | the same |
| Esc | pause menu | the same |
| Mouse (optional) | click the game to lock the mouse and look around (raw mouse look), or drag to orbit; Esc frees the mouse and opens the pause menu | the same |

The camera follows by itself, so the keyboard alone is enough. Hold W at a bowl lip to air out onto the deck instead
of back in. Mouse sensitivity and invert-Y are in the pause menu.

#### Gamepad (standard mapping)
| Input | Pro | Easy / Auto-ride |
|---|---|---|
| Left stick | steer · up push · down brake | steer · up faster · down slow / stop |
| A | hold to crouch, release to ollie | tap to ollie; in the air: flip trick |
| X | flip trick; the left-stick direction picks it (none or left kickflip, right heelflip, down shove-it, up tre flip) | flip trick, cycling the flips |
| D-pad + A | hold a direction as you release A: the same flips (alternate) | the same |
| B | grind | grind (grinds also lock on by themselves) |
| LB / RB | manual | the same |
| Y | auto-ride on / off | the same |
| Right stick · L3 / R3 | camera · recenter | the same |
| Start · Back · LT | pause menu · respawn · time of day | the same |

#### Touch (phones and tablets, portrait or landscape)
- **Pro:** floating stick: put your thumb down anywhere in the lower-left area and the stick appears under it (up
  pushes, down brakes, sideways steers) · OLLIE: hold to crouch, release to pop; a short swipe left / right / down / up
  as you release gives kickflip / heelflip / shove-it / tre flip (a drifting thumb or a long slide is a plain ollie) ·
  GRIND and MANUAL buttons.
- **Easy / Auto-ride:** the same floating stick (steer; he cruises, up for more speed, down slows down and stops) ·
  OLLIE: tap to pop · TRICK: flip trick, cycling the flips · AUTO: auto-ride on / off (lit while it drives). Grinds are
  automatic, so there is no GRIND button.
- **Every mode:** drag anywhere else to look around · the pause button sits top left · time of day, sound and help top
  right · a system gesture (notification shade, app switcher) never makes him jump.

#### Phones and tablets
- **Fullscreen / install:** on Android, Chrome's "Install app" (or "Add to Home screen") plays it fullscreen from its
  own icon; on iPhone and iPad, Safari → Share → Add to Home Screen (the pause menu shows this tip where the browser has
  no fullscreen). The fullscreen switch in the pause menu works wherever the browser allows it.
- **Lighter graphics tier** by default on phones and tablets (simpler shadows refreshed every other frame, no bloom, a
  smaller crowd with nearer detail levels, lighter sky and sea); it adapts to the device: effects go first, the
  resolution never drops below one rendered pixel per CSS pixel, and a steady 30 fps is only the last resort. Pause
  menu → Graphics overrides it.
- It pauses (and goes quiet) when you switch apps or lock the phone, keeps the screen awake while you ride or watch
  auto-ride, and the sound starts with your first tap. Portrait uses a wider camera; landscape shows the most.

#### Pause menu
Esc, gamepad Start, the touch pause button or the menu pill (top right on desktop) open it: the game freezes and the
sound ducks. Resume (locks the mouse again if it was locked) · Respawn · Controls (the full reference per device and
mode) · control mode · time of day · music and sound volume · mouse sensitivity and invert-Y · graphics quality (Auto,
Low, Medium, High) · fullscreen. Keyboard: W / S move, A / D change, Enter or Space select, Esc resumes. Gamepad:
D-pad or left stick, A selects, B goes back / resumes, Start resumes.

### How it feels
Momentum based: pushing gives diminishing returns, transitions convert height into speed and back, uphill costs you,
carving keeps your speed. Landings are judged on board angle, heading versus travel (fakie is fine) and whether the
flip was caught: slightly off makes you wobble, really off makes you bail. Hitting a wall at speed bails you too.
Trick names and a small combo score pop up and fade; tricks chain into combos until you roll away for a second.
Roll slowly over a coping from a deck to drop in: tail on the coping, lean the nose down onto the wall, ride it out.

## Run / build

```bash
pnpm install
pnpm dev          # dev server (http://127.0.0.1:5188/)
pnpm build        # production build into dist/ (base /skate-park/ for GitHub Pages)
pnpm preview
pnpm typecheck
```
The GitHub Pages workflow is `.github/workflows/deploy.yml` (pnpm build → actions/deploy-pages).

### URL parameters
`?mode=easy|auto|pro` control mode for this visit (not saved) · `?sens=<x>` / `?invertY` mouse look ·
`?fps=30` frame cap · `?quality=0|1|2` force quality (auto by default) · `?time=sunset|blue|noon` start time ·
`?touch` force touch controls · `?mobile` phone / tablet graphics tier and its adaptation on any device · `?mute` ·
`?debug` / `?test` expose `window.__skate` (teleport, setTime, scripted
input, manual frame stepping `manual(true)` + `advance(n)`, camera views, state, event log) for deterministic
recordings — see `src/debug/testHooks.ts` and `tools/capture/` (under `?test` the default mode is Pro, no attract;
add `&attract` to see the start screen). Real-time smoothness protocol: `tools/realtime/README.md`.

## How it is made

- **Engine:** Vite + TypeScript + [three.js](https://threejs.org) (WebGLRenderer), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)
  for collision queries, [postprocessing](https://github.com/pmndrs/postprocessing) for bloom / tone mapping / grade.
- **Park:** built procedurally in code (`src/world/park.ts`) with an exact collision mesh: two pool bowls with tile
  bands and metal coping, a 3 m half pipe with a little vert, quarter pipes, 30° banks, a six-stair with a handrail,
  a funbox with hips and a flat bar, painted ledges / curb / manual pad, a flat rail, connecting lines (pyramid, hips,
  extra banks, a platform three-stair with rail, more ledges and rails), landscaped edges (seat steps, planters,
  benches, sand drifts) and murals on a pavilion, a kiosk and the half-pipe wall. People hang out around the park:
  skaters waiting on the decks, friends on the steps, walkers on the boardwalk, a couple on the beach and a lifeguard.
- **Physics:** custom kinematic skateboard controller (`src/player/physics.ts`, 120 Hz): slope gravity, rolling
  resistance, smooth push strokes, ramped steering capped by lateral grip (more on banked walls), pumping, forward and
  fakie kickturns that keep their height, ballistic air with spin control, vert assist and a landing-prediction assist,
  grinds on polylines, manual balance, wall / curb impacts and a rag-doll-free bail with a tumbling board; recovery
  always gets up on level ground (`src/player/recovery.ts`). Easy mode adds landing assist, auto-grind and fast recovery.
- **Smoothness:** the fixed-step physics is drawn interpolated (`PhysView`: positions, orientations and every pose
  clock), with Hermite arcs in the air and a lag-free filter on the ground, frame-rate-independent springs and an eased
  camera, so it is smooth at 60, 144 or 200 Hz alike (measured with `tools/realtime/`).
- **Auto-ride:** an autopilot (`src/player/autopilot.ts`, lines in `src/player/lines.ts`) that only produces input:
  pure-pursuit steering along authored lines, speed management, pumping, ollies, flips, grinds, manuals, half-pipe airs.
- **Skater:** an original character modelled from signed distance fields fitted to the Mixamo reference skeleton
  (`tools/character/sdf_skater.py`), face painted procedurally (`tools/character/paint_face.py`), rigged and exported
  in Blender (`tools/blender/build_skater.py`: automatic weights through a voxel proxy + data transfer), optimised with
  glTF-Transform (meshopt + WebP). Riding is fully procedural with two-bone IK feet pinned to anchors on the deck
  (`src/player/skater.ts`); Mixamo clips are used only for falls, get-ups and an idle.
- **Look:** stylised wrap / banded lighting patched into Lambert materials, warm sun with 2-cascade soft shadows
  (three.js `SunLight` addon), violet hemisphere fill, painterly gradient sky with brushy cirrus, hand-painted cloud
  billboards, stylised ocean with a glittering sun path and shore foam, wind-swayed procedural palms, warm grade and
  vignette. Four time-of-day presets blend smoothly. Quality tiers live in `src/render/quality.ts` (desktop high, the
  mobile tier and its low fallback); the adaptation judges the 90th-percentile frame time and turns features off before
  it touches the resolution.
- **Loading:** the skater GLB loads first (meshopt-compressed, only the clips the game plays); the crowd (baked detail
  levels, no runtime simplifier) streams in after the game is playable and is compiled before it appears. Installable
  as a web app (`public/manifest.webmanifest`).
- **Audio:** Web Audio: wheel-roll loops per surface (concrete / wooden boardwalk) pitched and filtered by speed,
  pop, landings, board clacks, metal and concrete grind loops, waves, seagulls and a gentle ukulele loop. Each sound
  starts as soon as its own file is decoded; the music streams through an audio element into the same mix.

## Credits

### Sounds (all CC0 1.0, from [freesound.org](https://freesound.org))
| File | Sound | Author | Source |
|---|---|---|---|
| roll_concrete.mp3 | BPS-SKATEBOARDING RIDING-Concrete Skatepark-Transition-Cruising | bspiller5 | https://freesound.org/people/bspiller5/sounds/478162/ |
| roll_wood.mp3 | Rolling Wheels 2 | CJspellsfish | https://freesound.org/people/CJspellsfish/sounds/727643/ |
| grind_metal.mp3 | Skateboard Metal Grinding.1 | rokenjocu | https://freesound.org/people/rokenjocu/sounds/262079/ |
| grind_concrete.mp3 | skateboard grinding on concreate slab | 21100495 | https://freesound.org/people/21100495/sounds/655372/ |
| pop.mp3 | popping up skateboard | nolimitkid | https://freesound.org/people/nolimitkid/sounds/515226/ |
| land.mp3 | BPS-SKATEBOARDING GRINDS-Slides-Concrete Ledge-Multiple Lands-1 | bspiller5 | https://freesound.org/people/bspiller5/sounds/478164/ |
| clack.mp3 | Longboard hitting the ground | gerardcatala | https://freesound.org/people/gerardcatala/sounds/153285/ |
| waves.mp3 | WavesOnTheShore | richardemoore | https://freesound.org/people/richardemoore/sounds/260263/ |
| seagulls.mp3 | Seagull on beach | squashy555 | https://freesound.org/people/squashy555/sounds/353416/ |
| music.mp3 | ukulele | _steef | https://freesound.org/people/_steef/sounds/173122/ |
| bail_thud.mp3 | Body fall_02 | deleted_user_2104797 | https://freesound.org/people/deleted_user_2104797/sounds/346694/ |

Since pass 5 the shipped files (except music.mp3) are trimmed to the parts the game plays and re-encoded (mostly mono),
by `tools/assets/audio_trim.sh` from the originals above.

### Textures
| Asset | Author | Source | License |
|---|---|---|---|
| Concrete 034 (detail map for the concrete) | ambientCG / Lennart Demes | https://ambientcg.com/view?id=Concrete034 | CC0 1.0 |
| Planks 029 L (boardwalk planks) | ambientCG / Lennart Demes | https://ambientcg.com/view?id=Planks029L | CC0 1.0 |

### Generated for this project (original artwork, Cursor image generation)
Skater concept turnaround (`assets_src/generated/skater_concept_turnaround.jpg`), the three murals ("sun and waves",
"koi and octopus", "tropical patchwork"), the deck graphic (sun, waves and a paper boat) and the painted cumulus
clouds sheet (chroma-keyed into `public/textures/clouds.webp`). The skater's five face expressions (neutral, focused, wide-eyed, grin, grimace) are painted procedurally by
`tools/character/paint_face.py`. All other geometry (park, scenery, houses, palms, board, skater) is generated in code.

### Animation
Fall, get-up, idle and balance clips from [Mixamo](https://www.mixamo.com) (Adobe), used under the Mixamo licence and
shipped only baked into `public/models/skater.glb`: Falling Flat On Face, Slip And Fall Backwards, Knocked Over And
Falling To The Ground, Mid Air Falling Into A Roll, Frantically Slip And Fall To Stomach, Falling In The Air Idle,
Getting Up From Stomach, Getting Up From Back, Getting Up From Being Knocked Down, Standing Idle, Wobbling On A Ledge,
Slipping Off An Edge Then Regaining Balance, Standard Walk, Male Knocked Down From A Punch (wall impact), Laying On A Bed Shrugging (re-baked to the floor as the post-bail shake-off), Weight Shift Idle, Idle Stand Looking Around. The park's people (`public/models/people.glb`, recoloured variants of the same original character) use Sitting With Breathing Idle, Sitting While Laughing, Sitting Reclined On The Floor, Standing Texting On Phone, AJ Waving Gesture and Sitting Unenthusiastic Clap. The rig is the standard Mixamo skeleton (reference "Bryce"); no Mixamo
character mesh is used. Raw FBX files are not part of this repository.

Pass-3 additions (drop-in, a dedicated high-resolution shadow for the skater, painted leaf-clump foliage, the lit kiosk
interior, the charcoal grip texture) are all generated in code; no new third-party assets were added.
Since pass 5 `skater.glb` carries only the clips the game plays (the stomach fall, air flail, knocked-down get-up, ledge
wobble, regain-balance and relaxed idle were dropped), and the crowd reuses the skater's mesh, so `people.glb` holds
only the crowd's clips and its baked detail levels.

### App icons
`public/icons/*` (home-screen and install icons) are original artwork drawn by `tools/assets/make_icons.py` for this
project; no third-party assets.

### Libraries and tools
three.js (MIT) · three-mesh-bvh (MIT) · postprocessing (Zlib) · Vite (MIT) · TypeScript (Apache-2.0) ·
glTF-Transform (MIT) · meshoptimizer decoder + simplifier (MIT; the simplifier bakes the crowd's detail levels offline) · Nunito font via @fontsource (SIL OFL 1.1) · Blender (GPL, build
tool only) · NumPy, SciPy, scikit-image, Pillow (build tools only) · Playwright (capture tool only).

### Skills consulted
cloudai-x/threejs-skills, dgreenheck/webgpu-claude-skill, majidmanzarpour/threejs-game-skills and skills from skills.sh.
