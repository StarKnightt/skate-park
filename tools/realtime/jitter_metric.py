"""Real-time jitter metric for skate-park per-frame logs (the format written by tools/realtime/rt_protocol.mjs).

usage: python jitter_metric.py LOG.json [LOG2.json ...] [--json out.json]

Logs from a capped run (fpsCap > 0, e.g. --fps 60) report frame_std as N/A: on a 200 Hz display the rAF grid makes
15/20 ms alternation by construction, so the frame interval spread says nothing about the game there.

Per displayed frame the log holds: t (ms), dt (s), n (physics steps that frame), mode, speed, vel, board root position,
screen position of the hips / board / head (CSS px) and viewport height H, plus bone world positions.

Metrics (all on the *displayed* frames, uncapped real-time run):
  frame_std_ms     standard deviation of the frame interval
  hips_rms_px      RMS of the high-pass residual (zero-phase 2nd-order Butterworth low-pass at 8 Hz) of the hips screen
                   position, in pixels of a 1080-px-tall viewport, excluding +-60 ms around impulsive events
                   (mode changes, velocity jumps > 0.8 m/s in one frame: pops, landings, bonks, kickturn ends)
  hips_p99_px      99th percentile of the same residual
  head_p99_px      same for the head (catches pose/IK pops)
  board_rms_mm     RMS high-pass residual of the board root world position (mm), events excluded
  flips_per_s      sign changes per second of the second difference of the hips screen x or y (|d2| > 0.05 px), worse axis
  hf_share         share of the hips screen-velocity spectrum above 10 Hz (x and y combined; 0 when hips_rms < 0.05 px)
  stall_frames     frames where the board moved < 5 % of the expected distance while speed > 1 m/s
"""
import json
import sys

import numpy as np
from scipy.signal import butter, filtfilt

THRESH = {  # pass if <=
    'frame_std_ms': 1.0, 'hips_rms_px': 0.35, 'hips_p99_px': 1.2, 'head_p99_px': 2.0, 'board_rms_mm': 1.0,
    'flips_per_s': 30.0, 'hf_share': 0.25, 'stall_frames': 0,
}


def lowpass(x, fs, fc=8.0):
    b, a = butter(2, fc / (fs / 2))
    return filtfilt(b, a, x, axis=0, padlen=min(60, len(x) - 2))


def metrics(path):
    d = json.load(open(path))
    h = {k: i for i, k in enumerate(d['header'])}
    a = np.array(d['rows'], dtype=float)
    g = lambda k: a[:, h[k]]
    dt = g('dt'); fs = 1.0 / np.median(dt)
    k1080 = 1080.0 / g('H')[0]
    # impulsive events -> exclusion mask (+-60 ms)
    ev = np.zeros(len(a), bool)
    if 'mode' in h:
        ev[1:] |= np.diff(g('mode')) != 0
    if 'vx' in h:
        v = np.stack([g('vx'), g('vy'), g('vz')], 1)
        ev[1:] |= np.linalg.norm(np.diff(v, axis=0), axis=1) > 0.8
    pad = int(round(0.06 * fs))
    keep = np.ones(len(a), bool)
    for i in np.nonzero(ev)[0]:
        keep[max(0, i - pad):i + pad + 1] = False
    # the residuals are taken per frame index: a dropped vsync (one long frame) is a genuine 2x step there, not jitter,
    # and the 8 Hz filter spreads it over +-60 ms like an impulsive event
    for i in np.nonzero(dt > 1.5 * np.median(dt))[0]:
        keep[max(0, i - pad):i + pad + 1] = False
    edge = int(round(0.1 * fs))
    keep[:edge] = False; keep[-edge:] = False

    def res(xy):
        r = np.linalg.norm(xy - lowpass(xy, fs), axis=1)
        return r[keep] if keep.any() else r

    hips = np.stack([g('hsx'), g('hsy')], 1) * k1080
    head = np.stack([g('esx'), g('esy')], 1) * k1080 if 'esx' in h else hips
    board = np.stack([g('bx'), g('by'), g('bz')], 1)
    rh, re, rb = res(hips), res(head), res(board) * 1000
    flips, p_hf, p_all = 0.0, 0.0, 0.0
    for ax in (0, 1):  # screen x and y: flips on the worse axis, spectrum of both combined
        x = hips[:, ax]
        d2 = x[2:] - 2 * x[1:-1] + x[:-2]
        s = np.sign(d2) * (np.abs(d2) > 0.05)
        s = s[keep[1:-1]]
        nz = s[s != 0]
        flips = max(flips, float((np.sum(nz[1:] != nz[:-1]) if len(nz) > 1 else 0) / (keep.sum() / fs)))
        vel = np.diff(x)[keep[1:]]
        vel = vel - vel.mean()
        P = np.abs(np.fft.rfft(vel * np.hanning(len(vel)))) ** 2
        f = np.fft.rfftfreq(len(vel), 1 / fs)
        p_hf += P[f > 10].sum(); p_all += P[1:].sum()
    hf = float(p_hf / p_all) if p_all > 0 else 0.0
    if np.sqrt(np.mean(rh ** 2)) < 0.05:
        hf = 0.0  # below the noise floor the share is meaningless
    step = np.linalg.norm(np.diff(board, axis=0), axis=1)
    exp = g('speed')[1:] * dt[1:]
    stall = int(np.sum((exp > 1.0 * dt[1:]) & (step < 0.05 * exp) & keep[1:]))
    capped = bool(d.get('fpsCap'))
    m = {'frames': len(a), 'fs': round(float(fs), 1), 'frame_std_ms': None if capped else float(np.std(dt) * 1000), 'hips_rms_px': float(np.sqrt(np.mean(rh ** 2))),
         'hips_p99_px': float(np.percentile(rh, 99)), 'head_p99_px': float(np.percentile(re, 99)), 'board_rms_mm': float(np.sqrt(np.mean(rb ** 2))),
         'flips_per_s': float(flips), 'hf_share': hf, 'stall_frames': stall, 'excluded_frames': int((~keep).sum())}
    m['fail'] = [k for k, lim in THRESH.items() if m[k] is not None and m[k] > lim]
    m['pass'] = not m['fail']
    return m


if __name__ == '__main__':
    skip = {sys.argv.index('--json') + 1} if '--json' in sys.argv else set()
    args = [x for i, x in enumerate(sys.argv) if i > 0 and i not in skip and not x.startswith('--')]
    out = {}
    for p in args:
        out[p] = m = metrics(p)
        name = p.replace('\\', '/').split('/')[-1]
        fstd = 'N/A ' if m['frame_std_ms'] is None else '%.2f' % m['frame_std_ms']
        print('%-28s %s  frame_std %s ms | hips rms %.2f p99 %.2f px | head p99 %.2f px | board %.2f mm | flips %.0f/s | hf %.2f | stalls %d %s' % (
            name, 'PASS' if m['pass'] else 'FAIL', fstd, m['hips_rms_px'], m['hips_p99_px'], m['head_p99_px'], m['board_rms_mm'],
            m['flips_per_s'], m['hf_share'], m['stall_frames'], ('' if m['pass'] else ' <- ' + ','.join(m['fail']))))
    if '--json' in sys.argv:
        json.dump(out, open(sys.argv[sys.argv.index('--json') + 1], 'w'), indent=1)
