"""Garment landmarks and per-vertex cloth masks for the skater.

Shared by sdf_skater.py (sculpted folds) and tools/blender/build_skater.py (vertex attribute COLOR_1),
so the fold sculpt and the runtime fold/flutter shading always agree. numpy only (runs inside Blender).

Positions are glTF metres in the Bryce rest pose (Y up, character faces +Z, character left = +X).
  flutter (COLOR_1.r): 1 at the tee hem, sleeve ends and shorts hem, fading to 0 within ~10 cm
  fold    (COLOR_1.g): 1 in the waist, armpit, inner-elbow, crotch / front-hip and back-of-knee zones
"""
import numpy as np

TEE_HEM_Y = 0.968
SLEEVE_LEN = 0.135   # sleeve end, metres along the upper arm from the shoulder joint
SHORTS_LEN = 0.79    # shorts hem as a fraction of hip -> knee
FADE = 0.10          # flutter fade length
WAIST_Y = 1.035


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def axis_coords(p, a, d):
    """Signed distance along unit axis d from point a, radial distance and unit radial direction."""
    q = p - a
    t = q @ d
    r = q - t[:, None] * d
    rl = np.linalg.norm(r, axis=1)
    return t, rl, r / np.maximum(rl, 1e-9)[:, None]


class Landmarks:
    def __init__(self, bones):
        self.bones = bones

    def J(self, n):
        return np.array(self.bones["mixamorig:" + n]["head"], dtype=np.float64)

    @staticmethod
    def side(S):
        return ("Left", 1.0) if S == "L" else ("Right", -1.0)

    def arm(self, S):
        n = self.side(S)[0]
        return self.J(n + "Arm"), self.J(n + "ForeArm"), self.J(n + "Hand")

    def leg(self, S):
        n = self.side(S)[0]
        return self.J(n + "UpLeg"), self.J(n + "Leg"), self.J(n + "Foot")

    def sleeve_end(self, S):
        sh, el, wr = self.arm(S)
        adir = unit(el - sh)
        return sh + adir * SLEEVE_LEN + np.array([0, -0.006, 0]), adir

    def shorts_top(self, S):
        return np.array([self.side(S)[1] * 0.092, 0.94, 0.010])

    def shorts_hem(self, S):
        s = self.side(S)[1]
        hip, kn, an = self.leg(S)
        end = hip + (kn - hip) * SHORTS_LEN + np.array([s * 0.004, 0, 0])
        return end, unit(end - self.shorts_top(S))

    def armpit(self, S):
        sh = self.arm(S)[0]
        return np.array([self.side(S)[1] * 0.172, sh[1] - 0.080, sh[2] + 0.005])

    def crotch(self):
        return np.array([0.0, 0.860, 0.0])

    def front_hip(self, S):
        return np.array([self.side(S)[1] * 0.075, 0.905, 0.100])


# ----------------------------------------------------------------------------- zone fields (any part)
def waist_zone(p):
    band = 1.0 - smoothstep(0.035, 0.11, np.abs(p[:, 1] - WAIST_Y))
    front = 0.65 + 0.35 * smoothstep(-0.06, 0.06, p[:, 2])
    return band * front


def armpit_zone(p, L):
    return np.maximum.reduce([1.0 - smoothstep(0.03, 0.085, np.linalg.norm(p - L.armpit(S), axis=1)) for S in "LR"])


def elbow_zone(p, L):
    out = np.zeros(len(p))
    for S in "LR":
        sh, el, wr = L.arm(S)
        d = unit(unit(el - sh) + unit(wr - el))
        t, rl, rd = axis_coords(p, el, d)
        out = np.maximum(out, (1.0 - smoothstep(0.015, 0.06, np.abs(t))) * smoothstep(0.15, 0.75, rd[:, 2]) * (rl < 0.08))
    return out


def knee_zone(p, L):
    out = np.zeros(len(p))
    for S in "LR":
        hip, kn, an = L.leg(S)
        t, rl, rd = axis_coords(p, kn, unit(an - hip))
        out = np.maximum(out, (1.0 - smoothstep(0.03, 0.10, np.abs(t))) * smoothstep(0.15, 0.75, -rd[:, 2]) * (rl < 0.13))
    return out


def crotch_zone(p, L):
    c = 1.0 - smoothstep(0.03, 0.10, np.linalg.norm(p - L.crotch(), axis=1))
    h = np.maximum.reduce([1.0 - smoothstep(0.025, 0.075, np.linalg.norm(p - L.front_hip(S), axis=1)) for S in "LR"])
    return np.maximum(c, 0.85 * h)


# ----------------------------------------------------------------------------- per-part masks
def flutter(part, p, L):
    f = np.zeros(len(p))
    if part == "tee":
        f = 1.0 - smoothstep(0.0, FADE, p[:, 1] - TEE_HEM_Y)
        for S in "LR":
            e, d = L.sleeve_end(S)
            t, rl, _ = axis_coords(p, e, d)
            f = np.maximum(f, (1.0 - smoothstep(0.0, FADE, -t)) * (rl < 0.11))
    elif part == "cream":
        f = (np.abs(p[:, 0]) > 0.15).astype(np.float64)
    elif part == "shorts":
        for S in "LR":
            e, d = L.shorts_hem(S)
            t, rl, _ = axis_coords(p, e, d)
            same = (p[:, 0] * L.side(S)[1]) > 0
            f = np.maximum(f, (1.0 - smoothstep(0.0, FADE, -t)) * (rl < 0.13) * same)
    elif part == "shortscuff":
        f = np.ones(len(p))
    return np.clip(f, 0, 1)


def fold(part, p, L):
    g = np.zeros(len(p))
    if part == "tee":
        g = np.maximum.reduce([waist_zone(p), armpit_zone(p, L)])
    elif part == "cream":
        g = armpit_zone(p, L)
    elif part in ("armL", "armR"):
        g = elbow_zone(p, L)
    elif part == "shorts":
        g = np.maximum.reduce([0.5 * waist_zone(p), crotch_zone(p, L), knee_zone(p, L)])
    elif part in ("shortscuff", "legs"):
        g = knee_zone(p, L)
    return np.clip(g, 0, 1)


def masks(part, p, bones):
    """(N,3) glTF rest positions of one part -> (flutter, fold) arrays in 0..1."""
    L = Landmarks(bones)
    p = np.asarray(p, dtype=np.float64)
    return flutter(part, p, L), fold(part, p, L)
