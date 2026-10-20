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
    float h0 = height(p, uTime);
    float hpx = height(p + vec2(e, 0.0), uTime);
    float hmx = height(p - vec2(e, 0.0), uTime);
    float hpz = height(p + vec2(0.0, e), uTime);
    float hmz = height(p - vec2(0.0, e), uTime);
    // The upward normal, tilted by the ripples' slope (central differences).
    vec3 n = normalize(vec3(-(hpx - hmx) / (2.0 * e) * uSlope, 1.0, -(hpz - hmz) / (2.0 * e) * uSlope));
    // Ripple troughs focus the light, crests spread it: moving bright cells
    // over the window and faint ones across the mirror outside it.
    float lap = (hpx + hmx + hpz + hmz - 4.0 * h0) / (e * e);
    float focus = clamp(1.0 + lap * uSlope * 0.8, 0.6, 1.6);
    float cosI = dot(ray, n);
    // The real refraction out into the air: the window holds the whole sky,
    // the horizon (hazy, bright) at its rim and the zenith at its centre;
    // transmission dims smoothly towards the critical angle, so the rim
    // darkens rather than ending in a cut-out edge (round 3 critique).
    vec3 t = refract(ray, -n, 1.333);
    float band = mix(0.2, 0.02, uCrisp);
    float window = dot(t, t) > 0.0 ? smoothstep(${COS_CRITICAL}, ${COS_CRITICAL} + band, cosI) : 0.0;
    vec3 out_ = normalize(t + vec3(0.0, 1e-4, 0.0));
    // The horizon-to-zenith gradient follows the flat surface: through the
    // rippled refraction it broke into large dark blobs.
    vec3 skyCol = mix(uSky * 1.15 + 0.04, uSky * 0.95, smoothstep(${COS_CRITICAL}, 0.97, ray.y));
    float sunDot = max(dot(out_, uSunDir), 0.0);
    // A hard disc near the surface; scattered into a soft glow with depth.
    float sun = pow(sunDot, mix(60.0, 600.0, uCrisp)) * mix(0.7, 3.0, uCrisp) + pow(sunDot, 16.0) * 0.2;
    vec3 sky = (skyCol + vec3(1.0) * sun) * mix(1.0, focus, uCrisp);
    vec3 below = uBelow * mix(1.0, 0.9 + 0.1 * focus, uCrisp * 0.5);
    vec3 col = mix(below, sky, window);
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
      mesh.visible = fade > 0.001;
      if (!mesh.visible) return;
      const u = mesh.material.uniforms;
      const cam = ctx.camera.position;
      (u.uCam.value as THREE.Vector3).copy(cam);
      mesh.position.set(cam.x, 0, cam.z);
      u.uTime.value = frame.timeS;
      u.uCrisp.value = 1 - smoothstep(2, 10, depth);
      // About 4° of ripple tilt at the surface, flattening with depth: more
      // broke the window into large dark blobs (round 3 critique).
      u.uSlope.value = 0.07 * (0.4 + 0.6 * (1 - smoothstep(2, 14, depth)));
      u.uFade.value = fade;
      u.uFogDensity.value = fogDensity;
      // Sky through the window: a pale sky blue, dimming with depth.
      const sky = 0.75 + 0.25 * ambient;
      (u.uSky.value as THREE.Color).setRGB(0.7 * sky, 0.88 * sky, 0.98 * sky, THREE.SRGBColorSpace);
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
