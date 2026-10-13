"""Hand landmarks, digit chains and analytic finger skin weights for the skater.

Shared by sdf_skater.py (the sculpted hand) and tools/blender/build_skater.py (finger weights), so every
knuckle, crease and pad of the mesh sits on the joint the runtime bends. numpy only (runs inside Blender).
Positions are glTF metres in the Bryce rest pose (Y up, character faces +Z, character left = +X).

A digit is a chain of three elliptical segments on its joints (base knuckle -> middle -> distal -> end joint):
half-width W(s) and half-thickness H(s) taper along the arc s and widen a little at the joints.
"""
import numpy as np

FINGERS = ("Index", "Middle", "Ring", "Pinky")
SIDES = {"L": ("Left", 1.0), "R": ("Right", -1.0)}
# digit: (half-width at the base joint, at the end joint, half-thickness at the base, at the end), metres
SIZE = {"Index": (0.0086, 0.0057, 0.0077, 0.0045), "Middle": (0.0089, 0.0059, 0.0079, 0.0046),
        "Ring": (0.0083, 0.0055, 0.0074, 0.0043), "Pinky": (0.0071, 0.0048, 0.0064, 0.0038),
        "Thumb": (0.0122, 0.0074, 0.0106, 0.0052)}
HAND_FROM = -0.012     # the hand's own triangle budget starts this far before the wrist joint (along the hand axis)
TIP_BACK = 0.0022      # the distal segment ends this far before the end joint; its round cap reaches ~3 mm past it
TIP_CAP = 0.86         # fingertip cap length / tip half-width
THUMB_NAIL_TILT = 35.0  # thumbnail faces the radial side, tilted this many degrees towards the back of the hand


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def gauss(x, s):
    return np.exp(-(x / s) ** 2)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


class Chain:
    """One digit: three segments between four joints, a cross-section profile and a dorsal (nail) side."""

    def __init__(self, name, joints, dorsal):
        self.name = name
        J = [np.asarray(j, dtype=np.float64) for j in joints]
        self.J = J
        self.a = [unit(J[i + 1] - J[i]) for i in range(3)]
        L = [float(np.linalg.norm(J[i + 1] - J[i])) for i in range(3)]
        self.Lj = L                                     # joint-to-joint lengths
        self.sj = np.array([0.0, L[0], L[0] + L[1], L[0] + L[1] + L[2]])   # arc position of each joint
        self.L = [L[0], L[1], L[2] - TIP_BACK]           # segment lengths (the last one stops short of the end joint)
        self.s0 = self.sj[:3]
        self.d = [unit(dorsal - (dorsal @ a) * a) for a in self.a]
        self.l = [np.cross(a, d) for a, d in zip(self.a, self.d)]
        wb, wt, hb, ht = SIZE[name]
        self.wb, self.wt, self.hb, self.ht = wb, wt, hb, ht
        self.thumb = name == "Thumb"

    # ---- cross-section profile
    def W(self, s):
        f = np.clip(s / self.sj[3], 0.0, 1.0)
        w = self.wb + (self.wt - self.wb) * f
        if self.thumb:
            bump = 0.070 * gauss(s - self.sj[1], 0.0048) + 0.075 * gauss(s - self.sj[2], 0.0034)
        else:
            bump = 0.085 * gauss(s - self.sj[1], 0.0042) + 0.065 * gauss(s - self.sj[2], 0.0032)
        return w * (1.0 + bump)

    def H(self, s):
        f = np.clip(s / self.sj[3], 0.0, 1.0)
        return (self.hb + (self.ht - self.hb) * f) * (1.0 + 0.02 * gauss(s - self.sj[1], 0.0045) + 0.02 * gauss(s - self.sj[2], 0.0035))

    def end_cap(self):
        return TIP_CAP * self.W(self.sj[3] - TIP_BACK)

    # ---- per-point evaluation
    def segment(self, p, i):
        """(distance, s, u, v, e) of points p against segment i: arc position, lateral, dorsal, axial overshoot."""
        q = p - self.J[i]
        t = q @ self.a[i]
        tc = np.clip(t, 0.0, self.L[i])
        e = t - tc
        qp = q - t[:, None] * self.a[i]
        u = qp @ self.l[i]
        v = qp @ self.d[i]
        s = self.s0[i] + tc
        W, H = self.W(s), self.H(s)
        Re = W if i < 2 else np.where(e > 0, self.end_cap(), W)
        k0 = np.sqrt((u / W) ** 2 + (v / H) ** 2 + (e / Re) ** 2)
        k1 = np.sqrt((u / W ** 2) ** 2 + (v / H ** 2) ** 2 + (e / Re ** 2) ** 2)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-12), s, u, v, e, W, H, Re

    def evaluate(self, p):
        """Smooth union of the segments -> base distance, plus each segment's local coordinates and smooth
        per-segment blend weights (features are blended, so nothing jumps where the nearest segment changes)."""
        segs = [self.segment(p, i) for i in range(3)]
        d = smin(smin(segs[0][0], segs[1][0], 0.0012), segs[2][0], 0.0012)
        # hand over from one segment to the next across the bisector plane of their joint
        S1, S2 = (smoothstep(-0.0010, 0.0010, (p - self.J[j]) @ unit(self.a[j - 1] + self.a[j])) for j in (1, 2))
        w = np.stack([1 - S1, S1 * (1 - S2), S1 * S2])
        coords = []
        for g in segs:
            _, s, u, v, e, W, H, Re = g
            un, vn, en = u / W, v / H, e / Re
            coords.append(dict(s=s, un=un, en=en, cd=vn / (np.sqrt(un ** 2 + vn ** 2 + en ** 2) + 1e-9)))
        s = sum(w[i] * coords[i]["s"] for i in range(3))
        return d, dict(segs=coords, w=w, s=s)

    def features(self, c):
        disp = np.zeros(len(c["s"]))
        for i in range(3):
            m = c["w"][i] > 1e-3
            if m.any():
                disp[m] += c["w"][i][m] * self._features({k: v[m] for k, v in c["segs"][i].items()})
        return disp

    def _features(self, c):
        """Surface displacement (metres, + outwards): knuckle bumps and wrinkles, palmar creases and pads, nail."""
        s, un, cd = c["s"], c["un"], c["cd"]
        sj, L = self.sj, self.Lj
        fd, fp = np.clip(cd, 0, 1), np.clip(-cd, 0, 1)
        au = np.abs(un)
        sc = self.wb / 0.0089
        if self.thumb:
            kn = ((sj[1], 0.0014, 0.0050), (sj[2], 0.0013, 0.0038))
        else:
            kn = ((sj[1], 0.0013 * sc, 0.0040), (sj[2], 0.0009 * sc, 0.0030))
        disp = np.zeros_like(s)
        for sk, amp, sig in kn:                                   # dorsal knuckle bumps
            disp += amp * gauss(s - sk, sig) * fd ** 1.6
        # dorsal wrinkles: soft short arcs on top of the middle and distal knuckles, fading towards the sides
        top = (1 - smoothstep(0.22, 0.62, au)) * fd ** 2
        for off, dep in ((-0.0019, 0.00026), (0.0008, 0.00030)):
            disp -= dep * gauss(s - kn[0][0] - off - 0.0012 * un ** 2, 0.0011) * top
        disp -= 0.00024 * gauss(s - kn[1][0] + 0.0002 - 0.0010 * un ** 2, 0.0010) * top
        # palmar flexion creases: double at the middle joint, single at the distal joint and at the finger base
        pal = smoothstep(0.15, 0.55, fp)
        for off in (-0.0012, 0.0011):
            disp -= 0.00050 * gauss(s - kn[0][0] - off, 0.0010) * pal
        disp -= (0.00070 if self.thumb else 0.00055) * gauss(s - kn[1][0] - 0.0004, 0.0011) * pal
        if not self.thumb:
            disp -= 0.00050 * gauss(s - 0.42 * L[0], 0.0011) * pal
            disp += 0.00060 * gauss(s - 0.72 * L[0], 0.0055) * fp ** 1.5           # pad of the base phalanx
        disp += 0.00055 * gauss(s - (sj[1] + 0.5 * L[1]), 0.0050) * fp ** 1.5       # middle pad
        pulp = 0.0016 if self.thumb else 0.0012
        disp += pulp * gauss(s - (sj[2] + 0.60 * L[2]), 0.0060 if self.thumb else 0.0055) * fp ** 1.2   # fingertip pulp
        # nail: a slightly raised plate on the last phalanx (U-shaped cuticle) with a soft groove around it,
        # both fading out over the rounded fingertip so the free edge has no lip
        wide = 0.08 if self.thumb else 0.0
        free = 1 - smoothstep(0.05, 0.60, c["en"])
        sn0 = sj[2] + (0.38 if self.thumb else 0.42) * L[2] + 0.0016 * un ** 2
        nail = smoothstep(sn0 - 0.0008, sn0 + 0.0008, s) * (1 - smoothstep(0.60 + wide, 0.82 + wide, au)) * smoothstep(0.35, 0.65, fd)
        disp += 0.00026 * nail * free
        cuticle = gauss(s - sn0 + 0.0008, 0.00085) * (1 - smoothstep(0.58 + wide, 0.88 + wide, au)) * smoothstep(0.30, 0.60, fd)
        sides = gauss(au - (0.82 + wide), 0.09) * smoothstep(sn0, sn0 + 0.002, s) * smoothstep(0.15, 0.40, fd) * free
        disp -= 0.00030 * (1 - (1 - cuticle) * (1 - sides))
        return disp


class Hand:
    """Landmarks of one hand. Frame: hx towards the knuckles, hy the back of the hand, hz the thumb/index side."""

    def __init__(self, bones, S):
        self.S = S
        n, s = SIDES[S]
        self.n, self.s = n, s
        J = lambda b: np.array(bones["mixamorig:" + n + b]["head"], dtype=np.float64)
        self.wr, self.el = J("Hand"), J("ForeArm")
        self.joints = {f: [J("Hand" + f + str(i)) for i in range(1, 5)] for f in FINGERS}
        self.joints["Thumb"] = [J("HandThumb" + str(i)) for i in range(1, 5)]
        f1 = {f: self.joints[f][0] for f in FINGERS}
        self.knuck = sum(f1.values()) / 4
        hx = unit(self.knuck - self.wr)
        hz0 = unit(f1["Index"] - f1["Pinky"])
        hy = unit(-s * np.cross(hx, hz0))
        hz = np.cross(hx, hy)
        hz = hz if hz @ hz0 > 0 else -hz
        self.hx, self.hy, self.hz = hx, hy, hz
        self.R = np.stack([hx, hy, hz], 1)
        self.Lp = float(np.linalg.norm(self.knuck - self.wr))
        tilt = np.radians(THUMB_NAIL_TILT)
        self.chains = {f: Chain(f, self.joints[f], hy) for f in FINGERS}
        self.chains["Thumb"] = Chain("Thumb", self.joints["Thumb"], np.cos(tilt) * hz + np.sin(tilt) * hy)

    def local(self, p):
        return (p - self.wr) @ self.R

    def in_hand(self, p):
        return (np.asarray(p) - self.wr) @ self.hx > HAND_FROM

    def bbox(self, pad=0.02):
        pts = np.array([self.wr] + [j for js in self.joints.values() for j in js])
        return pts.min(0) - pad, pts.max(0) + pad

    # ---------------------------------------------------------------- analytic skin weights
    def weights(self, p):
        """-> (blend, {bone: weight}) for points p (N, 3). blend = how much these replace the bone-heat weights:
        0 up to the wrist, 1 from 2.2 cm past it. Weights per point sum to 1 (Hand + finger/thumb bones)."""
        p = np.asarray(p, dtype=np.float64)
        n = self.n
        tw = (p - self.wr) @ self.hx
        blend = smoothstep(0.004, 0.022, tw)
        out = {}

        def add(bone, w):
            key = "mixamorig:" + n + bone
            out[key] = out.get(key, 0.0) + w

        names = list(self.chains)
        dist, along = [], []
        for name in names:
            ch = self.chains[name]
            d, c = ch.evaluate(p)
            dist.append(d)
            # arc coordinate; behind the base joint it runs back (negative) along the first segment axis
            t0 = (p - ch.J[0]) @ ch.a[0]
            along.append(np.where(t0 < 0, t0, c["s"]))
        dist = np.stack(dist)
        dmin = dist.min(0)
        own = 1.0 - smoothstep(0.0, 0.004, dist - dmin)          # nearest digit(s); webs between two digits share
        own /= own.sum(0, keepdims=True)
        for i, name in enumerate(names):
            ch = self.chains[name]
            s = along[i]
            sj = ch.sj
            if ch.thumb:
                w0, w1, w2 = 0.012, 0.0060, 0.0045
                reach = 1.0 - smoothstep(0.006, 0.018, dist[i])  # thenar: only near the thumb metacarpal follows it
            else:
                w0, w1, w2 = 0.0095, 0.0045, 0.0035
                reach = 1.0 - smoothstep(0.010, 0.024, dist[i])
            a = smoothstep(-w0, w0, s - sj[0]) * reach
            b = smoothstep(-w1, w1, s - sj[1])
            c = smoothstep(-w2, w2, s - sj[2])
            base = "HandThumb" if ch.thumb else "Hand" + name
            add("Hand", own[i] * (1.0 - a))
            add(base + "1", own[i] * a * (1.0 - b))
            add(base + "2", own[i] * a * b * (1.0 - c))
            add(base + "3", own[i] * a * b * c)
        return blend, out
