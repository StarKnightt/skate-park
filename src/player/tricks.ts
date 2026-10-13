import type { SkateEvent } from './physics';

/** Turns physics events into trick names, points and combos. */
export class TrickTracker {
  combo = 0; // points in the current combo
  mult = 0;
  idle = 0; // seconds riding without a trick
  inLine = false;
  best = 0;
  private grindPts = 0;
  private manualPts = 0;
  onTrick: (name: string, pts: number, bail?: boolean) => void = () => {};
  onCombo: (total: number, mult: number, final: boolean) => void = () => {};

  private add(name: string, pts: number) {
    pts = Math.round(pts);
    this.combo += pts; this.mult += 1; this.idle = 0; this.inLine = true;
    this.onTrick(name, pts);
    this.onCombo(this.combo * this.mult, this.mult, false);
  }

  event(e: SkateEvent) {
    switch (e.type) {
      case 'land': {
        const deg = Math.abs(e.spin) * 180 / Math.PI;
        const spin = deg > 300 ? 360 : deg > 140 ? 180 : 0;
        const dirN = e.spin > 0 ? 'FS' : 'BS';
        let name = '';
        let pts = 0;
        if (e.vert) { name = (e.spin >= 0 ? 'Frontside' : 'Backside') + ' Air'; pts = 300 + e.airTime * 150; }
        else {
          if (e.flip) { name = e.flip.name; pts = e.flip.pts; }
          else if (e.popped) { name = 'Ollie'; pts = 100; }
          else if (e.airTime > 0.45) { name = 'Drop'; pts = 60; }
          if (spin && name) { name = `${dirN} ${spin} ${name === 'Ollie' ? '' : name}`.trim(); pts += spin === 360 ? 400 : 160; }
          else if (spin && !name) { name = `${dirN} ${spin}`; pts = spin === 360 ? 400 : 160; }
          if (name && e.airTime > 0.7) pts += (e.airTime - 0.7) * 200;
        }
        if (e.fakie && name && !e.vert) { name = 'Fakie ' + name; pts += 50; }
        if (e.quality === 'wobble' && name) { name = 'Sketchy ' + name; pts *= 0.6; }
        if (name) this.add(name, pts);
        break;
      }
      case 'grindStart': this.grindPts = 0; this.onTrick(e.name, 0); this.inLine = true; this.idle = 0; break;
      case 'grindEnd': {
        const pts = (e.style === '5050' ? 120 : 170) * Math.max(0.6, e.time) + 50;
        this.add(e.name, pts);
        break;
      }
      case 'manualStart': this.manualPts = 0; this.onTrick('Manual', 0); this.inLine = true; this.idle = 0; break;
      case 'manualEnd': if (e.time > 0.35) this.add('Manual', 80 * e.time + 20); break;
      case 'kickturn': break;
      case 'bail':
        this.onTrick('Bail!', 0, true);
        this.combo = 0; this.mult = 0; this.inLine = false;
        this.onCombo(0, 0, false);
        break;
    }
    void this.grindPts; void this.manualPts;
  }

  /** riding without tricks ends the combo */
  update(dt: number, riding: boolean, busy: boolean) {
    if (!this.inLine) return;
    if (riding && !busy) this.idle += dt; else this.idle = 0;
    if (this.idle > 1.15) {
      const total = this.combo * this.mult;
      if (this.mult > 1) this.onCombo(total, this.mult, true); else this.onCombo(0, 0, false);
      this.best = Math.max(this.best, total);
      this.combo = 0; this.mult = 0; this.inLine = false;
    }
  }
}
