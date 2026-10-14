import {
  Color, Fog, Group, HemisphereLight, Mesh, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, Scene,
  SRGBColorSpace, Texture, TextureLoader, Vector3, WebGLRenderer, NoToneMapping, MathUtils, DoubleSide, SpotLight,
  type LOD, type WebGLRenderTarget,
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
import { SkatePhysics, SkateInput, emptyInput, PhysView } from './player/physics';
import { BoardView } from './player/board';
import { Skater } from './player/skater';
import { CameraRig } from './player/cameraRig';
import { TrickTracker } from './player/tricks';
import { createAutopilot } from './player/autopilot';
import { Input, type AutoSource } from './core/input';
import { settings, onSettings, type QualitySetting } from './core/settings';
import { Hud, TouchControls } from './ui/hud';
import { installPauseMenu } from './ui/pauseMenu';
import { installPlatform } from './core/platform';
import { AudioEngine } from './audio/audio';
import { params, DEBUG, clamp } from './core/util';
import { installTestHooks } from './debug/testHooks';

const BASE = import.meta.env.BASE_URL;
export const STEP = 1 / 120;
/** physics steps per displayed frame at most; a longer hitch becomes a brief slow-down */
const MAX_STEPS = 12;
const _f = new Vector3(), _g = new Vector3();
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'OS', 'Fn']);
/** any gamepad button down or stick out of its deadzone */
const padActive = () => {
  for (const p of navigator.getGamepads?.() ?? []) if (p && (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.3))) return true;
  return false;
};

export class Game {
  renderer: WebGLRenderer;
  scene = new Scene();
  camera = new PerspectiveCamera(58, 1, 0.08, 4000);
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
  /** physics state after the previous / the last step, and the interpolated state every visual layer draws */
  prevV = new PhysView();
  curV = new PhysView();
  groundPos = new Vector3();
  groundMode = 'ride';
  view = new PhysView();
  /** last displayed frame: physics steps run, interpolation fraction */
  frameSteps = 0;
  frameAlpha = 0;
  /** paused: no simulation at all, the scene is redrawn at ~10 fps */
  paused = false;
  onPause?: (paused: boolean) => void;
  /** more pause observers (platform.ts: wake lock); onPause stays the pause menu's */
  pauseListeners: ((paused: boolean) => void)[] = [];
  qualityAuto = true;
  private pausedDrawT = 0;

  constructor(private container: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android/i.test(navigator.userAgent);
    const qs = settings.quality;
    this.quality = params.has('quality') ? Number(params.get('quality')) : qs !== 'auto' ? qs : mobile ? 1 : 2;
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
    this.input.attach(this.physics);
    this.input.auto = createAutopilot(this);
    // Easy / Auto: landing assist, auto-grind, fast recovery; Pro: none
    const syncAssist = () => {
      const on = settings.controlMode !== 'pro';
      Object.assign(this.physics.assist, { landing: on, autoGrind: on, fastRecover: on });
    };
    syncAssist();
    onSettings((_s, k) => { if (k === 'controlMode') syncAssist(); });
    this.board = new BoardView(deckTex);
    this.scene.add(this.board.root);
    this.skater = new Skater(gltf);
    this.scene.add(this.skater.root);
    this.skater.onRecovered = (pos, fwd) => {
      // the board stays where it came to rest; the rider steps onto it (flipping it over first if it lies upside down)
      const fromP = this.board.root.position.clone(), fromQ = this.board.root.quaternion.clone();
      this.physics.finishRecover(pos, fwd);
      this.resnap();
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
    if (!params.has('quality')) this.setQuality(settings.quality);
    onSettings((s, k) => { if (k === 'quality' && !params.has('quality')) this.setQuality(s.quality); });
    if (params.has('nowarm')) this.renderer.compile(this.scene, this.camera); else await this.warmUp(prog);
    prog(1);
    this.ready = true;
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 900);
    if (!touchMode && !params.has('mute')) this.hud.soundPrompt();
    this.renderer.setAnimationLoop((t) => this.frame(t));
    installPauseMenu(this);
    installPlatform(this);
    // start screen: he skates the park by himself under the title card until the first input
    if (!DEBUG || params.has('attract')) this.startAttract();
  }

  /** Compile every shader variant and upload every texture and buffer before the first frame (all distance levels and
   *  hidden objects, the sun / lamp / hero shadow passes, the post passes): otherwise, with a cold shader cache (a first
   *  visit), the first view of an area stalls for 100-250 ms. */
  private async warmUp(prog: (p: number) => void) {
    const r = this.renderer, scene = this.scene, t0 = performance.now();
    // the people load on their own: give them a few seconds to arrive
    while (!this.scenery.people.group.children.length && performance.now() - t0 < 8000) await new Promise((res) => setTimeout(res, 50));
    prog(0.88);
    const undo: (() => void)[] = [];
    scene.traverse((o) => {
      if (!o.visible) { o.visible = true; undo.push(() => { o.visible = false; }); }
      const lod = o as LOD;
      if (lod.isLOD && lod.autoUpdate) { lod.autoUpdate = false; undo.push(() => { lod.autoUpdate = true; }); }
      if (o.frustumCulled) { o.frustumCulled = false; undo.push(() => { o.frustumCulled = true; }); }
    });
    try {
      // the scene is drawn into the composer's linear half-float buffer: compile for that target, not the canvas
      const target = (this.post.composer as unknown as { inputBuffer?: WebGLRenderTarget }).inputBuffer ?? null;
      r.setRenderTarget(target);
      await r.compileAsync(scene, this.camera);
      r.setRenderTarget(null);
      prog(0.96);
      // one frame through the real pipeline with nothing culled: shadow maps, hero shadow, post passes, uploads
      this.lampSpot.shadow.needsUpdate = true;
      this.render(1 / 60);
    } catch (e) {
      console.warn('warm-up skipped', e); // whatever is left compiles on first use
    } finally {
      r.setRenderTarget(null);
      undo.forEach((f) => f());
      this.lampSpot.shadow.needsUpdate = true;
    }
    this.warmMs = performance.now() - t0;
  }
  /** load-time warm-up duration (ms), for tests */
  warmMs = 0;

  // ---------------------------------------------------------------- start screen (attract mode)
  /** the autopilot rides the calmer attract lap under the title card until the first input */
  attract = false;
  private attractOff: (() => void) | null = null;
  private titleHide = false;
  private startAttract() {
    const auto = this.input.auto as (AutoSource & { attract?: boolean }) | null;
    if (!auto) return;
    this.attract = true;
    if ('attract' in auto) auto.attract = true;
    this.input.setAuto(true);
    this.hud.showTitle(true);
    const end = () => this.endAttract();
    const key = (e: KeyboardEvent) => { if (!MODIFIER_KEYS.has(e.key)) end(); };
    // pointerdown: a canvas click (also the one that locks the pointer) or a tap; the HUD pills stop propagation
    addEventListener('keydown', key);
    addEventListener('pointerdown', end);
    this.attractOff = () => { removeEventListener('keydown', key); removeEventListener('pointerdown', end); };
  }
  /** first input: the title goes, the player takes over (he keeps rolling; Easy keeps cruising); Auto keeps riding */
  endAttract() {
    if (!this.attract) return;
    this.attract = false;
    this.attractOff?.(); this.attractOff = null;
    const auto = this.input.auto as (AutoSource & { attract?: boolean }) | null;
    if (auto && 'attract' in auto) auto.attract = false;
    if (settings.controlMode === 'auto') this.input.setAuto(true);
    else { this.input.setAuto(false); this.input.armCruise(); }
    // hidden after the HUD has seen auto-ride go off, so the hand-over shows no "Auto-ride off" toast
    this.titleHide = true;
  }

  // ---------------------------------------------------------------- pause / time / quality (used by the pause menu)
  setPaused(on: boolean, force = false) {
    // frame-stepped test captures (manual clock) never pause on their own
    if (on === this.paused || (on && this.manualClock && !force)) return;
    this.paused = on;
    this.pausedDrawT = -1e9;
    this.audio.duck(on);
    this.onPause?.(on);
    for (const f of this.pauseListeners) f(on);
  }
  togglePause() { this.setPaused(!this.paused); }

  setTime(index: number, instant = false) {
    const now = instant || this.paused;
    this.tod.set(index, now);
    if (now) { this.applyEnv(this.tod.cur); this.tod.dirty = false; this.pausedDrawT = -1e9; }
    this.hud.setTimeLabel(PRESETS[this.tod.index].name);
  }

  /** 'auto' adapts to the frame rate; a fixed level turns the adaptation off */
  setQuality(q: QualitySetting) {
    this.qualityAuto = q === 'auto';
    if (q !== 'auto' && q !== this.quality) { this.quality = q; this.applyQuality(); }
  }

  unlockAudio() {
    if (this.audio.started || params.has('mute')) return;
    this.audio.start();
  }

  respawn(pos = this.spawn.pos, heading = this.spawn.heading) {
    this.physics.reset(pos, heading);
    this.resnap();
    this.syncBoard(1, true);
    this.rig.snap(this.view.pos, Math.atan2(this.view.fwd.x, this.view.fwd.z));
    this.skater.reset();
    this.boardReturn = null;
    this.input.auto?.reset();
  }

  /** the physics state jumped (respawn, teleport, back on the board): draw it as is, no interpolation from before */
  resnap() {
    this.physics.snapshot(this.curV);
    this.prevV.copy(this.curV);
    this.view.copy(this.curV);
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
    const p = this.view.pos, lamps = this.scenery.lampLights;
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
    const v = this.view;
    const r = this.board.root;
    if (v.mode === 'bail' && v.bail) {
      r.position.copy(v.bail.boardPos);
      r.quaternion.copy(v.bail.boardQ);
      this.boardSmoothQ.copy(r.quaternion);
      this.boardVisOff.set(0, 0, 0);
      this.prevMode = v.mode;
      return;
    }
    const q = v.boardQ;
    // the drop-in pivot is a fast, exact rotation about the trailing wheels on the coping: no smoothing lag
    if (snap || v.dropin) this.boardSmoothQ.copy(q); else this.boardSmoothQ.slerp(q, 1 - Math.exp(-40 * dt));
    // catching a rail / ledge snaps the physics onto it (drawn without interpolation): ease that jump out over a few frames
    if (snap) this.boardVisOff.set(0, 0, 0);
    else if ((this.prevMode === 'air' || this.prevMode === 'ride') && v.mode === 'grind') {
      this.boardVisOff.add(this.prevPos.addScaledVector(this.prevVel, dt).sub(v.pos));
      if (this.boardVisOff.length() > 0.45) this.boardVisOff.setLength(0.45);
    }
    this.boardVisOff.multiplyScalar(Math.exp(-16 * dt));
    this.prevMode = v.mode; this.prevPos.copy(v.pos); this.prevVel.copy(v.vel);
    r.position.copy(v.pos).add(this.boardVisOff);
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

  /** advance the simulation by dt: fixed physics steps, then every visual layer from the state interpolated between the
   *  last two steps (the physics keeps its own true state) */
  simulate(dt: number) {
    const ph = this.physics;
    this.acc += dt;
    ph.events.length = 0;
    let n = 0;
    while (this.acc >= STEP && n < MAX_STEPS) {
      if (this.scriptInput) this.input.scripted = this.scriptInput(this.simTime);
      const inp = this.input.sample(ph.mode === 'air');
      this.lastInput = inp;
      const m0 = ph.mode;
      this.prevV.copy(this.curV);
      ph.step(STEP, inp);
      ph.snapshot(this.curV);
      // never interpolate across a jump: rail / ledge catches (eased in syncBoard) and teleports
      if ((ph.mode === 'grind' && m0 !== 'grind') || this.curV.pos.distanceToSquared(this.prevV.pos) > 0.25) this.prevV.copy(this.curV);
      this.acc -= STEP; this.simTime += STEP; n++;
    }
    if (n === MAX_STEPS) this.acc = Math.min(this.acc, STEP);
    this.frameSteps = n;
    this.frameAlpha = clamp(this.acc / STEP, 0, 1);
    const v = this.view.lerp(this.prevV, this.curV, this.frameAlpha);
    // sub-mm ground position noise (snapping to the collision facets) is filtered without lag: follow the view velocity
    // and pull toward the samples (12 ms); air, grinds and jumps over 5 cm draw the samples as they are
    if (v.mode === 'ride' && this.groundMode === 'ride') {
      this.groundPos.addScaledVector(v.vel, dt);
      if (this.groundPos.distanceToSquared(v.pos) < 0.0025) { this.groundPos.lerp(v.pos, 1 - Math.exp(-dt / 0.012)); v.pos.copy(this.groundPos); }
      else this.groundPos.copy(v.pos);
    } else this.groundPos.copy(v.pos);
    this.groundMode = v.mode;
    this.processEvents();

    this.tod.update(dt);
    if (this.tod.dirty) { this.applyEnv(this.tod.cur); this.tod.dirty = false; }
    // visuals: all read the interpolated view, never the physics
    this.syncBoard(dt);
    if (v.mode === 'ride') this.board.spinWheels(v.vel.dot(v.fwd) * dt);
    else if (v.mode === 'air') this.board.spinWheels(0.6 * dt);
    this.skater.update(dt, v, this.board, { steer: this.lastInput.steer, crouch: this.lastInput.crouch });
    // camera follows the hips (after the skater is posed)
    const focus = this.skater.hipsWorld(_f);
    if (v.mode === 'ride' || v.mode === 'grind' || v.mode === 'air') focus.lerp(_g.copy(v.pos).addScaledVector(v.up, 0.9), 0.5);
    this.rig.update(dt, focus, v);
    this.tricks.update(dt, ph.mode === 'ride', ph.manual.active || ph.kickturn.t >= 0);
    this.hud.update(dt);
    if (this.titleHide) { this.titleHide = false; this.hud.showTitle(false); }
    this.audio.update(dt, v.speed, v.surface, v.mode === 'ride', v.grind ? v.grind.speed : 0);
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
    this.frameInput(dt);
    if (this.paused) {
      if (t - this.pausedDrawT >= 100) { this.pausedDrawT = t; this.render(dt); }
      return;
    }
    this.simulate(dt);
    this.render(dt);
    this.adaptQuality(dt);
  }

  /** once per displayed frame, also while paused: input polling, input events, camera look */
  frameInput(dt: number) {
    const inp = this.input;
    inp.poll(dt);
    const ev = inp.consumeEvents();
    if (ev.pause) this.togglePause();
    const lk = inp.consumeLook(dt);
    this.rig.locked = inp.locked;
    if (this.paused) return;
    if (ev.autoToggle) inp.setAuto(!inp.autoActive);
    if (ev.timeOfDay) this.nextTime();
    if (ev.respawn) this.respawn();
    if (ev.recenter) this.rig.recenter();
    if (ev.help) this.hud.toggleHelp();
    this.rig.look(lk.yaw, lk.pitch);
    if (this.attract && padActive()) this.endAttract();
  }

  private qTimer = 0;
  private adaptQuality(dt: number) {
    if (!this.qualityAuto || params.has('quality') || DEBUG) return;
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
