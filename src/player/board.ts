import {
  BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry, Group, Material, Matrix4, Mesh, MeshLambertMaterial, Quaternion,
  SRGBColorSpace, Texture, TextureLoader, Vector3, BoxGeometry, SphereGeometry,
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

/**
 * Grip tape over the whole deck (0.8 mm texels): charcoal grit with glints and worn patches where the feet stand, and the
 * filed edge all round (pale wood + light grit), so the grip side reads as a board, not a black cut-out, when it faces you.
 */
let gripTex: CanvasTexture | null = null;
function gripTexture() {
  if (gripTex) return gripTex;
  const W = 256, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const img = x.createImageData(W, H);
  const d = img.data;
  let s = 20250117;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  const G = 8, gw = W / G + 2, gh = H / G + 2;
  const lat = new Float32Array(gw * gh);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const mottle = (i: number, j: number) => {
    const fx = i / G, fy = j / G, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const a = lat[y0 * gw + x0], b = lat[y0 * gw + x0 + 1], c0 = lat[(y0 + 1) * gw + x0], c1 = lat[(y0 + 1) * gw + x0 + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c0 + (c1 - c0) * tx) * ty;
  };
  const wearAt = (z: number, xx: number) => {
    const spot = (z0: number, sz: number, sx: number) => Math.exp(-(((z - z0) / sz) ** 2) - ((xx / sx) ** 2));
    return 0.8 * spot(0.17, 0.075, 0.075) + 0.8 * spot(-0.2, 0.07, 0.07) + 0.5 * spot(-0.33, 0.05, 0.06) + 0.35 * spot(0.31, 0.05, 0.06);
  };
  for (let j = 0; j < H; j++) {
    const v = 1 - (j + 0.5) / H; // CanvasTexture.flipY: canvas row 0 is v = 1
    const z = (v - 0.5) * DECK_L;
    const hw = halfWidth(z);
    for (let i = 0; i < W; i++) {
      const xx = ((i + 0.5) / W - 0.5) * DECK_W;
      const edge = hw - Math.abs(xx); // metres inside the deck outline
      let g = 96 + (rnd() - 0.5) * 56 + (mottle(i, j) - 0.5) * 22 + wearAt(z, xx) * 22;
      if (rnd() < 0.02) g += 55 + rnd() * 50; // grit glints
      // a cool charcoal: the warm low sun turns it a warm dark grey rather than tan
      let r = g * 0.95, gg = g * 0.98, b = g * 1.07;
      if (edge < 0.0035) { r = 232 + rnd() * 14; gg = 204 + rnd() * 12; b = 160 + rnd() * 12; } // rounded wood edge
      else if (edge < 0.006) { const k = 160 + rnd() * 34; r = k; gg = k; b = k + 4; } // filed grip edge
      const o = (j * W + i) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 8;
  return (gripTex = t);
}
function plyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const x = c.getContext('2d')!;
  const cols = ['#f3dcb0', '#d7a56f', '#f7e6c4', '#3f8c93', '#f7e6c4', '#d7a56f', '#f3dcb0'];
  cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(0, (i * 64) / cols.length, 4, 64 / cols.length + 1); });
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

export class BoardView {
  root = new Group();
  deck = new Group();
  deckMesh: Mesh;
  trucks: Group[] = [];
  wheels: Mesh[] = [];
  wheelAngle = 0;
  /** deck matrix with pitch and truck lean but without flip roll / shove-it yaw / lift (where the feet hover during a flip) */
  plainM = new Matrix4();
  constructor(deckTex: Texture) {
    deckTex.colorSpace = SRGBColorSpace;
    heroDeckTex ??= deckTex;
    // grip tape is rough and dark: no sheen (a broad lobe of the low sun turned it tan), a little less of the key light
    const gripM = toonMaterial({ map: gripTexture(), bands: 0.15, wrap: 0.5, rim: 0.6, key: 0.7, name: 'grip' });
    const bottomM = toonMaterial({ map: deckTex, bands: 0.3, rim: 0.3, name: 'deckBottom' });
    const plyM = toonMaterial({ map: plyTexture(), bands: 0.2, wrap: 0.5, rim: 0.5, name: 'ply' });
    const deckMesh = new Mesh(deckGeometry(), [gripM, bottomM, plyM]);
    deckMesh.castShadow = true;
    this.deckMesh = deckMesh;
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
    this.plainM.copy(pitchM).multiply(leanM);
    const full = this.deck.matrix.copy(pitchM).multiply(flipM).multiply(leanM);
    this.deck.matrixAutoUpdate = false;
    this.deck.matrixWorldNeedsUpdate = true;
    for (const t of this.trucks) t.rotation.z = -lean * 0.9;
    return full;
  }

  /** after a 180 shove-it the nose and tail have swapped ends: turn only the (symmetric) deck mesh so the graphic stays put */
  flipGraphic() {
    this.deckMesh.rotation.y = this.deckMesh.rotation.y === 0 ? Math.PI : 0;
  }

  spinWheels(dist: number) {
    this.wheelAngle += dist / WHEEL_R;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
  }

  /** world position of a point on the deck top (board space x,z): on the posed deck, or on the un-flipped deck plane */
  deckPoint(x: number, z: number, out: Vector3, useDeck = true) {
    out.set(x, deckTopY(z, x), z);
    out.applyMatrix4(useDeck ? this.deck.matrix : this.plainM);
    return out.applyMatrix4(this.root.matrixWorld);
  }
}

let heroDeckTex: Texture | null = null;
let propParts: { geo: BufferGeometry; mat: Material | Material[] }[] | null = null;

/**
 * A board lying around (other skaters'): the hero board's deck, grip, graphic, trucks and wheels at rest, merged into
 * one mesh per material and shared by every prop board. Wheels on the ground (y = 0), nose towards +z.
 */
export function boardProp(): Group {
  if (!propParts) {
    const tex = heroDeckTex ?? new TextureLoader().load(import.meta.env.BASE_URL + 'textures/deck_graphic.webp');
    const v = new BoardView(tex);
    // older boards lying around: worn, dusty grip, a little lighter than the hero's fresh sheet
    ((v.deckMesh.material as Material[])[0] as MeshLambertMaterial).color.setScalar(1.4);
    v.pose(0, 0, 0, 0, 0, 0);
    v.root.updateMatrixWorld(true);
    const byMat = new Map<Material, BufferGeometry[]>();
    propParts = [];
    v.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if (m === v.deckMesh) { propParts!.push({ geo: m.geometry, mat: m.material }); return; }
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      if (g.getAttribute('uv')) g.deleteAttribute('uv');
      const mat = m.material as Material;
      byMat.set(mat, [...(byMat.get(mat) ?? []), g]);
    });
    for (const [mat, gs] of byMat) propParts.push({ geo: mergeGeometries(gs), mat });
  }
  const g = new Group();
  g.name = 'boardProp';
  for (const p of propParts) {
    const m = new Mesh(p.geo, p.mat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
