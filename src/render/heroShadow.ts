import {
  Camera, Color, DoubleSide, HalfFloatType, Light, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, Object3D,
  OrthographicCamera, RGBAFormat, Scene, ShaderMaterial, Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { shared } from './materials';

/** layer of everything rendered into the skater's own shadow map (plus the lights, so the light setup never changes) */
export const HERO_LAYER = 7;

const VS = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform vec3 uC;
uniform vec3 uF;
varying float vD;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vD = dot( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz - uC, uF );
}`;
// coverage, depth along the light (m from the box centre); the mips average both, so coverage-weighted depth stays exact
const FS = /* glsl */ `
varying float vD;
void main() { gl_FragColor = vec4( 1.0, vD, 0.0, 1.0 ); }`;

const COLLAPSE = new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1e4, 0, 0, 0, 1);
const UP = new Vector3(0, 1, 0), FWD = new Vector3(0, 0, 1);
const _x = new Vector3(), _y = new Vector3(), _l = new Vector3(), _c = new Vector3(), _d = new Vector3();

/**
 * The skater's (and his board's) own sun shadow map: a box of ~3 m around him at a few mm per texel instead of the
 * centimetres of the park cascades, so his shadow on walls and the ground keeps his silhouette. Receivers filter it
 * by the distance behind the caster (materials.ts heroShadow): crisp at the contact, softer further away. While it is
 * active the skater and board are left out of the sun cascades (they still cast into the lamp spot light).
 */
export class HeroShadow {
  rt: WebGLRenderTarget | null = null;
  cam = new OrthographicCamera(-1, 1, 1, -1, 0.5, 14);
  mat = new ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side: DoubleSide,
    uniforms: { uC: { value: new Vector3() }, uF: { value: new Vector3() } },
  });
  size = 0;
  /** penumbra width per metre between caster and receiver (time of day) */
  k = 0.0176;
  boardIn = true;
  /** the skater and board live in this nested scene (at the origin, inside the main scene): the map pass draws only it */
  root = new Scene();
  private sunCams: Camera[] = [];
  private boardMeshes: Object3D[] = [];
  private clear = new Color();
  private M = new Matrix4();

  constructor() {
    this.cam.layers.set(HERO_LAYER);
    shared.uHeroMat.value = this.M;
    this.root.overrideMaterial = this.mat;
    this.root.matrixAutoUpdate = false;
    this.root.matrixWorldAutoUpdate = false;
  }

  get active() { return this.size > 0 && this.rt !== null; }

  /** map size in texels (0 = off: the skater casts into the sun cascades again) */
  setSize(n: number, renderer: WebGLRenderer) {
    const ok = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    n = ok ? n : 0;
    if (n === this.size) return;
    this.rt?.dispose();
    this.rt = null;
    this.size = n;
    if (n > 0) {
      this.rt = new WebGLRenderTarget(n, n, {
        type: HalfFloatType, format: RGBAFormat, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
        generateMipmaps: true, depthBuffer: true, stencilBuffer: false,
      });
      this.rt.texture.name = 'heroShadow';
    }
    shared.uHeroMap.value = this.rt?.texture ?? null;
    shared.uHeroInfo.value.z = 0;
  }

  attach(skater: Object3D, board: Object3D, sunCams: Camera[], lights: Light[]) {
    this.sunCams = sunCams;
    const skipSun = (_r: unknown, object: Object3D, _c: unknown, shadowCamera: Camera) => {
      if (this.active && this.sunCams.includes(shadowCamera)) object.modelViewMatrix.copy(COLLAPSE);
    };
    const skipBoard = (_r: unknown, object: Object3D, _c: unknown, shadowCamera: Camera) => {
      if (this.active && this.boardIn && this.sunCams.includes(shadowCamera)) object.modelViewMatrix.copy(COLLAPSE);
    };
    skater.traverse((o) => { if ((o as Mesh).isMesh) { o.layers.enable(HERO_LAYER); (o as any).onBeforeShadow = skipSun; } });
    board.traverse((o) => { if ((o as Mesh).isMesh) { this.boardMeshes.push(o); (o as any).onBeforeShadow = skipBoard; } });
    for (const l of lights) l.layers.enable(HERO_LAYER);
    skater.parent?.add(this.root);
    this.root.add(skater, board);
  }

  /** render the map around the hips (towards the sun direction in shared.uSunDir) and publish it to the toon materials;
   *  world matrices must be current (the pass does not update them) */
  update(renderer: WebGLRenderer, _scene: Scene, hips: Vector3, board: Object3D) {
    const info = shared.uHeroInfo.value;
    if (!this.active) { info.z = 0; return; }
    const L = _l.copy(shared.uSunDir.value).normalize();
    // the camera basis of lookAt(eye = centre + L, target = centre)
    _x.crossVectors(Math.abs(L.y) > 0.99 ? FWD : UP, L).normalize();
    _y.crossVectors(L, _x);
    // the board rides inside the box; after a bail it may lie metres away: grow the box a little or leave it to the cascades
    _d.copy(board.position).sub(hips);
    const need = Math.max(Math.abs(_d.dot(_x)), Math.abs(_d.dot(_y))) + 0.45;
    let R = 1.45;
    this.boardIn = need <= 2.6;
    if (this.boardIn && need > R) R = need;
    for (const m of this.boardMeshes) { if (this.boardIn) m.layers.enable(HERO_LAYER); else m.layers.disable(HERO_LAYER); }
    // snap the box to its texel grid so still shadows (the board on the ground) do not crawl while he sways
    const ts = (2 * R) / this.size;
    const cx = hips.dot(_x), cy = hips.dot(_y);
    const sx = Math.round(cx / ts) * ts, sy = Math.round(cy / ts) * ts;
    const C = _c.copy(hips).addScaledVector(_x, sx - cx).addScaledVector(_y, sy - cy);
    const cam = this.cam;
    cam.up.copy(Math.abs(L.y) > 0.99 ? FWD : UP);
    cam.position.copy(C).addScaledVector(L, 7);
    cam.lookAt(C);
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const cF = -C.dot(L);
    (this.mat.uniforms.uC.value as Vector3).copy(C);
    (this.mat.uniforms.uF.value as Vector3).copy(L).negate();
    // world -> (u, v, depth behind the box centre along the light, metres)
    const s = 1 / (2 * R);
    this.M.set(
      _x.x * s, _x.y * s, _x.z * s, 0.5 - sx * s,
      _y.x * s, _y.y * s, _y.z * s, 0.5 - sy * s,
      -L.x, -L.y, -L.z, -cF,
      0, 0, 0, 1,
    );
    // render the casters with the depth material only, no background, no shadow maps
    const prevT = renderer.getRenderTarget(), prevA = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    const au = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.root, cam);
    renderer.setRenderTarget(prevT);
    renderer.setClearColor(this.clear, prevA);
    renderer.shadowMap.autoUpdate = au;
    info.set(ts, this.k, this.size, R);
  }
}
