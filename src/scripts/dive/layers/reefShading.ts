// The reef's surface, injected into a standard material: caustics rippling
// across upward-facing surfaces near the surface, and rock grain — four
// octaves of 3D value noise, 1.6 m down to 15 cm, darkening and lightening
// the albedo and bumping the normal. Without the grain a 3D rock face is
// smooth plaster at any distance (round 2 critique); with it, it is rock.
//
// The grain lives in the mesh's own (object) space: the wall and plateau
// are moved with the camera, so world-space noise would slide across them.
// Each octave fades out once a pixel covers a sizeable part of its
// wavelength, so distant rock never shimmers.

import type * as THREE from 'three';

/** Grain relief, metres, at full amplitude. */
const BUMP_M = 0.45;

const SHARED_GLSL = /* glsl */ `
  varying vec3 vReefLocal;
  varying vec3 vCausticWorld;
  varying float vCausticUp;
`;

const FRAGMENT_GLSL = /* glsl */ `
  uniform float uCausticTime;
  uniform float uCaustics;
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
`;

// Fades a mesh in from (and back out to) the fog colour, uEmerge 0 → 1, so
// a set piece arriving or leaving never pops even where the fog alone would
// not hide it.
const EMERGE_DECL = 'uniform float uEmerge;';
const EMERGE_APPLY = /* glsl */ `#include <fog_fragment>
  #ifdef USE_FOG
    gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, uEmerge);
  #endif`;

/** The fade from the fog alone, for the reef's other materials (fans). */
export function withEmerge(material: THREE.Material, uniforms: Record<string, THREE.IUniform>) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEmerge = uniforms.uEmerge;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${EMERGE_DECL}`)
      .replace('#include <fog_fragment>', EMERGE_APPLY);
  };
}

export function withReefShading(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SHARED_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vReefLocal = position;
        vCausticWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCausticUp = normalize(mat3(modelMatrix) * objectNormal).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SHARED_GLSL}\n${FRAGMENT_GLSL}\n${EMERGE_DECL}`)
      .replace('#include <fog_fragment>', EMERGE_APPLY)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float reefH = reefGrain(vReefLocal, length(fwidth(vReefLocal)));
        diffuseColor.rgb *= max(0.35, 1.0 + 1.8 * reefH);
        diffuseColor.rgb *= 1.0 + uCaustics * 2.2 * causticField(vCausticWorld.xz * 0.5, uCausticTime) * smoothstep(0.0, 0.6, vCausticUp);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Bump from the grain's screen-space derivatives (Mikkelsen),
          // with unnormalised surface derivatives so the relief is in metres.
          vec3 sx = dFdx(-vViewPosition);
          vec3 sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal);
          vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec2 dh = vec2(dFdx(reefH), dFdy(reefH)) * ${BUMP_M.toFixed(2)};
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`,
      );
  };
}
