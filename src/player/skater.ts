import {
  AnimationAction, AnimationClip, AnimationMixer, Bone, Group, LoopOnce, LoopRepeat, Matrix4, Mesh, MeshLambertMaterial, Object3D,
  Quaternion, SkinnedMesh, SRGBColorSpace, Texture, TextureLoader, Vector3,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toonMaterial } from '../render/materials';
import { clamp, lerp, Spring } from '../core/util';
import { KICKTURN_T, type BailKind, type SkatePhysics } from './physics';
import { BoardView, deckTopY } from './board';

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const ONE = new Vector3(1, 1, 1);
const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _m = new Matrix4();
const BASE = import.meta.env.BASE_URL;

const sm = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (x: number) => { const t = clamp(x, 0, 1); return 1 - (1 - t) * (1 - t); };
const easeOut3 = (x: number) => { const t = clamp(x, 0, 1); return 1 - (1 - t) ** 3; };
/** rises 0 -> 1 between a and b, falls back to 0 between c and d */
const win = (t: number, a: number, b: number, c: number, d: number) => sm((t - a) / (b - a)) * (1 - sm((t - c) / (d - c)));
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** sketchy-landing strength: eases in after the absorb, holds for the first half, then settles */
const wobbleEnv = (ph: SkatePhysics) => {
  const wt = ph.wobbleDur - ph.wobble;
  return sm(wt / 0.1) * (1 - sm((wt / ph.wobbleDur - 0.5) / 0.5));
};

interface BoneInfo {
  bone: Bone;
  restLocal: Quaternion;
  restPos: Vector3;
  /** character-space (root) rest rotation */
  restRoot: Quaternion;
  ax: [Vector3, Vector3, Vector3]; // char X,Y,Z axes expressed in the bone's rest frame
}

const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const EXPRS = ['neutral', 'focus', 'wide', 'grin', 'grimace'] as const;
type Expr = typeof EXPRS[number];

type Phase = 'ride' | 'bail' | 'lie' | 'getup' | 'walk' | 'stepon';

/** fall clip per bail kind: where to start it (so it begins near the riding pose) and how fast */
const FALLS: Record<BailKind, { clip: string; start: number; end: number; rate: number }> = {
  face: { clip: 'bail_face', start: 0.18, end: 0.8, rate: 0.62 },
  back: { clip: 'bail_back', start: 0.42, end: 2.25, rate: 1.15 },
  knock: { clip: 'bail_knock', start: 0.12, end: 1.55, rate: 1.1 },
  roll: { clip: 'bail_roll', start: 0.05, end: 1.8, rate: 1.0 },
  wall: { clip: 'wall_hit', start: 0.0, end: 1.6, rate: 1.0 },
};
/** get-up segments: lying on the back sits up and stands, lying on the front goes through hands and knees */
const GETUPS = {
  back: { clip: 'getup_back', start: 3.05, end: 6.1, rate: 1.15 },
  front: { clip: 'getup_stomach', start: 2.0, end: 6.1, rate: 1.2 },
};
const WALK_SPEED = 1.2; // m/s; the in-place walk clip strides 1.4 m per 1.17 s loop

interface ArmP { raise: number; fwd: number; elbow: number; hang: number }
const arm = (raise: number, fwd: number, elbow: number, hang = 0): ArmP => ({ raise, fwd, elbow, hang });

/** One full procedural pose (character/root space), so whole poses can be cross-faded between contexts. */
class Pose {
  hipH = 0.82; hipX = 0; hipZ = 0;
  pYaw = 0; pPitch = 0; pRoll = 0; // pelvis
  cYaw = 0; cPitch = 0; cRoll = 0; // chest, relative to the pelvis (spread over the spine)
  hYaw = 0; hPitch = 0; hRoll = 0; // neck + head, relative to the chest
  aL = arm(0.2, 0.1, 0.4); aR = arm(0.2, 0.1, 0.4);
  curl = 1; // fingers: 1 relaxed curl, 0 open wide
  fA = new Vector3(); fF = new Vector3(0, 0, 1); fU = new Vector3(0, 1, 0); fP = new Vector3(0.45, 0.1, 1);
  bA = new Vector3(); bF = new Vector3(0, 0, 1); bU = new Vector3(0, 1, 0); bP = new Vector3(-0.15, 0.1, 1);

  copy(o: Pose) {
    this.hipH = o.hipH; this.hipX = o.hipX; this.hipZ = o.hipZ;
    this.pYaw = o.pYaw; this.pPitch = o.pPitch; this.pRoll = o.pRoll;
    this.cYaw = o.cYaw; this.cPitch = o.cPitch; this.cRoll = o.cRoll;
    this.hYaw = o.hYaw; this.hPitch = o.hPitch; this.hRoll = o.hRoll;
    Object.assign(this.aL, o.aL); Object.assign(this.aR, o.aR);
    this.curl = o.curl;
    this.fA.copy(o.fA); this.fF.copy(o.fF); this.fU.copy(o.fU); this.fP.copy(o.fP);
    this.bA.copy(o.bA); this.bF.copy(o.bF); this.bU.copy(o.bU); this.bP.copy(o.bP);
    return this;
  }

  /** this = a * (1 - k) + b * k */
  mix(a: Pose, b: Pose, k: number) {
    const L = (x: number, y: number) => x + (y - x) * k;
    this.hipH = L(a.hipH, b.hipH); this.hipX = L(a.hipX, b.hipX); this.hipZ = L(a.hipZ, b.hipZ);
    this.pYaw = L(a.pYaw, b.pYaw); this.pPitch = L(a.pPitch, b.pPitch); this.pRoll = L(a.pRoll, b.pRoll);
    this.cYaw = L(a.cYaw, b.cYaw); this.cPitch = L(a.cPitch, b.cPitch); this.cRoll = L(a.cRoll, b.cRoll);
    this.hYaw = L(a.hYaw, b.hYaw); this.hPitch = L(a.hPitch, b.hPitch); this.hRoll = L(a.hRoll, b.hRoll);
    for (const s of ['aL', 'aR'] as const) {
      this[s].raise = L(a[s].raise, b[s].raise); this[s].fwd = L(a[s].fwd, b[s].fwd);
      this[s].elbow = L(a[s].elbow, b[s].elbow); this[s].hang = L(a[s].hang, b[s].hang);
    }
    this.curl = L(a.curl, b.curl);
    this.fA.lerpVectors(a.fA, b.fA, k); this.fF.lerpVectors(a.fF, b.fF, k).normalize();
    this.fU.lerpVectors(a.fU, b.fU, k).normalize(); this.fP.lerpVectors(a.fP, b.fP, k);
    this.bA.lerpVectors(a.bA, b.bA, k); this.bF.lerpVectors(a.bF, b.bF, k).normalize();
    this.bU.lerpVectors(a.bU, b.bU, k).normalize(); this.bP.lerpVectors(a.bP, b.bP, k);
    return this;
  }
}

/** Original skater: Mixamo skeleton, procedural skate animation with IK feet glued to the deck, clips for bails. */
export class Skater {
  root = new Group(); // character root, placed every frame
  model: Object3D;
  mixer: AnimationMixer;
  clips = new Map<string, AnimationClip>();
  b = new Map<string, BoneInfo>();
  fingers: { bi: BoneInfo; s: number; f: number; j: number }[] = [];
  thumbs: { bi: BoneInfo; s: number; j: number }[] = [];
  legLen = { l1: 0.4, l2: 0.38 };
  armLen = { l1: 0.27, l2: 0.23 };
  restHipsY = 0.96;
  meshes: SkinnedMesh[] = [];

  phase: Phase = 'ride';
  phaseT = 0;
  procW = 1; // procedural weight (1 = riding, 0 = clip)
  action: AnimationAction | null = null;
  bailKind: BailKind = 'face';
  time = 0;
  onRecovered: ((pos: Vector3, fwd: Vector3) => void) | null = null;
  readonly stance = { front: 0.165, back: -0.205, tail: -0.31, nose: 0.29 };

  // procedural pose state
  private P = new Pose();
  private Pout = new Pose();
  private xf = { from: new Pose(), t: 1, dur: 1 };
  private crouchS = new Spring(0, 16);
  private pushS = new Spring(0, 12);
  private manS = new Spring(0, 9);
  private grindS = new Spring(0, 11);
  private idleS = new Spring(0, 2.5);
  private transS = new Spring(0, 5);
  private pumpS = new Spring(0, 6);
  private brakeS = new Spring(0, 9);
  private leanS = new Spring(0, 7);
  private lookS = new Spring(1, 6);
  private gazeS = new Spring(1.4, 7);
  private openS = new Spring(0, 10);
  private idleT = 0;
  private popH = 0.6;
  private steer = 0;
  private inCrouch = false;
  private deckInfo = { useDeck: true, fp: 0, kind: '' };
  // idle fidgets
  private fid = { kind: '' as '' | 'glance' | 'cap' | 'feet', t: 0, wait: 2.4, n: 0, applied: false };
  private glanceYaw = 0;
  private capW = 0;
  private capTug = 0;
  private footLift = 0;
  private idleFootYaw = 0;
  private idleFootYawT = 0;
  private pushPlant: Vector3 | null = null;
  private fPole = new Vector3(0.45, 0.1, 1);
  private pushRet = -1;
  private pushPrevT = 0;
  private pushFrom = new Vector3();

  // clip phases
  private clipRootPos = new Vector3();
  private clipRootQ = new Quaternion();
  private fallEnd = 1;
  private lieDur = 1.2;
  private getupEnd = 6;
  private stepDelay = 0;
  private shakeW = 0;
  private snap: Map<Bone, { q: Quaternion; p: Vector3 }> | null = null;
  private snapW = 0;
  private snapFade = 0.2;
  private corr = new Matrix4(); // root-space correction applied to the clip's hips (aligns a clip's start with the current pose)
  private rigM = new Matrix4(); // hips parent (rig) -> root
  private rigInv = new Matrix4();
  private clipPose = new Map<Bone, { q: Quaternion; p: Vector3 }>();
  private walk: null | { target: Vector3; faceYaw: number; speed: number; yaw: number; ridePos: Vector3; rideFwd: Vector3; wait: number } = null;

  // face + cloth
  private faceMat: MeshLambertMaterial | null = null;
  private glbFace: Texture | null = null;
  private faceTex: Partial<Record<Expr, Texture>> = {};
  private expr: Expr = 'neutral';
  private exprHold = 0;
  private grinT = 0;
  private clothU = {
    uClothAmp: { value: 0 }, uClothT: { value: 0 }, uClothScale: { value: 1 }, uClothWind: { value: new Vector3() }, uClothFold: { value: 0 },
  };
  private clothKick = 0;
  private clothKickT = 1;

  constructor(gltf: GLTF) {
    this.model = gltf.scene;
    this.root.add(this.model);
    this.mixer = new AnimationMixer(this.model);
    for (const c of gltf.animations) this.clips.set(c.name, c);
    // materials: stylised toon shading + cloth flutter / fold shading
    this.model.traverse((o) => {
      const sk = o as SkinnedMesh;
      if (!sk.isSkinnedMesh) return;
      this.meshes.push(sk);
      sk.castShadow = true; sk.receiveShadow = true;
      sk.frustumCulled = false;
      const hasC1 = !!sk.geometry.getAttribute('color_1');
      const mats = Array.isArray(sk.material) ? sk.material : [sk.material];
      const repl = mats.map((m: any) => {
        let tm: MeshLambertMaterial;
        if (m.map) {
          const map = m.map as Texture; map.colorSpace = SRGBColorSpace;
          this.glbFace = map;
          tm = toonMaterial({ map, bands: 0.45, wrap: 0.6, rim: 0.6, name: 'skinFace' });
          this.faceMat = tm;
        } else tm = toonMaterial({ vertexColors: true, bands: 0.85, wrap: 0.42, rim: 0.75, name: 'skaterVC' });
        this.wrapCloth(tm, hasC1);
        return tm;
      });
      sk.material = Array.isArray(sk.material) ? repl : repl[0];
    });
    this.loadFaces();
    // bones
    this.model.updateMatrixWorld(true);
    const rootInv = new Matrix4().copy(this.model.matrixWorld).invert();
    const getBone = (n: string) => this.model.getObjectByName('mixamorig' + n) as Bone;
    const info = (bone: Bone): BoneInfo => {
      const restRoot = new Quaternion();
      _m.multiplyMatrices(rootInv, bone.matrixWorld).decompose(_v, restRoot, _v2);
      const inv = restRoot.clone().invert();
      return {
        bone, restLocal: bone.quaternion.clone(), restPos: bone.position.clone(), restRoot,
        ax: [X.clone().applyQuaternion(inv), Y.clone().applyQuaternion(inv), Z.clone().applyQuaternion(inv)],
      };
    };
    for (const n of BONES) { const bn = getBone(n); if (bn) this.b.set(n, info(bn)); }
    ['Left', 'Right'].forEach((side, si) => FINGERS.forEach((f, fi) => {
      for (let j = 1; j <= 3; j++) { const bn = getBone(side + 'Hand' + f + j); if (bn) this.fingers.push({ bi: info(bn), s: si === 0 ? 1 : -1, f: fi, j }); }
    }));
    ['Left', 'Right'].forEach((side, si) => {
      for (let j = 1; j <= 3; j++) { const bn = getBone(side + 'HandThumb' + j); if (bn) this.thumbs.push({ bi: info(bn), s: si === 0 ? 1 : -1, j }); }
    });
    const wp = (n: string) => this.b.get(n)!.bone.getWorldPosition(new Vector3());
    this.legLen.l1 = wp('LeftUpLeg').distanceTo(wp('LeftLeg'));
    this.legLen.l2 = wp('LeftLeg').distanceTo(wp('LeftFoot'));
    this.armLen.l1 = wp('LeftArm').distanceTo(wp('LeftForeArm'));
    this.armLen.l2 = wp('LeftForeArm').distanceTo(wp('LeftHand'));
    this.restHipsY = wp('Hips').y;
    const rig = this.hips.parent!;
    this.rigM.multiplyMatrices(rootInv, rig.matrixWorld);
    this.rigInv.copy(this.rigM).invert();
    this.clothU.uClothScale.value = 1 / Math.max(1e-4, this.meshes[0]?.getWorldScale(new Vector3()).x ?? 1);
  }

  get hips() { return this.b.get('Hips')!.bone; }

  /** back to riding (respawn) */
  reset() {
    this.phase = 'ride'; this.phaseT = 0; this.procW = 1;
    this.mixer.stopAllAction(); this.action = null;
    this.snap = null; this.snapW = 0; this.shakeW = 0; this.walk = null;
    this.xf.t = this.xf.dur;
    this.fid.kind = ''; this.fid.wait = 2.4; this.glanceYaw = 0; this.capW = 0; this.footLift = 0;
    this.setExpr('neutral');
  }

  // ------------------------------------------------------------------------------------- materials
  /** cloth: hems and sleeves flutter with speed and landings (COLOR_1.r), fold zones darken in a crouch (COLOR_1.g) */
  private wrapCloth(m: MeshLambertMaterial, hasC1: boolean) {
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    const u = this.clothU;
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uClothAmp; uniform float uClothT; uniform float uClothScale; uniform vec3 uClothWind;
          varying float vClothFold;
          ${hasC1 ? 'attribute vec4 color_1;' : ''}`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
          {
            ${hasC1 ? 'float clothW = color_1.r; vClothFold = color_1.g;' : 'float clothW = 0.0; vClothFold = 0.0;'}
            if (clothW > 0.002) {
              vec3 cn = normalize(objectNormal);
              float ph = uClothT * 9.0 + dot(transformed, vec3(17.0, 23.0, 11.0)) * uClothScale;
              float wv = sin(ph) * 0.65 + sin(ph * 1.9 + 1.7) * 0.35;
              transformed += (cn * wv * uClothAmp + uClothWind * (0.75 + 0.25 * wv)) * clothW;
            }
          }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uClothFold; varying float vClothFold;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= 1.0 - clamp(vClothFold * uClothFold, 0.0, 1.0) * 0.32;`);
    };
    m.customProgramCacheKey = () => prevKey.call(m) + (hasC1 ? '-cloth1' : '-cloth0');
  }

  /** expression textures share the GLB face UV layout; anything missing keeps the GLB face */
  private loadFaces() {
    const tl = new TextureLoader();
    for (const e of EXPRS) {
      tl.load(`${BASE}textures/face_${e}.webp`, (t) => {
        t.flipY = false; t.colorSpace = SRGBColorSpace;
        const g = this.glbFace;
        if (g) { t.wrapS = g.wrapS; t.wrapT = g.wrapT; t.magFilter = g.magFilter; t.minFilter = g.minFilter; t.anisotropy = g.anisotropy; }
        this.faceTex[e] = t;
        if (this.expr === e) this.setExpr(e, true);
      }, undefined, () => { /* not there: the GLB face stays */ });
    }
  }

  private setExpr(e: Expr, force = false) {
    if (this.expr === e && !force) return;
    this.expr = e;
    if (!this.faceMat) return;
    const t = this.faceTex[e] ?? this.faceTex.neutral ?? this.glbFace;
    if (t && this.faceMat.map !== t) this.faceMat.map = t;
  }

  // ------------------------------------------------------------------------------------- bone helpers
  /** rotate a bone relative to its rest pose about character axes: yaw (Y) first, then pitch (X), then roll (Z) */
  private setYXZ(name: string, yaw: number, pitch: number, roll: number) {
    const bi = this.b.get(name); if (!bi) return;
    const q = bi.bone.quaternion.copy(bi.restLocal);
    if (yaw) q.multiply(_q.setFromAxisAngle(bi.ax[1], yaw));
    if (pitch) q.multiply(_q.setFromAxisAngle(bi.ax[0], pitch));
    if (roll) q.multiply(_q.setFromAxisAngle(bi.ax[2], roll));
  }

  private resetPose() {
    for (const bi of this.b.values()) { bi.bone.quaternion.copy(bi.restLocal); bi.bone.position.copy(bi.restPos); }
    for (const f of this.fingers) f.bi.bone.quaternion.copy(f.bi.restLocal);
    for (const t of this.thumbs) t.bi.bone.quaternion.copy(t.bi.restLocal);
  }

  /** basis-mapping rotation: maps (a0,b0) onto (a1,b1) */
  private static align(a0: Vector3, b0: Vector3, a1: Vector3, b1: Vector3, out: Quaternion) {
    const c0 = new Vector3().crossVectors(a0, b0).normalize();
    const b0o = new Vector3().crossVectors(c0, a0).normalize();
    const c1 = new Vector3().crossVectors(a1, b1).normalize();
    const b1o = new Vector3().crossVectors(c1, a1).normalize();
    const m0 = new Matrix4().makeBasis(a0, b0o, c0);
    const m1 = new Matrix4().makeBasis(a1, b1o, c1);
    m1.multiply(m0.transpose());
    return out.setFromRotationMatrix(m1);
  }

  /** set a bone's rotation so that in root space it equals R * restRoot */
  private setRootRot(name: string, R: Quaternion) {
    const bi = this.b.get(name)!;
    const parent = bi.bone.parent!;
    const pRoot = this.rootSpaceQuat(parent, _q2);
    const want = _q.copy(R).multiply(bi.restRoot);
    bi.bone.quaternion.copy(pRoot.invert().multiply(want));
    bi.bone.updateMatrixWorld(true);
  }

  private rootSpaceQuat(o: Object3D, out: Quaternion) {
    o.updateWorldMatrix(true, false);
    _m.copy(this.root.matrixWorld).invert().multiply(o.matrixWorld).decompose(_v3, out, _v2);
    return out;
  }

  private rootSpacePos(o: Object3D, out: Vector3) {
    o.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(o.matrixWorld);
    return this.root.worldToLocal(out);
  }

  /** rotation of a bone away from its rest pose, in root space */
  private deltaRot(name: string, out: Quaternion) {
    const bi = this.b.get(name)!;
    return this.rootSpaceQuat(bi.bone, out).multiply(_q.copy(bi.restRoot).invert());
  }

  /** two-bone leg IK in root space; ankle target + knee pole + foot forward/up */
  private legIK(side: 'Left' | 'Right', ankle: Vector3, pole: Vector3, footFwd: Vector3, footUp: Vector3) {
    const up = this.b.get(side + 'UpLeg')!;
    const hip = this.rootSpacePos(up.bone, new Vector3());
    const { l1, l2 } = this.legLen;
    const toT = new Vector3().subVectors(ankle, hip);
    let d = toT.length();
    const dmax = (l1 + l2) * 0.999;
    if (d > dmax) { toT.multiplyScalar(dmax / d); d = dmax; }
    d = Math.max(d, 0.08);
    const dir = toT.clone().normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const po = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const knee = hip.clone().addScaledVector(dir, a).addScaledVector(po, h);
    const target = hip.clone().add(toT);
    const restD1 = this.restDir(side + 'UpLeg', side + 'Leg');
    const D1 = knee.clone().sub(hip).normalize();
    const F1 = po.clone().addScaledVector(D1, -po.dot(D1)).normalize();
    Skater.align(restD1, Z, D1, F1, _q);
    this.setRootRot(side + 'UpLeg', _q.clone());
    const restD2 = this.restDir(side + 'Leg', side + 'Foot');
    const D2 = target.clone().sub(knee).normalize();
    const F2 = po.clone().addScaledVector(D2, -po.dot(D2)).normalize();
    Skater.align(restD2, Z, D2, F2, _q);
    this.setRootRot(side + 'Leg', _q.clone());
    const restF = this.restFootFwd(side);
    Skater.align(restF, Y, footFwd.clone().normalize(), footUp, _q);
    this.setRootRot(side + 'Foot', _q.clone());
  }

  private restDirs = new Map<string, Vector3>();
  private restDir(a: string, b: string) {
    const k = a + '>' + b;
    let v = this.restDirs.get(k);
    if (!v) {
      const pa = this.restRootPos(a), pb = this.restRootPos(b);
      v = pb.sub(pa).normalize();
      this.restDirs.set(k, v);
    }
    return v;
  }
  private restRootCache = new Map<string, Vector3>();
  private restRootPos(n: string) {
    let p = this.restRootCache.get(n);
    if (!p) {
      const chain: BoneInfo[] = [];
      let o: Object3D | null = this.b.get(n)!.bone;
      while (o && (o as Bone).isBone) { const bi = [...this.b.values()].find((x) => x.bone === o); if (bi) chain.unshift(bi); o = o.parent; }
      const m = new Matrix4();
      const armParent = this.b.get('Hips')!.bone.parent!;
      this.model.updateMatrixWorld(true);
      m.copy(this.root.matrixWorld).invert().multiply(armParent.matrixWorld);
      for (const bi of chain) m.multiply(new Matrix4().compose(bi.restPos, bi.restLocal, ONE));
      p = new Vector3().setFromMatrixPosition(m);
      this.restRootCache.set(n, p);
    }
    return p.clone();
  }
  private restFootFwd(side: string) {
    const k = 'foot' + side;
    let v = this.restDirs.get(k);
    if (!v) {
      const a = this.restRootPos(side + 'Foot'), b = this.restRootPos(side + 'ToeBase');
      v = b.sub(a).setY(0).normalize();
      this.restDirs.set(k, v);
    }
    return v;
  }

  /** aim an arm (upper + fore) in root space */
  private aimArm(side: 'Left' | 'Right', upperDir: Vector3, foreDir: Vector3) {
    const restU = this.restDir(side + 'Arm', side + 'ForeArm');
    const restF = this.restDir(side + 'ForeArm', side + 'Hand');
    const U = upperDir.clone().normalize();
    const F = foreDir.clone().normalize();
    let hintU = F.clone().addScaledVector(U, -F.dot(U));
    if (hintU.lengthSq() < 1e-4) hintU = Z.clone().addScaledVector(U, -Z.dot(U));
    hintU.normalize();
    Skater.align(restU, Z, U, hintU, _q);
    this.setRootRot(side + 'Arm', _q.clone());
    const th = new Vector3(0, 0.3, 1);
    let hintF = th.clone().addScaledVector(F, -th.dot(F));
    if (hintF.lengthSq() < 1e-4) hintF = Y.clone().addScaledVector(F, -Y.dot(F));
    hintF.normalize();
    Skater.align(restF, Z, F, hintF, _q);
    this.setRootRot(side + 'ForeArm', _q.clone());
  }

  /** arm parameters (in the chest frame) -> upper arm / forearm directions in root space */
  private armDirs(side: 'Left' | 'Right', a: ArmP, chestQ: Quaternion, outU: Vector3, outF: Vector3) {
    const s = side === 'Left' ? 1 : -1;
    const ca = Math.cos(a.raise), sa = Math.sin(a.raise), cf = Math.cos(a.fwd), sf = Math.sin(a.fwd);
    outU.set(s * sa * cf, -ca * cf, sf).normalize();
    // the elbow folds the forearm to the front of the body, a little up and in
    const hint = _v.set(-s * 0.3, 0.45, 1.0);
    hint.addScaledVector(outU, -hint.dot(outU)).normalize();
    outF.copy(outU).multiplyScalar(Math.cos(a.elbow)).addScaledVector(hint, Math.sin(a.elbow));
    outU.applyQuaternion(chestQ); outF.applyQuaternion(chestQ);
    if (a.hang > 0.001) {
      // relaxed arms hang under gravity rather than following the torso
      const hung = _v2.copy(outU).lerp(_v3.set(s * 0.12, -1, 0.05).normalize(), a.hang).normalize();
      _q.setFromUnitVectors(outU, hung);
      outU.copy(hung); outF.applyQuaternion(_q);
    }
  }

  /** two-bone arm IK to a wrist target (root space) */
  private armIK(side: 'Left' | 'Right', target: Vector3, pole: Vector3, outU: Vector3, outF: Vector3) {
    const sh = this.rootSpacePos(this.b.get(side + 'Arm')!.bone, new Vector3());
    const { l1, l2 } = this.armLen;
    const toT = target.clone().sub(sh);
    const d = clamp(toT.length(), 0.06, (l1 + l2) * 0.999);
    const dir = toT.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const po = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = sh.clone().addScaledVector(dir, a).addScaledVector(po, h);
    outU.subVectors(elbow, sh).normalize();
    outF.copy(sh).addScaledVector(dir, d).sub(elbow).normalize();
  }

  /** relaxed fingers curl; for balance they open and spread */
  private applyFingers(curl: number) {
    for (const { bi, s, f, j } of this.fingers) {
      const relaxed = j === 1 ? 0.3 + f * 0.07 : j === 2 ? 0.55 + f * 0.05 : 0.42 + f * 0.04;
      const opened = j === 2 ? 0.06 : 0.03;
      const c = lerp(opened, relaxed, curl);
      const q = bi.bone.quaternion.copy(bi.restLocal);
      if (j === 1) {
        const sp = lerp([0.16, 0.05, -0.06, -0.17][f], [-0.03, 0, 0.03, 0.06][f], curl);
        q.multiply(_q.setFromAxisAngle(bi.ax[1], -s * sp));
      }
      q.multiply(_q.setFromAxisAngle(bi.ax[2], -s * c));
    }
    for (const { bi, s, j } of this.thumbs) {
      const q = bi.bone.quaternion.copy(bi.restLocal);
      if (j === 1) q.multiply(_q.setFromAxisAngle(bi.ax[1], s * lerp(-0.18, 0.25, curl)));
      else q.multiply(_q.setFromAxisAngle(bi.ax[2], -s * lerp(0.0, 0.22, curl)));
    }
  }

  // ------------------------------------------------------------------------------------- per frame
  update(dt: number, ph: SkatePhysics, board: BoardView, input: { steer: number; crouch: boolean }) {
    this.time += dt;
    this.phaseT += dt;
    this.steer = input.steer;
    this.inCrouch = input.crouch;
    this.readEvents(ph, board);
    if (ph.mode === 'bail' && this.phase === 'ride') this.startBail(ph);
    const riding = this.phase === 'ride' || this.phase === 'stepon';
    if (riding) this.poseBoard(dt, ph, board); else { board.pose(0, -0.36, 0, 0, 0, 0); this.deckInfo.useDeck = true; }
    board.root.updateMatrixWorld(true);
    if (riding) this.placeRoot(board);
    if (this.phase !== 'ride') this.updateClipPhase(dt, ph);
    this.resetPose();
    if (this.procW > 0.001) this.ridePose(dt, ph, board);
    if (this.procW < 0.999) this.blendClip();
    this.updateFace(dt, ph);
    this.updateCloth(dt, ph);
  }

  private crossfade(dur: number) {
    this.xf.from.copy(this.Pout);
    this.xf.t = 0; this.xf.dur = dur;
  }

  private readEvents(ph: SkatePhysics, board: BoardView) {
    for (const e of ph.events) {
      switch (e.type) {
        case 'pop': this.popH = this.Pout.hipH; this.crossfade(0.06); break;
        case 'leaveGround': this.crossfade(0.12); break;
        case 'land':
          this.crossfade(0.1);
          if (e.quality === 'clean' && (e.popped || e.flip || e.vert || e.airTime > 0.3)) this.grinT = 1.1;
          this.clothKick = clamp(e.impact / 5, 0.3, 1); this.clothKickT = 0;
          break;
        case 'grindStart': this.crossfade(0.12); break;
        case 'grindEnd': this.crossfade(0.1); break;
        case 'flipDone': if (e.kind === 'shuvit') board.flipGraphic(); break;
      }
    }
  }

  // ------------------------------------------------------------------------------------- board + root
  private poseBoard(dt: number, ph: SkatePhysics, board: BoardView) {
    const inAir = ph.mode === 'air';
    let pitch = 0, pivot = -0.36, roll = 0, yaw = 0, lift = 0;
    // ollie: the tail snaps down, the nose rises, then the front foot drags it level
    if (inAir && ph.popped && ph.popT >= 0 && !ph.vert) {
      const tp = ph.time - ph.popT, T = ph.airPredT;
      pitch = 0.45 * sm(tp / 0.03) * (1 - sm((tp - 0.04) / Math.max(0.1, 0.4 * T)));
    }
    // manual: nose up ~15 deg on the back wheels with small, growing balance corrections
    const man = this.manS.update(ph.manual.active ? 1 : 0, dt);
    if (man > 0.001) {
      const A = this.manualAmp(ph);
      const mp = 0.27 + ph.manual.balance * 0.07 + A * 0.32 * Math.sin(this.time * 3.3) + A * 0.14 * Math.sin(this.time * 7.3 + 1);
      pitch = lerp(pitch, mp, man); pivot = lerp(pivot, -0.18, man);
    }
    // kickturn: the nose lifts ~28 deg and sets down as the board swings round on its back wheels
    if (ph.kickturn.t >= 0) {
      const k = clamp(ph.kickturn.t / KICKTURN_T, 0, 1);
      pitch = Math.max(pitch, 0.5 * Math.sin(Math.PI * Math.min(1, k * 1.08)));
      pivot = -0.18;
    }
    // flips: the board turns in open air under the feet, the deck is back to identity at the catch
    let useDeck = true, fp = 0, kind = '';
    if (inAir && ph.flip && !ph.flip.done) {
      fp = ph.flipProgress(); kind = ph.flip.kind;
      if (fp > 0) {
        useDeck = false;
        const e = 1 - Math.pow(1 - fp, 1.5);
        if (kind === 'kickflip') roll = -Math.PI * 2 * e; // toe edge comes up first
        else if (kind === 'heelflip') roll = Math.PI * 2 * e; // heel edge comes up first
        else if (kind === 'shuvit') yaw = -Math.PI * e; // backside: the tail swings behind the heels
        else { roll = -Math.PI * 2 * e; yaw = -Math.PI * 2 * e; }
        lift = 0.035 * Math.sin(Math.PI * fp);
      }
    }
    // sketchy landing: the board fishtails under the feet
    if (ph.wobble > 0 && ph.mode === 'ride') {
      const wt = ph.wobbleDur - ph.wobble;
      yaw += 0.26 * wobbleEnv(ph) * Math.sin(2 * Math.PI * 2.6 * wt);
    }
    const lean = ph.mode === 'ride' ? -this.leanS.x * 0.5 : 0;
    board.pose(pitch, pivot, roll, yaw, lift, lean);
    this.deckInfo.useDeck = useDeck; this.deckInfo.fp = fp; this.deckInfo.kind = kind;
  }

  private manualAmp(ph: SkatePhysics) {
    const m = ph.manual;
    return 0.06 + 0.1 * clamp(m.time / 2.5, 0, 1) + clamp(Math.abs(m.bvel) * 0.4, 0, 0.2);
  }

  /** root frame from the board: X_char = nose, Y = board up, Z = toe side (regular stance) */
  private placeRoot(board: BoardView) {
    const bq = board.root.quaternion;
    _q.setFromAxisAngle(Y, -Math.PI / 2);
    const rq = _q2.copy(bq).multiply(_q);
    if (this.phase === 'stepon') {
      const e = sm((this.phaseT - this.stepDelay) / 0.45);
      this.root.position.lerpVectors(this.clipRootPos, board.root.position, e);
      this.root.quaternion.slerpQuaternions(this.clipRootQ, rq, e);
    } else {
      this.root.position.copy(board.root.position);
      this.root.quaternion.copy(rq);
    }
    this.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------------------------- riding pose
  private ridePose(dt: number, ph: SkatePhysics, board: BoardView) {
    this.computePose(dt, ph, board, this.P);
    if (this.xf.t < this.xf.dur) {
      this.Pout.mix(this.xf.from, this.P, sm(this.xf.t / this.xf.dur));
      this.xf.t += dt;
    } else this.Pout.copy(this.P);
    this.applyPose(this.Pout);
  }

  private computePose(dt: number, ph: SkatePhysics, board: BoardView, P: Pose) {
    const st = this.stance;
    const t = this.time;
    const inAir = ph.mode === 'air';
    const g = ph.grind;
    const spd = ph.speed, spdF = clamp(spd / 9, 0, 1);
    const onTrans = ph.mode === 'ride' && ph.up.y < 0.965;
    // ---- context weights
    const crouch = this.crouchS.update(this.inCrouch && ph.mode === 'ride' && ph.kickturn.t < 0 && !ph.manual.active ? 1 : 0, dt);
    const push = this.pushS.update(ph.pushT >= 0 ? 1 : 0, dt);
    const man = this.manS.x;
    const gr = this.grindS.update(g ? 1 : 0, dt);
    const stillNow = ph.mode === 'ride' && spd < 0.25 && ph.pushT < 0 && !ph.manual.active && ph.kickturn.t < 0 && ph.up.y > 0.95 && !this.inCrouch;
    this.idleT = stillNow ? this.idleT + dt : 0;
    const idle = this.idleS.update(this.idleT > 0.7 ? 1 : 0, dt);
    const trans = this.transS.update(onTrans ? 1 : 0, dt);
    const brake = this.brakeS.update(ph.brakeAmt, dt);
    const leanT = ph.mode === 'ride' ? clamp(this.steer * spd * 0.068, -0.36, 0.36) * (1 - man * 0.5) : g ? g.balance * 0.35 : 0;
    const lean = this.leanS.update(leanT, dt);
    const look = this.lookS.update(ph.fakie ? -1 : 1, dt);
    const lookF = (look + 1) / 2;
    let open = man > 0.5 || gr > 0.5 || (inAir && (ph.popped || ph.airTime > 0.12)) || ph.wobble > 0 || ph.kickturn.t >= 0 ? 1 : 0;

    // ---- base riding stance: soft knees, hips open toward the nose, head over the leading shoulder
    P.hipH = 0.83 - 0.03 * spdF;
    P.hipZ = -0.015;
    P.pYaw = lerp(0.13, 0.32, lookF); P.pPitch = 0.13 + 0.05 * spdF; P.pRoll = 0;
    P.cYaw = 0.18 * look; P.cPitch = 0.08 + 0.04 * spdF + Math.sin(t * 2.1) * 0.012; P.cRoll = 0;
    P.hYaw = 0; P.hPitch = 0.12; P.hRoll = lean * 0.3;
    Object.assign(P.aL, arm(0.22 + 0.2 * spdF, 0.25, 0.5, 0.3));
    Object.assign(P.aR, arm(0.2 + 0.2 * spdF, -0.05, 0.45, 0.3));
    P.curl = 1;
    let frontX = st.front, backX = st.back;
    let frontYaw = 0.42, backYaw = 0.08;
    let hipShift = 0, hipToFront = 0;
    const fOff = new Vector3(), bOff = new Vector3();
    let fPitch = 0, fRoll = 0, bPitch = 0;
    this.fPole.set(0.45, 0.1, 1);

    // ---- relaxed idle on the board: weight on the back leg, soft shoulders, fidgets
    if (idle > 0.001) {
      hipShift -= 0.075 * idle;
      P.pRoll -= 0.09 * idle; P.cRoll += 0.075 * idle;
      P.pPitch = lerp(P.pPitch, 0.07, idle); P.cPitch = lerp(P.cPitch, 0.13, idle) + Math.sin(t * 1.5) * 0.02 * idle;
      P.pYaw += 0.08 * idle;
      for (const a of [P.aL, P.aR]) { a.raise = lerp(a.raise, 0.08, idle); a.fwd = lerp(a.fwd, 0.06, idle); a.elbow = lerp(a.elbow, 0.32, idle); a.hang = lerp(a.hang, 0.75, idle); }
    }
    this.fidget(dt, idle, P);
    this.idleFootYaw += (this.idleFootYawT * (idle > 0.3 ? 1 : 0) - this.idleFootYaw) * (1 - Math.exp(-(this.footLift > 0.005 ? 10 : 3) * dt));
    frontYaw += this.idleFootYaw;
    fOff.y += this.footLift;

    // ---- carving: the whole body leans into the turn (hips over the inside edge, knees bent), the shoulders lead
    if (ph.mode === 'ride') {
      const leanF = Math.max(0, lean), leanB = Math.max(0, -lean);
      P.hipZ += lean * 0.4;
      P.hipH -= Math.abs(lean) * 0.12;
      P.pPitch += leanF * 0.3 - leanB * 0.12; P.cPitch += leanF * 0.1 + leanB * 0.14;
      // the arms counter the lean: back on a toeside carve, forward over the toes on a heelside one
      P.aL.fwd += (leanB - leanF) * 0.9; P.aR.fwd += (leanB - leanF) * 0.9;
      P.aL.raise += Math.abs(lean) * 0.5; P.aR.raise += Math.abs(lean) * 0.5;
    } else {
      // grind balance
      P.hipZ += lean * 0.13;
      P.pPitch += Math.max(0, lean) * 0.45;
    }
    P.pYaw -= lean * 0.22; P.cYaw -= lean * 0.42;
    // ---- transitions: pump (compress toward the bottom, extend up the wall), never fold at the waist
    if (trans > 0.001 || Math.abs(this.pumpS.x) > 0.002) {
      const uphill = _v.set(0, 1, 0).addScaledVector(ph.up, -ph.up.y);
      const goingUp = uphill.lengthSq() > 1e-4 ? ph.vel.dot(uphill.normalize()) : 0;
      const steep = 1 - ph.up.y;
      const pumpT = !onTrans ? 0 : goingUp > 0.4 ? 0.05 : goingUp < -0.4 ? -0.15 * (1 - steep) - 0.02 : 0;
      const pump = this.pumpS.update(pumpT, dt);
      P.hipH += pump; P.pPitch -= pump * 0.9;
      P.hipH += 0.016 * Math.sin(t * 2.6) * trans;
    }
    // the arms keep adjusting, more on transitions and at speed
    const life = 0.1 + 0.16 * spdF + 0.42 * trans;
    P.aL.raise += life * (0.35 * Math.sin(t * 1.7 + 0.4) + 0.2 * Math.sin(t * 2.9)); P.aL.fwd += life * 0.4 * Math.sin(t * 1.1 + 1.3);
    P.aR.raise += life * (0.35 * Math.sin(t * 1.9 + 2.1) + 0.2 * Math.sin(t * 3.3 + 1)); P.aR.fwd += life * 0.4 * Math.sin(t * 1.3 + 0.2);
    if (trans > 0.3) open = 1;

    // ---- wind-up crouch before the pop
    if (crouch > 0.001) {
      P.hipH -= 0.3 * crouch;
      P.pPitch += 0.36 * crouch; P.cPitch += 0.14 * crouch;
      P.hPitch -= 0.3 * crouch;
      for (const a of [P.aL, P.aR]) { a.raise = lerp(a.raise, 0.22, crouch); a.fwd = lerp(a.fwd, -0.4, crouch); a.elbow = lerp(a.elbow, 0.35, crouch); a.hang = lerp(a.hang, 0, crouch); }
      backX = lerp(backX, st.tail + 0.01, crouch * 0.85);
      frontX = lerp(frontX, st.front - 0.02, crouch);
    }

    // ---- push: turn to face the nose, deep front knee, forward lean, the body sinks with each kick
    const pt = ph.pushT;
    if (push > 0.001) {
      const sink = pt >= 0 ? win(pt, 0.05, 0.26, 0.42, 0.74) : 0;
      P.pYaw += push * 1.15;
      P.pPitch += push * 0.32; P.cPitch += push * 0.2;
      P.hPitch -= push * 0.12;
      P.hipH -= push * (0.15 + 0.09 * sink);
      hipToFront = push * 0.85;
      P.hipZ += push * 0.03;
      this.fPole.lerp(_v.set(1, 0.15, 0.3), push); // the front knee bends forward over the front bolts
      const sw = pt >= 0 ? Math.sin((2 * Math.PI * pt) / 0.78) * push : 0;
      P.aL.fwd += 0.6 * sw; P.aR.fwd -= 0.6 * sw; P.aL.raise += 0.12 * push; P.aR.raise += 0.12 * push;
      P.aL.hang *= 1 - push * 0.6; P.aR.hang *= 1 - push * 0.6;
      frontYaw = lerp(frontYaw, 1.2, push);
    }

    // ---- manual: weight back over the tail, back knee bent, front leg long, arms out but bent, constant small corrections
    if (man > 0.001) {
      const m = ph.manual, A = this.manualAmp(ph);
      hipShift += man * (-0.14 + m.balance * 0.04);
      P.hipH += 0.01 * man;
      P.pRoll += man * (0.22 + m.balance * 0.07 + A * 0.25 * Math.sin(t * 2.7 + 0.6)); P.cRoll -= 0.04 * man;
      P.pPitch = lerp(P.pPitch, 0.1, man);
      P.hipZ += man * A * 0.06 * Math.sin(t * 1.9);
      const L = arm(0.78 + A * Math.sin(t * 2.3), 0.5 + A * 0.8 * Math.sin(t * 1.7 + 1), 0.75);
      const R = arm(0.72 + A * Math.sin(t * 2.0 + 2), -0.35 + A * 0.8 * Math.sin(t * 1.5), 0.7);
      for (const [a, b] of [[P.aL, L], [P.aR, R]] as [ArmP, ArmP][]) { a.raise = lerp(a.raise, b.raise, man); a.fwd = lerp(a.fwd, b.fwd, man); a.elbow = lerp(a.elbow, b.elbow, man); a.hang *= 1 - man; }
      backX = lerp(backX, -0.24, man); frontX = lerp(frontX, 0.19, man);
    }

    // ---- kickturn: bent knees, weight back, the shoulders turn first
    if (ph.kickturn.t >= 0) {
      const k = clamp(ph.kickturn.t / KICKTURN_T, 0, 1);
      const kw = sm(k / 0.15) * (1 - sm((k - 0.85) / 0.15));
      const d = ph.kickturn.dir;
      P.hipH -= 0.09 * kw; hipShift -= 0.07 * kw; P.pRoll += 0.12 * kw;
      P.cYaw += d * 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.5));
      P.pYaw += d * 0.2 * Math.sin(Math.PI * Math.min(1, k * 1.3));
      P.aL.raise += 0.5 * kw; P.aR.raise += 0.5 * kw; P.aL.hang *= 1 - kw; P.aR.hang *= 1 - kw;
    }

    // ---- sketchy landing: arms windmill, hips sway, one foot shuffles to re-centre
    if (ph.wobble > 0 && ph.mode === 'ride') {
      const wt = ph.wobbleDur - ph.wobble, env = wobbleEnv(ph);
      const a = 2 * Math.PI * 1.6 * wt;
      P.aL.raise += env * (0.5 + 0.8 * Math.sin(a)); P.aL.fwd += env * 1.1 * Math.cos(a);
      P.aR.raise += env * (0.5 + 0.8 * Math.sin(a + Math.PI)); P.aR.fwd += env * 1.1 * Math.cos(a + Math.PI);
      P.aL.elbow = lerp(P.aL.elbow, 0.25, env); P.aR.elbow = lerp(P.aR.elbow, 0.25, env);
      P.aL.hang *= 1 - env; P.aR.hang *= 1 - env;
      // hips counter the board's fishtail
      const sw = 2 * Math.PI * 2.6 * wt + Math.PI;
      P.hipZ += 0.08 * env * Math.sin(sw); P.pRoll += 0.11 * env * Math.sin(sw + 1.1); P.cRoll -= 0.13 * env * Math.sin(sw + 0.4);
      P.pPitch += 0.08 * env * Math.sin(Math.PI * 2.4 * wt);
      P.hPitch += 0.12 * env;
      const sh = win(wt, 0.38, 0.48, 0.58, 0.72);
      bOff.y += 0.07 * sh; backX += 0.04 * sh;
    }

    // ---- air
    if (inAir) {
      if (ph.vert) {
        const tti = ph.predicted ? ph.predicted.tti : 0.5;
        P.hipH = lerp(0.5, 0.72, sm((0.3 - tti) / 0.24));
        P.pPitch = 0.3; P.cPitch = 0.12; P.hPitch = 0.2;
        Object.assign(P.aL, arm(1.0, 0.35, 0.45)); Object.assign(P.aR, arm(0.95, -0.25, 0.45));
      } else if (ph.popped && ph.popT >= 0) {
        // explicit curves over the predicted air time: pop (back leg snaps straight) -> tuck at the peak -> reach for the ground
        const tp = ph.time - ph.popT, T = ph.airPredT;
        const tExt = 0.07, tT1 = Math.max(0.16, 0.48 * T), tE0 = Math.max(tT1 + 0.04, 0.6 * T), tE1 = Math.max(tE0 + 0.06, T - 0.02);
        // hips above the deck: the body still rises ~0.25 m at the peak while the board comes up into the tuck
        const Htuck = ph.flip ? 0.6 : 0.64;
        let h: number;
        if (tp < tExt) h = lerp(this.popH, 0.92, easeOut(tp / tExt));
        else if (tp < tT1) h = lerp(0.92, Htuck, sm((tp - tExt) / (tT1 - tExt)));
        else if (tp < tE0) h = Htuck;
        else h = lerp(Htuck, 0.75, sm((tp - tE0) / (tE1 - tE0)));
        P.hipH = h;
        const kPop = 1 - sm(tp / 0.12);
        const kExt = sm((tp - tE0) / (tE1 - tE0));
        const kTuck = sm((tp - tExt) / (tT1 - tExt)) * (1 - kExt);
        P.pPitch = 0.06 + 0.3 * kTuck + 0.14 * kExt + 0.06 * kPop;
        P.cPitch = 0.03 + 0.16 * kTuck + 0.06 * kExt;
        P.hPitch = 0.05 + 0.3 * kTuck + 0.05 * kExt;
        // arms swing up with the pop and stay out wide for balance
        const up = sm(tp / 0.1);
        const L = arm(1.25 - 0.25 * kTuck - 0.35 * kExt, 0.35, 0.4), R = arm(1.2 - 0.25 * kTuck - 0.35 * kExt, -0.2, 0.4);
        for (const [a, b] of [[P.aL, L], [P.aR, R]] as [ArmP, ArmP][]) { a.raise = lerp(a.raise, b.raise, up); a.fwd = lerp(a.fwd, b.fwd, up); a.elbow = lerp(a.elbow, b.elbow, up); a.hang = lerp(a.hang, 0, up); }
        // feet: the back foot snaps the tail, the front foot slides up to the nose, both come back over the bolts to land
        const slide = sm((tp - 0.02) / 0.14) * (1 - kExt);
        frontX = lerp(st.front, st.nose - 0.03, slide);
        backX = lerp(st.back + 0.01, st.tail + 0.01, 1 - sm((tp - 0.05) / 0.1));
        // flips: legs split, the front foot flicks off the toe edge (kickflip) or kicks the heel out over the heel edge
        const fp = this.deckInfo.fp, kind = this.deckInfo.kind;
        if (fp > 0 && fp < 1) {
          const out = sm(fp / 0.3) * (1 - sm((fp - 0.66) / 0.3));
          const lift = sm(fp / 0.22) * (1 - sm((fp - 0.74) / 0.26));
          if (kind === 'kickflip') {
            // front foot drags off the nose and flicks out over the toe edge; legs split wide
            fOff.set(0.22 * out, 0.05 * out + 0.07 * lift, 0.22 * out); bOff.set(-0.11 * lift, 0.19 * lift, 0.02 * lift); fRoll = 0.4 * out;
            this.fPole.lerp(_v.set(0.75, 0.35, 0.7), out);
          } else if (kind === 'heelflip') {
            // the heel kicks forward off the heel edge (toes up, heel leading); legs split wide
            fOff.set(0.2 * out, 0.06 * out + 0.07 * lift, -0.24 * out); bOff.set(-0.11 * lift, 0.19 * lift, 0.02 * lift);
            frontYaw -= 0.65 * out; fPitch = -0.45 * out;
            this.fPole.lerp(_v.set(0.8, 0.35, 0.35), out);
          } else if (kind === 'shuvit') {
            const scoop = win(fp, 0, 0.1, 0.18, 0.34);
            fOff.set(0, 0.15 * lift, 0); bOff.set(-0.02 * lift, 0.17 * lift, -0.08 * scoop); bPitch = 0.25 * scoop;
          } else {
            const scoop = win(fp, 0, 0.1, 0.18, 0.34);
            fOff.set(0.08 * out, 0.13 * lift, 0.15 * out); bOff.set(-0.03 * lift, 0.17 * lift, -0.09 * scoop); fRoll = 0.25 * out;
          }
          P.hipH -= 0.03 * lift;
          P.aL.raise += 0.1 * lift; P.aR.raise += 0.1 * lift;
        }
      } else {
        // rolled off an edge / dropping in: crouch a little, arms out, reach for the ground before touchdown
        const ta = ph.airTime, tti = ph.predicted ? ph.predicted.tti : 0.4;
        P.hipH = lerp(lerp(P.hipH, 0.64, sm(ta / 0.15)), 0.72, sm((0.22 - tti) / 0.18));
        P.pPitch += 0.08;
        for (const a of [P.aL, P.aR]) { a.raise = lerp(a.raise, 0.95, sm(ta / 0.15)); a.hang = 0; }
      }
    }

    // ---- landing: knees bend deep over 2-3 frames, arms dip, torso folds, then rise back up
    const tl = ph.time - ph.landT;
    if (ph.mode === 'ride' && tl >= 0 && tl < 0.7) {
      const depth = clamp(0.14 + 0.055 * ph.landImpact, 0.2, 0.36);
      const a = tl < 0.07 ? sm(tl / 0.07) : tl < 0.13 ? 1 : 1 - easeOut3((tl - 0.13) / 0.45);
      P.hipH -= depth * a;
      P.pPitch += 0.38 * a * (depth / 0.28); P.cPitch += 0.12 * a;
      P.hPitch -= 0.12 * a;
      for (const [arm_, f] of [[P.aL, 0.5], [P.aR, 0.35]] as [ArmP, number][]) {
        arm_.raise -= 0.35 * a; arm_.fwd += f * a; arm_.elbow += 0.3 * a; arm_.hang *= 1 - a;
      }
    }

    // ---- grinds: locked in, knees bent, arms out and balancing
    if (gr > 0.001) {
      const bal = g ? g.balance : 0;
      P.hipH = lerp(P.hipH, 0.67, gr);
      P.pPitch = lerp(P.pPitch, 0.24 + bal * 0.12, gr); P.cPitch = lerp(P.cPitch, 0.1, gr);
      P.hipZ += bal * 0.06 * gr;
      const L = arm(0.95 + 0.15 * Math.sin(t * 2.4 + bal), 0.3, 0.5), R = arm(0.9 + 0.15 * Math.sin(t * 2.1), -0.25, 0.5);
      for (const [a, b] of [[P.aL, L], [P.aR, R]] as [ArmP, ArmP][]) { a.raise = lerp(a.raise, b.raise, gr); a.fwd = lerp(a.fwd, b.fwd, gr); a.elbow = lerp(a.elbow, b.elbow, gr); a.hang *= 1 - gr; }
    }

    // ---- cap the bend: the torso never folds flat at the waist (~35 deg on transitions)
    const cap = onTrans ? 0.61 : 0.82;
    const bend = P.pPitch + P.cPitch;
    if (bend > cap) { const k = cap / bend; P.pPitch *= k; P.cPitch *= k; }

    // ---- gaze along the direction of travel (over the leading shoulder), within what a neck can turn
    const vr = _v.copy(ph.vel).applyQuaternion(_q.copy(this.root.quaternion).invert());
    let gaze = look > 0 ? 1.45 : -1.45;
    if (Math.hypot(vr.x, vr.z) > 0.6) {
      gaze = Math.atan2(vr.x, vr.z);
      if (Math.abs(gaze) > 2.6) gaze = Math.sign(this.gazeS.x || 1) * Math.PI;
      gaze = clamp(gaze, -1.65, 1.65);
    }
    const gz = this.gazeS.update(gaze, dt);
    P.hYaw = clamp(gz - P.pYaw - P.cYaw, -1.35, 1.35) + this.glanceYaw;

    P.curl = 1 - this.openS.update(open, dt);
    P.hipX = lerp((frontX + backX) / 2 - 0.015, frontX - 0.03, hipToFront) + hipShift;

    // ---- feet: IK targets on the deck (or above the un-flipped deck plane during a flip)
    const useDeck = this.deckInfo.useDeck;
    const fa = this.anchor(board, frontX, useDeck, new Vector3());
    const ba = this.anchor(board, backX, useDeck, new Vector3());
    const deckUp = new Vector3(0, 1, 0).applyMatrix4(_m.extractRotation(useDeck ? board.deck.matrix : board.plainM));
    deckUp.applyQuaternion(_q.setFromAxisAngle(Y, Math.PI / 2)).normalize();
    const onDeck = (yaw: number) => { const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)); return f.addScaledVector(deckUp, -f.dot(deckUp)).normalize(); };
    const ankleH = 0.118, shoeC = 0.075;
    const ff = onDeck(frontYaw), bf = onDeck(backYaw);
    const fu = deckUp.clone(), bu = deckUp.clone();
    if (fPitch || fRoll) { const side = new Vector3().crossVectors(fu, ff).normalize(); _q.setFromAxisAngle(side, fPitch); ff.applyQuaternion(_q); fu.applyQuaternion(_q); _q.setFromAxisAngle(ff, fRoll); fu.applyQuaternion(_q); }
    if (bPitch) { const side = new Vector3().crossVectors(bu, bf).normalize(); _q.setFromAxisAngle(side, bPitch); bf.applyQuaternion(_q); bu.applyQuaternion(_q); }
    P.fA.copy(fa).addScaledVector(ff, -shoeC).addScaledVector(fu, ankleH).add(fOff);
    P.fF.copy(ff); P.fU.copy(fu); P.fP.copy(this.fPole);
    P.bA.copy(ba).addScaledVector(bf, -shoeC).addScaledVector(bu, ankleH).add(bOff);
    P.bF.copy(bf); P.bU.copy(bu); P.bP.set(-0.15, 0.1, 1);

    // push: the back foot reaches ahead, plants beside the front truck, sweeps back along the ground, returns to the tail
    if (pt >= 0 && push > 0.02) {
      if (pt < this.pushPrevT) { this.pushPlant = null; this.pushRet = -1; }
      this.pushPrevT = pt;
      const plant = new Vector3(frontX + 0.05, 0, 0.21);
      const deckAnkle = P.bA.clone();
      if (pt < 0.24) {
        const k = sm(pt / 0.24);
        const p = deckAnkle.clone().lerp(_v.copy(plant).setY(ankleH), k);
        p.y += Math.sin(k * Math.PI) * 0.09;
        P.bA.copy(p); this.pushPlant = null; this.pushRet = -1;
        P.bF.lerp(new Vector3(1, 0, 0.15).normalize(), k).normalize();
        P.bU.lerp(Y, k).normalize();
        P.bP.set(0.6, 0.1, 0.8);
      } else {
        if (!this.pushPlant) this.pushPlant = this.root.localToWorld(plant.clone());
        if (this.pushRet < 0) {
          // the planted foot stays put on the ground; lift it once the stroke is done or it is far behind
          const rel = this.toRoot(this.pushPlant.clone());
          if (pt >= 0.54 || rel.x < -0.6) { this.pushRet = pt; this.pushFrom.copy(rel).setY(ankleH); }
        }
        if (this.pushRet < 0) {
          const p = this.toRoot(this.pushPlant.clone());
          const k = sm((pt - 0.24) / 0.3);
          p.y = ankleH + k * 0.012;
          P.bA.copy(p);
          P.bF.set(1, 0, 0.2).normalize().applyAxisAngle(Z, -k * 0.35);
          P.bU.copy(Y);
          P.bP.set(0.4, 0.05, 1);
        } else {
          const k = sm((pt - this.pushRet) / 0.24);
          const p = _v.copy(this.pushFrom).lerp(deckAnkle, k); p.y += Math.sin(k * Math.PI) * 0.13;
          P.bA.copy(p);
          P.bF.set(1, 0, 0.2).normalize().lerp(bf, k).normalize();
          P.bU.copy(Y).lerp(bu, k).normalize();
        }
      }
    } else { this.pushPlant = null; this.pushRet = -1; this.pushPrevT = 0; }
    // foot brake: the back foot drags behind on the ground
    if (brake > 0.01) {
      P.bA.lerp(new Vector3(st.back - 0.32, ankleH, 0.14), brake);
      P.bU.lerp(Y, brake).normalize();
      P.bF.lerp(new Vector3(0.3, 0, 1).normalize(), brake).normalize();
    }
  }

  private anchor(board: BoardView, x: number, useDeck: boolean, out: Vector3) {
    board.deckPoint(-0.01, x, out, useDeck);
    return this.root.worldToLocal(out);
  }

  private toRoot(p: Vector3) { return this.root.worldToLocal(p); }

  /** idle fidgets: glance around, adjust the cap, shift a foot */
  private fidget(dt: number, idle: number, P: Pose) {
    const f = this.fid;
    if (idle < 0.9) {
      if (f.kind) f.kind = '';
      f.wait = Math.max(f.wait, 1.5);
      this.glanceYaw *= Math.exp(-6 * dt); this.capW *= Math.exp(-8 * dt); this.footLift *= Math.exp(-8 * dt);
      return;
    }
    if (!f.kind) {
      f.wait -= dt;
      if (f.wait <= 0) { f.kind = (['glance', 'cap', 'feet'] as const)[f.n++ % 3]; f.t = 0; f.applied = false; }
      return;
    }
    f.t += dt;
    let D = 1;
    if (f.kind === 'glance') {
      D = 2.8;
      this.glanceYaw = 0.75 * win(f.t, 0.0, 0.45, 1.1, 1.5) - 0.6 * win(f.t, 1.3, 1.75, 2.3, 2.8);
      P.hPitch += 0.06 * win(f.t, 0, 0.4, 2.3, 2.8);
    } else if (f.kind === 'cap') {
      D = 2.3;
      this.capW = win(f.t, 0.05, 0.5, 1.7, 2.25);
      this.capTug = Math.sin(f.t * 9) * 0.012 * win(f.t, 0.6, 0.8, 1.4, 1.6);
      P.hPitch += 0.14 * this.capW;
    } else {
      D = 1.3;
      this.footLift = 0.035 * win(f.t, 0.1, 0.35, 0.75, 1.05);
      if (f.t > 0.35 && !f.applied) { f.applied = true; this.idleFootYawT = this.idleFootYawT > 0.05 ? -0.12 : 0.17; }
    }
    if (f.t > D) {
      f.kind = ''; f.wait = 2.6 + ((f.n * 0.618) % 1) * 2.4;
      this.glanceYaw = 0; this.capW = 0; this.footLift = 0;
    }
  }

  /** write a Pose onto the bones */
  private applyPose(P: Pose) {
    const hb = this.b.get('Hips')!;
    const hipsPos = new Vector3(P.hipX, deckTopY(0) + P.hipH, P.hipZ);
    hb.bone.position.copy(hb.bone.parent!.worldToLocal(this.root.localToWorld(hipsPos)));
    this.setYXZ('Hips', P.pYaw, P.pPitch, P.pRoll);
    this.setYXZ('Spine', P.cYaw / 3, P.cPitch * 0.4, P.cRoll / 3);
    this.setYXZ('Spine1', P.cYaw / 3, P.cPitch * 0.35, P.cRoll / 3);
    this.setYXZ('Spine2', P.cYaw / 3, P.cPitch * 0.25, P.cRoll / 3);
    // the head stays roughly level while the torso bends
    const hp = P.hPitch - 0.75 * (P.pPitch + P.cPitch);
    this.setYXZ('Neck', P.hYaw * 0.4, hp * 0.4, P.hRoll * 0.4);
    this.setYXZ('Head', P.hYaw * 0.6, hp * 0.6, P.hRoll * 0.6);
    this.hips.updateMatrixWorld(true);
    // arms
    const chestQ = this.deltaRot('Spine2', new Quaternion());
    const U = new Vector3(), F = new Vector3();
    this.armDirs('Left', P.aL, chestQ, U, F);
    this.aimArm('Left', U, F);
    this.armDirs('Right', P.aR, chestQ, U, F);
    if (this.capW > 0.001) {
      // right hand up to the cap brim
      const head = this.b.get('Head')!;
      const hpos = this.rootSpacePos(head.bone, new Vector3());
      const hq = this.deltaRot('Head', new Quaternion());
      const target = new Vector3(-0.06, 0.1 + this.capTug, 0.1).applyQuaternion(hq).add(hpos);
      const U2 = new Vector3(), F2 = new Vector3();
      this.armIK('Right', target, new Vector3(-0.7, -0.6, -0.1), U2, F2);
      U.lerp(U2, this.capW).normalize(); F.lerp(F2, this.capW).normalize();
    }
    this.aimArm('Right', U, F);
    // legs
    this.legIK('Left', P.fA, P.fP, P.fF, P.fU);
    this.legIK('Right', P.bA, P.bP, P.bF, P.bU);
    this.applyFingers(P.curl);
  }

  // ------------------------------------------------------------------------------------- clips (bail / get up / walk)
  private play(name: string, opts: { loop?: boolean; rate?: number; start?: number } = {}) {
    const clip = this.clips.get(name);
    if (!clip) return null;
    this.mixer.stopAllAction();
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(opts.loop ? LoopRepeat : LoopOnce, opts.loop ? Infinity : 1);
    a.clampWhenFinished = true;
    a.timeScale = opts.rate ?? 1;
    a.time = opts.start ?? 0;
    a.weight = 1;
    a.play();
    this.action = a;
    return a;
  }

  /** hold the pose on screen right now and fade from it into whatever comes next */
  private takeSnapshot(fade: number) {
    const s = new Map<Bone, { q: Quaternion; p: Vector3 }>();
    for (const bi of this.allBones()) s.set(bi.bone, { q: bi.bone.quaternion.clone(), p: bi.bone.position.clone() });
    this.snap = s; this.snapW = 1; this.snapFade = fade;
  }

  /** move the character root without anything moving on screen (the snapshot and the clip alignment are re-expressed) */
  private rebase(pos: Vector3, q: Quaternion) {
    this.root.updateMatrixWorld(true);
    const oldM = _m.copy(this.root.matrix);
    const newM = new Matrix4().compose(pos, q, ONE);
    const D = newM.clone().invert().multiply(oldM); // old root space -> new root space
    const hips = this.hips;
    if (this.snap) {
      const s = this.snap.get(hips);
      if (s) {
        const hm = new Matrix4().compose(s.p, s.q, ONE).premultiply(this.rigM).premultiply(D).premultiply(this.rigInv);
        hm.decompose(s.p, s.q, _v);
      }
    }
    this.corr.premultiply(D);
    this.root.position.copy(pos); this.root.quaternion.copy(q);
    this.root.updateMatrixWorld(true);
  }

  /** the clip's hips position/rotation at time t (root space) */
  private sampleHips(name: string, t: number) {
    const c = this.clips.get(name)!;
    const pt = c.tracks.find((k) => k.name.endsWith('Hips.position'));
    const qt = c.tracks.find((k) => k.name.endsWith('Hips.quaternion'));
    const p = new Vector3(), q = new Quaternion();
    // createInterpolant is assigned per track at runtime (not in the type declarations)
    if (pt) { const r = (pt as any).createInterpolant().evaluate(t); p.set(r[0], r[1], r[2]); }
    if (qt) { const r = (qt as any).createInterpolant().evaluate(t); q.set(r[0], r[1], r[2], r[3]); }
    const m = new Matrix4().compose(p, q, ONE).premultiply(this.rigM);
    m.decompose(p, q, _v);
    return { p, q };
  }

  /** direction the body lies (head direction when lying, facing when upright) */
  private static bodyYaw(q: Quaternion) {
    const u = _v.set(0, 1, 0).applyQuaternion(q);
    const d = Math.abs(u.y) < 0.75 ? u : _v.set(0, 0, 1).applyQuaternion(q);
    return Math.atan2(d.x, d.z);
  }

  /** align a clip's start pose with the current hips (horizontal position + body direction) */
  private alignClip(name: string, t: number) {
    const hb = this.hips;
    const cp = this.rootSpacePos(hb, new Vector3()), cq = this.rootSpaceQuat(hb, new Quaternion());
    const { p: gp, q: gq } = this.sampleHips(name, t);
    const dyaw = wrapA(Skater.bodyYaw(cq) - Skater.bodyYaw(gq));
    const rq = new Quaternion().setFromAxisAngle(Y, dyaw);
    const rp = gp.clone().applyQuaternion(rq);
    this.corr.compose(new Vector3(cp.x - rp.x, 0, cp.z - rp.z), rq, ONE);
  }

  private hipsFwdY() {
    const q = this.rootSpaceQuat(this.hips, new Quaternion());
    return _v.set(0, 0, 1).applyQuaternion(q).y;
  }

  private startBail(ph: SkatePhysics) {
    const b = ph.bail!;
    this.bailKind = b.kind;
    this.takeSnapshot(0.2);
    this.rebase(b.body.clone(), new Quaternion().setFromAxisAngle(Y, b.heading));
    this.corr.identity();
    this.phase = 'bail'; this.phaseT = 0; this.procW = 0;
    const spec = FALLS[b.kind];
    let clip = spec.clip, start = spec.start, rate = spec.rate, end = spec.end;
    if (!this.clips.has(clip)) { clip = 'bail_back'; start = 0.6; rate = 1.3; end = 2.25; }
    this.play(clip, { rate, start });
    this.fallEnd = Math.min(end, this.clips.get(clip)?.duration ?? end);
    this.setExpr('grimace');
    this.idleT = 0; this.fid.kind = '';
  }

  private startLie() {
    this.phase = 'lie'; this.phaseT = 0;
    const back = this.hipsFwdY() > 0.3;
    if (back && this.clips.has('lie_shake')) {
      // lying on the back: shake it off (the clip's start matches the fall's end)
      this.takeSnapshot(0.5);
      this.alignClip('lie_shake', 0);
      this.play('lie_shake', { loop: true });
      this.lieDur = 1.7; this.shakeW = 0;
    } else {
      // lying on the front: hold the end of the fall and move a little
      this.lieDur = 1.1; this.shakeW = 1;
    }
  }

  private startGetup() {
    const g = this.hipsFwdY() > 0.3 ? GETUPS.back : GETUPS.front;
    this.takeSnapshot(0.45);
    this.alignClip(g.clip, g.start);
    this.play(g.clip, { rate: g.rate, start: g.start });
    this.getupEnd = g.end;
    this.phase = 'getup'; this.phaseT = 0; this.shakeW = 0;
  }

  private startWalk(ph: SkatePhysics) {
    // stand the walker where the hips are, facing the way the body faces
    const hb = this.hips;
    const hp = hb.getWorldPosition(new Vector3());
    const f = new Vector3(0, 0, 1).applyQuaternion(hb.getWorldQuaternion(new Quaternion())).setY(0);
    if (f.lengthSq() < 1e-4) f.set(0, 0, 1);
    f.normalize();
    const yaw = Math.atan2(f.x, f.z);
    const gh = ph.world.raycast(_v.copy(hp).add(_v2.set(0, 0.5, 0)), _v3.set(0, -1, 0), 3);
    this.takeSnapshot(0.4);
    this.rebase(new Vector3(hp.x, gh ? gh.point.y : this.root.position.y, hp.z), new Quaternion().setFromAxisAngle(Y, yaw));
    this.corr.identity();
    this.walk = { target: new Vector3(), faceYaw: yaw, speed: 0, yaw, ridePos: new Vector3(), rideFwd: new Vector3(), wait: 0 };
    this.planWalk(ph);
    if (!this.play('walk', { loop: true, rate: 0.4 })) this.play('idle', { loop: true });
    this.phase = 'walk'; this.phaseT = 0;
  }

  /** stand on the heel side of the board, facing across it */
  private planWalk(ph: SkatePhysics) {
    const w = this.walk!;
    const bb = ph.bail?.board;
    const up = new Vector3(0, 1, 0);
    if (bb) bb.ridePose(w.ridePos, w.rideFwd, up);
    else { w.ridePos.copy(this.root.position); w.rideFwd.set(1, 0, 0); }
    const heel = new Vector3().crossVectors(up, w.rideFwd).setY(0).normalize();
    w.target.copy(w.ridePos).addScaledVector(heel, 0.36);
    w.faceYaw = Math.atan2(-heel.x, -heel.z);
  }

  private walkStep(dt: number, ph: SkatePhysics) {
    const w = this.walk!;
    const bb = ph.bail?.board;
    const waiting = !!bb && !bb.asleep && w.wait < 3;
    if (waiting) { w.wait += dt; this.planWalk(ph); }
    const p = this.root.position;
    const to = _v.set(w.target.x - p.x, 0, w.target.z - p.z);
    const dist = to.length();
    const near = dist < 0.4;
    const want = near ? w.faceYaw : Math.atan2(to.x, to.z);
    const dy = wrapA(want - w.yaw);
    w.yaw += clamp(dy, -3.2 * dt, 3.2 * dt);
    if (waiting) w.speed = Math.max(0, w.speed - 3 * dt);
    else if (!near) {
      const align = Math.max(0, Math.cos(dy));
      w.speed += clamp(WALK_SPEED * align * align * sm(dist / 0.8) - w.speed, -3 * dt, 2.5 * dt);
      p.x += Math.sin(w.yaw) * w.speed * dt; p.z += Math.cos(w.yaw) * w.speed * dt;
    } else {
      // last steps: shuffle onto the spot while turning to face the board
      w.speed = Math.max(0, w.speed - 3 * dt);
      if (dist > 1e-4) p.addScaledVector(to.divideScalar(dist), Math.min(dist, Math.max(0.3, w.speed) * dt));
    }
    const gh = ph.world.raycast(_v2.set(p.x, p.y + 0.6, p.z), _v3.set(0, -1, 0), 2);
    if (gh) p.y += (gh.point.y - p.y) * (1 - Math.exp(-14 * dt));
    this.root.quaternion.setFromAxisAngle(Y, w.yaw);
    if (this.action) this.action.timeScale = Math.max(near || Math.abs(dy) > 0.2 ? 0.55 : waiting ? 0.25 : 0.3, w.speed / WALK_SPEED);
    const arrived = dist < 0.04 && Math.abs(wrapA(w.faceYaw - w.yaw)) < 0.1;
    if (arrived || this.phaseT > 9) this.startStepOn(ph);
  }

  private startStepOn(ph: SkatePhysics) {
    const w = this.walk!;
    const bb = ph.bail?.board;
    if (bb) bb.ridePose(w.ridePos, w.rideFwd, _v);
    // an upside-down board gets flipped over first (the board hops over in game.syncBoard), then he steps on
    this.stepDelay = bb && !bb.wheelsDown ? 0.32 : 0;
    this.onRecovered?.(w.ridePos.clone(), w.rideFwd.clone());
    this.phase = 'stepon'; this.phaseT = 0;
    this.clipRootPos.copy(this.root.position); this.clipRootQ.copy(this.root.quaternion);
    this.procW = 0;
    if (this.action) this.action.timeScale = 0.25;
    this.xf.t = this.xf.dur;
    for (const s of [this.crouchS, this.pushS, this.manS, this.grindS, this.idleS, this.transS, this.pumpS, this.brakeS, this.leanS, this.openS]) s.set(0);
    this.idleS.set(0.6);
    this.lookS.set(1);
    this.gazeS.set(1.4);
  }

  private updateClipPhase(dt: number, ph: SkatePhysics) {
    const a = this.action;
    switch (this.phase) {
      case 'bail':
        if (ph.bail) this.root.position.copy(ph.bail.body);
        if (!a || a.time >= this.fallEnd - 0.03) {
          if (this.bailKind === 'roll') this.startWalk(ph); else this.startLie();
        }
        break;
      case 'lie':
        if (this.phaseT > this.lieDur) this.startGetup();
        break;
      case 'getup':
        if (!a || a.time >= this.getupEnd - 0.02) this.startWalk(ph);
        break;
      case 'walk':
        this.walkStep(dt, ph);
        break;
      case 'stepon':
        if (this.phaseT > this.stepDelay) this.procW = Math.min(1, this.procW + dt / 0.5);
        if (this.procW >= 1) { this.phase = 'ride'; this.mixer.stopAllAction(); this.action = null; this.snap = null; }
        break;
    }
    this.root.updateMatrixWorld(true);
    this.mixer.update(dt);
    // the mixer only writes changed values, so keep our own copy of the clip pose
    for (const bi of this.allBones()) {
      let s = this.clipPose.get(bi.bone);
      if (!s) { s = { q: new Quaternion(), p: new Vector3() }; this.clipPose.set(bi.bone, s); }
      s.q.copy(bi.bone.quaternion); s.p.copy(bi.bone.position);
    }
    // re-root the clip's hips (aligned start, walker position)
    const hs = this.clipPose.get(this.hips)!;
    const hm = new Matrix4().compose(hs.p, hs.q, ONE).premultiply(this.rigM).premultiply(this.corr).premultiply(this.rigInv);
    hm.decompose(hs.p, hs.q, _v);
    if (this.shakeW > 0.001) this.shake(this.shakeW);
    if (this.phase === 'bail' && this.bailKind === 'wall' && this.phaseT < 0.55) this.impact(this.phaseT);
    this.snapW = Math.max(0, this.snapW - dt / this.snapFade);
  }

  /** add a rotation about a character axis (as seen in the bone's rest frame) on top of the clip pose */
  private addClip(name: string, axis: 0 | 1 | 2, ang: number) {
    const bi = this.b.get(name); const s = bi && this.clipPose.get(bi.bone);
    if (s) s.q.multiply(_q.setFromAxisAngle(bi.ax[axis], ang));
  }

  /** small movements while lying there (rub, shrug, shake it off) */
  private shake(w: number) {
    const t = this.phaseT;
    this.addClip('Spine1', 0, Math.sin(t * 2.3) * 0.05 * w);
    this.addClip('Head', 1, Math.sin(t * 1.4) * 0.18 * w);
    this.addClip('Head', 0, Math.sin(t * 2.9 + 1) * 0.06 * w);
    this.addClip('LeftArm', 2, Math.sin(t * 3.1) * 0.12 * w);
    this.addClip('RightForeArm', 0, Math.sin(t * 2.6 + 0.5) * 0.15 * w);
    this.addClip('LeftUpLeg', 0, Math.sin(t * 1.7 + 2) * 0.1 * w);
  }

  /** wall impact: head and shoulders snap back, the arms fly up, then the fall clip takes over */
  private impact(t: number) {
    const e = win(t, 0, 0.09, 0.2, 0.55);
    this.addClip('Spine', 0, -0.2 * e); this.addClip('Spine1', 0, -0.22 * e); this.addClip('Spine2', 0, -0.2 * e);
    this.addClip('Neck', 0, -0.3 * e); this.addClip('Head', 0, -0.4 * e);
    this.addClip('LeftArm', 2, 1.0 * e); this.addClip('RightArm', 2, -1.0 * e);
    this.addClip('LeftForeArm', 2, 0.6 * e); this.addClip('RightForeArm', 2, -0.6 * e);
  }

  private _all: BoneInfo[] | null = null;
  private allBones() { return this._all ??= [...this.b.values(), ...this.fingers.map((f) => f.bi), ...this.thumbs.map((t) => t.bi)]; }

  /** final pose: clip (with the snapshot fading out of it) mixed with the procedural pose on the bones (procW) */
  private blendClip() {
    const w = this.procW, sw = this.snapW;
    for (const bi of this.allBones()) {
      const s = this.clipPose.get(bi.bone);
      if (!s) continue;
      const q = _q.copy(s.q);
      const p = _v.copy(s.p);
      if (sw > 0.001 && this.snap) {
        const o = this.snap.get(bi.bone);
        if (o) { q.slerp(o.q, sm(sw)); p.lerp(o.p, sm(sw)); }
      }
      if (w > 0.001) { q.slerp(bi.bone.quaternion, w); p.lerp(bi.bone.position, w); }
      bi.bone.quaternion.copy(q);
      bi.bone.position.copy(p);
    }
  }

  // ------------------------------------------------------------------------------------- face + cloth
  private updateFace(dt: number, ph: SkatePhysics) {
    this.grinT = Math.max(0, this.grinT - dt);
    this.exprHold = Math.max(0, this.exprHold - dt);
    let want: Expr = 'neutral';
    if (this.phase === 'bail' || this.phase === 'lie') want = 'grimace';
    else if (this.phase !== 'ride') want = 'neutral';
    else if (ph.mode === 'air' && (ph.popped || ph.airTime > 0.15)) want = 'wide';
    else if (ph.wobble > 0) want = 'wide';
    else if (this.grinT > 0) want = 'grin';
    else if (ph.mode === 'grind' || ph.manual.active || this.inCrouch || ph.speed > 4.2 || ph.kickturn.t >= 0) want = 'focus';
    if (want !== this.expr && (this.exprHold <= 0 || want === 'grimace' || want === 'wide')) {
      this.setExpr(want);
      this.exprHold = 0.22;
    }
  }

  private updateCloth(dt: number, ph: SkatePhysics) {
    const u = this.clothU;
    const v = ph.vel;
    const s = v.length();
    const spdF = clamp((s - 0.8) / 8, 0, 1);
    this.clothKickT += dt;
    const kick = this.clothKick * Math.exp(-5 * this.clothKickT);
    // relative wind pushes hems back against the motion; a landing flicks them down and up
    const wind = _v.copy(v).multiplyScalar(-0.028 * spdF / Math.max(s, 1));
    wind.y += kick * Math.sin(this.clothKickT * 28) * 0.03;
    if (ph.mode === 'air') wind.y += clamp(-ph.vel.y * 0.006, -0.02, 0.02);
    const mesh = this.meshes[0];
    if (mesh) {
      const wq = mesh.getWorldQuaternion(_q).invert();
      wind.applyQuaternion(wq).multiplyScalar(u.uClothScale.value);
    }
    u.uClothWind.value.lerp(wind, 1 - Math.exp(-10 * dt));
    u.uClothAmp.value = (0.004 + 0.012 * spdF + 0.016 * kick) * u.uClothScale.value;
    u.uClothT.value += dt * (1 + 1.6 * spdF + kick);
    const crouch = this.procW > 0.5 ? clamp((0.86 - this.Pout.hipH) / 0.34, 0, 1) : 0.6;
    u.uClothFold.value += (crouch - u.uClothFold.value) * (1 - Math.exp(-12 * dt));
  }

  /** world position of the head (camera framing) */
  headWorld(out: Vector3) { return this.b.get('Head')!.bone.getWorldPosition(out); }
  hipsWorld(out: Vector3) { return this.hips.getWorldPosition(out); }
  static isMesh(o: Object3D): o is Mesh { return (o as Mesh).isMesh; }
}
