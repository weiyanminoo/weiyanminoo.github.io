// Marine snow: the drifting flecks that make water read as a volume. Each
// fleck lives in a 30 m box that wraps around the camera, so its position
// is closed-form in (seed, time, camera) and computed on the GPU. Flecks
// within ~1.5 m of the lens are out of focus — larger, softer, fainter.
// Near the surface they flicker with caustic light (spec §6).

import * as THREE from 'three';
import { hash1 } from '../noise';
import type { Layer, LayerContext } from '../scene';
import { CAMERA_FOV_Y_DEG } from '../timeline';
import type { DiveFrame } from '../types';

const BOX_M = 30;
// A share of the flecks wrap in a much smaller box, so there are always a
// few within focus-blur range of the lens; spread over the 30 m box alone,
// almost none would be.
const NEAR_BOX_M = 6;
const NEAR_SHARE = 0.3;
const SEED = 505;
const TAN_HALF_FOV = Math.tan((CAMERA_FOV_Y_DEG * Math.PI) / 360);

const vertexShader = /* glsl */ `
  attribute vec3 aSeed;
  attribute vec3 aDrift;
  attribute float aSize;
  attribute float aBox;
  uniform float uTime;
  uniform vec3 uCam;
  uniform float uPixelScale;
  uniform float uFogDensity;
  varying float vNear;
  varying float vSeen;
  varying vec3 vWorld;
  void main() {
    // Wrap into a box centred on the camera (GLSL mod is floor-based, so
    // negative offsets wrap correctly).
    vec3 rel = mod(aSeed * aBox + aDrift * uTime - uCam, aBox) - aBox * 0.5;
    vec3 world = uCam + rel;
    vWorld = world;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    float dist = max(0.05, -mv.z);
    vNear = smoothstep(1.5, 0.3, dist);
    vSeen = exp(-pow(uFogDensity * dist, 2.0));
    gl_PointSize = aSize * uPixelScale / dist * (1.0 + 3.0 * vNear);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTint;
  uniform float uBright;
  uniform float uCaustics;
  uniform float uTime;
  varying float vNear;
  varying float vSeen;
  varying vec3 vWorld;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = 1.0 - smoothstep(mix(0.45, 0.0, vNear), 1.0, d);
    if (core <= 0.0) discard;
    // A cheap caustic network: bright where two drifting ripple fields
    // agree. Only matters near the surface (uCaustics → 0 by 25 m).
    vec2 p = vWorld.xz * 0.7;
    float c = abs(sin(p.x * 1.7 + uTime * 0.8) * sin(p.y * 1.3 - uTime * 0.6 + p.x * 0.4));
    float lit = uBright * (1.0 + uCaustics * 1.5 * pow(c, 4.0));
    float a = core * mix(0.75, 0.22, vNear) * vSeen;
    gl_FragColor = vec4(uTint * lit, a);
    #include <colorspace_fragment>
  }
`;

export default function createSnowLayer(): Layer {
  let ctx: LayerContext;
  let points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const tint = new THREE.Color();
  const buffer = new THREE.Vector2();

  return {
    id: 'snow',
    init(c) {
      ctx = c;
      const count = ctx.settings.snowCount;
      const seed = new Float32Array(count * 3);
      const drift = new Float32Array(count * 3);
      const size = new Float32Array(count);
      const box = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        box[i] = hash1(i, SEED + 7) < NEAR_SHARE ? NEAR_BOX_M : BOX_M;
        seed[i * 3] = hash1(i, SEED);
        seed[i * 3 + 1] = hash1(i, SEED + 1);
        seed[i * 3 + 2] = hash1(i, SEED + 2);
        // Slow: a few centimetres a second, mostly sinking.
        drift[i * 3] = (hash1(i, SEED + 3) - 0.5) * 0.06;
        drift[i * 3 + 1] = -0.02 - 0.04 * hash1(i, SEED + 4);
        drift[i * 3 + 2] = (hash1(i, SEED + 5) - 0.5) * 0.06;
        size[i] = 0.006 + 0.014 * hash1(i, SEED + 6) ** 2;
      }
      const geometry = new THREE.BufferGeometry();
      // Positions are computed in the shader; this attribute only sets the
      // vertex count.
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
      geometry.setAttribute('aDrift', new THREE.BufferAttribute(drift, 3));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geometry.setAttribute('aBox', new THREE.BufferAttribute(box, 1));
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
          uPixelScale: { value: 1 },
          uFogDensity: { value: 0.03 },
          uTint: { value: tint },
          uBright: { value: 1 },
          uCaustics: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 50;
      ctx.scene.add(points);
    },
    update(frame: DiveFrame) {
      const { ambient, caustics, fogDensity, transmittance } = frame.water;
      const u = points.material.uniforms;
      u.uTime.value = frame.timeS;
      (u.uCam.value as THREE.Vector3).copy(ctx.camera.position);
      ctx.renderer.getDrawingBufferSize(buffer);
      u.uPixelScale.value = buffer.y / 2 / TAN_HALF_FOV;
      u.uFogDensity.value = fogDensity;
      u.uBright.value = 0.35 + 0.65 * ambient;
      u.uCaustics.value = caustics;
      tint.setRGB(
        0.75 + 0.25 * transmittance[0],
        0.85 + 0.15 * transmittance[1],
        0.92,
        THREE.SRGBColorSpace,
      );
    },
    dispose() {
      points.geometry.dispose();
      points.material.dispose();
      ctx.scene.remove(points);
    },
  };
}
