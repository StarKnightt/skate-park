import {
  AnimationAction, AnimationClip, AnimationMixer, Bone, Group, LoopOnce, LoopRepeat, Matrix4, Mesh, Object3D, Quaternion,
  SkinnedMesh, Texture, Vector3, VectorKeyframeTrack, SRGBColorSpace,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toonMaterial } from '../render/materials';
import { clamp, Spring, lerp, smoothstep } from '../core/util';
import type { SkatePhysics, BailKind } from './physics';
import { BoardView, deckTopY } from './board';

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _m = new Matrix4();

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

type Phase = 'ride' | 'bail' | 'getup' | 'stand' | 'stepon';

/** Original skater: Mixamo skeleton, procedural skate animation with IK feet glued to the deck. */
export class Skater {
  root = new Group(); // character root, placed every frame
  model: Object3D;
  mixer: AnimationMixer;
  clips = new Map<string, AnimationClip>();
  b = new Map<string, BoneInfo>();
  fingerBones: BoneInfo[] = [];
  thumbBones: BoneInfo[] = [];
  legLen = { l1: 0.4, l2: 0.38 };
  restHipsY = 0.96;
  meshes: SkinnedMesh[] = [];

  // procedural state (critically damped springs)
  crouch = new Spring(0, 11);
  lean = new Spring(0, 7);
  absorb = new Spring(0, 16);
  tuck = new Spring(0, 13);
  armsOut = new Spring(0, 7);
  pushBlend = new Spring(0, 12);
  openYaw = new Spring(0.32, 6);
  pitchS = new Spring(0, 30);
  frontSlide = new Spring(0, 20);
  backSlide = new Spring(0, 18);
  feetLift = new Spring(0, 26);
  manualLean = new Spring(0, 9);
  grindPose = new Spring(0, 10);
  brakeS = new Spring(0, 9);
  wobbleS = new Spring(0, 10);
  look = new Spring(1, 6);
  procW = 1; // procedural weight (1 = riding, 0 = clip)
  phase: Phase = 'ride';
  phaseT = 0;
  action: AnimationAction | null = null;
  bailKind: BailKind = 'face';
  rootPos = new Vector3();
  rootQ = new Quaternion();
  clipRootPos = new Vector3();
  clipRootQ = new Quaternion();
  standPos = new Vector3();
  standHeading = 0;
  popT = -1; // time since pop
  pushPlant: Vector3 | null = null;
  time = 0;
  lastFlipKind = '';
  onRecovered: ((pos: Vector3, heading: number) => void) | null = null;
  readonly stance = { front: 0.165, back: -0.205, tail: -0.31, nose: 0.29 };

  constructor(gltf: GLTF, faceTex?: Texture) {
    this.model = gltf.scene;
    this.root.add(this.model);
    this.mixer = new AnimationMixer(this.model);
    for (const c of gltf.animations) this.clips.set(c.name, c);
    // materials: replace with the stylised toon shading
    this.model.traverse((o) => {
      const sm = o as SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      this.meshes.push(sm);
      sm.castShadow = true; sm.receiveShadow = true;
      sm.frustumCulled = false;
      const mats = Array.isArray(sm.material) ? sm.material : [sm.material];
      const repl = mats.map((m: any) => {
        if (m.map) {
          const map = faceTex ?? m.map; map.colorSpace = SRGBColorSpace;
          return toonMaterial({ map, bands: 0.85, wrap: 0.45, rim: 0.7, name: 'skinFace' });
        }
        return toonMaterial({ vertexColors: true, bands: 0.85, wrap: 0.42, rim: 0.75, name: 'skaterVC' });
      });
      sm.material = Array.isArray(sm.material) ? repl : repl[0];
    });
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
    for (const side of ['Left', 'Right']) for (const f of FINGERS) for (let i = 1; i <= 3; i++) {
      const bn = getBone(side + 'Hand' + f + i); if (bn) this.fingerBones.push(info(bn));
    }
    for (const side of ['Left', 'Right']) for (let i = 1; i <= 3; i++) { const bn = getBone(side + 'HandThumb' + i); if (bn) this.thumbBones.push(info(bn)); }
    const wp = (n: string) => this.b.get(n)!.bone.getWorldPosition(new Vector3());
    this.legLen.l1 = wp('LeftUpLeg').distanceTo(wp('LeftLeg'));
    this.legLen.l2 = wp('LeftLeg').distanceTo(wp('LeftFoot'));
    this.restHipsY = wp('Hips').y;
  }

  get hips() { return this.b.get('Hips')!.bone; }

  /** rotate bone about character-space axes relative to its rest pose */
  private setLocal(name: string, rx: number, ry = 0, rz = 0) {
    const bi = this.b.get(name); if (!bi) return;
    const q = bi.bone.quaternion.copy(bi.restLocal);
    if (rx) q.multiply(_q.setFromAxisAngle(bi.ax[0], rx));
    if (ry) q.multiply(_q.setFromAxisAngle(bi.ax[1], ry));
    if (rz) q.multiply(_q.setFromAxisAngle(bi.ax[2], rz));
  }

  private resetPose() {
    for (const bi of this.b.values()) { bi.bone.quaternion.copy(bi.restLocal); bi.bone.position.copy(bi.restPos); }
    for (const bi of this.fingerBones) bi.bone.quaternion.copy(bi.restLocal);
    for (const bi of this.thumbBones) bi.bone.quaternion.copy(bi.restLocal);
  }

  /** world -> character root space helpers */
  private toRoot(p: Vector3) { return this.root.worldToLocal(p); }

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
    // parent root-space rotation
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

  /** two-bone leg IK in root space; ankle target + knee pole + foot forward/up */
  private legIK(side: 'Left' | 'Right', ankle: Vector3, pole: Vector3, footFwd: Vector3, footUp: Vector3) {
    const up = this.b.get(side + 'UpLeg')!, lo = this.b.get(side + 'Leg')!, ft = this.b.get(side + 'Foot')!;
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
    // thigh: rest direction is straight down-ish (rest root space), knee forward = +Z
    const restD1 = this.restDir(side + 'UpLeg', side + 'Leg');
    const D1 = knee.clone().sub(hip).normalize();
    const F1 = po.clone().addScaledVector(D1, -po.dot(D1)).normalize();
    Skater.align(restD1, Z, D1, F1, _q);
    this.setRootRot(side + 'UpLeg', _q.clone());
    // shin
    const restD2 = this.restDir(side + 'Leg', side + 'Foot');
    const D2 = target.clone().sub(knee).normalize();
    const F2 = po.clone().addScaledVector(D2, -po.dot(D2)).normalize();
    Skater.align(restD2, Z, D2, F2, _q);
    this.setRootRot(side + 'Leg', _q.clone());
    // foot flat on the deck
    const restF = this.restFootFwd(side);
    Skater.align(restF, Y, footFwd.clone().normalize(), footUp, _q);
    this.setRootRot(side + 'Foot', _q.clone());
    void ft; void lo;
  }

  private restDirs = new Map<string, Vector3>();
  private restDir(a: string, b: string) {
    const k = a + '>' + b;
    let v = this.restDirs.get(k);
    if (!v) {
      // compute from the bind pose (stored rest local transforms): use rest root rotations & positions
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
      // walk the chain using rest locals
      const chain: BoneInfo[] = [];
      let o: Object3D | null = this.b.get(n)!.bone;
      while (o && (o as Bone).isBone) { const bi = [...this.b.values()].find((x) => x.bone === o); if (bi) chain.unshift(bi); o = o.parent; }
      const m = new Matrix4();
      const armParent = this.b.get('Hips')!.bone.parent!;
      this.model.updateMatrixWorld(true);
      m.copy(this.root.matrixWorld).invert().multiply(armParent.matrixWorld);
      for (const bi of chain) m.multiply(new Matrix4().compose(bi.restPos, bi.restLocal, new Vector3(1, 1, 1)));
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
    const s = side === 'Left' ? 1 : -1;
    const restU = this.restDir(side + 'Arm', side + 'ForeArm');
    const restF = this.restDir(side + 'ForeArm', side + 'Hand');
    const U = upperDir.clone().normalize();
    const F = foreDir.clone().normalize();
    // elbow hint: the forearm side of the upper arm
    let hintU = F.clone().addScaledVector(U, -F.dot(U));
    if (hintU.lengthSq() < 1e-4) hintU = Z.clone().addScaledVector(U, -Z.dot(U));
    hintU.normalize();
    Skater.align(restU, Z, U, hintU, _q);
    this.setRootRot(side + 'Arm', _q.clone());
    // forearm twist: thumb (rest +Z) keeps pointing forward / slightly up
    const th = new Vector3(0, 0.3, 1);
    let hintF = th.clone().addScaledVector(F, -th.dot(F));
    if (hintF.lengthSq() < 1e-4) hintF = Y.clone().addScaledVector(F, -Y.dot(F));
    hintF.normalize();
    Skater.align(restF, Z, F, hintF, _q);
    this.setRootRot(side + 'ForeArm', _q.clone());
    void s;
  }

  // ------------------------------------------------------------------------------------- per frame
  update(dt: number, ph: SkatePhysics, board: BoardView, input: { steer: number; crouch: boolean }) {
    this.time += dt;
    this.phaseT += dt;
    const riding = ph.mode === 'ride' || ph.mode === 'air' || ph.mode === 'grind';
    if (ph.mode === 'bail' && this.phase === 'ride') this.startBail(ph);
    if (this.phase !== 'ride') this.updateClipPhase(dt, ph, board);

    // ---------------- springs from physics state
    const inAir = ph.mode === 'air';
    const g = ph.grind;
    const manual = ph.manual.active;
    if (ph.events.some((e) => e.type === 'pop')) { this.popT = 0; }
    if (this.popT >= 0) this.popT += dt;
    if (!inAir && this.popT > 0.08) this.popT = -1;
    const landEv = ph.events.find((e) => e.type === 'land');
    if (landEv) { this.absorb.kick(1.6 + ph.landImpulse * 2.4); this.tuck.set(this.tuck.x); }

    let crouchT = input.crouch && !inAir ? 1 : 0.12 + clamp(ph.speed / 12, 0, 0.18);
    if (g) crouchT = 0.55;
    if (manual) crouchT = 0.25;
    if (inAir) crouchT = 0.35;
    if (ph.up.y < 0.95 && ph.mode === 'ride') crouchT = Math.max(crouchT, 0.3 + (1 - ph.up.y) * 0.5);
    this.crouch.update(crouchT, dt);
    // tuck: knees up in the air (biggest right after the pop)
    let tuckT = 0;
    if (inAir) {
      const t = ph.airTime;
      tuckT = ph.vert ? 0.9 : (ph.popped ? clamp(t / 0.18, 0, 1) * (1 - smoothstep(0.45, 0.9, t)) * 0.95 + 0.1 : 0.25);
      if (ph.flip && !ph.flip.done) tuckT = Math.max(tuckT, 0.85);
      const p = ph.predicted;
      if (p && p.tti < 0.22) tuckT *= p.tti / 0.22; // extend legs to meet the ground
    }
    this.tuck.update(tuckT, dt);
    this.absorb.update(0, dt);
    // carve lean from lateral acceleration
    const latAcc = input.steer * ph.speed * 0.6;
    this.lean.update(ph.mode === 'ride' ? clamp(latAcc * 0.11, -0.34, 0.34) : (g ? g.balance * 0.4 : 0), dt);
    this.armsOut.update(g || manual ? 1 : inAir ? 0.55 : ph.wobble > 0 ? 0.8 : 0.08 + clamp(ph.speed / 10, 0, 0.25), dt);
    this.pushBlend.update(ph.pushT >= 0 ? 1 : 0, dt);
    this.manualLean.update(manual ? 1 : 0, dt);
    this.grindPose.update(g ? 1 : 0, dt);
    this.brakeS.update(ph.brakeAmt, dt);
    this.wobbleS.update(ph.wobble > 0 ? 1 : 0, dt);
    this.look.update(ph.fakie ? -1 : 1, dt);
    // board pitch: pop snap, manual, kickturn
    let pitchT = 0;
    if (this.popT >= 0 || (inAir && ph.popped && ph.airTime < 0.3)) {
      const t = inAir ? ph.airTime : 0;
      pitchT = 0.42 * (1 - smoothstep(0.06, 0.26, t));
    }
    if (manual) pitchT = 0.2 + ph.manual.balance * 0.08;
    if (ph.kickturn.t >= 0) pitchT = 0.3 * Math.sin(Math.PI * clamp(ph.kickturn.t / 0.34, 0, 1));
    this.pitchS.update(pitchT, dt, manual ? 14 : 30);
    // front foot slides up the deck to level the board after the pop
    const slideT = inAir && ph.popped ? clamp(ph.airTime / 0.16, 0, 1) * (1 - smoothstep(0.35, 0.6, ph.airTime)) : 0;
    this.frontSlide.update(slideT, dt);
    // flip feet lift
    let liftT = 0;
    if (ph.flip && inAir) {
      const pr = ph.flip.t / ph.flip.dur;
      liftT = pr < 0.82 ? smoothstep(0.0, 0.18, pr) : 1 - smoothstep(0.82, 1.0, pr);
      if (ph.flip.done) liftT = 0;
    }
    this.feetLift.update(liftT, dt);

    // ---------------- board pose
    let roll = 0, yaw = 0, lift = 0;
    if (ph.flip && inAir) {
      const pr = clamp(ph.flip.t / ph.flip.dur, 0, 1);
      const e = pr < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * pr) : 1;
      if (ph.flip.kind === 'kickflip') roll = -Math.PI * 2 * e;
      if (ph.flip.kind === 'heelflip') roll = Math.PI * 2 * e;
      if (ph.flip.kind === 'shuvit') yaw = Math.PI * e;
      if (ph.flip.kind === 'treflip') { roll = -Math.PI * 2 * e; yaw = Math.PI * 2 * e; }
      lift = 0.06 * Math.sin(Math.PI * pr);
    }
    if (ph.kickturn.t >= 0) yaw = Math.PI * ph.kickturn.dir * smoothstep(0, 1, clamp(ph.kickturn.t / 0.34, 0, 1));
    let wob = 0;
    if (ph.wobble > 0) wob = Math.sin(this.time * 17) * 0.09 * Math.min(1, ph.wobble);
    const pivot = manual || ph.kickturn.t >= 0 ? -0.18 : -0.36;
    const deckLean = ph.mode === 'ride' ? -this.lean.x * 0.35 + wob : wob;
    board.pose(this.pitchS.x, pivot, roll, yaw, lift, deckLean);
    board.root.updateMatrixWorld(true);

    if (riding || this.phase === 'stepon') this.placeRoot(board, dt);
    this.resetPose();
    if (this.procW > 0.001) this.proceduralPose(dt, ph, board);
    if (this.procW < 0.999 && this.action) this.blendClip();
  }

  /** root frame from the board: X_char = nose, Y = board up, Z = toe side (regular stance) */
  private placeRoot(board: BoardView, dt: number) {
    const bq = board.root.quaternion;
    // character forward (+Z) = board -X (toe side); left (+X) = board +Z (nose)
    _q.setFromAxisAngle(Y, -Math.PI / 2);
    this.rootQ.copy(bq).multiply(_q);
    this.rootPos.copy(board.root.position);
    if (this.phase === 'stepon') {
      const k = clamp(this.phaseT / 0.45, 0, 1);
      const e = k * k * (3 - 2 * k);
      this.root.position.lerpVectors(this.clipRootPos, this.rootPos, e);
      this.root.quaternion.slerpQuaternions(this.clipRootQ, this.rootQ, e);
    } else {
      this.root.position.copy(this.rootPos);
      this.root.quaternion.copy(this.rootQ);
    }
    this.root.updateMatrixWorld(true);
    void dt;
  }

  private proceduralPose(dt: number, ph: SkatePhysics, board: BoardView) {
    const c = this.crouch.x, tuck = this.tuck.x, push = this.pushBlend.x, man = this.manualLean.x, gr = this.grindPose.x;
    const absorb = clamp(this.absorb.x, -0.2, 1.2);
    const st = this.stance;
    // ---- feet anchors on the deck (board space) -> root space
    const deckT = (x: number) => deckTopY(x);
    const frontX = st.front + this.frontSlide.x * (st.nose - st.front) * 0.6;
    const backT = (this.popT >= 0 || (ph.mode === 'air' && ph.popped && ph.airTime < 0.25)) ? 0.85
      : (ph.crouchTime > 0.05 && ph.mode === 'ride' ? 0.6 : 0);
    const backX = st.back + this.backSlide.update(backT, dt) * (st.tail - st.back);
    // anchors in board space: (x across, z along). Deck matrix includes pitch/flip/lean
    const useDeck = !(ph.flip && ph.mode === 'air' && !ph.flip.done);
    const frontA = board.deckPoint(-0.01, frontX, new Vector3(), true);
    const backA = board.deckPoint(-0.01, backX, new Vector3(), true);
    if (!useDeck) {
      // feet leave the flipping board: follow the un-flipped deck plane, lifted
      board.deckPoint(-0.01, frontX, frontA, false);
      board.deckPoint(-0.01, backX, backA, false);
    }
    this.toRoot(frontA); this.toRoot(backA);
    // deck up in root space
    const deckUp = new Vector3(0, 1, 0).applyMatrix4(new Matrix4().extractRotation(board.deck.matrix));
    // board space -> root space rotation: root = board * rotY(-90): board vector v -> rotY(+90) v
    const b2r = new Quaternion().setFromAxisAngle(Y, Math.PI / 2);
    deckUp.applyQuaternion(b2r);
    if (!useDeck) deckUp.set(0, 1, 0);
    const lift = this.feetLift.x;
    if (lift > 0.001) {
      const fk = ph.flip?.kind;
      const kickZ = fk === 'kickflip' || fk === 'treflip' ? 1 : fk === 'heelflip' ? -1 : 0;
      frontA.y += lift * 0.2; frontA.z += kickZ * lift * 0.07;
      backA.y += lift * 0.15;
    }
    // ---- hips
    const ride = 0.84;
    let hipH = ride - c * 0.24 - tuck * 0.3 - absorb * 0.16 - gr * 0.05;
    hipH -= push * 0.1;
    const hipX = lerp((frontX + backX) / 2 - 0.02, frontX - 0.05, push * 0.85) - man * 0.07;
    const hipZ = -0.02 + this.lean.x * 0.12 - push * 0.04;
    const hipsPos = new Vector3(hipX, deckT(0) + hipH, hipZ);
    const hb = this.b.get('Hips')!;
    const parent = hb.bone.parent!;
    const wpos = this.root.localToWorld(hipsPos.clone());
    hb.bone.position.copy(parent.worldToLocal(wpos));
    // hips rotation: open towards the nose, lean with carve, bend
    const open = 0.3 + push * 0.95 + gr * 0.1;
    const yawLook = this.look.x;
    const lean = this.lean.x;
    // X = bend towards the toe side, Y = open towards the nose, Z = tilt towards the tail (manual)
    this.setLocal('Hips', 0.1 + c * 0.32 + tuck * 0.15 + lean * 0.35, open * (yawLook > 0 ? 1 : 0.4), man * 0.16);
    hb.bone.updateMatrixWorld(true);
    // spine
    const bend = 0.06 + c * 0.18 + tuck * 0.12;
    const breath = Math.sin(this.time * 2.1) * 0.012;
    const wob = this.wobbleS.x * Math.sin(this.time * 9.0) * 0.12;
    this.setLocal('Spine', bend + breath + lean * 0.12, 0.06 * yawLook, wob * 0.5 + man * 0.08);
    this.setLocal('Spine1', bend * 0.9 + lean * 0.1, 0.12 * yawLook + push * 0.1, wob * 0.6 + man * 0.06);
    this.setLocal('Spine2', bend * 0.6 - breath, 0.14 * yawLook, wob * 0.4);
    // head looks along the travel direction (over the leading shoulder)
    const headYaw = (yawLook > 0 ? 0.62 : -0.85) * (1 - push * 0.45) + Math.sin(this.time * 0.37) * 0.04;
    this.setLocal('Neck', -bend * 0.5, headYaw * 0.4, 0);
    this.setLocal('Head', -bend * 0.6 - 0.05 + c * 0.1, headYaw * 0.6, this.lean.x * 0.25);
    this.hips.updateMatrixWorld(true);

    // ---- arms
    const ao = this.armsOut.x;
    const t = this.time;
    for (const side of ['Left', 'Right'] as const) {
      const s = side === 'Left' ? 1 : -1;
      // relaxed: down, slightly forward/out; balance: out wide
      const down = lerp(-1.25, -0.35, ao) + (side === 'Left' ? 0.08 : -0.04) * c;
      const fwd = 0.25 + c * 0.35 + (side === 'Left' ? 0.15 : 0.05);
      const fl = this.wobbleS.x * Math.sin(t * 11 + s * 1.7) * 0.6;
      const U = new Vector3(s * Math.cos(down) * 0.9, Math.sin(down) + fl * 0.4, fwd * 0.6 + fl * 0.3);
      const elbow = 0.35 + c * 0.4 - ao * 0.15;
      const F = U.clone().normalize().applyAxisAngle(new Vector3(0, 1, 0), -s * elbow * 0.6).add(new Vector3(0, elbow * 0.3, elbow * 0.6));
      if (push > 0.01) {
        // pushing: arms swing
        const sw = Math.sin((ph.pushT / 0.78) * Math.PI * 2) * push;
        U.z += sw * 0.4 * s; F.z += sw * 0.5 * s;
      }
      this.aimArm(side, U, F);
    }
    // relaxed fingers
    const curl = 0.35 + this.grindPose.x * 0.1;
    for (const bi of this.fingerBones) {
      bi.bone.quaternion.copy(bi.restLocal).multiply(_q.setFromAxisAngle(bi.ax[2], (bi.bone.name.includes('Left') ? -1 : 1) * curl));
    }
    for (const bi of this.thumbBones) bi.bone.quaternion.copy(bi.restLocal).multiply(_q.setFromAxisAngle(bi.ax[1], (bi.bone.name.includes('Left') ? 1 : -1) * 0.25));

    // ---- legs (IK to the deck anchors)
    const ankleH = 0.118;
    const fwdFront = new Vector3(Math.sin(0.42), 0, Math.cos(0.42)); // angled towards the nose
    const fwdBack = new Vector3(-Math.sin(0.08), 0, Math.cos(0.08));
    if (push > 0.02 && ph.pushT >= 0) fwdFront.set(Math.sin(1.25), 0, Math.cos(1.25)).normalize();
    const footUp = deckUp.clone().normalize();
    const shoeC = 0.075; // ankle sits behind the shoe centre
    const ankleOf = (anchor: Vector3, f: Vector3) => anchor.clone().addScaledVector(f, -shoeC).addScaledVector(footUp, ankleH);
    let backAnkle = ankleOf(backA, fwdBack);
    let backFwd = fwdBack.clone(), backUp = footUp.clone();
    // push: back foot steps off to the ground on the toe side, plants in world space, returns
    if (ph.pushT >= 0 && push > 0.02) {
      const pt = ph.pushT;
      const groundY = 0.0;
      const plantLocal = new Vector3(frontX - 0.12, groundY, 0.22);
      if (pt < 0.22) {
        const k = smoothstep(0.0, 0.22, pt);
        const p = backAnkle.clone().lerp(plantLocal.clone().add(new Vector3(0, ankleH, 0)), k);
        p.y += Math.sin(k * Math.PI) * 0.1;
        backAnkle = p; this.pushPlant = null;
        backFwd = fwdBack.clone().lerp(new Vector3(1, 0, 0.2), k).normalize();
        backUp = footUp.clone().lerp(Y, k).normalize();
      } else if (pt < 0.52) {
        if (!this.pushPlant) this.pushPlant = this.root.localToWorld(plantLocal.clone());
        const p = this.toRoot(this.pushPlant.clone());
        // keep on the ground plane of the board
        p.y = groundY;
        const k = smoothstep(0.22, 0.52, pt);
        backAnkle = p.add(new Vector3(0, ankleH + k * 0.015, 0));
        backFwd = new Vector3(1, 0, 0.25).normalize(); backUp = Y.clone();
        // toe pushes off at the end
        backFwd.applyAxisAngle(new Vector3(0, 0, 1), -k * 0.35);
      } else {
        const k = smoothstep(0.52, 0.78, pt);
        const from = this.pushPlant ? this.toRoot(this.pushPlant.clone()).setY(ankleH) : plantLocal.clone().setY(ankleH);
        const p = from.lerp(backAnkle, k); p.y += Math.sin(k * Math.PI) * 0.14;
        backAnkle = p;
        backFwd = new Vector3(1, 0, 0.25).normalize().lerp(fwdBack, k).normalize();
        backUp = Y.clone().lerp(footUp, k).normalize();
      }
    } else this.pushPlant = null;
    // foot brake: back foot drags behind on the ground
    if (this.brakeS.x > 0.01) {
      const drag = new Vector3(st.back - 0.32, ankleH + 0.0, 0.14);
      backAnkle.lerp(drag, this.brakeS.x);
      backUp.lerp(Y, this.brakeS.x).normalize();
      backFwd.lerp(new Vector3(0.3, 0, 1).normalize(), this.brakeS.x).normalize();
    }
    const frontAnkle = ankleOf(frontA, fwdFront);
    // knees point to the toe side and towards the nose
    const poleF = new Vector3(0.45, 0.1, 1);
    const poleB = new Vector3(-0.15, 0.1, 1);
    this.legIK('Left', frontAnkle, poleF, fwdFront, footUp);
    this.legIK('Right', backAnkle, poleB, backFwd, backUp);
    // toes flat
    void dt;
  }

  // ------------------------------------------------------------------------------------- clips (bail / get up)
  private play(name: string, opts: { loop?: boolean; rate?: number; fade?: number; start?: number } = {}) {
    const clip = this.clips.get(name);
    if (!clip) return null;
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(opts.loop ? LoopRepeat : LoopOnce, opts.loop ? Infinity : 1);
    a.clampWhenFinished = true;
    a.timeScale = opts.rate ?? 1;
    a.time = opts.start ?? 0;
    a.play();
    if (this.action && this.action !== a) {
      if (opts.fade) this.action.crossFadeTo(a, opts.fade, false); else this.action.stop();
    }
    this.action = a;
    return a;
  }

  private hipsTrackPos(clip: string, atEnd: boolean) {
    const c = this.clips.get(clip);
    const tr = c?.tracks.find((t) => t.name.endsWith('Hips.position')) as VectorKeyframeTrack | undefined;
    if (!tr) return new Vector3();
    const i = atEnd ? tr.values.length - 3 : 0;
    return new Vector3(tr.values[i], tr.values[i + 1], tr.values[i + 2]);
  }

  private startBail(ph: SkatePhysics) {
    const b = ph.bail!;
    this.bailKind = b.kind;
    this.phase = 'bail'; this.phaseT = 0;
    this.clipRootPos.copy(b.body);
    this.clipRootQ.setFromAxisAngle(Y, b.heading);
    const clip = { face: 'bail_face', back: 'bail_back', knock: 'bail_knock', roll: 'bail_roll' }[b.kind];
    this.mixer.stopAllAction();
    this.action = null;
    this.play(clip, { rate: b.kind === 'back' ? 1.25 : 1.1 });
  }

  private getupClip() { return { face: 'getup_stomach', back: 'getup_back', knock: 'getup_knock', roll: 'idle' }[this.bailKind]; }

  private updateClipPhase(dt: number, ph: SkatePhysics, board: BoardView) {
    const a = this.action;
    if (this.phase === 'bail') {
      this.procW = Math.max(0, this.procW - dt / 0.18);
      // follow the sliding body
      if (ph.bail) this.clipRootPos.copy(ph.bail.body);
      const dur = a ? a.getClip().duration / Math.abs(a.timeScale) : 1;
      if (this.phaseT > dur + 0.35) {
        const fall = a?.getClip().name ?? '';
        const gu = this.getupClip();
        // align the get-up start with where the fall ended (hips, horizontally)
        const e = this.hipsTrackPos(fall, true), s = this.hipsTrackPos(gu, false);
        const off = new Vector3(e.x - s.x, 0, e.z - s.z).multiply(this.model.scale).applyQuaternion(this.clipRootQ);
        if (gu !== 'idle') this.clipRootPos.add(off);
        this.phase = 'getup'; this.phaseT = 0;
        this.play(gu, { rate: gu === 'getup_knock' ? 1.15 : gu === 'idle' ? 1 : 1.75, fade: gu === 'idle' ? 0.4 : 0.12, loop: gu === 'idle' });
      }
    } else if (this.phase === 'getup') {
      const dur = a ? a.getClip().duration / Math.abs(a.timeScale) : 1;
      const done = a?.getClip().name === 'idle' ? this.phaseT > 0.8 : this.phaseT > dur - 0.05;
      if (done) {
        // where is the character standing now?
        this.model.updateMatrixWorld(true);
        const hp = this.hips.getWorldPosition(new Vector3());
        this.standPos.set(hp.x, this.clipRootPos.y, hp.z);
        const fwdW = new Vector3(0, 0, 1).applyQuaternion(this.hips.getWorldQuaternion(new Quaternion()));
        fwdW.y = 0; if (fwdW.lengthSq() < 1e-4) fwdW.set(0, 0, 1); fwdW.normalize();
        this.standHeading = Math.atan2(fwdW.x, fwdW.z);
        this.phase = 'stand'; this.phaseT = 0;
        this.play('idle', { loop: true, fade: 0.3 });
      }
    } else if (this.phase === 'stand') {
      if (this.phaseT > 0.25) {
        // board comes back: nose to the rider's left (regular stance)
        const left = new Vector3(Math.cos(this.standHeading), 0, -Math.sin(this.standHeading));
        const boardHeading = Math.atan2(left.x, left.z);
        this.onRecovered?.(this.standPos.clone(), boardHeading);
        this.phase = 'stepon'; this.phaseT = 0;
        this.clipRootPos.copy(this.root.position);
        this.clipRootQ.copy(this.root.quaternion);
      }
    } else if (this.phase === 'stepon') {
      this.procW = Math.min(1, this.procW + dt / 0.45);
      if (this.procW >= 1) { this.phase = 'ride'; this.mixer.stopAllAction(); this.action = null; }
    }
    if (this.phase === 'bail' || this.phase === 'getup' || this.phase === 'stand') {
      this.root.position.copy(this.clipRootPos);
      this.root.quaternion.copy(this.clipRootQ);
      this.root.updateMatrixWorld(true);
    }
    void board;
    this.mixer.update(dt);
  }

  private snap = new Map<Bone, { q: Quaternion; p: Vector3 }>();
  /** blend the clip pose (sampled into a snapshot) with the procedural pose currently on the bones */
  private blendClip() {
    // procedural pose is on the bones; capture it, evaluate the mixer, then mix
    const w = this.procW;
    const all = [...this.b.values(), ...this.fingerBones, ...this.thumbBones];
    for (const bi of all) {
      let s = this.snap.get(bi.bone);
      if (!s) { s = { q: new Quaternion(), p: new Vector3() }; this.snap.set(bi.bone, s); }
      s.q.copy(bi.bone.quaternion); s.p.copy(bi.bone.position);
    }
    this.mixer.update(0);
    for (const bi of all) {
      const s = this.snap.get(bi.bone)!;
      bi.bone.quaternion.slerp(s.q, w);
      bi.bone.position.lerp(s.p, w);
    }
  }

  /** world position of the head (camera framing) */
  headWorld(out: Vector3) { return this.b.get('Head')!.bone.getWorldPosition(out); }
  hipsWorld(out: Vector3) { return this.hips.getWorldPosition(out); }
  static isMesh(o: Object3D): o is Mesh { return (o as Mesh).isMesh; }
}
