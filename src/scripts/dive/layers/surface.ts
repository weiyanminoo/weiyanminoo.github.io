// The water surface seen from below. Inside Snell's window — rays meeting
// the surface within 48.6° of vertical — light from the sky refracts in and
// the surface is bright; outside it, total internal reflection mirrors the
// darker water below. A rippling height field bends the normal, so the
// window's edge shimmers. Crisp near the surface, a soft glow by ~10 m,
// gone by 30 m (plan Task 8).

import * as THREE from 'three';
import { smoothstep } from '../math';
import type { Layer, LayerContext } from '../scene';
import type { DiveFrame } from '../types';

const SIZE = 800;
// cos(48.6°): the critical angle for water to air.
const COS_CRITICAL = 0.661;
// The same slightly-off-vertical sun the light shafts lean away from.
const SUN_DIR = new THREE.Vector3(-0.16, 1, -0.06).normalize();

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uCam;
  uniform float uTime;
  uniform float uSlope;
  uniform float uCrisp;
  uniform float uFade;
  uniform vec3 uSky;
  uniform vec3 uBelow;
  uniform vec3 uSunDir;
  uniform float uFogDensity;
  varying vec3 vWorld;

  // Wind ripples, wavelengths of roughly 0.6–4 m: small enough that they
  // fringe the window's edge rather than bending the whole disc. Six waves
  // at uneven angles and frequencies, so the pattern never tiles into the
  // diamond lattice two crossed sines make.
  float wave(vec2 p, float angle, float k, float speed, float t) {
    return sin(dot(p, vec2(cos(angle), sin(angle))) * k + t * speed);
  }
  float height(vec2 p, float t) {
    return wave(p, 0.31, 1.7, 1.1, t) * 0.34
      + wave(p, 1.13, 2.3, 1.4, t) * 0.27
      + wave(p, 1.97, 3.1, 1.9, t) * 0.18
      + wave(p, 2.71, 4.3, 2.3, t) * 0.11
      + wave(p, 3.83, 5.9, 2.9, t) * 0.07
      + wave(p, 4.47, 8.1, 3.6, t) * 0.04;
  }

  void main() {
    vec3 ray = normalize(vWorld - uCam);
    vec2 p = vWorld.xz;
    float e = 0.03;
    float hx = height(p + vec2(e, 0.0), uTime) - height(p - vec2(e, 0.0), uTime);
    float hz = height(p + vec2(0.0, e), uTime) - height(p - vec2(0.0, e), uTime);
    // The upward normal, tilted by the ripples' slope (central differences).
    vec3 n = normalize(vec3(-hx / (2.0 * e) * uSlope, 1.0, -hz / (2.0 * e) * uSlope));
    float cosI = dot(ray, n);
    float edge = mix(0.1, 0.015, uCrisp);
    float window = smoothstep(${COS_CRITICAL} - edge, ${COS_CRITICAL} + edge, cosI);
    // Through the window: sky blue, a hot sun spot, and bright lines where
    // ripples focus the light.
    float sun = pow(max(dot(normalize(ray + (n - vec3(0.0, 1.0, 0.0)) * 2.0), uSunDir), 0.0), 90.0);
    float sparkle = pow(clamp(1.0 - abs(cosI - 0.93) * 6.0, 0.0, 1.0), 6.0) * uCrisp;
    vec3 sky = uSky * (0.9 + 0.35 * sparkle) + vec3(1.0) * sun * 1.4;
    vec3 col = mix(uBelow, sky, window);
    // Far away the surface simply vanishes into the water — no colour of its
    // own, so there is no edge where it meets the dome.
    float dist = length(vWorld - uCam);
    float seen = exp(-pow(uFogDensity * dist, 2.0));
    gl_FragColor = vec4(col, uFade * seen);
    #include <colorspace_fragment>
  }
`;

export default function createSurfaceLayer(): Layer {
  let ctx: LayerContext;
  let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  return {
    id: 'surface',
    init(c) {
      ctx = c;
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uCam: { value: new THREE.Vector3() },
          uTime: { value: 0 },
          uSlope: { value: 0.12 },
          uCrisp: { value: 1 },
          uFade: { value: 1 },
          uSky: { value: new THREE.Color() },
          uBelow: { value: new THREE.Color() },
          uSunDir: { value: SUN_DIR },
          uFogDensity: { value: 0.03 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const geometry = new THREE.PlaneGeometry(SIZE, SIZE);
      geometry.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = -5;
      ctx.scene.add(mesh);
    },
    update(frame: DiveFrame) {
      const { depth } = frame.state;
      const { fog, fogDensity, ambient } = frame.water;
      const fade = 1 - smoothstep(10, 30, depth);
      mesh.visible = fade > 0.001 && frame.state.insert === null;
      if (!mesh.visible) return;
      const u = mesh.material.uniforms;
      const cam = ctx.camera.position;
      (u.uCam.value as THREE.Vector3).copy(cam);
      mesh.position.set(cam.x, 0, cam.z);
      u.uTime.value = frame.timeS;
      u.uCrisp.value = 1 - smoothstep(2, 10, depth);
      // About 7° of ripple tilt at the surface, flattening with depth.
      u.uSlope.value = 0.12 * (0.3 + 0.7 * (1 - smoothstep(2, 14, depth)));
      u.uFade.value = fade;
      u.uFogDensity.value = fogDensity;
      // Sky through the window: a pale sky blue, dimming with depth.
      const sky = 0.75 + 0.25 * ambient;
      (u.uSky.value as THREE.Color).setRGB(0.6 * sky, 0.84 * sky, 0.98 * sky, THREE.SRGBColorSpace);
      // Outside the window the surface mirrors the water below it.
      (u.uBelow.value as THREE.Color).setRGB(fog[0] * 0.92, fog[1] * 0.95, fog[2], THREE.SRGBColorSpace);
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.material.dispose();
      ctx.scene.remove(mesh);
    },
  };
}
