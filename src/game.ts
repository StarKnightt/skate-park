import {
  Clock, Color, Fog, Group, HemisphereLight, Mesh, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, Scene,
  SRGBColorSpace, Texture, TextureLoader, Vector3, WebGLRenderer, NoToneMapping, MathUtils, DoubleSide, SpotLight,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import { buildPark, meshFromBuilder, mergeTubes } from './world/park';
import { buildParkDetail } from './world/parkDetail';
import { CollisionWorld } from './world/collision';
import { buildScenery, Scenery } from './world/scenery';
import { loadSharedTextures, shared, toonMaterial, LAMP } from './render/materials';
import { Sky, CloudLayer, Ocean, glowPoints } from './render/environment';
import { TimeOfDay, PRESETS, EnvState } from './render/timeOfDay';
import { Post } from './render/post';
import { HeroShadow } from './render/heroShadow';
import { SkatePhysics, SkateInput, emptyInput } from './player/physics';
import { BoardView } from './player/board';
import { Skater } from './player/skater';
import { CameraRig } from './player/cameraRig';
import { TrickTracker } from './player/tricks';
import { Input } from './core/input';
import { Hud, TouchControls } from './ui/hud';
import { AudioEngine } from './audio/audio';
import { params, DEBUG, clamp } from './core/util';
import { installTestHooks } from './debug/testHooks';

const BASE = import.meta.env.BASE_URL;
const STEP = 1 / 120;

export class Game {
  renderer: WebGLRenderer;
  scene = new Scene();
  camera = new PerspectiveCamera(58, 1, 0.08, 4000);
  clock = new Clock();
  world!: CollisionWorld;
  physics!: SkatePhysics;
  board!: BoardView;
  skater!: Skater;
  rig!: CameraRig;
  input: Input;
  hud!: Hud;
  touch!: TouchControls;
  audio = new AudioEngine(BASE);
  tricks = new TrickTracker();
  tod = new TimeOfDay();
  sky = new Sky();
  clouds!: CloudLayer;
  ocean = new Ocean();
  scenery!: Scenery;
  post!: Post;
  sun = new SunLight(0xffffff, 2.5);
  hemi = new HemisphereLight(0xffffff, 0xffffff, 1);
  /** the one shadow casting lamp: follows the street lamp nearest to the skater (blue hour / sunset) */
  lampSpot = new SpotLight(0xffffff, 0, LAMP.range, LAMP.angle, LAMP.penumbra, 2);
  lampIdx = -1;
  lampGlow!: ReturnType<typeof glowPoints>;
  /** the skater's own sharp sun shadow map (he is left out of the sun cascades while it is on) */
  hero = new HeroShadow();
  spawn = { pos: new Vector3(), heading: 0 };
  landmarks: Record<string, { pos: Vector3; look: Vector3 }> = {};
  acc = 0;
  simTime = 0;
  fpsCap = Number(params.get('fps')) || 0;
  lastFrame = 0;
  manualClock = false;
  scriptInput: ((t: number) => Partial<Record<string, boolean>> | null) | null = null;
  quality = 2;
  frameTimes: number[] = [];
  boardReturn: null | { t: number; fromP: Vector3; fromQ: Quaternion; hop: boolean } = null;
  lastInput: SkateInput = emptyInput();
  started = false;
  ready = false;
  boardSmoothQ = new Quaternion();

  constructor(private container: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android/i.test(navigator.userAgent);
    this.quality = params.has('quality') ? Number(params.get('quality')) : mobile ? 1 : 2;
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.input = new Input(this.renderer.domElement);
  }

  async start() {
    const loading = document.querySelector('.loading') as HTMLDivElement | null;
    const bar = loading?.querySelector('.bar i') as HTMLElement | null;
    const prog = (p: number) => { if (bar) bar.style.width = `${Math.round(p * 100)}%`; };
    prog(0.05);
    loadSharedTextures(BASE);
    const tl = new TextureLoader();
    const tex = (n: string) => new Promise<Texture>((res) => tl.load(BASE + 'textures/' + n, (t) => { t.colorSpace = SRGBColorSpace; t.anisotropy = 4; res(t); }));
    const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [gltf, deckTex, cloudTex, cloudRects, murals] = await Promise.all([
      gltfLoader.loadAsync(BASE + 'models/skater.glb').then((g) => { prog(0.7); return g; }),
      tex('deck_graphic.webp'), tex('clouds.webp'),
      fetch(BASE + 'textures/clouds.json').then((r) => r.json()),
      Promise.all(['mural_sunwaves', 'mural_koi', 'mural_patchwork'].map((n) => tex(n + '.webp'))),
    ]);
    prog(0.85);

    // ---------------- world
    const park = buildPark();
    this.spawn.pos.copy(park.spawn.pos); this.spawn.heading = park.spawn.heading;
    this.landmarks = park.landmarks;
    const b = park.builder;
    this.world = new CollisionWorld(b.collisionGeometry(), b.cSurf, park.grindLines);
    const mats = {
      concrete: toonMaterial({ vertexColors: true, color: 0xe8ded2, detail: 'concrete', bands: 0.06, wrap: 0.3, rim: 0.12, name: 'concrete' }),
      wall: toonMaterial({ vertexColors: true, color: 0xe8dccd, detail: 'wall', bands: 0.1, wrap: 0.3, rim: 0.12, name: 'wall' }),
      paint: toonMaterial({ vertexColors: true, detail: 'paint', bands: 0.2, wrap: 0.3, rim: 0.25, name: 'paint' }),
      wood: toonMaterial({ color: 0xffffff, detail: 'wood', bands: 0.12, wrap: 0.45, rim: 0.1, name: 'wood' }),
    };
    for (const m of Object.values(mats)) m.shadowSide = DoubleSide;
    const parkGroup = new Group();
    for (const [k, m] of Object.entries(mats)) { const mesh = meshFromBuilder(b, k, m); if (mesh) parkGroup.add(mesh); }
    const metal = new Mesh(mergeTubes(park.tubes), toonMaterial({ color: 0xc3c8d0, spec: 1.1, shininess: 55, bands: 0.55, rim: 0.7, name: 'metal' }));
    metal.castShadow = true; metal.receiveShadow = true;
    parkGroup.add(metal);
    const texByName: Record<string, Texture> = { mural_sunwaves: murals[0], mural_koi: murals[1], mural_patchwork: murals[2] };
    for (const mu of park.murals) {
      const g = new PlaneGeometry(mu.w, mu.h);
      const m = new Mesh(g, toonMaterial({ map: texByName[mu.tex], detail: 'mural', bands: 0.1, wrap: 0.3, rim: 0.05, name: mu.key }));
      m.position.copy(mu.center);
      m.lookAt(mu.center.clone().add(mu.normal));
      m.receiveShadow = true;
      parkGroup.add(m);
    }
    parkGroup.add(buildParkDetail(park));
    this.scene.add(parkGroup);
    this.scenery = buildScenery(park.lamps);
    this.scene.add(this.scenery.group);
    shared.uLampPos.value.forEach((v, i) => { const l = this.scenery.lampLights[i]; if (l) v.copy(l); });
    this.lampGlow = glowPoints(this.scenery.lampLights, new Color(1.0, 0.75, 0.45), 1.6);
    this.scene.add(this.lampGlow);
    this.scene.add(this.sky.mesh);
    this.clouds = new CloudLayer(cloudTex, cloudRects, PRESETS[0].sunDir);
    this.scene.add(this.clouds.group);
    this.scene.add(this.ocean.mesh);
    this.scene.fog = new Fog(0xf6c49e, 70, 620);

    // ---------------- lights
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality >= 2 ? 2048 : 1024, this.quality >= 2 ? 2048 : 1024);
    this.sun.shadow.camera.far = this.quality >= 2 ? 95 : 60;
    // toon materials add a receiver-plane bias per PCF tap and a normal offset of ~0.6 texel per cascade on top of these
    this.sun.shadow.bias = -0.00008;
    this.sun.shadow.normalBias = 0.012;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.hemi);
    const ls = this.lampSpot;
    ls.castShadow = this.quality >= 1;
    ls.shadow.mapSize.set(this.quality >= 2 ? 1024 : 512, this.quality >= 2 ? 1024 : 512);
    ls.shadow.camera.near = 0.3;
    ls.shadow.camera.far = LAMP.range;
    ls.shadow.bias = -0.0006;
    ls.shadow.normalBias = 0.02;
    ls.shadow.radius = 2.5;
    ls.shadow.autoUpdate = false;
    ls.shadow.needsUpdate = true; // render once so a depth texture is always bound to the shadow sampler
    ls.position.set(0, -50, 0);
    ls.target.position.set(0, -60, 0);
    this.scene.add(ls, ls.target);

    // ---------------- player
    this.physics = new SkatePhysics(this.world);
    this.board = new BoardView(deckTex);
    this.scene.add(this.board.root);
    this.skater = new Skater(gltf);
    this.scene.add(this.skater.root);
    this.skater.onRecovered = (pos, fwd) => {
      // the board stays where it came to rest; the rider steps onto it (flipping it over first if it lies upside down)
      const fromP = this.board.root.position.clone(), fromQ = this.board.root.quaternion.clone();
      this.physics.finishRecover(pos, fwd);
      const toQ = this.physics.basisQuat(this.physics.fwd, this.physics.up);
      this.boardReturn = { t: 0, fromP, fromQ, hop: fromQ.angleTo(toQ) > 1.0 };
    };
    this.rig = new CameraRig(this.camera, this.world);
    this.respawn();

    // ---------------- UI + audio
    const touchMode = params.has('touch') || matchMedia('(pointer: coarse)').matches;
    this.hud = new Hud(touchMode);
    this.touch = new TouchControls(this.input, this.renderer.domElement);
    this.touch.show(touchMode);
    this.hud.onTimeOfDay = () => this.nextTime();
    this.hud.onSound = () => { this.audio.setMuted(!this.audio.muted); this.hud.setMuted(this.audio.muted); this.unlockAudio(); };
    this.tricks.onTrick = (n, p, bail) => this.hud.trick(n, p, bail);
    this.tricks.onCombo = (t, m, f) => this.hud.combo(t, m, f);
    const unlock = () => this.unlockAudio();
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    if (params.has('mute')) { this.audio.setMuted(true); this.hud.setMuted(true); }

    // ---------------- post
    const msaa = this.quality >= 2 ? 4 : 0;
    this.post = new Post(this.renderer, this.scene, this.camera, msaa);
    this.hero.attach(this.skater.root, this.board.root, [this.sun.shadow.getCamera(0), this.sun.shadow.getCamera(1)], [this.sun, this.hemi, this.lampSpot]);
    this.hero.setSize(this.quality >= 2 ? 1024 : this.quality === 1 ? 512 : 0, this.renderer);
    const tName = params.get('time');
    this.tod.set(tName ? Math.max(0, this.tod.byName(tName)) : 0, true);
    this.applyEnv(this.tod.cur);
    this.hud.setTimeLabel(this.tod.cur.name);
    this.resize();
    addEventListener('resize', () => this.resize());
    if (DEBUG) installTestHooks(this);
    this.renderer.compile(this.scene, this.camera);
    prog(1);
    this.ready = true;
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 900);
    if (!touchMode && !params.has('mute')) this.hud.soundPrompt();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  unlockAudio() {
    if (this.audio.started || params.has('mute')) return;
    this.audio.start();
  }

  respawn(pos = this.spawn.pos, heading = this.spawn.heading) {
    this.physics.reset(pos, heading);
    this.syncBoard(1, true);
    this.rig.snap(this.physics.pos, Math.atan2(this.physics.fwd.x, this.physics.fwd.z));
    this.skater.reset();
    this.boardReturn = null;
  }

  nextTime() { this.tod.next(); this.hud.setTimeLabel(PRESETS[this.tod.index].name); }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const dprCap = this.quality >= 2 ? 1.75 : this.quality === 1 ? 1.25 : 0.85;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applyEnv(e: EnvState) {
    this.sun.color.copy(e.lightColor);
    this.sun.intensity = e.lightIntensity;
    this.sun.position.copy(e.lightDir).multiplyScalar(100);
    this.sun.shadow.intensity = e.shadowIntensity;
    this.sun.shadow.radius = e.shadowRadius;
    this.hero.k = e.shadowRadius * 0.0055;
    this.hemi.color.copy(e.hemiSky); this.hemi.groundColor.copy(e.hemiGround); this.hemi.intensity = e.hemiIntensity;
    // toon materials light themselves from these (sun-aware sky ambient + backlight rim)
    shared.uSunDir.value.copy(e.lightDir).normalize();
    shared.uSunColor.value.copy(e.lightColor).multiplyScalar(e.lightIntensity);
    shared.uSkyTop.value.copy(e.hemiSky).multiplyScalar(e.hemiIntensity);
    shared.uSkySun.value.copy(e.skySun).multiplyScalar(e.hemiIntensity);
    shared.uSkyAnti.value.copy(e.skyAnti).multiplyScalar(e.hemiIntensity);
    shared.uGroundBounce.value.copy(e.hemiGround).multiplyScalar(e.hemiIntensity);
    const fog = this.scene.fog as Fog;
    fog.color.copy(e.fog); fog.near = e.fogNear; fog.far = e.fogFar;
    this.sky.apply(e);
    const gl = PRESETS[0].cloudLit, gs = PRESETS[0].cloudShade;
    const dist = Math.abs(e.cloudLit.r - gl.r) + Math.abs(e.cloudLit.g - gl.g) + Math.abs(e.cloudLit.b - gl.b)
      + Math.abs(e.cloudShade.r - gs.r) + Math.abs(e.cloudShade.g - gs.g) + Math.abs(e.cloudShade.b - gs.b);
    this.clouds.apply(e, clamp(1 - dist * 2.5, 0, 1));
    this.ocean.apply(e);
    shared.uLampIntensity.value = e.lamps * LAMP.intensity;
    this.lampSpot.color.copy(shared.uLampColor.value);
    this.lampSpot.intensity = shared.uLampIntensity.value;
    this.lampSpot.shadow.autoUpdate = e.lamps > 0.02 && this.lampSpot.castShadow;
    if (e.lamps <= 0.02) { this.lampIdx = -1; shared.uLampSkip.value = -1; this.lampSpot.position.y = -50; }
    shared.uRimColor.value.copy(e.rim);
    shared.uRimStrength.value = e.rimStrength;
    shared.uWarmth.value.copy(e.warmth);
    this.scenery.windows.emissiveIntensity = e.windows * 1.3;
    this.scenery.lampHeads.emissiveIntensity = e.lamps * 4.5;
    this.scenery.lighthouseLamp.emissiveIntensity = 0.3 + e.lamps * 3;
    (this.lampGlow.material as any).uniforms.uIntensity.value = e.lamps * 1.1;
    if (this.post) {
      this.post.bloom.intensity = e.bloom * (this.quality >= 1 ? 1 : 0);
      this.post.setExposure(e.exposure);
      this.post.grade.uniforms.get('uSat')!.value = e.saturation;
      this.post.grade.uniforms.get('uContrast')!.value = e.contrast;
    }
    this.scene.background = e.fog;
  }

  /** park the shadow casting spot light in the street lamp nearest to the skater; the shader skips that lamp's pool */
  updateLampLight() {
    if (shared.uLampIntensity.value <= 0.02 * LAMP.intensity) return;
    const p = this.physics.pos, lamps = this.scenery.lampLights;
    const n = Math.min(lamps.length, shared.uLampPos.value.length);
    const d2 = (i: number) => (lamps[i].x - p.x) ** 2 + (lamps[i].z - p.z) ** 2;
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = d2(i); if (d < bd) { bd = d; best = i; } }
    if (this.lampIdx >= 0 && best !== this.lampIdx && d2(this.lampIdx) < bd * 1.2 + 1) best = this.lampIdx;
    if (best < 0 || best === this.lampIdx) return;
    this.lampIdx = best;
    const l = lamps[best];
    this.lampSpot.position.copy(l);
    this.lampSpot.target.position.set(l.x, l.y - 5, l.z);
    this.lampSpot.target.updateMatrixWorld();
    shared.uLampSkip.value = best;
  }

  syncBoard(dt: number, snap = false) {
    const ph = this.physics;
    const r = this.board.root;
    if (ph.mode === 'bail' && ph.bail) {
      ph.bail.board.rootPos(r.position);
      r.quaternion.copy(ph.bail.board.q);
      this.boardSmoothQ.copy(r.quaternion);
      this.boardVisOff.set(0, 0, 0);
      this.prevMode = ph.mode;
      return;
    }
    const q = ph.mode === 'air' ? ph.boardQ.clone() : ph.basisQuat(ph.fwd, ph.up);
    // the drop-in pivot is a fast, exact rotation about the trailing wheels on the coping: no smoothing lag
    if (snap || ph.dropin) this.boardSmoothQ.copy(q); else this.boardSmoothQ.slerp(q, 1 - Math.exp(-28 * dt));
    // catching a rail from a little below snaps the physics onto it: ease that jump out over a few frames
    if (snap) this.boardVisOff.set(0, 0, 0);
    else if (this.prevMode === 'air' && ph.mode === 'grind') {
      this.boardVisOff.add(this.prevPos.addScaledVector(this.prevVel, dt).sub(ph.pos));
      if (this.boardVisOff.length() > 0.45) this.boardVisOff.setLength(0.45);
    }
    this.boardVisOff.multiplyScalar(Math.exp(-16 * dt));
    this.prevMode = ph.mode; this.prevPos.copy(ph.pos); this.prevVel.copy(ph.vel);
    r.position.copy(ph.pos).add(this.boardVisOff);
    r.quaternion.copy(this.boardSmoothQ);
    if (this.boardReturn) {
      const br = this.boardReturn;
      br.t += dt;
      const k = clamp(br.t / 0.35, 0, 1), e = k * k * (3 - 2 * k);
      const p = br.fromP.clone().lerp(r.position, e);
      if (br.hop) p.y += Math.sin(k * Math.PI) * 0.16;
      r.position.copy(p);
      r.quaternion.slerpQuaternions(br.fromQ, this.boardSmoothQ, e);
      if (k >= 1) this.boardReturn = null;
    }
  }
  boardVisOff = new Vector3();
  prevMode = 'ride';
  prevPos = new Vector3();
  prevVel = new Vector3();

  eventLog: { t: number; type: string; [k: string]: any }[] = [];
  private processEvents() {
    const ph = this.physics;
    for (const e of ph.events) {
      this.tricks.event(e);
      if (DEBUG) {
        const { flip, ...rest } = e as any;
        this.eventLog.push({ t: +this.simTime.toFixed(2), ...rest, ...(flip ? { flip: flip.name ?? flip.kind ?? flip } : {}) });
        if (this.eventLog.length > 400) this.eventLog.shift();
      }
      switch (e.type) {
        case 'pop': this.audio.pop(e.charge ?? 0.5); break;
        case 'land':
          this.audio.land(clamp(e.impact / 7, 0, 1));
          if (e.impact > 6) this.rig.shake = Math.max(this.rig.shake, 0.5);
          break;
        case 'grindStart': this.audio.grind(true, e.metal && e.kind !== 'ledge' ? true : e.metal); break;
        case 'grindEnd': this.audio.grind(false); break;
        case 'bail': this.audio.grind(false); this.audio.thud(); this.rig.shake = 0.8; break;
        case 'boardClack': this.audio.clack(e.v); break;
        case 'bonk': this.audio.clack(2); this.rig.shake = Math.max(this.rig.shake, 0.3); break;
        case 'dropIn': this.audio.land(0.25); break;
      }
    }
  }

  /** advance the simulation by dt (fixed physics substeps) */
  simulate(dt: number) {
    const ph = this.physics;
    this.acc += dt;
    ph.events.length = 0;
    let n = 0;
    while (this.acc >= STEP && n < 10) {
      if (this.scriptInput) this.input.scripted = this.scriptInput(this.simTime);
      const inp = this.input.sample(ph.mode === 'air');
      this.lastInput = inp;
      ph.step(STEP, inp);
      this.acc -= STEP; this.simTime += STEP; n++;
    }
    if (n === 10) this.acc = 0;
    this.processEvents();
    // input events
    const ev = this.input.consumeEvents();
    if (ev.timeOfDay) this.nextTime();
    if (ev.respawn) this.respawn();
    if (ev.recenter) this.rig.recenter();
    if (ev.help) this.hud.toggleHelp();
    const cam = this.input.consumeCamera();
    if (cam.dx || cam.dy) this.rig.addOrbit(cam.dx, cam.dy);
    if (this.input.camStick.x || this.input.camStick.y) this.rig.addOrbit(this.input.camStick.x * 900 * dt, this.input.camStick.y * 500 * dt);

    this.tod.update(dt);
    if (this.tod.dirty) { this.applyEnv(this.tod.cur); this.tod.dirty = false; }
    // visuals
    this.syncBoard(dt);
    if (ph.mode === 'ride') this.board.spinWheels(ph.vel.dot(ph.fwd) * dt);
    else if (ph.mode === 'air') this.board.spinWheels(0.6 * dt);
    this.skater.update(dt, ph, this.board, { steer: this.lastInput.steer, crouch: this.lastInput.crouch });
    // camera follows the hips
    const focus = this.skater.hipsWorld(new Vector3());
    if (ph.mode === 'ride' || ph.mode === 'grind' || ph.mode === 'air') focus.lerp(ph.pos.clone().addScaledVector(ph.up, 0.9), 0.5);
    this.rig.update(dt, focus, ph);
    this.tricks.update(dt, ph.mode === 'ride', ph.manual.active || ph.kickturn.t >= 0);
    this.hud.update(dt);
    this.audio.update(dt, ph.speed, ph.surface, ph.mode === 'ride', ph.grind ? ph.grind.speed : 0);
    shared.uTime.value = this.simTime;
    this.ocean.mat.uniforms.uTime.value = this.simTime;
    this.sky.mat.uniforms.uTime.value = this.simTime;
    this.scenery.update(this.simTime, dt);
    this.updateLampLight();
    this.sky.mesh.position.copy(this.camera.position);
    this.clouds.group.position.copy(this.camera.position);
    this.ocean.mesh.position.x = Math.round(this.camera.position.x / 50) * 50;
    this.post.grade.uniforms.get('uTime')!.value = this.simTime;
  }

  render(dt: number) {
    this.hero.update(this.renderer, this.scene, this.skater.hipsWorld(new Vector3()), this.board.root);
    this.post.render(dt);
  }

  private frame(t: number) {
    if (this.manualClock) return;
    if (this.fpsCap > 0) {
      const minDt = 1000 / this.fpsCap - 1.5;
      if (t - this.lastFrame < minDt) return;
    }
    const dt = Math.min(0.1, this.lastFrame ? (t - this.lastFrame) / 1000 : 1 / 60);
    this.lastFrame = t;
    this.simulate(dt);
    this.render(dt);
    this.adaptQuality(dt);
  }

  private qTimer = 0;
  private adaptQuality(dt: number) {
    if (params.has('quality') || DEBUG) return;
    this.frameTimes.push(dt);
    this.qTimer += dt;
    if (this.qTimer < 3) return;
    this.qTimer = 0;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const target = this.fpsCap ? 1 / this.fpsCap : 1 / 60;
    if (avg > target * 1.35 && this.quality > 0) { this.quality--; this.applyQuality(); }
    else if (avg < target * 0.7 && this.quality < 2 && !matchMedia('(pointer: coarse)').matches) { this.quality++; this.applyQuality(); }
  }
  applyQuality() {
    this.resize();
    this.post.bloom.intensity = this.quality >= 1 ? this.tod.cur.bloom : 0;
    this.sun.shadow.camera.far = this.quality >= 2 ? 95 : this.quality === 1 ? 60 : 40;
    this.hero.setSize(this.quality >= 2 ? 1024 : this.quality === 1 ? 512 : 0, this.renderer);
    if (this.quality === 0) { this.lampSpot.shadow.autoUpdate = false; this.lampSpot.shadow.needsUpdate = false; }
    void MathUtils;
  }
}
