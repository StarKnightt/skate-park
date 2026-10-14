/**
 * Hand-authored auto-ride lines through the park (coordinates from src/world/park.ts). A lap is a chain of lines; each
 * point carries a target speed and optionally an action that fires when the rider reaches it.
 */
export type Feature = 'flat' | 'bowl' | 'halfpipe' | 'qp' | 'funbox' | 'ledge' | 'rail' | 'manual' | 'stairs' | 'bank';

export type Act =
  /** pop here; flip = random flip trick, charge = minimum pop charge */
  | { k: 'ollie'; flip?: boolean; charge?: number }
  /** pop beside a rail/ledge and catch it (grind held) */
  | { k: 'grind'; charge?: number }
  /** press grind on a flush ledge / coping without popping */
  | { k: 'grindFlat' }
  /** manual for `len` metres (`p`: done on that share of laps) */
  | { k: 'manual'; len: number; p?: number }
  /** transition: ride straight at it, let the physics kickturn or air, resume when rolling away from it */
  | { k: 'wall' }
  /** bowl exit: ride up the wall from this floor point, catch the coping, lean out onto the deck; on a miss go back
   * `retry` points and carve around again */
  | { k: 'copeOut'; retry?: number }
  /** half pipe session: straight passes between the walls (axis x, centre cx, kept within z0..z1) pumping every
   * downhill until the walls are cleared, then `airs` vert airs; carries on after `passes` passes regardless */
  | { k: 'hpAirs'; cx: number; z0: number; z1: number; airs: number; passes: number };

export interface Wp {
  x: number; z: number;
  /** target speed (m/s) */
  v: number;
  act?: Act;
  f?: Feature;
  /** steer at the surface point under (x, z) instead of a point at the rider's height (transition walls) */
  y3?: boolean;
}
export interface Line { name: string; f: Feature; pts: Wp[] }

const P = (x: number, z: number, v: number, act?: Act, y3 = false): Wp => ({ x, z, v, act, y3 });

/**
 * Start from the spawn (facing north): push off straight up the plaza, a wide left turn past the flat rail and join the lap
 * on the long-ledge run-in, so the first seconds on the start screen are a cruise, two grinds and the pyramid (no U-turn).
 */
export const SPAWN_INTRO = {
  from: { x: 9, z: 3 },
  pts: [{ x: 9.1, z: 0.5, v: 4.2 }, { x: 9.6, z: -4, v: 5 }, { x: 11.0, z: -8.5, v: 5.2 }, { x: 11.6, z: -12.4, v: 5.2 }, { x: 10.6, z: -15.4, v: 5.2 }, { x: 8.4, z: -16.7, v: 5.4 }],
  join: { x: 6.15, z: -16.4 },
};
const T = (x: number, z: number, v: number, act?: Act): Wp => P(x, z, v, act, true);

/**
 * The lap (~335 m, ~71 s): half pipe session (pumping passes, vert airs once fast enough; attract carves instead) -> mini QP
 * -> long ledge + nw curb -> pyramid -> main bowl (drop in, carve, coping exit) -> sw ledge + pad edge -> flat manual -> funbox
 * -> east rail -> back to the half pipe. Grind run-ins are straight for a few
 * metres before the pop and keep the body clear of ledge boxes; turns at speed respect the physics' lateral-acceleration cap.
 */
export function lapLines(attract = false): Line[] {
  const flip = !attract;
  const L: Line[] = [
    {
      name: 'to the half pipe', f: 'flat',
      pts: [P(16.5, 10.6, 5.4), P(19.5, 10.6, 5.4, { k: 'manual', len: 3, p: 0.4 }), P(22, 10.6, 5.8), P(27.6, 10.4, 5.8), P(28.6, 7.4, 5.8), P(25.6, 3.2, 6.2), P(23.6, 0.0, 6.4)],
    },
    attract ? {
      name: 'half pipe carves', f: 'halfpipe', pts: [
        P(23.4, -3.4, 6.5), T(28.2, -6.0, 5), P(24, -7.6, 6.5), T(19.8, -9.4, 5), P(24, -11.0, 6.5), T(28.2, -12.2, 5), P(24.4, -13.8, 6), P(24, -16.2, 5),
      ],
    } : {
      name: 'half pipe airs', f: 'halfpipe', pts: [
        // passes stay in the south half; it hands back heading for the east wall, which is carved round to the north exit
        P(23.6, -3.8, 6.5, { k: 'hpAirs', cx: 24, z0: -9.0, z1: -4.6, airs: 3, passes: 9 }), T(28.2, -11.6, 6), P(24.4, -13.8, 6), P(24.1, -16.4, 5.5),
      ],
    },
    { name: 'mini quarter', f: 'qp', pts: [P(24, -18.4, 5, { k: 'wall' }), P(23.6, -17.6, 4.5), P(21, -17.2, 4.8), P(18, -17.0, 5)] },
    // straight 25 deg run-in onto the long ledge's north edge (z -12.6): no S-curve before the pop
    { name: 'to the long ledge', f: 'flat', pts: [P(13.0, -17.0, 5.4), P(9.0, -16.9, 5.6), P(6.15, -16.4, 5.6), P(3.44, -15.14, 5.6), P(0.72, -13.87, 5.6)] },
    { name: 'long ledge', f: 'ledge', pts: [P(-0.82, -13.15, 5.6, { k: 'grind', charge: 1 }), P(-6, -12.6, 4.4), P(-10.4, -12.6, 5.2)] },
    { name: 'nw curb', f: 'ledge', pts: [P(-12.5, -12.85, 5.4), P(-15.5, -13.0, 5.4), P(-17.05, -13.0, 5.4, { k: 'grind', charge: 0.75 }), P(-22.8, -12.6, 5.4)] },
    // the one flip attract keeps (a calm kickflip or shove-it, ~15 s after the start screen comes up)
    { name: 'pyramid', f: 'funbox', pts: [P(-24.4, -12.9, 5.4), P(-25.9, -13.55, 5.6), P(-27.9, -13.6, 4), P(-29.6, -13.6, 3.5, { k: 'ollie', flip: true, charge: 1 }), P(-32.6, -13.6, 4.4)] },
    { name: 'west side', f: 'flat', pts: [P(-34.6, -12.4, 4.4), P(-35.5, -10.0, 4.4), P(-35.4, -7.6, 4)] },
    {
      name: 'main bowl', f: 'bowl', pts: [
        // drop in over the NW corner, a low fast carve round the east end, then a pushed floor run to the coping exit
        P(-34.0, -6.6, 3.5), P(-32.6, -5.8, 3.5), P(-27.5, -1.5, 8), P(-22.5, 1.8, 8), T(-17.2, 4.8, 7), T(-15.9, 0, 7), T(-17.2, -4.8, 7),
        P(-21.0, -2.6, 8), P(-24.6, -1.4, 8), P(-27.2, 0.4, 8), P(-29.2, 2.1, 8, { k: 'copeOut', retry: 6 }),
      ],
    },
    {
      name: 'past the pocket bowl', f: 'flat',
      pts: [P(-34.4, 4.0, 4.5), P(-34.2, 9.0, 4.8), P(-34.2, 13.5, 4.8), P(-34.6, 18.0, 4.6), P(-33.6, 20.4, 4.6), P(-31.8, 21.15, 4.8), P(-29.6, 21.2, 5), P(-28.4, 21.2, 5)],
    },
    { name: 'sw ledge', f: 'ledge', pts: [P(-27.45, 21.2, 5, { k: 'grind', charge: 1 }), P(-23.5, 21.6, 4.2), P(-19.6, 21.6, 4.6)] },
    { name: 'sw manual pad', f: 'ledge', pts: [P(-18.2, 21.2, 4.6), P(-16.6, 20.72, 4.6), P(-15.7, 20.62, 4.6, { k: 'grindFlat' }), P(-12, 20.4, 4), P(-9.2, 20.4, 4.2)] },
    { name: 'manual north', f: 'manual', pts: [P(-7.4, 18.4, 4.2), P(-6.8, 15.8, 4.6), P(-6.8, 13.4, 4.6, { k: 'manual', len: 3.2 }), P(-6.6, 10.2, 4.8), P(-4.2, 7.2, 5)] },
    {
      name: 'funbox', f: 'funbox',
      pts: [
        P(-1.4, 4.4, 5.4), P(1.6, 2.8, 5.6), P(2.6, 1.6, 5.6), P(2.6, 0.2, 4.6), P(2.6, -0.4, 4.4, { k: 'manual', len: 1.4, p: 0.5 }),
        P(2.6, -2.3, 4.2, { k: 'ollie', flip, charge: 1 }), P(2.6, -5.6, 4.8),
      ],
    },
    {
      name: 'east rail', f: 'rail',
      pts: [P(4.4, -7.0, 5), P(8.0, -7.2, 5.2), P(11.0, -6.4, 5.2), P(12.6, -4.6, 5), P(13.15, -2.0, 5), P(13.15, 0.4, 5), P(13.15, 2.0, 5, { k: 'grind', charge: 0.75 }), P(13.4, 5, 4.5), P(13.4, 8.8, 4.8), P(14.2, 10.4, 5)],
    },
  ];
  for (const l of L) for (const p of l.pts) p.f ??= l.f;
  return L;
}
