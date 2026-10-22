// The reef's surface, injected into a standard material:
//
//   grain     four octaves of 3D value noise, 1.6 m down to 15 cm,
//             darkening and lightening the albedo and bumping the normal.
//             Without it a 3D rock face is smooth plaster at any distance
//             (round 2 critique); with it, it is rock. Each octave fades
//             once a pixel covers a sizeable part of its wavelength, so
//             distant rock never shimmers.
//   mosaic    the living cover: colonies 20–60 cm across, drawn per pixel
//             over the rock, in the palette of the reference wall and slope
//             (Wei Yan's own clips 4 and 3; Komodo walls, Cannibal Rock):
//             pale encrusting and rubble, olive-gold growth, lime foliose
//             coral, and rarer red-magenta, purple, orange and teal. A
//             vertex attribute `life` (0..1) says how much of it a surface
//             carries, so the sand channels stay sand.
//   polyps    for the soft-coral trees: pale stalks, the colour in the
//             polyp clusters (the alpha map's red channel marks them).
//   photo     photographs of real rock, tri-planar: a lichen-crusted face
//             on the sides, coral rubble on whatever faces up. Their
//             colour (over its mean) modulates rock and cover alike, so the
//             colonies are textured growth rather than flat paint; their
//             normal maps add to the bump. Procedural cover alone read as
//             stylised however it was tuned (round 7).
//   caustics  rippling across upward-facing surfaces, as strong as each
//             surface's own depth allows (gone by 25 m)
//   depth     the reef darkens the further below the camera it falls, and
//             lifts a little above it: the light comes from the surface.
//   distance  colour absorbed over the water between surface and lens
//             (absorb.ts): vivid up close, blue-green beyond.

import type * as THREE from 'three';
import { SURFACE_CLEARANCE_M } from '../world';
import { withWaterOptics } from './absorb';

/** Grain relief, metres, at full amplitude. */
const BUMP_M = 0.45;
/** Metres below the camera over which the reef's light falls by e. */
const DARKEN_M = 30;

/** A photographed surface: colour map, its mean linear colour, normal map,
 *  and the metres of real surface one tile shows. */
export interface ReefPhoto {
  map: THREE.Texture;
  mean: readonly [number, number, number];
  normal: THREE.Texture;
  tileM: number;
  /** How much of the photo's own hue (over its mean's) the rock takes, 0..1;
   *  its light and dark it takes in full. */
  hue: number;
}

export interface ReefPhotos {
  /** Sides and undersides. */
  crust: ReefPhoto;
  /** Whatever faces up. */
  rubble: ReefPhoto;
}

const VERTEX_GLSL = /* glsl */ `
  attribute float life;
  attribute float rock;
  varying vec3 vReefLocal;
  varying vec3 vReefNormal;
  varying vec3 vCausticWorld;
  varying float vCausticUp;
  varying float vLife;
  varying float vRock;
`;

const FRAGMENT_GLSL = /* glsl */ `
  varying vec3 vReefLocal;
  varying vec3 vReefNormal;
  varying vec3 vCausticWorld;
  varying float vCausticUp;
  varying float vLife;
  varying float vRock;
  uniform float uCausticTime;
  uniform float uCamY;
  float causticLayer(vec2 p, float t) {
    vec2 q = p + vec2(sin(p.y * 1.3 + t * 0.7), cos(p.x * 1.1 - t * 0.6)) * 0.6;
    float a = abs(sin(q.x * 2.2 + t * 0.9) + sin(q.y * 2.6 - t * 0.8));
    return pow(max(0.0, 1.0 - a * 0.6), 6.0);
  }
  float causticField(vec2 p, float t) {
    return causticLayer(p, t) + 0.6 * causticLayer(p * 1.7 + 3.1, t * 1.3);
  }
  // A sin-free hash, stable across GPUs.
  float reefHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float reefNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(reefHash(i), reefHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(reefHash(i + vec3(0.0, 1.0, 0.0)), reefHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(reefHash(i + vec3(0.0, 0.0, 1.0)), reefHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(reefHash(i + vec3(0.0, 1.0, 1.0)), reefHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float reefNoise2(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(reefHash(vec3(i, 0.5)), reefHash(vec3(i + vec2(1.0, 0.0), 0.5)), f.x),
      mix(reefHash(vec3(i + vec2(0.0, 1.0), 0.5)), reefHash(vec3(i + vec2(1.0, 1.0), 0.5)), f.x),
      f.y);
  }
  float reefGrain(vec3 p, float footprint) {
    float h = 0.0;
    float amp = 0.5;
    float lambda = 1.6;
    for (int o = 0; o < 4; o++) {
      float keep = 1.0 - smoothstep(0.15 * lambda, 0.4 * lambda, footprint);
      h += amp * keep * (reefNoise(p / lambda + float(o) * 7.13) - 0.5);
      amp *= 0.55;
      lambda *= 0.45;
    }
    return h;
  }
  // One colony layer: where its noise field crosses 'edge', a patch of
  // 'tint', its outline warped so it is irregular as a living colony is,
  // and mottled inside (polyps, ridges) at six times its own scale — flat
  // fills with clean edges read as a painted map (round 6). Faded out once
  // a pixel spans a good part of a colony, so distant reef averages to its
  // rock tone instead of shimmering.
  // Each colony also stands up from the rock by 'height' metres, added to
  // 'lift', which the bump reads: lit on top, shadowed at its edge, so the
  // cover reads as growth rather than paint.
  vec3 colony(vec3 c, vec2 p, float footprint, float freq, float seed, float edge, vec3 tint, float cover, float height, inout float lift) {
    float keep = 1.0 - smoothstep(0.12, 0.35, footprint * freq);
    vec2 q = p * freq + seed;
    q += 0.6 * vec2(reefNoise2(q * 1.9 + 7.3), reefNoise2(q * 1.9 + 3.1)) - 0.3;
    float n = reefNoise2(q);
    float inside = smoothstep(edge, edge + 0.09, n);
    float k = inside * cover * keep;
    float mottle = 0.78 + 0.44 * reefNoise2(q * 6.0 + 1.7);
    lift += k * height * smoothstep(edge, edge + 0.2, n) * mottle;
    return mix(c, tint * mottle, k);
  }
  // The living cover, over the rock tone 'base', tinted like the rock by
  // the material colour 'ink' (the light's cast at this depth): colonies
  // 10–40 cm across, as on the reference reef, the common ones muted
  // (encrusting, olive-gold, lime, blue-green) and the saturated ones small
  // and rare (red-magenta, purple, orange).
  vec3 reefMosaic(vec3 base, vec3 ink, vec2 p, inout float lift) {
    float fp = length(fwidth(p));
    vec3 c = base;
    c = colony(c, p, fp, 4.5, 3.1, 0.5, ink * vec3(0.82, 0.85, 0.79), 0.75, 0.05, lift);
    c = colony(c, p, fp, 2.6, 11.7, 0.5, ink * vec3(0.62, 0.56, 0.32), 0.75, 0.1, lift);
    c = colony(c, p, fp, 1.8, 27.3, 0.7, ink * vec3(0.70, 0.70, 0.34), 0.8, 0.18, lift);
    c = colony(c, p, fp, 3.4, 91.2, 0.78, ink * vec3(0.46, 0.60, 0.56), 0.6, 0.08, lift);
    c = colony(c, p, fp, 6.0, 41.9, 0.86, ink * vec3(0.78, 0.22, 0.32), 0.9, 0.15, lift);
    c = colony(c, p, fp, 5.0, 57.1, 0.9, ink * vec3(0.52, 0.34, 0.58), 0.8, 0.12, lift);
    c = colony(c, p, fp, 7.0, 73.5, 0.88, ink * vec3(0.92, 0.52, 0.24), 0.9, 0.1, lift);
    return c;
  }
`;

const glslVec3 = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(4)).join(', ')})`;

function photoHeadGlsl(photos: ReefPhotos): string {
  return /* glsl */ `
  uniform sampler2D uCrustMap;
  uniform sampler2D uCrustNormal;
  uniform sampler2D uRubbleMap;
  uniform sampler2D uRubbleNormal;
  const float CRUST_M = ${photos.crust.tileM.toFixed(2)};
  const float RUBBLE_M = ${photos.rubble.tileM.toFixed(2)};
  const vec3 CRUST_MEAN = ${glslVec3(photos.crust.mean)};
  const vec3 RUBBLE_MEAN = ${glslVec3(photos.rubble.mean)};
  const float CRUST_HUE = ${photos.crust.hue.toFixed(2)};
  const float RUBBLE_HUE = ${photos.rubble.hue.toFixed(2)};
  // A photo's colour over its mean: its light and dark in full, its hue in
  // part. Over a warm mean, grey stones come out blue, and the rock's own
  // colour should lead.
  vec3 reefTone(vec3 c, vec3 mean, float hue) {
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    return mix(vec3(dot(c, LUMA) / dot(mean, LUMA)), c / mean, hue);
  }
  // A photograph tiled without a visible grid (Quilez, "texture repetition",
  // technique 3): two copies at offsets picked by a slow noise, cross-faded
  // along the image's own light and dark, so the fade does not read as a
  // blur. Explicit gradients: the offsets leave no mip seams. Returns the
  // colour; 'slope' is the relief's rise per metre along u and v, from the
  // normal map (tangent-space x and y over z).
  vec3 reefPhoto(sampler2D map, sampler2D nmap, vec2 uv, vec2 gx, vec2 gy, out vec2 slope) {
    float l = 8.0 * reefNoise2(uv * 0.15);
    float ia = floor(l);
    vec2 oa = vec2(reefHash(vec3(ia, 1.7, 3.1)), reefHash(vec3(ia, 5.3, 0.9)));
    vec2 ob = vec2(reefHash(vec3(ia + 1.0, 1.7, 3.1)), reefHash(vec3(ia + 1.0, 5.3, 0.9)));
    vec3 ca = textureGrad(map, uv + oa, gx, gy).rgb;
    vec3 cb = textureGrad(map, uv + ob, gx, gy).rgb;
    float b = smoothstep(0.3, 0.7, fract(l) - 0.15 * dot(ca - cb, vec3(1.0)));
    vec3 n = mix(textureGrad(nmap, uv + oa, gx, gy).xyz, textureGrad(nmap, uv + ob, gx, gy).xyz, b) * 2.0 - 1.0;
    slope = -n.xy / max(n.z, 0.3);
    return mix(ca, cb, b);
  }
`;
}

// Tri-planar in the mesh's own frame (the wall's is turned to face east, so
// its face is the z plane): each plane weighted by how squarely the surface
// faces it, planes that barely count skipped. Up-facing planes are rubble,
// the rest crust. It runs after the grain and the cover, so it textures the
// colonies as well as the rock between them.
const PHOTO_GLSL = /* glsl */ `
  {
    vec3 w = abs(normalize(vReefNormal));
    w *= w;
    w *= w;
    w /= w.x + w.y + w.z;
    vec3 dpx = dFdx(vReefLocal);
    vec3 dpy = dFdy(vReefLocal);
    vec3 photo = vec3(0.0);
    vec2 slope;
    if (w.z > 0.02) {
      vec2 k = vec2(1.0 / CRUST_M);
      vec3 c = reefPhoto(uCrustMap, uCrustNormal, vReefLocal.xy * k, dpx.xy * k, dpy.xy * k, slope);
      photo += w.z * reefTone(c, CRUST_MEAN, CRUST_HUE);
      reefPhotoDh += w.z * vec2(dot(slope, dpx.xy), dot(slope, dpy.xy));
    }
    if (w.x > 0.02) {
      vec2 k = vec2(1.0 / CRUST_M);
      vec3 c = reefPhoto(uCrustMap, uCrustNormal, vReefLocal.zy * k, dpx.zy * k, dpy.zy * k, slope);
      photo += w.x * reefTone(c, CRUST_MEAN, CRUST_HUE);
      reefPhotoDh += w.x * vec2(dot(slope, dpx.zy), dot(slope, dpy.zy));
    }
    if (w.y > 0.02) {
      if (vReefNormal.y > 0.0) {
        vec2 k = vec2(1.0 / RUBBLE_M);
        vec3 c = reefPhoto(uRubbleMap, uRubbleNormal, vReefLocal.xz * k, dpx.xz * k, dpy.xz * k, slope);
        photo += w.y * reefTone(c, RUBBLE_MEAN, RUBBLE_HUE);
      } else {
        vec2 k = vec2(1.0 / CRUST_M);
        vec3 c = reefPhoto(uCrustMap, uCrustNormal, vReefLocal.xz * k, dpx.xz * k, dpy.xz * k, slope);
        photo += w.y * reefTone(c, CRUST_MEAN, CRUST_HUE);
      }
      reefPhotoDh += w.y * vec2(dot(slope, dpx.xz), dot(slope, dpy.xz));
    }
    // Corals growing on the rock (plates, tables) keep their own smooth
    // tissue: the 'rock' attribute says how much of a surface is bare.
    diffuseColor.rgb *= mix(vec3(1.0), photo, vRock);
    reefPhotoDh *= vRock;
  }
`;

const GRAIN_GLSL = /* glsl */ `
  reefH = reefGrain(vReefLocal, length(fwidth(vReefLocal)));
  diffuseColor.rgb *= max(0.35, 1.0 + 1.8 * reefH);
`;

// Projected onto (x, y + z): a vertical face's own plane, and a level
// reef top's plane, from one expression. Any one projection streaks
// somewhere on a round head, so the heads carry little of this and more
// of the tri-planar photograph (reef.ts coralHead).
const MOSAIC_GLSL = /* glsl */ `
  diffuseColor.rgb = mix(
    diffuseColor.rgb,
    reefMosaic(diffuseColor.rgb, diffuse, vec2(vReefLocal.x, vReefLocal.y + vReefLocal.z), reefLift),
    0.8 * vLife);
`;

// The tree's stalks are pale; the colour is in its polyps.
const POLYPS_GLSL = /* glsl */ `
  #ifdef USE_ALPHAMAP
    diffuseColor.rgb = mix(diffuse * vec3(0.93, 0.88, 0.86), diffuseColor.rgb, texture2D(alphaMap, vAlphaMapUv).r);
  #endif
`;

// Caustics at the surface's own depth (halved: at 19 m the full web read as
// a sunlit swimming-pool floor, round 2), and the fall-off with depth below
// the camera.
const DEPTH_GLSL = /* glsl */ `
  {
    float causticDepth = -vCausticWorld.y - ${SURFACE_CLEARANCE_M.toFixed(1)};
    float caustics = 0.5 * (1.0 - smoothstep(0.0, 25.0, causticDepth));
    diffuseColor.rgb *= 1.0 + caustics * 2.2 * causticField(vCausticWorld.xz * 0.5, uCausticTime) * smoothstep(0.0, 0.6, vCausticUp);
    diffuseColor.rgb *= clamp(exp((vCausticWorld.y - uCamY) / ${DARKEN_M.toFixed(1)}), 0.25, 1.3);
  }
`;

const BUMP_GLSL = /* glsl */ `
  {
    // Bump from the grain's screen-space derivatives (Mikkelsen), with
    // unnormalised surface derivatives so the relief is in metres.
    vec3 sx = dFdx(-vViewPosition);
    vec3 sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal);
    vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec2 dh = vec2(dFdx(reefH), dFdy(reefH)) * ${BUMP_M.toFixed(2)} + vec2(dFdx(reefLift), dFdy(reefLift)) * vLife + reefPhotoDh;
    normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
  }
`;

export interface ReefShadingOptions {
  /** Rock grain and its bump. */
  grain?: boolean;
  /** The living cover (needs the `life` attribute). */
  mosaic?: boolean;
  /** Pale stalks, coloured polyps (soft-coral trees). */
  polyps?: boolean;
  /** Photographed rock under the grain and cover (needs the `rock`
   *  attribute). */
  photos?: ReefPhotos;
}

export function withReefShading(
  material: THREE.MeshStandardMaterial,
  uniforms: Record<string, THREE.IUniform>,
  opts: ReefShadingOptions = {},
) {
  const { grain = false, mosaic = false, polyps = false, photos } = opts;
  // Three caches programs by the hook's source text, the same for every
  // variant; the key keeps them apart.
  material.customProgramCacheKey = () => `reef-${+grain}${+mosaic}${+polyps}${+!!photos}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (photos) {
      Object.assign(shader.uniforms, {
        uCrustMap: { value: photos.crust.map },
        uCrustNormal: { value: photos.crust.normal },
        uRubbleMap: { value: photos.rubble.map },
        uRubbleNormal: { value: photos.rubble.normal },
      });
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vReefLocal = position;
        vReefNormal = objectNormal;
        vCausticWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCausticUp = normalize(mat3(modelMatrix) * objectNormal).y;
        vLife = ${mosaic ? 'life' : '0.0'};
        vRock = ${photos ? 'rock' : '0.0'};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_GLSL}${photos ? photoHeadGlsl(photos) : ''}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float reefH = 0.0;
        float reefLift = 0.0;
        vec2 reefPhotoDh = vec2(0.0);
        ${polyps ? POLYPS_GLSL : ''}${grain ? GRAIN_GLSL : ''}${mosaic ? MOSAIC_GLSL : ''}${photos ? PHOTO_GLSL : ''}${DEPTH_GLSL}`,
      );
    withWaterOptics(shader);
    if (grain || photos) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${BUMP_GLSL}`,
      );
    }
  };
}
