import {
  Color, DoubleSide, FrontSide, MeshLambertMaterial, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector3, Vector4,
  Side, LinearMipmapLinearFilter, ShaderChunk, Matrix4,
} from 'three';

/** max street lamps with a light pool (shader array size) */
export const MAX_LAMPS = 28;

/** Street lamps: one cone shape shared by the shader light pools and the real (shadow casting) spot light. */
export const LAMP = {
  range: 15,
  angle: 1.12, // half angle of the cone (rad)
  penumbra: 0.6,
  intensity: 95, // candela at lamps = 1
};

/** Uniforms shared by every stylised material (time of day drives them). */
export const shared = {
  uTime: { value: 0 },
  uLampIntensity: { value: 0 },
  uLampColor: { value: new Color('#ffc283') },
  uLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new Vector3(0, -999, 0)) },
  /** index into uLampPos rendered by the real spot light instead of the shader pool (-1 = none) */
  uLampSkip: { value: -1 },
  uLampCone: { value: new Vector4(Math.cos(LAMP.angle), Math.cos(LAMP.angle * (1 - LAMP.penumbra)), LAMP.range, 0) },
  uRimColor: { value: new Color(1.0, 0.75, 0.55) },
  uRimStrength: { value: 0.55 },
  uWind: { value: 1.0 },
  uDetail: { value: null as Texture | null },
  uWood: { value: null as Texture | null },
  uWarmth: { value: new Color(1, 1, 1) },
  /** world-space direction towards the key light (the sun, or the moon at blue hour) */
  uSunDir: { value: new Vector3(0, 1, 0) },
  /** key light radiance (colour * intensity) */
  uSunColor: { value: new Color(1, 1, 1) },
  /** sky ambient: zenith, horizon on the sun side, horizon away from the sun, ground bounce (colour * intensity) */
  uSkyTop: { value: new Color(0.5, 0.5, 0.6) },
  uSkySun: { value: new Color(0.6, 0.5, 0.4) },
  uSkyAnti: { value: new Color(0.4, 0.45, 0.6) },
  uGroundBounce: { value: new Color(0.3, 0.25, 0.2) },
  /** the skater's own shadow map (heroShadow.ts): world -> (u, v, depth along the light) and
   *  (texel size m, penumbra width per metre behind the caster, map size or 0 = off, box half size m) */
  uHeroMap: { value: null as Texture | null },
  uHeroMat: { value: new Matrix4() },
  uHeroInfo: { value: new Vector4(0, 0, 0, 1) },
  /** warm light spilling out of a lit opening (the kiosk's service window): a line source A -> B (w = range m) lighting
   *  only the side in front of its wall plane (xyz = outward normal, w = offset); colour * intensity, black = off */
  uSpillA: { value: new Vector4(0, -999, 0, 6) },
  uSpillB: { value: new Vector4(0, -999, 0, 0) },
  uSpillPlane: { value: new Vector4(0, 0, 1, 0) },
  uSpillColor: { value: new Color(0, 0, 0) },
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
  detail?: 'concrete' | 'paint' | 'sand' | 'wood' | 'wall' | 'mural' | null;
  wind?: boolean;
  lamps?: boolean;
  transparent?: boolean;
  alphaTest?: number;
  fog?: boolean;
  name?: string;
  /** hair sheen + outline on the hair part of the character vertex colours (default: the skater and people bodies) */
  hair?: boolean;
  /** share of the direct (sun, moon, lamp) diffuse it takes; < 1 for dark rough stuff the sky fill would otherwise flatten */
  key?: number;
}

const NOISE = /* glsl */ `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h12(i), h12(i+vec2(1,0)), u.x), mix(h12(i+vec2(0,1)), h12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

/**
 * Sun shadows with receiver-plane depth bias: every PCF tap compares against the receiver's own plane, so wide soft
 * kernels stay acne-free at a grazing golden-hour sun without a large constant bias (which would detach contact shadows).
 */
const SUN_SHADOW_RPDB = /* glsl */ `
#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && ( NUM_SUN_LIGHT_SHADOWS > 0 || NUM_SPOT_LIGHT_SHADOWS > 0 )
  // Smooth separable tent PCF of radius R texels (1 <= R <= 3). The tent weight of every texel is folded into 3x3
  // bilinear compare taps (two texels per tap and axis), so the filter slides smoothly with the sub-texel position and
  // prints no pattern into the penumbra (a kernel rotated per screen pixel shows its rotation as a regular dot grid).
  // Each tap compares against the receiver plane at its own offset (dzduv; zero for no plane bias).
  float tentPCF( sampler2DShadow map, vec2 uv, float z, vec2 dzduv, float slope, vec2 size, float R ) {
    vec2 p = uv * size - 0.5, b = floor( p ), f = p - b, r = vec2( R );
    vec2 w0 = max( r - 2.0 - f, 0.0 ), w1 = max( r - 1.0 - f, 0.0 ), w2 = max( r - f, 0.0 );
    vec2 w3 = max( r - 1.0 + f, 0.0 ), w4 = max( r - 2.0 + f, 0.0 ), w5 = max( r - 3.0 + f, 0.0 );
    vec2 g0 = w0 + w1, g1 = w2 + w3, g2 = w4 + w5;
    vec2 t0 = ( b - 1.5 + w1 / max( g0, 1e-5 ) ) / size;
    vec2 t1 = ( b + 0.5 + w3 / max( g1, 1e-5 ) ) / size;
    vec2 t2 = ( b + 2.5 + w5 / max( g2, 1e-5 ) ) / size;
    #define TT( X, Y, WX, WY ) ( WX ) * ( WY ) * textureLod( map, vec3( X, Y, z + clamp( dot( dzduv, vec2( X, Y ) - uv ), -0.02, 0.02 ) - slope ), 0.0 )
    float s = TT( t0.x, t0.y, g0.x, g0.y ) + TT( t1.x, t0.y, g1.x, g0.y ) + TT( t2.x, t0.y, g2.x, g0.y )
      + TT( t0.x, t1.y, g0.x, g1.y ) + TT( t1.x, t1.y, g1.x, g1.y ) + TT( t2.x, t1.y, g2.x, g1.y )
      + TT( t0.x, t2.y, g0.x, g2.y ) + TT( t1.x, t2.y, g1.x, g2.y ) + TT( t2.x, t2.y, g2.x, g2.y );
    #undef TT
    return s / max( ( g0.x + g1.x + g2.x ) * ( g0.y + g1.y + g2.y ), 1e-5 );
  }
#endif
#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0 && defined( SHADOWMAP_TYPE_PCF )
  float toonSpotShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    float shadow = 1.0;
    shadowCoord.xyz /= shadowCoord.w;
    shadowCoord.z += shadowBias;
    bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
    if ( inFrustum && shadowCoord.z <= 1.0 )
      shadow = tentPCF( shadowMap, shadowCoord.xy, shadowCoord.z, vec2( 0.0 ), 0.0, shadowMapSize, clamp( shadowRadius * 0.866, 1.0, 3.0 ) );
    return mix( 1.0, shadow, shadowIntensity );
  }
  #define SPOT_SHADOW_FN toonSpotShadow
#else
  #define SPOT_SHADOW_FN getShadow
#endif
#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0 && defined( SHADOWMAP_TYPE_PCF )
  uniform sampler2D uHeroMap;
  uniform mat4 uHeroMat;
  uniform vec4 uHeroInfo;
  // one mip level of the skater map, reconstructed with a cubic B-spline from four bilinear taps (no bilinear diamonds)
  vec4 heroBspline( vec2 uv, float lod ) {
    float n = uHeroInfo.z * exp2( -lod );
    vec2 p = uv * n - 0.5, i = floor( p ), f = p - i, f2 = f * f, f3 = f2 * f;
    vec2 w0 = ( 1.0 - 3.0 * f + 3.0 * f2 - f3 ) / 6.0, w1 = ( 4.0 - 6.0 * f2 + 3.0 * f3 ) / 6.0;
    vec2 w2 = ( 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3 ) / 6.0, w3 = f3 / 6.0;
    vec2 g0 = w0 + w1, g1 = w2 + w3;
    vec2 t0 = ( i - 0.5 + w1 / g0 ) / n, t1 = ( i + 1.5 + w3 / g1 ) / n;
    return g0.x * g0.y * textureLod( uHeroMap, t0, lod ) + g1.x * g0.y * textureLod( uHeroMap, vec2( t1.x, t0.y ), lod )
      + g0.x * g1.y * textureLod( uHeroMap, vec2( t0.x, t1.y ), lod ) + g1.x * g1.y * textureLod( uHeroMap, t1, lod );
  }
  // near the caster: a 4x4 texel tent PCF on the raw map, each texel compared against the receiver plane
  float heroFine( vec2 uv, float t, vec2 dtduv, float bias ) {
    float n = uHeroInfo.z;
    vec2 p = uv * n - 0.5, b = floor( p );
    float occ = 0.0, ws = 0.0;
    for ( int j = -1; j <= 2; j ++ ) {
      for ( int i = -1; i <= 2; i ++ ) {
        vec2 k = b + vec2( float( i ), float( j ) ), dk = k - p;
        float w = max( 1.5 - abs( dk.x ), 0.0 ) * max( 1.5 - abs( dk.y ), 0.0 );
        vec4 s = texelFetch( uHeroMap, ivec2( clamp( k, vec2( 0.0 ), vec2( n - 1.0 ) ) ), 0 );
        float tz = t + clamp( dot( dtduv, dk / n ), -0.05, 0.05 ) - bias;
        occ += w * step( 0.5, s.x ) * step( s.y, tz );
        ws += w;
      }
    }
    return 1.0 - occ / ws;
  }
  // The skater's shadow: the penumbra grows with the distance between him and the receiver (a sun-sized light), so it
  // is crisp where he touches a surface and softens along a long ground shadow. lOff ignores occluders that close
  // along the light (self-shadow of a limb on itself).
  float heroShadow( vec3 wp, vec3 wn, float lOff ) {
    float n = uHeroInfo.z;
    if ( n < 1.0 ) return 1.0;
    float tx = uHeroInfo.x;
    vec3 h = ( uHeroMat * vec4( wp + wn * ( 1.5 * tx ) + uSunDir * lOff, 1.0 ) ).xyz;
    if ( h.x <= 0.0 || h.x >= 1.0 || h.y <= 0.0 || h.y >= 1.0 ) return 1.0;
    float maxLod = log2( n );
    // blocker search: coverage and mean depth of the casters within the widest penumbra this receiver could have
    float ls = clamp( log2( max( uHeroInfo.y * ( h.z + uHeroInfo.w ), tx ) / ( 1.65 * tx ) ) + 1.0, 2.0, maxLod - 1.0 );
    vec4 s = textureLod( uHeroMap, h.xy, ls );
    if ( s.x < 1e-3 ) return 1.0;
    float w = uHeroInfo.y * max( h.z - s.y / s.x, 0.0 );
    // mip level whose (B-spline) footprint spans that penumbra; 1.65 texels is the width of level 0
    float L = clamp( log2( max( w, 1e-5 ) / ( 1.65 * tx ) ), -1.0, maxLod - 2.0 );
    float vis = 1.0;
    if ( L < 1.0 ) {
      mat3 M3 = mat3( uHeroMat );
      vec3 dx = M3 * gDPdx, dy = M3 * gDPdy;
      float det = dx.x * dy.y - dx.y * dy.x;
      vec2 dtduv = abs( det ) > 1e-14 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
      vis = heroFine( h.xy, h.z, dtduv, 0.004 );
    }
    if ( L > 0.0 ) {
      float l0 = floor( L );
      vec4 m = mix( heroBspline( h.xy, l0 ), heroBspline( h.xy, l0 + 1.0 ), L - l0 );
      float cv = clamp( m.x, 0.0, 1.0 ) * smoothstep( -0.02, 0.05, h.z - m.y / max( m.x, 1e-4 ) );
      vis = mix( vis, 1.0 - cv, clamp( L, 0.0, 1.0 ) );
    }
    return vis;
  }
  float sunShadowPCF( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec3 sc, vec2 dzduv, float tight ) {
    float shadow = 1.0;
    sc.z += shadowBias;
    bool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;
    if ( inFrustum && sc.z <= 1.0 ) {
      vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
      // the hardware 2x2 compare reaches a texel either way of a tap
      float slopeTexel = abs( dzduv.x ) * texelSize.x * 0.5 + abs( dzduv.y ) * texelSize.y;
      float wide = 0.0, fine = 0.0;
      if ( tight < 1.0 ) {
        // ground and walls: smooth tent, as soft overall as the preset radius
        wide = tentPCF( shadowMap, sc.xy, sc.z, dzduv, abs( dzduv.x ) * texelSize.x + abs( dzduv.y ) * texelSize.y,
          shadowMapSize, clamp( shadowRadius * 0.866, 1.0, 3.0 ) );
      }
      if ( tight > 0.0 ) {
        // small curved shapes: a tight 3x3 tent on a fixed grid, smooth with no per-pixel rotation (a rotated kernel
        // as wide as a limb draws its penumbra as a dot grid)
        // (written out: FXC will not unroll a tap loop here and then warns about the shadow lookups)
        vec2 d = 0.75 * texelSize;
        float z0 = sc.z - slopeTexel, zx = clamp( dzduv.x * d.x, -0.02, 0.02 ), zy = clamp( dzduv.y * d.y, -0.02, 0.02 );
        #define TAP( i, j ) textureLod( shadowMap, vec3( sc.xy + vec2( i, j ) * d, z0 + ( i ) * zx + ( j ) * zy ), 0.0 )
        fine = ( 4.0 * TAP( 0.0, 0.0 ) + 2.0 * ( TAP( 1.0, 0.0 ) + TAP( -1.0, 0.0 ) + TAP( 0.0, 1.0 ) + TAP( 0.0, -1.0 ) )
          + TAP( 1.0, 1.0 ) + TAP( -1.0, -1.0 ) + TAP( 1.0, -1.0 ) + TAP( -1.0, 1.0 ) ) * 0.0625;
        #undef TAP
      }
      shadow = mix( wide, fine, tight );
    }
    return mix( 1.0, shadow, shadowIntensity );
  }
  float getSunShadowRPDB( sampler2DShadow shadowMap, SunLightShadow sunLightShadow, int shadowIndex ) {
    vec3 wp = vSunShadowWorldPosition.xyz;
    vec3 wn = normalize( vSunShadowWorldNormal );
    float viewDepth = vSunShadowWorldPosition.w;
    int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
    float shadow = 1.0, rimVis = 1.0;
    float ndl = dot( wn, uSunDir );
    // curvature of the receiver along the direction towards the sun (1/m), > 0 where it bends up towards the sun
    vec3 lt = uSunDir - wn * ndl;
    float a11 = dot( gDPdx, gDPdx ), a12 = dot( gDPdx, gDPdy ), a22 = dot( gDPdy, gDPdy );
    float det2 = a11 * a22 - a12 * a12;
    float bend = 0.0;
    if ( det2 > 1e-6 * a11 * a22 && dot( lt, lt ) > 1e-4 ) {
      vec2 ab = vec2( a22 * dot( gDPdx, lt ) - a12 * dot( gDPdy, lt ), a11 * dot( gDPdy, lt ) - a12 * dot( gDPdx, lt ) ) / det2;
      bend = -dot( ab.x * gDNdx + ab.y * gDNdy, uSunDir ) / dot( lt, lt );
    }
    // right at the terminator of such a bend the shadow map cannot resolve the surface (it runs along the light rays),
    // but the answer is known: the ray towards the sun meets the bend again after a chord of ~2 ndl / bend
    float bendLit = bend > 0.05 ? smoothstep( 0.08, 0.3, 2.0 * max( ndl, 0.0 ) / bend ) : 1.0;
    // small, strongly curved receivers (limbs, cloth folds, trunks, people) are no bigger than the wide kernel and
    // carry folds finer than a texel: ignore occluders a few cm along the light ray there, filter with the tight
    // kernel and leave the bend logic (meant for metre-scale ramps) out
    float small = smoothstep( 2.0, 6.0, gCurv );
    bendLit = mix( bendLit, 1.0, small );
    for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
      vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
      if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
        mat4 M = sunShadowMatrix[ cascadeOffset + i ];
        // world size of one shadow texel in this cascade: the normal offset scales with it
        float texelWorld = 1.0 / ( length( vec3( M[0][1], M[1][1], M[2][1] ) ) * sunLightShadow.shadowMapSize.y );
        float nOff = sunLightShadow.shadowNormalBias + texelWorld * 0.6, lOff = small * ( 0.025 + texelWorld );
        vec3 sc = ( M * vec4( wp + wn * nOff + uSunDir * lOff, 1.0 ) ).xyz;
        mat3 M3 = mat3( M );
        vec3 dx = M3 * gDPdx, dy = M3 * gDPdy;
        float det = dx.x * dy.y - dx.y * dy.x;
        vec2 dzduv = abs( det ) > 1e-16 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
        // only receivers facing the sun need the plane bias; on a back face it would only let light leak through
        // the occluder in front (a bowl wall turned away from the sun is in shadow anyway)
        float planeW = smoothstep( -0.05, 0.08, ndl );
        // where the surface bends up towards a grazing sun (the toe of a transition) the bend itself shadows the
        // receiver a chord of ~2 ndl / bend further on: keep the plane bias reach well inside that chord
        if ( bend > 1e-3 && ndl > 0.0 ) {
          float reach = ( sunLightShadow.shadowRadius + 1.0 ) * texelWorld / max( ndl, 0.01 );
          planeW *= mix( clamp( 1.6 * ndl / ( bend * reach ), 0.0, 1.0 ), 1.0, small );
        }
        dzduv = clamp( dzduv, vec2( -40.0 ), vec2( 40.0 ) ) * planeW;
        float cs = sunShadowPCF( shadowMap, sunLightShadow.shadowMapSize, sunLightShadow.shadowIntensity, sunLightShadow.shadowBias,
          sunLightShadow.shadowRadius, sc, dzduv, small );
        float bl = smoothstep( cascade.z, cascade.y, viewDepth );
        shadow = mix( cs, shadow, bl );
        #ifdef TOON_RIM
          // the backlight rim sits right on the terminator, where a surface shadows itself: test a point a little
          // towards the sun instead, so only real occluders (walls, other limbs) switch the rim off
          float rv = 1.0;
          if ( gCurv > 0.5 ) {
            vec3 sr = ( M * vec4( wp + uSunDir * 0.12 + wn * texelWorld, 1.0 ) ).xyz;
            if ( sr.x >= 0.0 && sr.x <= 1.0 && sr.y >= 0.0 && sr.y <= 1.0 && sr.z <= 1.0 )
              rv = textureLod( shadowMap, vec3( sr.xy, sr.z + sunLightShadow.shadowBias ), 0.0 );
          }
          rimVis = mix( rv, rimVis, bl );
        #endif
      }
    }
    // the skater is not in the cascades while his own map is on: his shadow (on himself too) comes from there
    float hero = heroShadow( wp, wn, 0.004 + 0.056 * small );
    #ifdef TOON_RIM
      // (his own head or torso right behind the rim point does not count, as with the cascades)
      if ( gCurv > 0.5 ) rimVis = min( rimVis, heroShadow( wp + uSunDir * 0.12, wn, 0.25 ) );
    #endif
    gRimVis = min( gRimVis, mix( 1.0, rimVis, sunLightShadow.shadowIntensity ) );
    shadow *= mix( 1.0, hero, sunLightShadow.shadowIntensity );
    return min( shadow, mix( 1.0, bendLit, sunLightShadow.shadowIntensity ) );
  }
  #define SUN_SHADOW_FN getSunShadowRPDB
#else
  #define SUN_SHADOW_FN getSunShadow
#endif
`;
const LIGHTS_BEGIN = ShaderChunk.lights_fragment_begin.replace(/getSunShadow\(/g, 'SUN_SHADOW_FN(')
  .replace(/getShadow\( spotShadowMap/g, 'SPOT_SHADOW_FN( spotShadowMap');
if (!LIGHTS_BEGIN.includes('SPOT_SHADOW_FN')) console.warn('toon: spot shadow filter hook not found');

let detailTex: Texture | null = null;
let woodTex: Texture | null = null;
export function loadSharedTextures(base: string) {
  const tl = new TextureLoader();
  detailTex = tl.load(base + 'textures/concrete_detail.webp');
  detailTex.wrapS = detailTex.wrapT = RepeatWrapping;
  detailTex.minFilter = LinearMipmapLinearFilter;
  detailTex.anisotropy = 8;
  woodTex = tl.load(base + 'textures/wood_planks.webp');
  woodTex.wrapS = woodTex.wrapT = RepeatWrapping;
  woodTex.colorSpace = SRGBColorSpace;
  woodTex.anisotropy = 8;
  shared.uDetail.value = detailTex;
  shared.uWood.value = woodTex;
}

const seedOf = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h / 9973; };

/** Concrete, park walls and house walls: texture, stains, slabs, joints, wear, bowls, sand, pores. */
function concreteCode(wall: boolean) {
  return /* glsl */ `
  {
    vec3 p = vWorldPos;
    vec3 n = gN;
    float fp = gFp;
    // concrete texture (triplanar, anisotropic); its contrast eases off with distance so it never turns into stripes
    vec3 dt = triDetail(p, n, ${wall ? '0.35' : '0.22'});
    float g = dot(dt, vec3(0.333));
    diffuseColor.rgb *= mix(1.0, 0.8 + 0.44 * g, mix(0.6, 0.24, smoothstep(0.006, 0.06, fp)));
    // broad stains and warm/cool mottling
    float st = fbm(p.xz * 0.23 + p.y * 0.3);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.88, 0.86, 0.89), smoothstep(0.55, 0.8, st) * 0.55);
    float st2 = fbm(p.xz * 0.8 + p.y * 0.5 + 4.0);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(1.035, 1.0, 0.95), smoothstep(0.42, 0.7, st2) * 0.35 * aaFade(1.2));
    gSheen = 0.07;
    ${wall ? `
    if (abs(n.y) < 0.5) {
      float sx = dot(p.xz, vec2(-n.z, n.x));
      // grimy band near the ground, rain streaks from the top
      float gn = fbm(vec2(sx * 1.3, p.y * 2.0) + 7.0);
      float grime = 1.0 - smoothstep(0.05, 0.6, p.y + (gn - 0.5) * 0.35);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72, 0.68, 0.64), grime * 0.7);
      float rs = vnoise(vec2(sx * 5.0, p.y * 0.35 + 9.0)) * smoothstep(0.3, 1.2, p.y);
      diffuseColor.rgb *= 1.0 - smoothstep(0.62, 0.9, rs) * 0.12 * aaFade(0.2);
    }` : `
    if (n.y > 0.92 && p.y > -0.05) {
      vec2 cid = floor(p.xz / 3.0);
      float hv = h12(cid + 0.5), hv2 = h12(cid * 1.73 + 7.31);
      // gentle patchy slab-to-slab tone
      diffuseColor.rgb *= (1.0 + (hv - 0.5) * 0.11) * mix(vec3(1.0), vec3(0.975, 0.99, 1.025), step(0.62, hv2));
      // darker patch repairs
      if (hv2 > 0.84) {
        vec2 lp = p.xz / 3.0 - cid;
        vec2 c0 = 0.12 + 0.3 * vec2(h12(cid + 3.1), h12(cid + 5.7));
        vec2 sz = vec2(0.28 + 0.4 * h12(cid + 9.2), 0.25 + 0.4 * h12(cid + 1.9));
        vec2 dq = abs(lp - c0 - sz * 0.5) - sz * 0.5;
        float bd = max(dq.x, dq.y) * 3.0;
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.82, 0.81, 0.83), 1.0 - smoothstep(-fp, fp, bd));
        diffuseColor.rgb *= 1.0 - 0.3 * lineAA(abs(bd), 0.003, fp);
      }
      // control joints every 3 m, box filtered so they never alias
      vec2 gp = abs(fract(p.xz / 3.0 + 0.5) - 0.5) * 3.0;
      vec2 fw = max(abs(dFdx(p.xz)) + abs(dFdy(p.xz)), vec2(1e-5));
      diffuseColor.rgb *= 1.0 - 0.3 * max(lineAA(gp.x, 0.008, fw.x), lineAA(gp.y, 0.008, fw.y));
      // a few hairline cracks
      float cm = smoothstep(0.6, 0.7, fbm(p.xz * 0.11 + 11.3));
      if (cm > 0.001) {
        vec2 q = p.xz * 0.8 + (vec2(vnoise(p.xz * 0.9), vnoise(p.xz * 0.9 + 5.3)) - 0.5) * 1.6;
        float cn = vnoise(q * 1.7);
        float gl = max(length(vec2(dFdx(cn), dFdy(cn))), 1e-6) / fp;
        diffuseColor.rgb *= 1.0 - 0.5 * cm * lineAA(abs(cn - 0.5) / gl, 0.0016, fp) * aaFade(0.03);
      }
      // black wheel and board scuffs
      float sc = vnoise(p.xz * vec2(0.55, 6.0) + vnoise(p.xz * 0.27) * 5.0);
      diffuseColor.rgb *= 1.0 - smoothstep(0.8, 0.95, sc) * 0.16 * aaFade(0.16);
    }
    // transitions and banks: dark wheel marks running up and down the slope
    if (n.y > 0.12 && n.y < 0.95) {
      vec2 hz = normalize(n.xz + vec2(1e-5));
      float across = dot(p.xz, vec2(-hz.y, hz.x));
      // each carve line drifts sideways as it climbs, so the marks fan out instead of standing in a comb
      across += (vnoise(vec2(across * 0.3, 1.7)) - 0.5) * 2.4 * p.y;
      float m = vnoise(vec2(across * 7.0, p.y * 0.9));
      m *= smoothstep(0.5, 0.8, vnoise(vec2(across * 0.6, p.y * 0.4) + 3.3));
      diffuseColor.rgb *= 1.0 - smoothstep(0.55, 0.85, m) * 0.24 * aaFade(0.14);
    }
    // sand blown in from the beach: drifts thicken towards the boardwalk (z = -23) and settle on flat and gentle tops
    if (p.y > -0.05 && n.y > 0.55) {
      float sz2 = smoothstep(-13.5, -22.6, p.z);
      if (sz2 > 0.0) {
        float dr = fbm(p.xz * vec2(0.45, 1.3) + vec2(1.7, 3.0)) * 0.8 + fbm(p.xz * 3.1 + 7.7) * 0.2 + sz2 * 0.3;
        float sandA = smoothstep(0.72 - 0.22 * sz2, 0.84 - 0.12 * sz2, dr) * smoothstep(0.0, 0.3, sz2) * smoothstep(0.55, 0.9, n.y);
        float grain = h12(floor(p.xz * 150.0));
        vec3 sandC = vec3(0.84, 0.66, 0.42) * (0.92 + 0.16 * mix(0.5, grain, aaFade(0.012)));
        diffuseColor.rgb = mix(diffuseColor.rgb, sandC, sandA * 0.92);
        gSheen *= 1.0 - sandA;
      }
    }
    // sunken bowls: near the lip a wall sees cool sky and the shaded bowl instead of the sunny deck; deeper down the
    // sky closes in and warm bounce from the sunlit wall opposite takes over (cool, darker lip -> warm, brighter low wall)
    if (p.y < -0.015) {
      float depth = clamp(-p.y / 2.3, 0.0, 1.0);
      gSkyVis = 1.0 - 0.3 * smoothstep(0.15, 1.0, depth);
      gGround = 0.35 + 0.25 * smoothstep(0.0, 0.5, depth);
      vec2 shz = normalize(uSunDir.xz + vec2(1e-5));
      float away = saturate(-dot(n.xz, shz));
      gBounce = uSunColor * (0.075 + 0.12 * away) * smoothstep(0.02, 0.6, depth) * smoothstep(-0.05, 0.25, uSunDir.y);
      if (p.y > -0.185 && abs(n.y) < 0.8) {
        if (p.y < -0.028) {
          bool zf = abs(n.z) > abs(n.x);
          float along = zf ? p.x : p.z;
          float seam = abs(abs(n.z) - abs(n.x));
          const float TS = 0.075;
          vec2 tc = vec2(along / TS, (p.y + 0.028) / TS);
          vec2 cell = floor(tc);
          vec2 f2 = fract(tc);
          vec2 ge = min(f2, 1.0 - f2) * TS;
          vec2 fwt = max(abs(dFdx(tc)) + abs(dFdy(tc)), vec2(1e-4)) * TS;
          float grout = max(lineAA(ge.x, 0.0035, fwt.x), lineAA(ge.y, 0.0035, fwt.y));
          grout = max(grout, 1.0 - smoothstep(0.0, 0.05, seam));
          float th = h12(cell + (zf ? 17.0 : 41.0));
          vec3 tile = mix(vec3(0.03, 0.2, 0.62), vec3(0.02, 0.42, 0.56), th);
          tile = mix(tile, vec3(0.45, 0.7, 0.82), step(0.88, h12(cell + 3.7)) * 0.7);
          tile *= 0.85 + 0.3 * h12(cell * 2.3 + 1.1);
          float chipT = step(0.93, h12(cell + 9.0)) * smoothstep(0.35, 0.6, vnoise(tc * 3.0));
          vec3 bandC = mix(tile, vec3(0.56, 0.53, 0.48), grout);
          bandC = mix(bandC, diffuseColor.rgb * 0.8, chipT);
          // dark grind marks and wax smears right under the coping
          float gm = vnoise(vec2(along * 1.3, 0.0)) * vnoise(vec2(along * 9.0, p.y * 60.0));
          bandC *= 1.0 - smoothstep(0.22, 0.5, gm) * smoothstep(-0.13, -0.03, p.y) * 0.65;
          diffuseColor.rgb = bandC;
          gSheen = 0.3 * (1.0 - grout) * (1.0 - chipT);
        } else {
          // the rounded arris under the coping catches the light
          float along2 = abs(n.z) > abs(n.x) ? p.x : p.z;
          diffuseColor.rgb *= 1.12 * (1.0 - 0.5 * smoothstep(0.3, 0.6, vnoise(vec2(along2 * 3.0, 0.5))));
          gSheen = 0.45;
        }
      }
    }`}
    // pores and grit: crisp right at the camera, faded before they can alias
    float pk = aaFade(0.03);
    if (pk > 0.001) {
      vec2 pp = abs(n.y) > 0.6 ? p.xz : (abs(n.x) > abs(n.z) ? p.zy : p.xy);
      float pore = smoothstep(0.8, 0.9, vnoise(pp * 230.0)) * aaFade(0.008);
      float gr = vnoise(pp * 70.0 + 13.0);
      float grit = (smoothstep(0.72, 0.86, gr) - smoothstep(0.16, 0.05, gr) * 0.7) * pk;
      diffuseColor.rgb *= (1.0 - 0.32 * pore) * (1.0 + 0.08 * grit);
    }
  }`;
}

const PAINT_CODE = /* glsl */ `
  {
    vec3 p = vWorldPos;
    float n1 = fbm(p.xz * 4.0 + p.y * 6.0);
    float cw = max(fwidth(n1), 0.012);
    float chip = smoothstep(0.68 - cw, 0.68 + cw, n1);
    vec3 conc = vec3(0.78, 0.75, 0.70) * (0.9 + 0.2 * triDetail(p, gN, 0.5).r);
    diffuseColor.rgb = mix(diffuseColor.rgb, conc, chip);
    diffuseColor.rgb *= 0.92 + 0.12 * fbm(p.xz * 1.3 + p.y);
    if (gN.y > 0.9) {
      // black board marks along the top
      float bm = vnoise(vec2(p.x * 1.6 + p.z * 0.3, p.z * 38.0));
      bm *= smoothstep(0.3, 0.7, vnoise(vec2(p.x * 0.5, p.z * 3.0) + 2.0));
      diffuseColor.rgb *= 1.0 - smoothstep(0.45, 0.75, bm) * 0.5 * aaFade(0.05);
    }
    gSheen = 0.05;
  }`;

const MURAL_CODE = /* glsl */ `
  {
    vec2 uv = vMapUv;
    vec3 p = vWorldPos;
    vec2 wp = vec2(dot(p.xz, vec2(-gN.z, gN.x)), p.y); // metres in the wall plane
    vec3 paintC = diffuseColor.rgb;
    // weathered matte paint: less saturated, chalky with dust, so in shade it sits at the value of the wall beside it
    float lum = dot(paintC, vec3(0.2126, 0.7152, 0.0722));
    paintC = mix(vec3(lum), paintC, 0.74) * 0.92 + vec3(0.06, 0.052, 0.045);
    vec3 dt = triDetail(p, gN, 0.35);
    float g = dot(dt, vec3(0.333));
    vec3 wallC = vec3(0.78, 0.66, 0.54) * (0.84 + 0.32 * g);
    // the concrete pores show through the paint
    paintC *= mix(1.0, 0.78 + 0.44 * g, 0.18 + 0.4 * aaFade(0.03));
    // sun-bleached patches
    float fade = smoothstep(0.48, 0.76, fbm(wp * 0.45 + 2.7 + uSeed * 9.0));
    paintC = mix(paintC, mix(vec3(dot(paintC, vec3(0.333))), paintC, 0.4) * 1.1 + 0.05, fade * 0.6);
    // chipped edges and flaking
    float edge = min(min(uv.x, 1.0 - uv.x) * 8.0, min(uv.y, 1.0 - uv.y) * 3.0);
    float fl = fbm(wp * 6.0 + 1.3 + uSeed * 5.0);
    float flw = max(fwidth(fl), 0.015);
    float th = 0.75 - 0.28 * (1.0 - smoothstep(0.0, 0.14, edge));
    vec3 col = mix(paintC, wallC, smoothstep(th - flw, th + flw, fl));
    // a few overlapping abstract tag scribbles (sprayed loops, no letters)
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      vec2 c = vec2(0.1 + 0.8 * h12(vec2(fk * 3.7, 1.3) + uSeed * 17.0), 0.22 + 0.3 * h12(vec2(fk * 5.1, 2.9) + uSeed * 13.0));
      float region = 1.0 - smoothstep(0.55, 1.0, length((uv - c) * vec2(2.6, 1.0) / vec2(0.2, 0.17)));
      if (region <= 0.0) continue;
      vec2 q = wp * (2.2 + fk * 0.5) + fk * 13.7 + uSeed * 31.0;
      q += (vec2(vnoise(q * 0.7), vnoise(q * 0.7 + 4.1)) - 0.5) * 1.5;
      float nv = vnoise(q) * 0.7 + vnoise(q * 2.1 + 3.0) * 0.3;
      float iso = abs(nv - 0.5);
      float fw = max(fwidth(nv), 1e-4);
      float stroke = 1.0 - smoothstep(0.032 - fw, 0.032 + fw, iso);
      float halo = 1.0 - smoothstep(0.05 - fw, 0.07 + fw, iso);
      vec3 tc = k == 0 ? vec3(0.02, 0.02, 0.025) : (k == 1 ? vec3(0.8, 0.8, 0.78) : vec3(0.5, 0.05, 0.12));
      col = mix(col, col * 0.75, halo * region * 0.4);
      col = mix(col, tc, stroke * region * 0.92);
    }
    // grimy, scuffed band near the ground
    float gn = fbm(wp * vec2(1.4, 2.5) + 5.0);
    float grime = 1.0 - smoothstep(0.2, 0.95, p.y + (gn - 0.5) * 0.4);
    col *= mix(vec3(1.0), vec3(0.6, 0.55, 0.5), grime * 0.85);
    float sm = vnoise(vec2(wp.x * 4.0, wp.y * 26.0)) * (1.0 - smoothstep(0.25, 0.8, p.y));
    col *= 1.0 - smoothstep(0.55, 0.85, sm) * 0.55 * aaFade(0.04);
    diffuseColor.rgb = col;
  }`;

const SAND_CODE = /* glsl */ `
  {
    vec3 p = vWorldPos;
    float r = sin(p.x * 1.7 + fbm(p.xz * 0.3) * 6.0) * 0.5 + 0.5;
    float n = fbm(p.xz * 0.8);
    diffuseColor.rgb *= 0.93 + 0.08 * mix(0.5, r, aaFade(3.7)) + 0.08 * n;
    float g = h12(floor(p.xz * 40.0));
    diffuseColor.rgb *= 0.97 + 0.06 * mix(0.5, g, aaFade(0.05));
  }`;

const WOOD_CODE = /* glsl */ `
  {
    vec3 w = texture2D(uWood, vec2(vWorldPos.x * 0.33, vWorldPos.z * 0.33)).rgb;
    diffuseColor.rgb *= w * 1.35;
    // sand drifts on the boardwalk, thickest on the beach side (z = -27.4)
    if (gN.y > 0.8 && vWorldPos.y < 0.1) {
      float sz = smoothstep(-23.5, -27.6, vWorldPos.z);
      float dr = fbm(vWorldPos.xz * vec2(0.5, 1.4) + 3.1) * 0.8 + fbm(vWorldPos.xz * 2.7) * 0.2 + sz * 0.3;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.66, 0.42), smoothstep(0.74 - 0.2 * sz, 0.86 - 0.1 * sz, dr) * sz * 0.85);
    }
  }`;

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
  const detail = o.detail === 'mural' && !o.map ? null : o.detail ?? null;
  const hair = !!o.vertexColors && (o.hair ?? (o.name === 'skaterVC' || o.name === 'personVC'));
  const key = `toon2-${bands}-${wrap}-${rim}-${spec}-${shin}-${detail}-${o.wind ? 1 : 0}-${o.lamps !== false ? 1 : 0}-${hair ? 1 : 0}`;
  const seed = seedOf(m.name);
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.uniforms.uBands = { value: bands };
    sh.uniforms.uWrap = { value: wrap };
    sh.uniforms.uRim = { value: rim };
    sh.uniforms.uSpec = { value: spec };
    sh.uniforms.uShin = { value: shin };
    sh.uniforms.uSeed = { value: seed };
    sh.uniforms.uKey = { value: o.key ?? 1 };
    let vs = (hair ? '#define TOON_HAIR\n' : '') + sh.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>
      varying vec3 vWorldPos; varying vec3 vWorldNrm;
      uniform float uTime; uniform float uWind;
      ${hair ? 'varying float vHair; varying vec3 vHairP; varying vec3 vHairN;' : ''}
      ${o.wind ? 'attribute vec3 windData;' : ''}`);
    if (hair) {
      // hair = the hair part of the character colours (#492e1c); people without a cap wear the cap in their hair colour,
      // so a dark, not bluish cap counts too. Runs after any per-person recolour of vColor (inserted right after the include).
      vs = vs.replace('#include <color_vertex>', `#include <color_vertex>
        vHair = 0.0;
        #ifdef USE_COLOR
        {
          vec3 dh = color.rgb - vec3(0.0667, 0.0275, 0.0118), dc = color.rgb - vec3(0.7843, 0.4353, 0.0431);
          float lum = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float capHair = (1.0 - smoothstep(0.05, 0.08, lum)) * (1.0 - smoothstep(0.15, 0.3, (vColor.b - vColor.r) / max(vColor.b, 1e-3)));
          vHair = max(step(dot(dh, dh), 0.0004), step(dot(dc, dc), 0.0004) * capHair);
        }
        #endif
        // rest pose, in metres: the strand pattern stays on the head however he moves
        vHairP = position * length(modelMatrix[0].xyz); vHairN = normal;`);
    }
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

    let fs = (rim > 0 ? '#define TOON_RIM\n' : '') + (hair ? '#define TOON_HAIR\n' : '') + sh.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
      varying vec3 vWorldPos; varying vec3 vWorldNrm;
      ${hair ? 'varying float vHair; varying vec3 vHairP; varying vec3 vHairN;' : ''}
      float gHair; float gStrand;
      uniform float uTime, uBands, uWrap, uRim, uSpec, uShin, uLampIntensity, uRimStrength, uSeed, uKey;
      uniform vec3 uLampColor, uRimColor, uWarmth, uSpillColor;
      uniform vec4 uSpillA, uSpillB, uSpillPlane;
      uniform vec3 uLampPos[${MAX_LAMPS}];
      uniform int uLampSkip;
      uniform vec4 uLampCone;
      uniform vec3 uSunDir, uSunColor, uSkyTop, uSkySun, uSkyAnti, uGroundBounce;
      uniform sampler2D uDetail; uniform sampler2D uWood;
      ${NOISE}
      // per-fragment values shared between the colour stage and the lighting functions
      vec3 gN; vec3 gDPdx; vec3 gDPdy; vec3 gDNdx; vec3 gDNdy; float gFp; float gCurv; float gSkyVis; float gGround; vec3 gBounce; float gSheen; float gRimVis;
      float toonRamp(float w){
        float b1 = smoothstep(0.38, 0.46, w);
        float b2 = smoothstep(0.72, 0.80, w) * 0.25;
        return mix(w, b1 * 0.8 + b2, uBands);
      }
      vec3 triDetail(vec3 p, vec3 n, float s){
        vec3 a = abs(n); a = a / (a.x + a.y + a.z);
        return texture2D(uDetail, p.zy * s).rgb * a.x + texture2D(uDetail, p.xz * s).rgb * a.y + texture2D(uDetail, p.xy * s).rgb * a.z;
      }
      // box-filtered coverage of a line of half width w at distance d, for a pixel footprint fw (all in metres)
      float lineAA(float d, float w, float fw){
        fw = max(fw, 1e-5);
        return max(0.0, min(d + 0.5 * fw, w) - max(d - 0.5 * fw, -w)) / fw;
      }
      // fades a pattern of the given period (metres) out before it gets smaller than a couple of pixels
      float aaFade(float period){ return 1.0 - smoothstep(period * 0.2, period * 0.55, gFp); }
      // sky light: the horizon on the sun side is warm, the opposite horizon cool, the zenith in between
      vec3 skyAmbient(vec3 n){
        vec2 sh = uSunDir.xz; float sl = length(sh); sh = sl > 1e-4 ? sh / sl : vec2(0.0, -1.0);
        float hz = length(n.xz);
        float toward = hz > 1e-4 ? dot(n.xz / hz, sh) : 0.0;
        vec3 horizon = mix(uSkyAnti, uSkySun, smoothstep(-0.75, 0.95, toward));
        vec3 sky = mix(horizon, uSkyTop, smoothstep(-0.2, 0.92, n.y));
        float skyW = 0.5 + 0.5 * n.y;
        return sky * skyW + uGroundBounce * (1.0 - skyW) * gGround;
      }`);
    // stylised light: wrapped banded diffuse, optional spec, concrete sheen and a sun-aware backlight rim
    fs = fs.replace('#include <lights_lambert_pars_fragment>', `#include <lights_lambert_pars_fragment>
      void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
        float d = dot( geometryNormal, directLight.direction );
        float w = saturate( (d + uWrap) / (1.0 + uWrap) );
        reflectedLight.directDiffuse += toonRamp(w) * directLight.color * BRDF_Lambert( material.diffuseColor ) * uKey;
        float nh = saturate(dot(geometryNormal, normalize(directLight.direction + geometryViewDir)));
        if (uSpec > 0.0) {
          float sp = pow(nh, uShin);
          sp = mix(sp, smoothstep(0.45, 0.55, sp), uBands);
          reflectedLight.directSpecular += directLight.color * sp * uSpec * step(0.0, d) * 0.5;
        }
        if (gSheen > 0.0) reflectedLight.directSpecular += directLight.color * pow(nh, 22.0) * smoothstep(0.0, 0.3, d) * gSheen;
        #ifdef TOON_HAIR
        if (gHair > 0.0) {
          // strands run down the head: a highlight band across them (Kajiya-Kay) rather than a plastic spot
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          vec3 tg = upV - geometryNormal * dot(geometryNormal, upV);
          float tl = length(tg);
          float th = tl > 1e-3 ? dot(tg / tl, normalize(directLight.direction + geometryViewDir)) : 0.0;
          float band = mix(pow(nh, 40.0), pow(max(1.0 - th * th, 0.0), 40.0), smoothstep(0.2, 0.6, tl));
          reflectedLight.directSpecular += directLight.color * band * smoothstep(-0.1, 0.35, d) * 0.05 * gHair * gStrand;
        }
        #endif
      }
      void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
        vec3 nW = inverseTransformDirection( geometryNormal, viewMatrix );
        reflectedLight.indirectDiffuse += ( skyAmbient( nW ) * gSkyVis + gBounce ) * BRDF_Lambert( material.diffuseColor );
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_Toon
      #undef RE_IndirectDiffuse
      #define RE_IndirectDiffuse RE_IndirectDiffuse_Toon`);
    fs = fs.replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
      ${SUN_SHADOW_RPDB}`);
    fs = fs.replace('#include <lights_fragment_begin>', `// toon: lights_fragment_begin (sun shadows with receiver plane bias)
      ${LIGHTS_BEGIN}`);
    let detailCode = '';
    if (detail === 'concrete' || detail === 'wall') detailCode = concreteCode(detail === 'wall');
    else if (detail === 'paint') detailCode = PAINT_CODE;
    else if (detail === 'mural') detailCode = MURAL_CODE;
    else if (detail === 'sand') detailCode = SAND_CODE;
    else if (detail === 'wood') detailCode = WOOD_CODE;
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
      gN = normalize(vWorldNrm);
      #ifdef DOUBLE_SIDED
        gN *= gl_FrontFacing ? 1.0 : -1.0;
      #endif
      gDPdx = dFdx(vWorldPos); gDPdy = dFdy(vWorldPos);
      gDNdx = dFdx(gN); gDNdy = dFdy(gN);
      gFp = max(max(length(gDPdx), length(gDPdy)), 1e-5);
      gCurv = length(abs(gDNdx) + abs(gDNdy)) / gFp;
      gSkyVis = 1.0; gGround = 1.0; gBounce = vec3(0.0); gSheen = 0.0; gRimVis = 1.0; gHair = 0.0;
      gStrand = 1.0;
      #ifdef TOON_HAIR
        gHair = vHair;
        if (gHair > 0.0) {
          // strands hang along the rest pose's up axis: fine strands and broader clumps, each faded before it can alias
          vec3 an = abs(normalize(vHairN)); an /= an.x + an.y + an.z;
          vec3 q = vHairP;
          float st = vnoise(vec2(q.x * 95.0 + q.z * 11.0, q.y * 7.0)) * an.z + vnoise(vec2(q.z * 95.0 + q.x * 11.0, q.y * 7.0)) * an.x + vnoise(q.xz * 60.0) * an.y;
          float cl = vnoise(vec2(q.x * 30.0 + q.z * 4.0, q.y * 3.0) + 7.0) * an.z + vnoise(vec2(q.z * 30.0 + q.x * 4.0, q.y * 3.0) + 7.0) * an.x + vnoise(q.xz * 22.0 + 7.0) * an.y;
          gStrand = (0.55 + 0.9 * mix(0.5, st, aaFade(0.012))) * (0.6 + 0.8 * mix(0.5, cl, aaFade(0.035)));
        }
      #endif
      ${detailCode}
      diffuseColor.rgb *= uWarmth;`);
    // specular (Lambert drops it), a faint cool sky rim, and the street lamp pools
    fs = fs.replace('#include <opaque_fragment>', `
      {
        outgoingLight += reflectedLight.directSpecular;
        vec3 nW = inverseTransformDirection(normal, viewMatrix);
        vec3 vW = normalize(cameraPosition - vWorldPos);
        float fr = pow(1.0 - saturate(dot(nW, vW)), 4.0);
        outgoingLight += uSkyTop * fr * uRim * 0.05 * gSkyVis * (0.4 + 0.6 * diffuseColor.rgb) * smoothstep(0.5, 3.0, gCurv);
        #ifdef TOON_RIM
        {
          // sun-aware backlight rim: a thin hot outline along the silhouette when the sun is behind the subject
          float edge = smoothstep(0.3, 0.85, 1.0 - saturate(dot(nW, vW)));
          float back = smoothstep(0.0, 0.8, dot(-vW, uSunDir));
          float lit = smoothstep(-0.7, 0.1, dot(nW, uSunDir));
          float r = edge * edge * back * lit * smoothstep(0.5, 3.0, gCurv) * uRim * uRimStrength * gRimVis;
          // hair tufts narrower than a few pixels turn their normal round within a pixel: a rim there only lights
          // single pixels along every tuft (a dotted outline), so it keeps to the smooth outline of the head
          r *= mix(1.0, 1.0 - smoothstep(0.22, 0.6, gCurv * gFp), gHair);
          // backlit hair glows through its outer strands whatever its colour
          outgoingLight += uSunColor * uRimColor * r * mix(0.4 + 0.6 * diffuseColor.rgb, vec3(0.75), gHair) * 0.65;
        }
        #endif
        #ifdef TOON_HAIR
        if (gHair > 0.0) {
          // dark hair shows mostly what it reflects: a soft sheen of the sky, stronger towards the silhouette, so it
          // keeps its shape and a lighter edge from every side (also from above, where the backlight rim never reaches)
          // (light that went through the outer strands picks up their colour, so brown hair stays brown)
          // the darker the hair, the more of what we see of it is this sheen
          float nv = saturate(dot(nW, vW));
          float dark = 1.9 - 0.9 * smoothstep(0.012, 0.035, dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
          // the grazing part only where the normal turns slowly across the pixel (the head's outline, not each tuft),
          // and little of it on hair facing down (a fringe under a brim sees the brim and the face, not the sky)
          float hAA = 1.0 - smoothstep(0.22, 0.6, gCurv * gFp);
          float fh = (0.045 + 0.4 * pow(1.0 - nv, 3.0) * hAA) * dark * mix(0.3, 1.0, smoothstep(-0.55, 0.3, nW.y));
          vec3 tint = diffuseColor.rgb / max(max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), 1e-4);
          vec3 sr = skyAmbient(reflect(-vW, nW));
          sr = mix(sr, vec3(dot(sr, vec3(0.2126, 0.7152, 0.0722))) * tint, 0.45);
          // strands show where the hair faces us; towards the outline the sheen stays one smooth band
          outgoingLight += sr * RECIPROCAL_PI * fh * gSkyVis * gHair * mix(1.0, gStrand, smoothstep(0.15, 0.6, nv) * hAA);
        }
        #endif
        ${o.lamps !== false ? `
        if (uLampIntensity > 0.001) {
          float acc = 0.0;
          float r2 = uLampCone.z * uLampCone.z;
          for (int i = 0; i < ${MAX_LAMPS}; i++) {
            if (i == uLampSkip) continue;
            vec3 lv = uLampPos[i] - vWorldPos;
            float d2 = dot(lv, lv);
            if (d2 > r2) continue;
            float dd = sqrt(d2);
            vec3 L = lv / dd;
            float spot = smoothstep(uLampCone.x, uLampCone.y, L.y);
            float att = pow2(saturate(1.0 - pow4(dd / uLampCone.z))) / max(d2, 0.01);
            acc += toonRamp(saturate((dot(nW, L) + uWrap) / (1.0 + uWrap))) * spot * att;
          }
          outgoingLight += diffuseColor.rgb * uLampColor * (acc * uLampIntensity * RECIPROCAL_PI);
        }
        if (uSpillColor.r + uSpillColor.g + uSpillColor.b > 0.001) {
          vec3 ab = uSpillB.xyz - uSpillA.xyz;
          vec3 lv = uSpillA.xyz + ab * saturate(dot(vWorldPos - uSpillA.xyz, ab) / max(dot(ab, ab), 1e-4)) - vWorldPos;
          float d2 = dot(lv, lv), dd = sqrt(d2);
          float front = smoothstep(-0.35, -0.1, dot(uSpillPlane.xyz, vWorldPos) - uSpillPlane.w);
          float att = pow2(saturate(1.0 - pow4(dd / uSpillA.w))) / (d2 + 0.35);
          float wl = toonRamp(saturate((dot(nW, lv / max(dd, 1e-4)) + uWrap) / (1.0 + uWrap)));
          outgoingLight += diffuseColor.rgb * uSpillColor * (wl * att * front * RECIPROCAL_PI);
        }` : ''}
      }
      #include <opaque_fragment>`);
    sh.fragmentShader = fs;
  };
  return m;
}

export function setMaterialSide(m: MeshLambertMaterial, double: boolean) { m.side = double ? DoubleSide : FrontSide; }
