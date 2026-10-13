# Golden Hour Skatepark

A cosy third-person skateboarding game that runs in the browser: a sunny beachside flow park at golden hour,
painted in a soft, warm, hand-made animated-film style. Push, carve the bowls, air out of the half pipe,
flip tricks, grind rails and ledges, manual, bail and get back up, then flip the sky to sunset, blue hour or noon.

Everything in the game is original: the park, the skater "Sol", the board and its graphic, the murals and the UI.

## Play

- **Live:** https://starknightt.github.io/skate-park/ (GitHub Pages, once deployed)
- **Local:** `pnpm install` then `pnpm dev` and open http://127.0.0.1:5188/

### Keyboard + mouse
| Input | Action |
|---|---|
| W | push (flat ground) / pump down transitions |
| A / D | steer and carve; spin in the air |
| S | foot brake |
| Space | hold to crouch, release to ollie (longer crouch = higher pop) |
| ← → ↓ ↑ + Space | kickflip, heelflip, pop shove-it, tre flip (hold the arrow at the pop, or press arrow + Space in the air) |
| E | grind / slide a rail, ledge, curb or coping (50-50 when aligned, boardslide when across) |
| Shift | manual (W / S to keep your balance) |
| hold W at a bowl lip | air out of the bowl onto the deck instead of back in |
| Mouse drag | orbit the camera · C recenters |
| T | time of day (golden hour → sunset → blue hour → bright noon) |
| R | respawn · H help |

### Gamepad (standard mapping)
Left stick push / brake / steer · A hold + release to ollie · D-pad + A flip tricks · X grind · B or RB manual ·
right stick camera · Y time of day · Start help · Back respawn.

### Touch (phones and tablets, portrait or landscape)
Left virtual stick: up pushes, down brakes, sideways steers · OLLIE: hold to crouch, release to pop; swipe ← → ↓ ↑
as you release for kickflip / heelflip / shove-it / tre flip · GRIND and MANUAL buttons · drag anywhere else to look
around · the time-of-day and help buttons sit top right.

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
`?fps=30` frame cap · `?quality=0|1|2` force quality (auto by default) · `?time=sunset|blue|noon` start time ·
`?touch` force touch controls · `?mute` · `?debug` / `?test` expose `window.__skate` (teleport, setTime, scripted
input, manual frame stepping `manual(true)` + `advance(n)`, camera views, state, event log) for deterministic
recordings — see `src/debug/testHooks.ts` and `tools/capture/`.

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
  resistance, diminishing push, carving, pumping, kickturns, ballistic air with spin control, vert assist and a
  landing-prediction assist, grinds on polylines, manual balance, wall / curb impacts and a rag-doll-free bail with a
  tumbling board.
- **Skater:** an original character modelled from signed distance fields fitted to the Mixamo reference skeleton
  (`tools/character/sdf_skater.py`), face painted procedurally (`tools/character/paint_face.py`), rigged and exported
  in Blender (`tools/blender/build_skater.py`: automatic weights through a voxel proxy + data transfer), optimised with
  glTF-Transform (meshopt + WebP). Riding is fully procedural with two-bone IK feet pinned to anchors on the deck
  (`src/player/skater.ts`); Mixamo clips are used only for falls, get-ups and an idle.
- **Look:** stylised wrap / banded lighting patched into Lambert materials, warm sun with 2-cascade soft shadows
  (three.js `SunLight` addon), violet hemisphere fill, painterly gradient sky with brushy cirrus, hand-painted cloud
  billboards, stylised ocean with a glittering sun path and shore foam, wind-swayed procedural palms, warm grade and
  vignette. Four time-of-day presets blend smoothly. Quality adapts to the frame rate.
- **Audio:** Web Audio: wheel-roll loops per surface (concrete / wooden boardwalk) pitched and filtered by speed,
  pop, landings, board clacks, metal and concrete grind loops, waves, seagulls and a gentle ukulele loop.

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

### Libraries and tools
three.js (MIT) · three-mesh-bvh (MIT) · postprocessing (Zlib) · Vite (MIT) · TypeScript (Apache-2.0) ·
glTF-Transform (MIT) · meshoptimizer decoder + simplifier (MIT, people LODs) · Nunito font via @fontsource (SIL OFL 1.1) · Blender (GPL, build
tool only) · NumPy, SciPy, scikit-image, Pillow (build tools only) · Playwright (capture tool only).

### Skills consulted
cloudai-x/threejs-skills, dgreenheck/webgpu-claude-skill, majidmanzarpour/threejs-game-skills and skills from skills.sh.
