# The making of Golden Hour Skatepark

Golden Hour Skatepark was built in Cursor by AI agents in about 28 hours, from the early afternoon of 13 October 2026
to the late afternoon of the 14th. It went through five builder and critic passes, a real-time diagnosis, a mobile QA
audit, the user's own play-test, an overnight run and two power cuts. This is what happened, with the numbers from the
critiques and the build logs. The working notes, screenshots and recordings stayed on the build machine; only the
results are in this repository.

## The method: a builder and a critic

A builder agent wrote the code for each pass and then captured a fixed set of media from the running game: stills from
named cameras, keyframes, clips and contact sheets, frame-stepped at 30 fps through a manual clock so the same input
always gave the same frames. A separate critic agent then reviewed those media and nothing else. It never worked from
the code. It compared every frame with photographs of real beachside skateparks at golden hour and with real
skateboarding footage, and listed everything that looked fake.

The reason for the split is that a builder reviewing its own work sees what it meant to build. The critic saw only
what was on the screen, and it had real references to hold it to. Every finding had the same shape: **Fake** (the
frames that show it), **Real** (the reference that shows the truth) and **Fixed when** (what a fix must look like), and
one of three tags:

- **BREAKS**: kills the illusion on sight;
- **NOTICEABLE**: a normal viewer reads it as fake or unfinished;
- **MINOR**: polish.

Each critique also kept a **Keep** list of things that already worked and must not regress, and a **Not shown** list
of captures it needed next time. The builder answered with an index of the new media and a fix map, item by item. The
loop ran until the verdict was PASS, and the builder and the critic never ran at the same time.

## The reference set

The critic's references came from Wikimedia Commons, each with its author and licence recorded. They were used for
comparison only and never shipped:

- **22 photographs**: skatepark bowls and plazas by the sea (Venice Beach, Bondi, Marseille, Barcelona and Málaga) at
  golden hour, sunset and blue hour, with details such as pool coping and tile, weathered murals, a grind on a painted
  ledge at sunset, a skater backlit with a long shadow, a beach boardwalk at sunset, palms against the sky, and a
  concession stand and a seaside kiosk for the snack kiosk's window;
- **13 stills** of moves with no usable video: an ollie sequence, a flip in multiple exposure, boardslides, a manual,
  bails, pushes and three drop-ins;
- **22 video clips**, two of which turned out to be interviews, cut into labelled contact sheets.

From them the critic measured the numbers it judged by. A flatground ollie takes 0.37 to 0.38 s from pop to landing
and a kickflip about 0.41 s; the board rolls once in about 0.17 s while the legs split, and the feet catch it near the
peak. A ledge grind lasts about 0.7 to 0.8 s. In a real bail the board rolls about 2 m and stops flat on its wheels,
and the rider stands about 4 s after the impact and walks back to it. In a carve the body leans into the wall,
perpendicular to it, with the knees deeply bent and the arms moving.

## The passes at a glance

| Pass | Verdict | New and open issues | Breaks | Noticeable | Minor | From the previous list |
|---|---|---|---|---|---|---|
| 1 | FAIL | 54 | 7 | 33 | 14 | |
| 2 | FAIL | 14 | 0 | 7 | 7 | 53 of 54 fixed, 0 regressed |
| 3 | PASS | 6 | 0 | 0 | 6 | 14 of 14 fixed, 0 regressed |
| 4 | FAIL | 7 | 0 | 4 | 3 | 5 of 6 fixed, 1 narrowed, 0 regressed |
| 5 | PASS | 4 open | 0 | 0 | 4 | 5 fixed, 1 fixed in its main case, 1 deferred |

## Pass 1: 54 issues

The first playable build was committed at 14:35 on 13 October: a park built in code, a kinematic skateboard
controller, an original rigged skater and a golden-hour look. Pass 1 added bails with motion clips, camera fixes,
fences round the park, the GitHub Pages workflow and the capture tools. The critic went through 45 screenshots, 51
keyframes, 9 clips and 19 sheets and came back with 54 issues: 7 breaks, 33 noticeable, 14 minor.

The seven breaks were all about motion:

- **Every trick floated.** 28 to 29 frames (0.93 to 0.97 s) from pop to landing on flat ground, the hang time of a
  jump more than a metre high, against 0.37 to 0.41 s in the footage: "slow motion or moon gravity".
- **The body held one pose through every trick**: no wind-up, no snap of the back leg, no tuck, no reach for the
  ground.
- **The board hovered in mid-air** at foot height beside him for about 3 s while he lay after a bail.
- **The carve folded him about 90° at the waist**, then froze him in one pose on the bowl wall for 2.4 s.
- **The manual was a frozen T-pose** for 3.3 s.
- **The wall bail passed through the wall** with no impact.
- **A clean tre flip ended in a snap-bail**: he turned 90° in two frames next to a lamp post that nothing touched.

The noticeable list read like a tour of the scene: concrete one flat colour, bowls filled with flat lavender, no rim
light when he was backlit, murals that looked like self-lit stickers, a blue hour that was daytime with a filter, a
washed-out noon, moiré on the concrete, an unidentified object floating in the sky, no people anywhere ("a ghost
town"), features scattered across one big slab, beach houses with floating roofs, palms like stiff ferns, a toy-like
head and cap, clothes like rigid shells, a push that looked like walking, a camera that went top-down in the bowl and a
controls panel that never left the screen.

## Pass 2: 53 of 54 fixed

Pass 2 split the work into five parallel workstreams (animation and physics, lighting, the world and its people, the
character and its clips, and the camera and HUD). With several agents sharing one GPU, it also introduced the
heavy-job lock: one browser run, Blender job, production build or video encode at a time, machine-wide.

The tricks came down to earth: a full-crouch pop now stayed up 17 to 18 frames (0.57 to 0.6 s) and a quick pop about
14 (0.47 s), both what gravity gives for their height, with a crouch, a pop, a tuck, an extension and an absorb. The
push planted the foot and swept it back, carves leaned into the wall, kickturns lifted the nose, the manual balanced,
sketchy landings wobbled, the wall bail snapped him back, and he got up in stages and walked to the board. The light
learned which way each face pointed, the bowls got gradients with warm bounce, and the park got people, houses with
porches, a headland, real palms and a face with expressions.

The critic, now with 122 screenshots, 25 clips, 161 keyframes and 54 sheets to go through, marked 53 of the 54 items
fixed, none regressed. The one left was the kickflip and the heelflip, which still used the same legs frame for frame.
It found 13 new problems, for 14 open in all (0 breaks, 7 noticeable, 7 minor): a fine dot grid inside every soft
shadow, his shadow on the mural wall a shapeless smudge, faceted low-poly bushes, a flat black void for the kiosk's
window, a see-through sheet across one walker's face, a box-shaped notch where a quarter pipe met a bank, a drop-in
that was really an upright air off the lip, and a bowl camera that let him shrink to a dot.

## Pass 3: the first PASS

Pass 3 fixed all 14. The kickflip's front foot now flicks off the toe edge and the heelflip's heel kicks forward, with
the legs split for about six frames around the peak. The drop-in got a real set-up: tail on the coping, nose down onto
the wall, a deep crouch. The shadow filter was rebuilt to sample in a fixed pattern (the per-pixel rotated kernel was
the dot grid), the skater got a dedicated high-resolution shadow map so his shadow on the wall reads as him, the
bushes became painted leaf clumps, and the kiosk window opened onto a lit interior with a vendor.

The critic, reviewing 247 screenshots and 29 clips, gave the first PASS: "nothing left that breaks the illusion". Six
MINOR items remained: the sunlit grip tape washing out to a pale khaki, the kiosk's wall sinking to black at blue hour
(17.6 % of its frame below 18 of 255), black background boards, a dotted fringe on cut-out hair and leaf edges, a
drop-in set-up that held the board level over thin air for 0.27 s, and low-poly agaves.

## The user's play-test

At 00:20 on 14 October the user played the pass-2 build in real time and wrote down eight things, which from then on
outranked the critic's minor items:

1. **The skater vibrates.**
2. **The controls aren't smooth**: steering, pushing and the camera felt abrupt.
3. **The mouse can't be locked** for mouse look.
4. **Esc doesn't open a pause menu.**
5. **He goes inside the bowl**: after a bail he stood upright on the steep wall just under the coping, sinking into
   it, with no board under him.
6. **"A lot of things to do by far"**: it did not feel finished in the hand yet.
7. **No arrow keys anywhere.** Many keyboards have none, and the right hand belongs on the mouse, so flips moved to F,
   with the W A S D key held at that moment picking the flip.
8. **"This game is too manual."** Three modes: Easy as the new default, Auto-ride, where he skates by himself, and Pro.

### The real-time diagnosis

A separate agent took the exact build the user had played and measured it with real keyboard and mouse input at the
monitor's 200 Hz, logging every displayed frame. The vibration was the fixed 120 Hz physics drawn without
interpolation: 40 % of the frames got no physics step and 60 % got one, so at 6 m/s the skater moved 0 mm, then 47 mm,
then 0 mm while the spring-smoothed camera glided. That was 3.04 px of jitter side-on at 1080p and up to 14 px in the
half pipe, with 159 direction reversals a second. At 30, 60 and 120 Hz it measured exactly zero, which is why no
30 fps review capture had ever shown it. A prototype interpolation patched into the page took it from 3.04 px to
0.01 px.

The diagnosis found more under it. The animation read the physics clocks raw, so the kickflip's spin froze on 15 of
its 38 frames; the push snapped the back knee by up to 46° in a single frame, three times per stroke; the steering
jumped to 130° a second within one physics step, for a 2 m turn; the push had 225 ms of dead time and then a surge of
nearly 1 g; the brake was on or off; and the mouse orbit lagged in yaw and stepped in pitch. It wrote a fix plan in
eleven steps and a real-time protocol with pass thresholds, which every motion review used from then on (see
[TESTING.md](TESTING.md)).

## Pass 4: the overnight run

At 01:45 the user left the machine to the agents for the night: "pc is yours … finish it … see you tomorrow". The
pass-3 builder had already stopped with "no progress", its context used up, so pass 4 began at 03:00 with a fresh
builder briefed from the notes. Its first step was to put the pass-3 build on GitHub Pages, live at 03:25, so the user
would have a link in the morning. Then it ran as a lead with helpers editing the code at the same time, each owning
named files or regions under a written contract:

- **Smoothness**: every visual layer moved onto a snapshot interpolated between physics steps, and every pose clock
  with it. Side-on jitter went from 3.04 to 0.00 px, the half pipe from 3.63 to 0.36 px, and the kickflip had no
  frozen frames.
- **Feel**: steering now reached 90 % in 126 to 128 ms instead of 3 to 8, with a 3.05 m radius at 4.8 m/s instead of
  2.0; the push answered in 90 ms instead of 232, peaking at 6.67 m/s² instead of 9.1; the brake ramped; and the
  worst knee snap in a push dropped from 49° to 2.7° per frame.
- **Input**: pointer lock with raw mouse movement, the F flips, Easy's rules and gamepad response curves.
- **UI and audio**: the pause menu, the HUD and audio buses that duck when paused.
- **Recovery**: 103 of 483 simulated bails had left the body on ground nobody could stand on, such as the bowl wall.
  After a rewrite, 483 of 483 ended on level ground, and the landing assist, auto-grind and fast recovery arrived for
  Easy.
- **Auto-ride**: an autopilot that rides hand-made lines through the whole park, nine of nine laps clean in the first
  simulations.
- **Visuals**: the minor items. The sunlit grip went from a brightness of 159 to 66 against concrete at 160, the share
  of black pixels on the kiosk at blue hour from 17.6 % to 4.3 %, and the background boards from 1 to 26.

Batch 1 was committed at 04:37 and deployed at 04:41. Batch 2 (the attract mode, a load-time shader warm-up, smoother
half-pipe riding and drop-ins, fakie kickturns) was nearly done when, some time after 05:30, the power went out.

### The first power cut

Nothing ran again until 10:40. The user was asleep, and batch 2's uncommitted edits had survived on disk. The builder
resumed, checked the tree (typecheck clean, the recovery and assist sims passing) and fixed what was left: kickturns
had slid about 0.55 m down the wall each time, which capped half-pipe pumping below the lip, and a last flicker in the
half pipe came from sub-millimetre noise in the ground position. The protocol then passed 12 of 12 scenarios at 200 Hz
and 10 of 10 in a 60 Hz sweep, and batch 2 went live at 10:56.

At 11:01 the user asked for mobile support. At 11:08 the second monitor came back on, and every test window was moved
there, clamped to the right of x = 1920, so the user could work on the main screen. Test windows never take the focus,
so the agents emulated pointer lock inside the page instead of grabbing the real one; the one later run in which
Chrome granted a real lock picked up the user's own mouse movements and was thrown away. Pass 4 was finished and live
at 12:25, with 0 console errors and a 5.5 s load.

The critic reviewed pass 4 under a time box, because the user now wanted the final version by 5 PM. It confirmed the
vibration gone ("every edge is straight on flat ground" in its slit-scans of all 12 real-time recordings), five of the
six minor items fixed, and the auto-ride's lap believable. But it found seven issues, four of them noticeable:

- **#74**: an F flip pressed while rolling popped from straight legs and landed in about 0.2 s, "a twitch, not a flip";
- **#75**: in Easy's fast recovery the board balanced on its edge, then slid a metre to his feet by itself;
- **#76**: beside walls in auto-ride, the camera jumped to a tight shot of his legs;
- **#78**: in the bowl he lay flat along the top of the wall for 1.4 to 1.6 s, then swung upright onto the coping in
  about five frames;

plus three minor ones: the shore walker's fringe (#71), pale triangles on the agave blades (#77), and the title card
across his head (#79).

## The mobile audit

Between 11:10 and 12:30 a read-only QA agent tested the live build as a phone would see it: headless Chrome with six
device profiles, the CPU throttled four and six times, Fast and Slow 4G, a 60 Hz refresh emulated in the page, and real
multi-finger touch. It found 25 issues and a protocol result of 32 PASS against 40 FAIL. The game took 8.3 to 8.5 s to
become playable on Fast 4G with a four times slower CPU. The sound was all or nothing: 5.75 MB of MP3 decoded to 98 MB
of PCM, and nothing played for 6 to 19 s after the first tap. The adaptive quality dropped phones to a pixel ratio of
0.85 within 3 s and never came back, without helping, because the frame was bound by the CPU (207 draw calls,
1.32 million triangles, and a skater shadow pass that redrew the whole scene). The auto-ride toast sat under the
buttons, tap targets were 24 to 42 px, there was no web app manifest, and the audio unlock probably failed on iPhones,
where a touch's pointerdown does not count as a user gesture.

## Pass 5: two tracks against a deadline

At 13:18 the user wrote "use multiple agents if you want and cook, i'm not gaming", and a fresh lead started pass 5 at
13:20 with two tracks of helpers.

**Track M (mobile)** took on the audit:

- **Loading**: Sol's model went from 2.03 MB to 854 KB (only the clips the game plays, 16-bit quaternions, meshopt
  filters), the crowd's from 1.55 MB to 494 KB by reusing his mesh with distance levels baked offline, and the crowd now
  downloads after the game is playable.
- **Audio**: the sounds were trimmed to the slices the game plays (0.73 MB) and the music streams, so the decoded audio
  fell from 98.1 MB to 21.7 MB and everything was decoded about 1.4 s after the first tap.
- **Performance**: three quality profiles, a rewritten adaptation that turns features off before resolution and never
  drops a phone below a pixel ratio of 1.0, and CPU cuts. Medium went from 207 to 105 draw calls and from 1.32 million
  to 561,000 triangles, and the emulated mid-range Android from 44.9 to 52.1 fps to 58.5 to 59.1.
- **Touch and platform**: a floating stick, a stricter swipe window, a cancelled touch that never pops, safe areas,
  44 px targets, toasts at the top, a pause when the page is hidden, a screen wake lock, the web app manifest and a
  wider portrait camera.

On the helpers' builds the protocol went from 32 PASS and 40 FAIL to 62 PASS and 0 FAIL.

**Track C** took the critic's list. The rolling F flip now crouches for 0.1 s first (his hips drop about 21 cm over
five or six frames) and pops at a higher charge, so the air went from 0.438 to 0.533 s (#74). The bail board falls
flat once it is more than about 41° off flat, stays where it stops, and he walks to it: in 230 simulated bails the board
had moved toward him 69 times, and now it never does (#75). The camera's boom eases in and out on a spring and checks
the clearance 0.3 s ahead, so in headless auto-ride laps the frames with his head out of shot fell from 461 to 132 and
those with the board out from 186 to 0, and the real-time takes had none of either (#76). Turns that fight gravity on
the steep top of a bowl wall lose their help, cutting the level stretch from 1.03 to 0.62 s, and the swing onto the lip
now takes 0.2 s instead of 0.11 (#78). The agave margins turned out to be wound inside out (#77), and the desktop title
moved into the sky with one prompt at a time (#79). The fringe (#71) was traced to its cause and deferred.

The mobile track was committed at 14:35 and the critic's track at 15:31.

### The second power cut

Around 15:35 the power went out again, and every process died: the helpers, a full mobile protocol run, the dev server
and the preview. When it came back, the stale heavy-job lock was cleared and the 15:31 commit pushed at 15:43, and the
Pages deploy succeeded. The lead resumed with a compressed plan. A follow-up to the bail fix, started a minute before
the cut and never tested, was reverted rather than shipped. A finish script then checked the live build: no console
errors and every asset served, a ten-point desktop play-through with real input (all ten passed), the real-time
subset, the phone load test on the live site (playable in 4.6 s on the Android profile and 6.1 s on the iPhone
profile, with all the sounds decoded within 1.5 s of the first tap), and a phone clip. The full mobile protocol on the
final build was put off until after the deadline.

## The verdict

At 16:16 the critic's quick final review came back: **PASS, 0 breaks, 0 noticeable**. #74, #75, #76, #77 and #79 were
fixed, and so was #78 for the carve. Four MINOR items stayed open: the shore walker's fringe (#71), the auto-ride's
coping-grind lock-in that still brings him upright in about 0.1 s (what was left of #78), the title card that still
crosses the skater on phones (#80), and auto-ride nearly stopping for about 3.5 s when switched on behind the
south-east ledge (#81).

## Timeline

| Time (IST) | What happened |
|---|---|
| 13 Oct, early afternoon | CC0 sounds and textures sourced, the Mixamo skeleton measured |
| 13 Oct, 14:35 | First playable build committed |
| 13 Oct, 15:28 | Pass 1 committed |
| 13 Oct, from 15:37 | The critic gathers its reference set from Wikimedia Commons |
| 13 Oct, 17:19 | Critique 1: FAIL, 54 issues |
| 13 Oct, 17:31 to 21:36 | Pass 2: the heavy-job lock, then five workstreams |
| 13 Oct, about 22:30 | Critique 2: FAIL, 53 of 54 fixed, 14 open |
| 14 Oct, 00:15 | Pass 3 committed |
| 14 Oct, 00:20 | The user's play-test: eight items |
| 14 Oct, by 01:12 | The real-time diagnosis: 120 Hz physics drawn without interpolation on a 200 Hz monitor |
| 14 Oct, 01:45 | The user hands the machine over for the night |
| 14 Oct, by 03:00 | Critique 3: PASS, six minor items |
| 14 Oct, 03:25 | First deploy to GitHub Pages |
| 14 Oct, 04:41 | Pass 4 batch 1 live |
| 14 Oct, after 05:30 | First power cut |
| 14 Oct, 10:40 to 10:56 | Work resumes; batch 2 verified and live |
| 14 Oct, 11:01 | The user asks for mobile support |
| 14 Oct, 11:10 to 12:30 | Mobile audit: 25 issues, 32 PASS and 40 FAIL |
| 14 Oct, 12:25 | Pass 4 complete and live |
| 14 Oct, 13:20 | Pass 5 begins: mobile and critic tracks with parallel helpers |
| 14 Oct, about 14:35 | The 5 PM deadline set; critique 4: FAIL, 4 noticeable and 3 minor; the mobile track committed |
| 14 Oct, 15:31 | The critic's track committed |
| 14 Oct, about 15:35 | Second power cut |
| 14 Oct, 15:43 | Pushed and deployed |
| 14 Oct, 16:05 | The live build verified |
| 14 Oct, 16:16 | Critique 5: PASS, 0 breaks, 0 noticeable |

## What made the difference

- **Measuring motion in real time.** The worst problem the user had, the vibration, was invisible in every
  frame-stepped capture. From the diagnosis on, motion verdicts came only from real-time runs with real input, logged
  per displayed frame and judged against thresholds.
- **A critic with references and no access to the code.** It judged what a player sees, it held the game to
  photographs and footage, and its Keep list made regressions show up as clearly as new bugs.
- **One heavy job at a time, and one owner per file.** Two browser runs on one GPU each run at half speed, so the lock
  kept measurements honest; written ownership let several helpers edit physics, animation and UI at once without
  overwriting each other.
- **Notes written as they went.** A builder ran out of context once and the power went out twice; each time the next
  agent picked up from the notes, the logs and the media index, and nothing was lost.

## What is left for later

The open polish items above; the full mobile protocol on the final build; a check of pointer lock with a physical
mouse; and everything that needs a real phone: the iPhone audio unlock and its recovery after a call, the wake lock,
real safe areas, the thumb feel of the stick and the swipe, the GPU time and first shader compile on a phone, and
thermal throttling over a long session. The README's [Limitations](../README.md#limitations) has the full
list.
