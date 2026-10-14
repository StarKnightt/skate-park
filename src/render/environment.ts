import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, Group, Mesh, PlaneGeometry, Points, ShaderMaterial,
  SphereGeometry, Texture, Vector3, MathUtils, NormalBlending,
} from 'three';
import type { EnvState } from './timeOfDay';
import { rng } from '../core/util';

const NOISE = /* glsl */ `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<NOISE_OCT;i++){ s += a*vnoise(p); p = p*2.02 + 13.7; a *= 0.5; }
#if NOISE_OCT < 5
  s *= 0.96875 / (1.0 - exp2(-float(NOISE_OCT)));
#endif
  return s; }
`;
/** fbm octaves (and ocean wave count) of a sky / ocean material: 5 / 9 high, fewer on the mobile tiers */
function setDefines(m: ShaderMaterial, d: Record<string, number>) {
  if (Object.entries(d).every(([k, v]) => m.defines[k] === v)) return;
  Object.assign(m.defines, d);
  m.needsUpdate = true;
}

/** Painterly sky dome: layered gradient, sun glow, brushy cirrus, stars. Follows the camera. */
export class Sky {
  mesh: Mesh;
  mat: ShaderMaterial;
  constructor() {
    this.mat = new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false, defines: { NOISE_OCT: 5 },
      uniforms: {
        uZenith: { value: new Color() }, uMid: { value: new Color() }, uHorizon: { value: new Color() },
        uSunDir: { value: new Vector3() }, uGlow: { value: new Color() }, uGlowStrength: { value: 1 },
        uCloudLit: { value: new Color() }, uCloudShade: { value: new Color() }, uStars: { value: 0 }, uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uMid, uHorizon, uSunDir, uGlow, uCloudLit, uCloudShade; uniform float uGlowStrength, uStars, uTime;
        varying vec3 vDir;
        ${NOISE}
        void main(){
          vec3 d = normalize(vDir);
          float hh = d.y + (fbm(d.xz * 3.0 + vec2(uTime * 0.002, 0.0)) - 0.5) * 0.06;
          vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.22, hh));
          col = mix(col, uZenith, smoothstep(0.16, 0.8, hh));
          vec3 sd3 = normalize(uSunDir);
          float sd = max(dot(d, sd3), 0.0);
          vec2 dh = normalize(d.xz + 1e-5), sh = normalize(sd3.xz + 1e-5);
          float az = max(dot(dh, sh), 0.0);
          float low = 1.0 - smoothstep(-0.05, 0.42, d.y);
          col += uGlow * (pow(sd, 5.0) * 0.38 + pow(sd, 40.0) * 0.55 + pow(az, 4.0) * low * 0.38) * uGlowStrength;
          // sun disc (soft painted edge)
          float disc = smoothstep(0.9990, 0.9995, dot(d, sd3));
          col = mix(col, vec3(1.0, 0.95, 0.82) * 1.5, disc * smoothstep(-0.03, 0.0, sd3.y));
          // brushy high cirrus streaks
          if (d.y > 0.02) {
            vec2 uv = d.xz / (d.y + 0.12) * 0.55;
            uv = vec2(uv.x * 0.6 + uv.y * 0.35, uv.y * 1.8 - uv.x * 0.2);
            float n = fbm(uv * 1.3 + vec2(uTime * 0.004, 0.0));
            float n2 = fbm(uv * 4.0 + 7.0);
            float c = smoothstep(0.52, 0.8, n * 0.8 + n2 * 0.35);
            c *= smoothstep(0.02, 0.18, d.y) * (1.0 - smoothstep(0.55, 0.9, d.y));
            vec3 cc = mix(uCloudShade, uCloudLit, 0.35 + 0.65 * pow(sd, 2.0) + n2 * 0.2);
            col = mix(col, cc, c * 0.55);
          }
          // stars
          if (uStars > 0.001 && d.y > 0.05) {
            vec2 sp = d.xz / (d.y + 0.3) * 160.0;
            float s = h12(floor(sp));
            float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
            float star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5)) * tw;
            col += vec3(1.0, 0.95, 0.9) * star * uStars * smoothstep(0.05, 0.3, d.y);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(1800, 48, 24), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }
  setNoise(oct: number) { setDefines(this.mat, { NOISE_OCT: oct }); }
  apply(e: EnvState) {
    const u = this.mat.uniforms;
    u.uZenith.value.copy(e.zenith); u.uMid.value.copy(e.mid); u.uHorizon.value.copy(e.horizon);
    u.uSunDir.value.copy(e.sunDir); u.uGlow.value.copy(e.glow); u.uGlowStrength.value = e.glowStrength;
    u.uCloudLit.value.copy(e.cloudLit); u.uCloudShade.value.copy(e.cloudShade); u.uStars.value = e.stars;
  }
}

/** Big painted cumulus billboards (generated art, chroma keyed) around the horizon. */
export class CloudLayer {
  group = new Group();
  mat: ShaderMaterial;
  constructor(tex: Texture, rects: { u0: number; u1: number; v0: number; v1: number; aspect: number }[], sunDir: Vector3) {
    this.mat = new ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: NormalBlending,
      uniforms: { uMap: { value: tex }, uLit: { value: new Color() }, uShade: { value: new Color() }, uOrig: { value: 1 }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `attribute vec4 rect; attribute float flip; varying vec2 vUv; varying float vH;
        void main(){ vec2 u = uv; if (flip > 0.5) u.x = 1.0 - u.x; vUv = vec2(mix(rect.x, rect.y, u.x), mix(rect.z, rect.w, u.y));
          vec4 wp = modelMatrix * vec4(position, 1.0); vH = wp.y;
          gl_Position = projectionMatrix * viewMatrix * wp; gl_Position.z = gl_Position.w * 0.99998; }`,
      fragmentShader: /* glsl */ `uniform sampler2D uMap; uniform vec3 uLit, uShade; uniform float uOrig, uAlpha; varying vec2 vUv; varying float vH;
        void main(){ vec4 t = texture2D(uMap, vUv); if (t.a < 0.02) discard;
          float l = dot(t.rgb, vec3(0.33, 0.45, 0.22));
          vec3 remap = mix(uShade, uLit, smoothstep(0.55, 0.95, l)) * (0.9 + 0.2 * l);
          vec3 col = mix(remap, t.rgb, uOrig);
          gl_FragColor = vec4(col, t.a * uAlpha);
          #include <colorspace_fragment>
        }`,
    });
    const R = rng(42);
    const geos: BufferGeometry[] = [];
    const n = 15;
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + R() * 0.3;
      const el = MathUtils.degToRad(2.5 + R() * 13 + (i % 3 === 0 ? 6 : 0));
      const dist = 1300;
      const d = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      const r = rects[Math.floor(R() * rects.length)];
      const h = 120 + R() * 160;
      const g = new PlaneGeometry(h * r.aspect, h);
      const flip = new Vector3().crossVectors(d, sunDir).y > 0 ? 1 : 0;
      const nv = g.getAttribute('position').count;
      g.setAttribute('rect', new BufferAttribute(new Float32Array(Array(nv).fill([r.u0, r.u1, r.v0, r.v1]).flat()), 4));
      g.setAttribute('flip', new BufferAttribute(new Float32Array(nv).fill(flip), 1));
      g.lookAt(d.clone().negate());
      g.translate(d.x * dist, d.y * dist + h * 0.35, d.z * dist);
      geos.push(g);
    }
    // merge into one mesh (sorted far to near is irrelevant: they rarely overlap)
    let total = 0; for (const g of geos) total += g.getAttribute('position').count;
    const merged = new BufferGeometry();
    const attrs = ['position', 'uv', 'rect', 'flip'];
    for (const a of attrs) {
      const size = geos[0].getAttribute(a).itemSize;
      const arr = new Float32Array(total * size); let o = 0;
      for (const g of geos) { const src = g.getAttribute(a).array as Float32Array; arr.set(src, o); o += src.length; }
      merged.setAttribute(a, new BufferAttribute(arr, size));
    }
    const idx: number[] = []; let base = 0;
    for (const g of geos) { for (const i of g.index!.array) idx.push(i + base); base += g.getAttribute('position').count; }
    merged.setIndex(idx);
    const m = new Mesh(merged, this.mat);
    m.frustumCulled = false; m.renderOrder = -9;
    this.group.add(m);
  }
  apply(e: EnvState, goldenness: number) {
    this.mat.uniforms.uLit.value.copy(e.cloudLit);
    this.mat.uniforms.uShade.value.copy(e.cloudShade);
    this.mat.uniforms.uOrig.value = goldenness;
    this.mat.uniforms.uAlpha.value = 0.95;
  }
}

/** Stylised ocean: wave normals, sun glitter path, sky fresnel, shore foam, painterly banding. */
export class Ocean {
  mesh: Mesh;
  mat: ShaderMaterial;
  constructor(public level = -1.3, shoreZ = -74) {
    this.mat = new ShaderMaterial({
      fog: false, defines: { NOISE_OCT: 5, OCEAN_WAVES: 9 },
      uniforms: {
        uTime: { value: 0 }, uDeep: { value: new Color() }, uShallow: { value: new Color() }, uSky: { value: new Color() },
        uHorizon: { value: new Color() }, uSunDir: { value: new Vector3() }, uSunCol: { value: new Color() }, uFog: { value: new Color() },
        uFogNear: { value: 80 }, uFogFar: { value: 700 }, uShore: { value: shoreZ }, uGlint: { value: 1 },
      },
      vertexShader: /* glsl */ `varying vec3 vW; uniform float uTime;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0);
          w.y += sin(w.x * 0.05 + uTime * 0.6) * 0.06 + sin(w.z * 0.08 - uTime * 0.9) * 0.08;
          vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFogNear, uFogFar, uShore, uGlint; uniform vec3 uDeep, uShallow, uSky, uHorizon, uSunDir, uSunCol, uFog;
        varying vec3 vW;
        ${NOISE}
        float fbm3(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<3;i++){ s += a*vnoise(p); p = p*2.02 + 13.7; a *= 0.5; } return s / 0.875; }
        // incommensurate directional waves with drifting swell groups; each fades once it is smaller than a few pixels
        vec2 waveGrad(vec2 p, float t, float fp){
          vec2 g = vec2(0.0);
          for (int i = 0; i < OCEAN_WAVES; i++) {
            float fi = float(i);
            float a = fi * 2.39996323 + 0.37;
            vec2 dir = normalize(vec2(cos(a), sin(a)) + vec2(0.0, 0.85));
            float f = 0.15 * pow(1.43, fi) * (1.0 + 0.13 * sin(fi * 4.13 + 0.7));
            float ph = dot(dir, p) * f + t * sqrt(9.8 * f) * 0.55 + fi * 1.913;
            float grp = 0.35 + vnoise(p * (0.015 + 0.004 * fi) + vec2(fi * 7.31, t * 0.02 * (1.0 + 0.1 * fi)));
            float lod = 1.0 - smoothstep(0.1, 0.35, fp * f);
            g += dir * cos(ph) * f * (0.24 / (1.0 + fi * 0.75)) * grp * lod;
          }
          return g;
        }
        void main(){
          vec2 p0 = vW.xz;
          float dist = length(cameraPosition.xz - p0);
          float fp = max(length(fwidth(p0)), 1e-4);
          // large-scale domain warp: no crest line stays straight, nothing tiles
          vec2 wv = vec2(fbm3(p0 * 0.012 + vec2(uTime * 0.004, 0.0)), fbm3(p0 * 0.012 + vec2(5.2, -uTime * 0.003))) - 0.5;
          vec2 p = p0 + wv * 60.0;
          vec2 g = waveGrad(p, uTime, fp);
          g += (vec2(fbm(p * 0.35 + uTime * 0.05), fbm(p * 0.35 - uTime * 0.04 + 9.0)) - 0.5) * 0.45 * (1.0 - smoothstep(0.4, 1.4, fp));
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
          float shoreD = max(0.0, uShore - p0.y + sin(p0.x * 0.05) * 3.0);
          vec3 base = mix(uShallow, uDeep, smoothstep(2.0, 90.0, shoreD));
          // painterly darker swell bands
          float band = smoothstep(0.42, 0.58, fbm(p * 0.03 + vec2(0.0, uTime * 0.01)));
          base *= 0.9 + 0.12 * band;
          vec3 skyR = mix(uHorizon, uSky, clamp(reflect(-v, n).y * 2.0, 0.0, 1.0));
          vec3 col = mix(base, skyR, clamp(fres * 0.85 + 0.12, 0.0, 1.0));
          // glitter path: sparkles in irregular drifting clusters, averaged where they would be smaller than a pixel
          vec3 sd = normalize(uSunDir);
          vec3 r = reflect(-v, n);
          float s = max(dot(r, sd), 0.0);
          float path = pow(s, 14.0);
          vec2 sc = floor(mat2(0.83, -0.56, 0.56, 0.83) * p * vec2(1.9, 3.4));
          float cell = h12(sc + floor(uTime * 7.0 + h12(sc) * 5.0) * 1.37);
          float clusters = smoothstep(0.3, 0.72, fbm3(p * 0.05 + vec2(uTime * 0.03, 0.0)));
          float thr = 0.97 - path * 0.22 - clusters * 0.07;
          float spark = mix(step(thr, cell), 1.0 - thr, smoothstep(0.25, 1.0, fp * 3.4)) * pow(s, 6.0) * (0.35 + clusters);
          col += uSunCol * (pow(s, 220.0) * 6.0 + path * 0.35 + spark * 2.6) * uGlint * smoothstep(-0.12, 0.05, sd.y);
          // shore foam: lapping bands
          float lap = sin(shoreD * 0.9 - uTime * 1.3 + fbm(p0 * 0.2) * 3.0);
          float foam = smoothstep(0.75, 0.95, lap) * (1.0 - smoothstep(0.0, 14.0, shoreD));
          foam += 1.0 - smoothstep(0.0, 2.2 + sin(uTime * 0.8 + p0.x * 0.1) * 0.8, shoreD);
          foam *= smoothstep(0.35, 0.55, fbm(p0 * 0.6 + uTime * 0.1));
          col = mix(col, vec3(0.98, 0.97, 0.95) * (0.75 + 0.25 * uSunCol), clamp(foam, 0.0, 1.0) * 0.85);
          float f = smoothstep(uFogNear, uFogFar, dist);
          col = mix(col, uFog, f);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    // the ocean starts north of the beach (never under the park: the bowls are deeper than sea level)
    const g = new PlaneGeometry(6000, 3200, 140, 90);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -50 - 1600);
    this.mesh = new Mesh(g, this.mat);
    this.mesh.position.y = level;
    this.mesh.receiveShadow = false;
  }
  setNoise(oct: number, waves: number) { setDefines(this.mat, { NOISE_OCT: oct, OCEAN_WAVES: waves }); }
  apply(e: EnvState) {
    const u = this.mat.uniforms;
    u.uDeep.value.copy(e.deep); u.uShallow.value.copy(e.shallow); u.uSky.value.copy(e.zenith).lerp(e.mid, 0.4);
    u.uHorizon.value.copy(e.horizon); u.uFog.value.copy(e.fog); u.uFogNear.value = e.fogNear * 1.4; u.uFogFar.value = e.fogFar * 1.1;
    const night = e.sunDir.y < -0.02;
    u.uSunDir.value.copy(night ? e.lightDir : e.sunDir);
    u.uSunCol.value.copy(night ? new Color('#c8d2ff') : e.glow).multiplyScalar(night ? 0.6 : 1);
    u.uGlint.value = night ? 0.7 : 1.0;
  }
}

/** A few stars of light: lamp glow sprites drawn additively (bloom picks them up). */
export function glowPoints(positions: Vector3[], color: Color, size: number) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions.flatMap((p) => [p.x, p.y, p.z])), 3));
  const mat = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uColor: { value: color }, uSize: { value: size }, uIntensity: { value: 0 } },
    vertexShader: /* glsl */ `uniform float uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * 300.0 / -mv.z; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uIntensity; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * a * a * uIntensity, 1.0); }`,
  });
  return new Points(g, mat);
}
