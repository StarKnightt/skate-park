// Pass-4 media (M1): teleports + key timelines of every physics-driven media4.mjs segment, shared by media4.mjs (browser)
// and media4_sim.mjs (headless check). ?test = Pro controls; no arrow keys any more: flips are Space crouch + F, the WASD
// key held at the F press picks the flip (none kickflip, D heelflip, S pop shove-it, W tre flip).
const FKEY = { kickflip: [], heelflip: ['KeyD'], shuvit: ['KeyS'], treflip: ['KeyW'] };
/** crouch from t0, F at t0 + hold pops at the current charge (same pop time as the old Space release); the pick key is
 *  let go 1-2 physics steps later (A/D spin the board in the air), Space after the pop (its release is swallowed) */
export const FLIP = (t0, trick, hold = 0.32) => (trick
  ? [{ at: t0, down: ['Space'] }, { at: t0 + hold, down: ['KeyF', ...FKEY[trick]] }, { at: t0 + hold + 0.0125, up: ['KeyF', ...FKEY[trick]] },
    { at: t0 + hold + 0.12, up: ['Space'] }]
  : [{ at: t0, down: ['Space'] }, { at: t0 + hold, up: ['Space'] }]);
export const KEY = (k, t0, d) => [{ at: t0, down: [k] }, { at: t0 + d, up: [k] }];
export const CARVE = [...KEY('KeyA', 0.2, 0.4), ...KEY('KeyD', 1.3, 0.6), ...KEY('KeyA', 2.6, 0.8)];
const OLLIE_E = (t0, up, e, eUp) => [{ at: t0, down: ['Space'] }, { at: up, up: ['Space'] }, { at: e, down: ['KeyE'] }, ...(eUp ? [{ at: eUp, up: ['KeyE'] }] : [])];

const clip02 = [];
[null, 'kickflip', 'heelflip', 'shuvit', 'treflip'].forEach((k, i) => {
  const t0 = 0.3 + i * 1.75;
  clip02.push(...FLIP(t0, k, 0.32));
  if (i < 4) clip02.push(...KEY('KeyW', t0 + 1.15, 0.4));
});
clip02.push(...KEY('KeyS', 8.1, 1.4));

const flips2 = (k) => [{ tp: [30, 0, 22, 180, 4.5], script: [...FLIP(0.4, k, 0.32), ...FLIP(2.3, k, 0.12)], frames: 120 }];
const board = (k) => [0, 1].map(() => ({ tp: [30, 0, 22, 180, 4.5], script: FLIP(0.3, k, 0.32), frames: 46 }));
const HAND = { tp: [7, 1, 17.4, 180, 5.0], script: OLLIE_E(0.05, 0.42, 0.5, 1.4) };
const BAR = { tp: [0, 0, 4.0, 180, 6.0], preroll: 0, script: OLLIE_E(0.55, 0.8, 0.85, 1.8) };
const LEDGE = { tp: [3.2, 0, -12.95, -90, 5.5], script: OLLIE_E(0.1, 0.35, 0.45, 1.2) };
const FUNBOX = { tp: [11, 0, -0.6, -90, 6.4] };

export const CASES = {
  clip01: [{ tp: [-2, 0, 1.5, -90, 1.5], script: [...KEY('KeyW', 0, 2.2), ...KEY('KeyD', 4.0, 0.35), ...KEY('KeyW', 7.6, 0.7)], frames: 390 }],
  clip02: [{ tp: [-20, 0, 10.5, 90, 5.6], script: clip02, frames: 285 }],
  clip04: [{ ...HAND, frames: 78 }, { ...BAR, frames: 132 }],
  clip07: [{ tp: [10.5, 0, -9, 90, 7.5], frames: 120 }],
  clip10: [{ ...LEDGE, frames: 100 }, { ...BAR, frames: 72 }, { ...BAR, frames: 72 }, { ...HAND, preroll: 0, frames: 60 }],
  clip12: flips2(null), clip13: flips2('kickflip'), clip14: flips2('heelflip'), clip15: flips2('shuvit'),
  clip16: [{ tp: [30, 0, 22, 180, 0], script: KEY('KeyW', 0.3, 3.4), frames: 150 }],
  clip17: [{ tp: [22.5, 0, -9, 90, 9.6], script: KEY('KeyW', 2.6, 0.8), frames: 330 }],
  clip22: [{ tp: [-28, -2.3, -2.0, 90, 7.5], script: CARVE, frames: 150 }],
  clip24: [{ tp: [30, 0, 22, 180, 4.5], script: KEY('ShiftLeft', 0.4, 2.9), frames: 135 }],
  clip25: [{ tp: [30, 0, 22, 180, 4.5], script: [...FLIP(0.6, null, 0.32), ...KEY('KeyD', 1.25, 0.09)], frames: 105 }],
  clip26: board('kickflip'), clip27: board('heelflip'), clip28: board('shuvit'),
  clip29: [{ tp: [-12.5, 0, 0.6, -90, 4.5], frames: 80 }],
  // pass-3 line (-24,-2.3,-1, 75 deg, 7.5, D 1.3 s) now rides straight up the SE corner and stalls at the lip (wider floor
  // carves); this one carves round the SE corner and along the south wall ~1.2 m up at 4.2-4.4 m/s (media4_search.mjs)
  clip31: [{ tp: [-25, -2.3, 0, 85, 7.0], script: KEY('KeyD', 0.1, 1.8), frames: 140, skip: 36 }, { tp: [-25, -2.3, 0, 85, 7.0], script: KEY('KeyD', 0.1, 1.8), frames: 140, skip: 40 }],
  clip33: [{ tp: [15.3, 0, -14.2, 0, 2.6], frames: 75 }, { tp: [15.3, 0, -13.8, 0, 2.2], frames: 50 }, { tp: [21.5, 0, 23.9, 90, 2.2], frames: 50 }],
  clip34: [{ tp: [-7, 0, -19.1, 90, 5.5], frames: 75 }, { tp: [3, 0, -19.3, -90, 5.5], frames: 80 }, { tp: [-2.25, 0, -15.5, 180, 4.8], frames: 70 }],
  // pass-3 line (-24,-2.3,-4.2, 90 deg, 7.0, A 1.4 s) now climbs the NE wall and crawls along it at ~1.5 m/s for 6 s;
  // this one carves 344 deg round the bowl (1.3 m up the walls, >= 2.4 m/s) and kickturns at f156 (pass 3: f150)
  clip35: [{ tp: [-24, -2.3, 1.5, 90, 7.0], script: KEY('KeyA', 0.2, 3.6), frames: 240 }],
  // pass-4 needs-capture
  // blue hour: south down the east side past the lamp at (37.3, 12), west along the kiosk's park side past the lamp at
  // (16, 25.2) (raised structure west of x 14.5); then the turn behind the kiosk again, for a dolly along its town side
  clip37: [{ tp: [33.5, 0, 5, 0, 4.6], script: [...KEY('KeyD', 3.4, 0.85), ...KEY('KeyW', 5.0, 0.6)], frames: 236 },
    { tp: [33.5, 0, 13, 0, 4.5], script: KEY('KeyD', 1.7, 0.85), frames: 170, skip: 50 }],
  // west across the funbox top at z -0.6 (pass-2 clip18 run-in); F at 2.35 s pops at the top's west edge, lands on the flat
  clip38: [{ ...FUNBOX, script: FLIP(2.05, 'kickflip', 0.3), frames: 110 }],
  clip39: [{ ...FUNBOX, script: FLIP(2.05, 'heelflip', 0.3), frames: 110 }],
  // south up the 30 deg terrace bank (x -4..3, top z 14, 1 m): F at 1.45 s pops at the coping, lands on the terrace
  clip40: [{ tp: [0, 0, 6, 0, 6.0], script: FLIP(1.15, 'kickflip', 0.3), frames: 78 }],
  clip41: [{ tp: [17.6, 3.1, -9, 90, 3.0], frames: 75 }],
  clip42: [{ tp: [33, 0, 8.5, 0, 4.5], script: KEY('ShiftLeft', 0.2, 2.8), frames: 100 }],
  // stills
  b_kickflip_mid: [{ tp: [30, 0, 20, 180, 5], script: FLIP(0.1, 'kickflip', 0.3), frames: 30 }],
  b_heelflip_mid: [{ tp: [30, 0, 20, 180, 5], script: FLIP(0.1, 'heelflip', 0.3), frames: 30 }],
  b_shuvit_mid: [{ tp: [30, 0, 20, 180, 5], script: FLIP(0.1, 'shuvit', 0.3), frames: 30 }],
  b_5050: [{ ...LEDGE, frames: 40 }],
  b_boardslide: [{ tp: [0, 0, 4.0, 180, 6.0], script: OLLIE_E(0.55, 0.8, 0.85), frames: 40 }],
  b_handrail: [{ tp: [7, 1, 17.2, 180, 5.0], script: OLLIE_E(0.05, 0.42, 0.5), frames: 30 }],
  grip_kickflip: [{ tp: [30, 0, 22, 180, 4.5], script: FLIP(0.3, 'kickflip', 0.32), frames: 45 }],
  grip_heelflip: [{ tp: [30, 0, 22, 180, 4.5], script: FLIP(0.3, 'heelflip', 0.32), frames: 45 }],
  handsplay_bail: [{ tp: [10.5, 0, -9, 90, 7.5], frames: 60 }],
};
