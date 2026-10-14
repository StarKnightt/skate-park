import { Camera, Color, HalfFloatType, Scene, Uniform, Vector2, WebGLRenderer } from 'three';
import {
  BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, FXAAEffect,
} from 'postprocessing';

const GRADE = /* glsl */ `
uniform float uSat, uContrast, uExposure, uGrain, uTime, uVig;
uniform vec3 uTint, uVigColor, uLift;
float gh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * uTint;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  // gentle s-curve around mid grey in a perceptual-ish space
  vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
  g = (g - 0.5) * uContrast + 0.5;
  g += uLift * (1.0 - g);
  // warm vignette (never black), round in screen space whatever the aspect ratio
  float asp = resolution.x / resolution.y;
  vec2 q = (uv - 0.5) * vec2(asp, 1.0) / length(vec2(asp, 1.0) * 0.5);
  float v = smoothstep(0.42, 1.05, length(q));
  g = mix(g, g * uVigColor, v * uVig);
  // per-pixel triangular dither: hides 8-bit banding in the sky without a visible grain pattern
  vec2 fc = gl_FragCoord.xy + fract(uTime * 7.31) * vec2(113.0, 71.0);
  g += (gh(fc) + gh(fc + 37.7) - 1.0) * uGrain;
  outputColor = vec4(pow(max(g, 0.0), vec3(2.2)), inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE, {
      uniforms: new Map<string, Uniform>([
        ['uSat', new Uniform(1.1)], ['uContrast', new Uniform(1.04)], ['uExposure', new Uniform(1)], ['uGrain', new Uniform(0.005)],
        ['uTime', new Uniform(0)], ['uVig', new Uniform(0.55)], ['uTint', new Uniform(new Color(1, 1, 1))],
        ['uVigColor', new Uniform(new Color(0.78, 0.62, 0.66))], ['uLift', new Uniform(new Color(0.02, 0.012, 0.03))],
      ]),
    });
  }
}

export class Post {
  composer: EffectComposer;
  bloom: BloomEffect;
  grade: GradeEffect;
  tone: ToneMappingEffect;
  fxaa: FXAAEffect;
  pass: EffectPass;
  bloomOn: boolean;
  fxaaOn: boolean;
  constructor(public renderer: WebGLRenderer, scene: Scene, private camera: Camera, msaa: number, bloom = true, fxaa = !msaa) {
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: msaa });
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.78, luminanceSmoothing: 0.22, intensity: 0.55, radius: 0.72 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.grade = new GradeEffect();
    this.fxaa = new FXAAEffect();
    this.bloomOn = bloom; this.fxaaOn = fxaa;
    this.pass = this.effectPass();
    this.composer.addPass(this.pass);
  }
  // FXAA has to come first in the merged pass: it reads its neighbours from the raw input buffer, so after the grade it
  // would mix graded and raw values and paste raw (ungraded) pixels wherever their difference crossed its threshold
  private effectPass() {
    return new EffectPass(this.camera, ...(this.fxaaOn ? [this.fxaa] : []), ...(this.bloomOn ? [this.bloom] : []), this.tone, this.grade);
  }
  /** bloom off removes it from the merged pass (intensity 0 still runs its luminance and mip blur passes) */
  configure(bloom: boolean, fxaa: boolean, msaa: number) {
    this.composer.multisampling = msaa;
    if (bloom === this.bloomOn && fxaa === this.fxaaOn) return;
    this.composer.removePass(this.pass);
    this.pass.dispose();
    this.bloomOn = bloom; this.fxaaOn = fxaa;
    this.pass = this.effectPass();
    this.composer.addPass(this.pass);
  }
  setSize(w: number, h: number) { this.composer.setSize(w, h); }
  render(dt: number) { this.composer.render(dt); }
  setExposure(e: number) { (this.grade.uniforms.get('uTint')!.value as Color).setScalar(e); }
  size() { return this.renderer.getDrawingBufferSize(new Vector2()); }
}
