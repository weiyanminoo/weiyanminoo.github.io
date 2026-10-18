// The lens. The scene renders to a target, then one full-screen pass gives
// the 3D water and (Task 15) the footage the same optics: dome-port barrel
// distortion, a touch of chromatic aberration towards the edges, vignette,
// film grain, and the thermocline — a band of refraction shimmer swept
// bottom to top by events.thermocline (plan Task 13). Grain is seeded by
// the frame clock, so a seeked frame is still deterministic.

import * as THREE from 'three';
import type { DiveFrame } from './types';

export interface DivePost {
  render(scene: THREE.Scene, camera: THREE.Camera, frame: DiveFrame): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform float uAspect;
  uniform float uGrainSeed;
  uniform float uThermo;
  uniform float uTime;
  varying vec2 vUv;

  const float BARREL = 0.04;
  const float ABERRATION = 0.002;
  const float VIGNETTE = 0.35;
  const float GRAIN = 0.035;
  const float BAND = 0.18;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 d = vUv - 0.5;
    vec2 a = vec2(d.x * uAspect, d.y);
    float r2 = dot(a, a);
    float rMax2 = 0.25 * (uAspect * uAspect + 1.0);
    // Barrel distortion, normalised so the corners still sample inside.
    vec2 uv = 0.5 + d * (1.0 + BARREL * r2) / (1.0 + BARREL * rMax2);

    // The thermocline: water of two temperatures refracting differently,
    // a shimmering band that the camera passes through. Refraction alone
    // is invisible over open blue, so the band also carries faint light
    // lines and a touch of milkiness, like heat haze.
    float w = 0.0;
    if (uThermo > 0.0 && uThermo < 1.0) {
      float centre = mix(-BAND, 1.0 + BAND, uThermo);
      w = 1.0 - smoothstep(0.0, BAND * 0.5, abs(uv.y - centre));
      uv.x += (sin(uv.y * 70.0 + uTime * 3.0) * 0.012 + sin(uv.y * 23.0 - uTime * 1.7) * 0.008) * w;
      uv.y += sin(uv.x * 40.0 + uTime * 2.2) * 0.005 * w;
    }

    vec2 dir = d * sqrt(r2) * 2.0;
    vec3 col;
    col.r = texture2D(tScene, uv + dir * ABERRATION).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - dir * ABERRATION).b;
    if (w > 0.0) {
      // Broad and broken up — a shimmer, never a drawn line.
      float shimmer = pow(0.5 + 0.5 * sin(uv.y * 55.0 + 2.5 * sin(uv.x * 6.0 + uTime * 0.7) + uTime * 2.0), 2.5)
        * (0.6 + 0.4 * sin(uv.x * 13.0 - uTime * 1.3));
      col = mix(col, col * 1.12 + 0.012, w * 0.6) + vec3(0.012, 0.018, 0.022) * shimmer * w;
    }
    col *= 1.0 - VIGNETTE * smoothstep(0.15, 1.0, r2 / rMax2);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    gl_FragColor.rgb += (hash(gl_FragCoord.xy + uGrainSeed * vec2(17.0, 23.0)) - 0.5) * GRAIN;
  }
`;

export function createPost(renderer: THREE.WebGLRenderer, w: number, h: number): DivePost {
  // Half-float where the GPU can render to it, to keep dark gradients from
  // banding; 8-bit otherwise (the grain hides most of it).
  const halfFloat =
    renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
    depthBuffer: true,
  });
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      tScene: { value: target.texture },
      uAspect: { value: 1 },
      uGrainSeed: { value: 0 },
      uThermo: { value: 0 },
      uTime: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const screen = new THREE.Scene();
  screen.add(quad);
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const resize = (cssW: number, cssH: number) => {
    const ratio = renderer.getPixelRatio();
    target.setSize(Math.max(1, Math.floor(cssW * ratio)), Math.max(1, Math.floor(cssH * ratio)));
    material.uniforms.uAspect.value = cssW / cssH;
  };
  resize(w, h);

  return {
    render(scene, camera, frame) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      const u = material.uniforms;
      u.uGrainSeed.value = Math.floor(frame.timeS * 24) % 1000;
      u.uThermo.value = frame.state.events.thermocline;
      u.uTime.value = frame.timeS;
      renderer.render(screen, screenCamera);
    },
    resize,
    dispose() {
      target.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}
