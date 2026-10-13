import { Camera, Color, HalfFloatType, Scene, Uniform, Vector2, WebGLRenderer } from 'three';
import {
  BloomEffect, Effect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, FXAAEffect,
} from 'postprocessing';

const GRADE = /* glsl */ `
uniform float uSat, uContrast, uExposure, uGrain, uTime, uVig;
uniform vec3 uTint, uVigColor, uLift;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * uTint;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  // gentle s-curve around mid grey in a perceptual-ish space
  vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
  g = (g - 0.5) * uContrast + 0.5;
  g += uLift * (1.0 - g);
  // warm vignette (never black)
  vec2 q = uv - 0.5;
  float v = smoothstep(0.32, 0.85, length(q * vec2(1.15, 1.0)));
  g = mix(g, g * uVigColor, v * uVig);
  g += (hash(uv * 900.0 + fract(uTime)) - 0.5) * uGrain;
  outputColor = vec4(pow(max(g, 0.0), vec3(2.2)), inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE, {
      uniforms: new Map<string, Uniform>([
        ['uSat', new Uniform(1.1)], ['uContrast', new Uniform(1.04)], ['uExposure', new Uniform(1)], ['uGrain', new Uniform(0.012)],
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
  constructor(public renderer: WebGLRenderer, scene: Scene, camera: Camera, msaa: number) {
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: msaa });
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.78, luminanceSmoothing: 0.22, intensity: 0.55, radius: 0.72 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.grade = new GradeEffect();
    this.fxaa = new FXAAEffect();
    this.pass = new EffectPass(camera, this.bloom, this.tone, this.grade, ...(msaa ? [] : [this.fxaa]));
    this.composer.addPass(this.pass);
  }
  setSize(w: number, h: number) { this.composer.setSize(w, h); }
  render(dt: number) { this.composer.render(dt); }
  setExposure(e: number) { (this.grade.uniforms.get('uTint')!.value as Color).setScalar(e); }
  size() { return this.renderer.getDrawingBufferSize(new Vector2()); }
}
