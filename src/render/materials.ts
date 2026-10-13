import {
  Color, DoubleSide, FrontSide, MeshLambertMaterial, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector3, Side,
  LinearMipmapLinearFilter,
} from 'three';

/** Uniforms shared by every stylised material (time of day drives them). */
export const shared = {
  uTime: { value: 0 },
  uLampIntensity: { value: 0 },
  uLampColor: { value: new Color(1.0, 0.72, 0.42) },
  uLampPos: { value: Array.from({ length: 16 }, () => new Vector3(0, -999, 0)) },
  uRimColor: { value: new Color(1.0, 0.75, 0.55) },
  uRimStrength: { value: 0.55 },
  uWind: { value: 1.0 },
  uDetail: { value: null as Texture | null },
  uWood: { value: null as Texture | null },
  uWarmth: { value: new Color(1, 1, 1) },
};

export interface ToonOpts {
  color?: number | Color;
  map?: Texture | null;
  vertexColors?: boolean;
  bands?: number; // 0 soft .. 1 hard cel
  wrap?: number;
  rim?: number;
  spec?: number;
  shininess?: number;
  emissive?: number | Color;
  emissiveIntensity?: number;
  side?: Side;
  detail?: 'concrete' | 'paint' | 'sand' | 'wood' | 'wall' | null;
  wind?: boolean;
  lamps?: boolean;
  transparent?: boolean;
  alphaTest?: number;
  fog?: boolean;
  name?: string;
}

const NOISE = /* glsl */ `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

let detailTex: Texture | null = null;
let woodTex: Texture | null = null;
export function loadSharedTextures(base: string) {
  const tl = new TextureLoader();
  detailTex = tl.load(base + 'textures/concrete_detail.webp');
  detailTex.wrapS = detailTex.wrapT = RepeatWrapping;
  detailTex.minFilter = LinearMipmapLinearFilter;
  woodTex = tl.load(base + 'textures/wood_planks.webp');
  woodTex.wrapS = woodTex.wrapT = RepeatWrapping;
  woodTex.colorSpace = SRGBColorSpace;
  woodTex.anisotropy = 4;
  shared.uDetail.value = detailTex;
  shared.uWood.value = woodTex;
}

export function toonMaterial(o: ToonOpts = {}): MeshLambertMaterial {
  const m = new MeshLambertMaterial({
    color: o.color ?? 0xffffff,
    map: o.map ?? null,
    vertexColors: !!o.vertexColors,
    side: o.side ?? FrontSide,
    transparent: !!o.transparent,
    alphaTest: o.alphaTest ?? 0,
    fog: o.fog ?? true,
  });
  if (o.emissive !== undefined) { m.emissive = new Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  m.name = o.name ?? 'toon';
  const bands = o.bands ?? 0.25, wrap = o.wrap ?? 0.35, rim = o.rim ?? 0.4, spec = o.spec ?? 0, shin = o.shininess ?? 40;
  const detail = o.detail ?? null;
  const key = `toon-${bands}-${wrap}-${rim}-${spec}-${shin}-${detail}-${o.wind ? 1 : 0}-${o.lamps !== false ? 1 : 0}`;
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.uniforms.uBands = { value: bands };
    sh.uniforms.uWrap = { value: wrap };
    sh.uniforms.uRim = { value: rim };
    sh.uniforms.uSpec = { value: spec };
    sh.uniforms.uShin = { value: shin };
    let vs = sh.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>
      varying vec3 vWorldPos; varying vec3 vWorldNrm;
      uniform float uTime; uniform float uWind;
      ${o.wind ? 'attribute vec3 windData;' : ''}`);
    if (o.wind) {
      // windData: x = phase, y = bend weight (0 at the base), z = flutter weight (leaf tips)
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float ph = windData.x + wp0.x * 0.05 + wp0.z * 0.04;
          float sway = sin(uTime * 0.9 + ph) * 0.6 + sin(uTime * 1.7 + ph * 1.3) * 0.25;
          float bend = windData.y * windData.y;
          transformed.x += sway * bend * 0.22 * uWind;
          transformed.z += cos(uTime * 0.7 + ph) * bend * 0.12 * uWind;
          float fl = sin(uTime * 5.3 + ph * 3.1 + position.x * 2.0) * windData.z;
          transformed.y += fl * 0.07 * uWind;
          transformed.x += fl * 0.04 * uWind;
        }`);
    }
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
        #endif
        wp = modelMatrix * wp;
        vWorldPos = wp.xyz;
        vWorldNrm = normalize(mat3(modelMatrix) * wn);
      }`);
    sh.vertexShader = vs;

    let fs = sh.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
      varying vec3 vWorldPos; varying vec3 vWorldNrm;
      uniform float uTime, uBands, uWrap, uRim, uSpec, uShin, uLampIntensity, uRimStrength;
      uniform vec3 uLampColor, uRimColor, uWarmth;
      uniform vec3 uLampPos[16];
      uniform sampler2D uDetail; uniform sampler2D uWood;
      ${NOISE}
      float toonRamp(float w){
        float b1 = smoothstep(0.38, 0.46, w);
        float b2 = smoothstep(0.72, 0.80, w) * 0.25;
        float banded = b1 * 0.8 + b2 + 0.0;
        return mix(w, banded, uBands);
      }
      vec3 triDetail(vec3 p, vec3 n, float s){
        vec3 a = abs(n); a = a / (a.x + a.y + a.z);
        return texture2D(uDetail, p.zy * s).rgb * a.x + texture2D(uDetail, p.xz * s).rgb * a.y + texture2D(uDetail, p.xy * s).rgb * a.z;
      }`);
    // stylised direct light: wrapped, banded diffuse + optional spec
    fs = fs.replace('#include <lights_lambert_pars_fragment>', `#include <lights_lambert_pars_fragment>
      void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
        float d = dot( geometryNormal, directLight.direction );
        float w = saturate( (d + uWrap) / (1.0 + uWrap) );
        float lum = max(max(directLight.color.r, directLight.color.g), directLight.color.b);
        vec3 irradiance = toonRamp(w) * directLight.color;
        reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
        if (uSpec > 0.0) {
          vec3 hv = normalize(directLight.direction + geometryViewDir);
          float sp = pow(saturate(dot(geometryNormal, hv)), uShin);
          sp = mix(sp, smoothstep(0.45, 0.55, sp), uBands);
          reflectedLight.directSpecular += directLight.color * sp * uSpec * step(0.0, d);
        }
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_Toon`);
    let detailCode = '';
    if (detail === 'concrete' || detail === 'wall') {
      detailCode = `
        {
          vec3 dt = triDetail(vWorldPos, vWorldNrm, ${detail === 'wall' ? '0.35' : '0.22'});
          float g = dot(dt, vec3(0.333));
          diffuseColor.rgb *= mix(1.0, 0.82 + 0.42 * g, 0.55);
          float st = fbm(vWorldPos.xz * 0.23 + vWorldPos.y * 0.3);
          float st2 = fbm(vWorldPos.xz * 1.7 + 4.0);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 0.84, 0.86), smoothstep(0.55, 0.8, st) * 0.6);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), smoothstep(0.4, 0.7, st2) * 0.35);
          ${detail === 'concrete' ? `
          if (vWorldNrm.y > 0.985) {
            vec2 gp = abs(fract(vWorldPos.xz / 3.0 + 0.5) - 0.5) * 3.0;
            float ln = 1.0 - smoothstep(0.006, 0.016, min(gp.x, gp.y));
            diffuseColor.rgb *= 1.0 - ln * 0.16;
            // skate marks (wheel scuffs)
            float sc = vnoise(vWorldPos.xz * vec2(0.6, 7.0) + vnoise(vWorldPos.xz * 0.3) * 5.0);
            diffuseColor.rgb *= 1.0 - smoothstep(0.82, 0.95, sc) * 0.07;
          }
          // sunken bowls: cooler deep end (fake occlusion) + a band of pool tiles under the coping
          if (vWorldPos.y < -0.015) {
            float depth = clamp(-vWorldPos.y / 2.3, 0.0, 1.0);
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.80, 0.82, 0.92), smoothstep(0.1, 1.0, depth) * 0.75);
            if (vWorldPos.y > -0.19 && abs(vWorldNrm.y) < 0.6) {
              vec2 tc = vec2((vWorldPos.x + vWorldPos.z) * 9.0, vWorldPos.y * 9.0);
              vec2 cell = floor(tc);
              vec2 fp = fract(tc);
              float grout = step(min(fp.x, fp.y), 0.08);
              float hv = h12(cell);
              vec3 tile = mix(vec3(0.16, 0.50, 0.66), vec3(0.24, 0.62, 0.72), hv);
              if (cell.y > -1.5) tile = mix(vec3(0.93, 0.93, 0.88), tile, 0.15);
              diffuseColor.rgb = mix(tile, vec3(0.85, 0.83, 0.8), grout);
            }
          }` : ''}
        }`;
    } else if (detail === 'paint') {
      detailCode = `
        {
          float n1 = fbm(vWorldPos.xz * 4.0 + vWorldPos.y * 6.0);
          float chip = smoothstep(0.66, 0.70, n1);
          vec3 conc = vec3(0.78, 0.75, 0.70) * (0.9 + 0.2 * triDetail(vWorldPos, vWorldNrm, 0.5).r);
          diffuseColor.rgb = mix(diffuseColor.rgb, conc, chip);
          diffuseColor.rgb *= 0.92 + 0.12 * fbm(vWorldPos.xz * 1.3 + vWorldPos.y);
        }`;
    } else if (detail === 'sand') {
      detailCode = `
        {
          float r = sin(vWorldPos.x * 1.7 + fbm(vWorldPos.xz * 0.3) * 6.0) * 0.5 + 0.5;
          float n = fbm(vWorldPos.xz * 0.8);
          diffuseColor.rgb *= 0.93 + 0.08 * r + 0.08 * n;
          float g = h12(floor(vWorldPos.xz * 40.0));
          diffuseColor.rgb *= 0.97 + 0.06 * g;
        }`;
    } else if (detail === 'wood') {
      detailCode = `
        {
          vec3 w = texture2D(uWood, vec2(vWorldPos.x * 0.33, vWorldPos.z * 0.33)).rgb;
          diffuseColor.rgb *= w * 1.35;
        }`;
    }
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
      ${detailCode}
      diffuseColor.rgb *= uWarmth;`);
    // rim + lamp pools
    fs = fs.replace('#include <opaque_fragment>', `
      {
        vec3 nW = normalize(vWorldNrm);
        vec3 vW = normalize(cameraPosition - vWorldPos);
        float fr = pow(1.0 - saturate(dot(nW, vW)), 3.0);
        outgoingLight += uRimColor * fr * uRim * uRimStrength * (0.35 + 0.65 * diffuseColor.rgb);
        ${o.lamps !== false ? `
        if (uLampIntensity > 0.001) {
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 16; i++) {
            vec3 lp = uLampPos[i];
            vec3 d = lp - vWorldPos;
            float dist = length(d);
            float fall = 1.0 / (1.0 + dist * dist * 0.045);
            fall *= smoothstep(16.0, 4.0, dist);
            float facing = saturate(dot(nW, d / max(dist, 1e-3)) * 0.7 + 0.3);
            acc += fall * facing;
          }
          outgoingLight += diffuseColor.rgb * uLampColor * acc * uLampIntensity;
        }` : ''}
      }
      #include <opaque_fragment>`);
    sh.fragmentShader = fs;
  };
  return m;
}

export function setMaterialSide(m: MeshLambertMaterial, double: boolean) { m.side = double ? DoubleSide : FrontSide; }
