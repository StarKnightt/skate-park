import {
  BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry, Group, Matrix4, Mesh, Quaternion, RepeatWrapping,
  SRGBColorSpace, Texture, Vector3, BoxGeometry, SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/materials';

const _Y = new Vector3(0, 1, 0), _Z = new Vector3(0, 0, 1);
const _qr = new Quaternion();
const _t = new Matrix4(), _p = new Matrix4(), _r = new Matrix4(), _l = new Matrix4();

export const DECK_L = 0.81, DECK_W = 0.21, DECK_T = 0.012;
export const DECK_Y = 0.104; // bottom of the deck above the ground at the centre
export const TRUCK_Z = 0.18, WHEEL_R = 0.027, WHEEL_X = 0.094;

/** kick (nose/tail) rise of the deck centre line */
export function kickY(z: number) {
  const a = Math.abs(z), k0 = 0.25, len = DECK_L / 2 - k0;
  return a > k0 ? 0.052 * Math.pow((a - k0) / len, 1.45) : 0;
}
const halfWidth = (z: number) => {
  const a = Math.abs(z), r0 = DECK_L / 2 - DECK_W / 2;
  if (a <= r0) return DECK_W / 2;
  const t = Math.min(1, (a - r0) / (DECK_W / 2));
  return (DECK_W / 2) * Math.sqrt(Math.max(0, 1 - t * t));
};
const concave = (x: number) => 0.0055 * Math.pow(Math.min(1, Math.abs(x) / (DECK_W / 2)), 2);
/** deck top surface height (board space) */
export function deckTopY(z: number, x = 0) { return DECK_Y + DECK_T + kickY(z) + concave(x); }

function deckGeometry() {
  const nz = 72, nx = 12;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], groups: [number, number, number][] = [];
  const zs: number[] = [];
  for (let i = 0; i <= nz; i++) {
    const t = i / nz;
    zs.push(-DECK_L / 2 + DECK_L * (0.5 - 0.5 * Math.cos(Math.PI * t)));
  }
  const surf = (top: boolean) => {
    const base = pos.length / 3;
    for (let i = 0; i <= nz; i++) {
      const z = zs[i], hw = Math.max(halfWidth(z), 0.0008);
      for (let j = 0; j <= nx; j++) {
        const x = -hw + (2 * hw * j) / nx;
        const y = DECK_Y + kickY(z) + concave(x) + (top ? DECK_T : 0);
        pos.push(x, y, z);
        uv.push(0.5 + x / DECK_W, 0.5 + z / DECK_L);
      }
    }
    const start = idx.length;
    for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
      const a = base + i * (nx + 1) + j, b = a + 1, c = a + nx + 1, d = c + 1;
      if (top) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    groups.push([start, idx.length - start, top ? 0 : 1]);
  };
  surf(true); surf(false);
  // side band
  const base = pos.length / 3;
  const ring: [number, number][] = [];
  for (let i = 0; i <= nz; i++) ring.push([halfWidth(zs[i]), zs[i]]);
  for (let i = nz; i >= 0; i--) ring.push([-halfWidth(zs[i]), zs[i]]);
  for (let k = 0; k < ring.length; k++) {
    const [x, z] = ring[k];
    const y0 = DECK_Y + kickY(z) + concave(x);
    pos.push(x, y0, z, x, y0 + DECK_T, z);
    uv.push(k / ring.length, 0, k / ring.length, 1);
  }
  const start = idx.length;
  for (let k = 0; k < ring.length - 1; k++) {
    const a = base + k * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  groups.push([start, idx.length - start, 2]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  for (const [s, c, m] of groups) g.addGroup(s, c, m);
  g.computeVertexNormals();
  return g;
}

function gripTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#2b2a2e'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.random() * 40;
    x.fillStyle = `rgb(${v},${v},${v + 4})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(1, 4); t.colorSpace = SRGBColorSpace;
  return t;
}
function plyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const x = c.getContext('2d')!;
  const cols = ['#e9c38d', '#c4874f', '#f1d6a6', '#3d7f86', '#f1d6a6', '#c4874f', '#e9c38d'];
  cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(0, (i * 64) / cols.length, 4, 64 / cols.length + 1); });
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

export class BoardView {
  root = new Group();
  deck = new Group();
  trucks: Group[] = [];
  wheels: Mesh[] = [];
  wheelAngle = 0;
  constructor(deckTex: Texture) {
    deckTex.colorSpace = SRGBColorSpace;
    const gripM = toonMaterial({ map: gripTexture(), bands: 0.3, rim: 0.15, name: 'grip' });
    const bottomM = toonMaterial({ map: deckTex, bands: 0.3, rim: 0.3, name: 'deckBottom' });
    const plyM = toonMaterial({ map: plyTexture(), bands: 0.2, name: 'ply' });
    const deckMesh = new Mesh(deckGeometry(), [gripM, bottomM, plyM]);
    deckMesh.castShadow = true;
    this.deck.add(deckMesh);
    const metal = toonMaterial({ color: 0xc9ccd2, bands: 0.6, spec: 0.9, shininess: 60, rim: 0.5, name: 'truck' });
    const bush = toonMaterial({ color: 0xf2b84b, bands: 0.5, name: 'bushing' });
    const wheelM = toonMaterial({ color: 0xf4ead2, bands: 0.5, rim: 0.4, name: 'wheel' });
    const coreM = toonMaterial({ color: 0xe0574a, bands: 0.5, name: 'wheelCore' });
    for (const z of [TRUCK_Z, -TRUCK_Z]) {
      // baseplate + kingpin + bushing ride with the deck
      const bp = new BoxGeometry(0.062, 0.008, 0.08); bp.translate(0, DECK_Y - 0.004, z);
      const kp = new CylinderGeometry(0.006, 0.006, 0.04, 8); kp.translate(0, DECK_Y - 0.026, z + (z > 0 ? -0.012 : 0.012));
      const plate = new Mesh(mergeGeometries([bp, kp]), metal); plate.castShadow = true;
      this.deck.add(plate);
      const b1 = new Mesh(new CylinderGeometry(0.014, 0.014, 0.016, 10), bush);
      b1.position.set(0, DECK_Y - 0.02, z + (z > 0 ? -0.012 : 0.012)); this.deck.add(b1);
      // hanger + axle + wheels stay level with the ground (truck lean)
      const truck = new Group(); truck.position.set(0, 0, z);
      const hanger = new CylinderGeometry(0.012, 0.016, 0.15, 10); hanger.rotateZ(Math.PI / 2); hanger.translate(0, WHEEL_R + 0.006, 0);
      const neck = new BoxGeometry(0.04, 0.034, 0.03); neck.translate(0, WHEEL_R + 0.026, 0);
      const axle = new CylinderGeometry(0.0035, 0.0035, 0.23, 6); axle.rotateZ(Math.PI / 2); axle.translate(0, WHEEL_R, 0);
      const hm = new Mesh(mergeGeometries([hanger.toNonIndexed(), neck.toNonIndexed(), axle.toNonIndexed()]), metal);
      hm.castShadow = true;
      truck.add(hm);
      for (const sx of [WHEEL_X, -WHEEL_X]) {
        const wg = new CylinderGeometry(WHEEL_R, WHEEL_R, 0.032, 20); wg.rotateZ(Math.PI / 2);
        const w = new Mesh(wg, wheelM); w.position.set(sx, WHEEL_R, 0); w.castShadow = true;
        const core = new Mesh(new CylinderGeometry(0.012, 0.012, 0.0335, 10).rotateZ(Math.PI / 2), coreM);
        w.add(core);
        const dot = new Mesh(new SphereGeometry(0.004, 6, 4), metal); dot.position.set(sx > 0 ? 0.017 : -0.017, 0.006, 0); w.add(dot);
        truck.add(w); this.wheels.push(w);
      }
      this.deck.add(truck);
      this.trucks.push(truck);
    }
    this.root.add(this.deck);
  }

  private _m = new Matrix4();
  private _m2 = new Matrix4();
  private _q = new Quaternion();

  /**
   * Pose the deck inside the board root.
   * pitch: nose-up angle (rad), pivotZ: pivot along the board (tail ~ -0.36, back truck -0.18)
   * roll: flip roll around the long axis, yaw: shove-it rotation, lift: extra height (flips), lean: truck lean (carving)
   */
  pose(pitch: number, pivotZ: number, roll: number, yaw: number, lift: number, lean: number) {
    const cy = DECK_Y + 0.006;
    // flip (roll about the long axis) + shove-it (yaw) about the deck centre, lifted
    this._q.setFromAxisAngle(_Y, yaw).multiply(_qr.setFromAxisAngle(_Z, roll));
    const flipM = this._m.makeTranslation(0, cy + lift, 0)
      .multiply(this._m2.makeRotationFromQuaternion(this._q))
      .multiply(_t.makeTranslation(0, -cy, 0));
    // pitch about a pivot on the ground line (tail / back wheels)
    const pitchM = _p.makeTranslation(0, 0, pivotZ).multiply(_r.makeRotationX(-pitch)).multiply(_t.makeTranslation(0, 0, -pivotZ));
    // deck lean about its centre line (trucks counter-rotate)
    const leanM = _l.makeTranslation(0, cy, 0).multiply(_r.makeRotationZ(lean)).multiply(_t.makeTranslation(0, -cy, 0));
    const full = this.deck.matrix.copy(pitchM).multiply(flipM).multiply(leanM);
    this.deck.matrixAutoUpdate = false;
    this.deck.matrixWorldNeedsUpdate = true;
    for (const t of this.trucks) t.rotation.z = -lean * 0.9;
    return full;
  }

  spinWheels(dist: number) {
    this.wheelAngle += dist / WHEEL_R;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
  }

  /** world position of a point on the deck top (board space x,z) given the current deck matrix */
  deckPoint(x: number, z: number, out: Vector3, useDeck = true) {
    out.set(x, deckTopY(z, x), z);
    if (useDeck) out.applyMatrix4(this.deck.matrix);
    return out.applyMatrix4(this.root.matrixWorld);
  }
}
