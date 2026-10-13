"""Feel checks for a protocol run (tools/realtime/rt_protocol.mjs output folder): the protocol's extra checks.

usage: python feel_metric.py RUN_DIR [--json out.json]     (default RUN_DIR/feel.json)

Per scenario log (logs/<scenario>.json, also <scenario>@<rate>.json from a sweep):
  knee_max_deg / knee_p99_deg  largest / 99th-percentile change of a knee's bend direction between displayed frames
                               (unit vector from the hip-ankle line to the knee, skater root frame, both legs; bail and
                               recover frames and nearly straight legs (offset < 2 cm) excluded). Pass: <= 6 deg
  steer: per key press t90_ms (key -> 90 % of the plateau turn rate, physics steps), overshoot (peak / steady - 1),
         radius_m (speed / steady turn rate) and the speed. Pass: 120-200 ms, no overshoot (< 3 %), radius >= 3 m at 5 m/s
  push:  latency_ms (W key -> first physics step with forward acceleration > 0.25 m/s^2), peak_accel, max_accel_step
         (largest change of acceleration between consecutive physics steps), dv per push. Pass: <= 120 ms, peak <= 7.5,
         step <= 3 m/s^2
  brake: ramp_ms (S key -> 90 % of the full decel), release_ms, max_accel_step
  kickflip: frozen_flip_frames (displayed frames during the board rotation where the deck turned < 0.05 deg). Pass: 0
Key times are the real key events (performance.now) in real-time runs, and the input changes in sweep runs.
"""
import json
import os
import sys

import numpy as np

run = sys.argv[1]
outp = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else os.path.join(run, 'feel.json')
LD = os.path.join(run, 'logs')


def cols(header, rows):
    a = np.array(rows, dtype=float) if rows else np.zeros((0, len(header)))
    h = {k: i for i, k in enumerate(header)}
    return (lambda k: a[:, h[k]]), a


def knee(d):
    g, a = cols(d['header'], d['rows'])
    if len(a) < 3 or 'kLx' not in d['header']:
        return None
    mode = g('mode')
    # the 6 deg limit is per displayed frame at 200 Hz: scale it with the frame interval for slower runs
    fs = 1.0 / np.median(g('dt'))
    lim = float(6.0 * max(1.0, 200.0 / fs)) if fs < 190 else 6.0
    res = {}
    worst = 0.0
    for leg in ('L', 'R'):
        v = np.stack([g('k%sx' % leg), g('k%sy' % leg), g('k%sz' % leg)], 1)
        hh = g('k%sh' % leg)
        dot = np.clip(np.sum(v[1:] * v[:-1], 1), -1, 1)
        ang = np.degrees(np.arccos(dot))
        ok = (hh[1:] > 0.02) & (hh[:-1] > 0.02) & (mode[1:] < 3) & (mode[:-1] < 3)
        ang = ang[ok]
        idx = np.nonzero(ok)[0]
        if len(ang):
            i = int(np.argmax(ang))
            res[leg] = {'max': round(float(ang[i]), 2), 'p99': round(float(np.percentile(ang, 99)), 2),
                        'at_frame': int(idx[i] + 1), 'at_s': round(float((g('t')[idx[i] + 1] - g('t')[0]) / 1000), 3)}
            worst = max(worst, float(ang[i]))
    return {'knee_max_deg': round(worst, 2), 'limit_deg': round(lim, 1), 'deg_per_s': round(worst * fs, 1), 'legs': res, 'pass': bool(worst <= lim)}


def steps_of(d):
    if not d.get('steps'):
        return None, None
    g, a = cols(d['stepHeader'], d['steps'])
    if d.get('sweepRate'):
        # a sweep runs faster than real time: use the simulated clock (ms) instead of the wall clock
        t = a[:, d['stepHeader'].index('time')] * 1000.0
        a = a.copy()
        a[:, d['stepHeader'].index('t')] = t
        g, _ = cols(d['stepHeader'], a.tolist())
    return g, a


def key_times(d, code, gs, col, sign=None):
    """(down, up) times in the step clock ('t' column, ms) for a key: real key events if logged, else input changes"""
    keys = [k for k in d.get('keys', []) if k[2] == code]
    if keys:
        downs = [k[0] for k in keys if k[1] == 1]
        ups = [k[0] for k in keys if k[1] == 0]
        return [(t0, next((u for u in ups if u > t0), None)) for t0 in downs]
    x = gs(col)
    t = gs('t')
    on = (x > 0.5) if sign is None else (x * sign > 0.5)
    out = []
    for i in range(1, len(x)):
        if on[i] and not on[i - 1]:
            j = next((k for k in range(i + 1, len(x)) if not on[k]), None)
            # the input changed during step i: the key arrived somewhere in the frame before it; use the previous step time
            out.append((t[i - 1], t[j - 1] if j else None))
    return out


def yaw_rates(gs):
    f = np.stack([gs('fx'), gs('fy'), gs('fz')], 1)
    u = np.stack([gs('ux'), gs('uy'), gs('uz')], 1)
    tt = gs('time')
    c = np.cross(f[:-1], f[1:])
    s = np.sum(c * u[1:], 1)
    co = np.sum(f[:-1] * f[1:], 1)
    dt = np.diff(tt)
    dt[dt <= 0] = 1 / 120
    r = np.concatenate([[0.0], -np.arctan2(s, co) / dt])  # + = turning right (D)
    return r


def steer(d):
    gs, a = steps_of(d)
    if gs is None or len(a) < 10:
        return None
    r = yaw_rates(gs)
    t, spd = gs('t'), gs('speed')
    out = []
    for code, sign in (('KeyA', -1), ('KeyD', 1)):
        for (t0, t1) in key_times(d, code, gs, 'steer', sign):
            if t1 is None:
                t1 = t[-1]
            m = (t >= t0) & (t <= t1 + 20)
            if m.sum() < 5:
                continue
            rr = r[m] * sign
            tt = t[m]
            peak = float(rr.max())
            hold = (tt >= t0 + 0.6 * (t1 - t0)) & (tt <= t1)
            steady = float(np.median(rr[hold])) if hold.sum() else peak
            i90 = int(np.argmax(rr >= 0.9 * peak))
            sp = float(np.median(spd[m][hold])) if hold.sum() else float(spd[m].mean())
            out.append({'key': code, 'hold_ms': round(t1 - t0), 't90_ms': round(float(tt[i90] - t0), 1), 'peak_rad_s': round(peak, 3),
                        'steady_rad_s': round(steady, 3), 'overshoot': round(peak / steady - 1, 3) if steady > 1e-3 else None,
                        'speed': round(sp, 2), 'radius_m': round(sp / steady, 2) if steady > 1e-3 else None})
    ok = all(120 <= o['t90_ms'] <= 200 and (o['overshoot'] or 0) < 0.03 for o in out) and bool(out)
    return {'presses': out, 'pass_t90_overshoot': ok}


def accel(gs):
    v = np.stack([gs('vx'), gs('vy'), gs('vz')], 1)
    f = np.stack([gs('fx'), gs('fy'), gs('fz')], 1)
    vf = np.abs(np.sum(v * f, 1))
    dt = np.diff(gs('time'))
    dt[dt <= 0] = 1 / 120
    return np.concatenate([[0.0], np.diff(vf) / dt])


def push(d):
    gs, a = steps_of(d)
    if gs is None or len(a) < 10:
        return None
    acc = accel(gs)
    t = gs('t')
    ride = gs('mode') == 0
    ks = key_times(d, 'KeyW', gs, 'push')
    if not ks:
        return None
    t0 = ks[0][0]
    after = np.nonzero((t >= t0) & (acc > 0.25) & ride)[0]
    lat = float(t[after[0]] - t0) if len(after) else None
    m = (t >= t0) & ride
    da = np.abs(np.diff(acc[m]))
    # dv per push: integrate positive acceleration per push cycle (pushT restarts)
    pt = gs('pushT')
    dvs, cur = [], 0.0
    tt = gs('time')
    for i in range(1, len(pt)):
        if pt[i] >= 0 and (pt[i - 1] < 0 or pt[i] < pt[i - 1]):
            if cur > 0.05:
                dvs.append(round(float(cur), 2))
            cur = 0.0
        if pt[i] >= 0 and acc[i] > 0:
            cur += acc[i] * (tt[i] - tt[i - 1])
    if cur > 0.05:
        dvs.append(round(float(cur), 2))
    out = {'latency_ms': round(lat, 1) if lat is not None else None, 'peak_accel': round(float(acc[m].max()), 2),
           'max_accel_step': round(float(da.max()), 2) if len(da) else None, 'dv_per_push': dvs}
    out['pass'] = bool(lat is not None and lat <= 120 and out['peak_accel'] <= 7.5 and (out['max_accel_step'] or 0) <= 3)
    return out


def brake(d):
    gs, a = steps_of(d)
    if gs is None or len(a) < 10:
        return None
    acc = accel(gs)
    t = gs('t')
    ks = key_times(d, 'KeyS', gs, 'brake')
    if not ks:
        return None
    t0, t1 = ks[0]
    base = float(np.median(acc[(t < t0) & (t > t0 - 300)])) if ((t < t0) & (t > t0 - 300)).any() else 0.0
    dec = -(acc - base)
    on = np.nonzero((t >= t0) & (dec >= 0.9 * 3.4))[0]
    off = np.nonzero((t >= (t1 or 1e18)) & (dec <= 0.1 * 3.4))[0] if t1 else []
    m = (t >= t0 - 50) & (t <= (t1 or t[-1]) + 300) & (gs('speed') > 0.3)
    da = np.abs(np.diff(acc[m]))
    return {'ramp_ms': round(float(t[on[0]] - t0), 1) if len(on) else None, 'release_ms': round(float(t[off[0]] - t1), 1) if len(off) else None,
            'peak_decel': round(float(dec[m].max()), 2), 'max_accel_step': round(float(da.max()), 2) if len(da) else None}


def flip(d):
    g, a = cols(d['header'], d['rows'])
    if len(a) < 3:
        return None
    fp = g('flipP')
    q = np.stack([g('dqx'), g('dqy'), g('dqz'), g('dqw')], 1)
    dots = np.clip(np.abs(np.sum(q[1:] * q[:-1], 1)), -1, 1)
    ang = np.degrees(2 * np.arccos(dots))
    m = (fp[1:] > 0.0) & (fp[1:] < 1.0) & (fp[:-1] > 0.0)
    if not m.any():
        return {'flip_frames': 0, 'note': 'no flip rotation in this log'}
    return {'flip_frames': int(m.sum()), 'frozen_flip_frames': int((ang[m] < 0.05).sum()), 'min_deg_per_frame': round(float(ang[m].min()), 3)}


res = {}
summary = json.load(open(os.path.join(run, 'summary.json'))) if os.path.exists(os.path.join(run, 'summary.json')) else {}
for f in sorted(os.listdir(LD)):
    if not f.endswith('.json'):
        continue
    d = json.load(open(os.path.join(LD, f)))
    name = f[:-5]
    base = name.split('@')[0]
    r = {'knee': knee(d)}
    if base == 'steer':
        r['steer'] = steer(d)
    if base == 'push':
        r['push'] = push(d)
    if base == 'brake':
        r['brake'] = brake(d)
    if base == 'kickflip':
        r['flip'] = flip(d)
        r['input'] = d.get('input')
    if base == 'mouselook':
        r['pointerLockAfterClick'] = summary.get('pointerLockAfterClick')
        r['pointerLockAfterEscape'] = summary.get('pointerLockAfterEscape')
    res[name] = r
    k = r['knee']
    line = '%-22s knee max %5.2f deg/frame (limit %.0f) %s' % (name, k['knee_max_deg'], k['limit_deg'], 'PASS' if k['pass'] else 'FAIL') if k else '%-22s (no knee data)' % name
    if r.get('steer'):
        line += ' | steer ' + '; '.join('%s t90 %.0f ms os %.3f R %.2f m @ %.2f m/s' % (o['key'], o['t90_ms'], o['overshoot'] or 0, o['radius_m'] or 0, o['speed'])
                                         for o in r['steer']['presses'])
    if r.get('push'):
        p = r['push']
        line += ' | push latency %s ms peak %.2f step %s dv %s %s' % (p['latency_ms'], p['peak_accel'], p['max_accel_step'], p['dv_per_push'], 'PASS' if p['pass'] else 'FAIL')
    if r.get('brake'):
        b = r['brake']
        line += ' | brake ramp %s ms release %s ms peak %.2f step %s' % (b['ramp_ms'], b['release_ms'], b['peak_decel'], b['max_accel_step'])
    if r.get('flip'):
        line += ' | flip %s' % r['flip']
    if base == 'mouselook':
        line += ' | lock after click %s, after Esc %s' % (r['pointerLockAfterClick'], r['pointerLockAfterEscape'])
    print(line)
json.dump(res, open(outp, 'w'), indent=1)
