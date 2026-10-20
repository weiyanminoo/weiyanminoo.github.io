// Bubbles, in two kinds, all closed-form in the frame (spec §5):
//
//   exhale  every breath (breath.ts), a stream rises from below the lens —
//           the visitor's own regulator — along world up, so looking up you
//           watch your bubbles climb towards the surface
//   entry   the Dive-in back-roll: a dense cloud that clears (frame.entry)
//
// Positions are in camera space and projected directly, so the bubbles
// travel with the lens. Each is drawn as a glass sphere — dark refractive
// rim, bright inner ring, a specular highlight, clear centre — never an
// outline circle (spec §6 banned looks).

import * as THREE from 'three';
import { breathAt } from '../breath';
import { clamp, smoothstep } from '../math';
import { hash1 } from '../noise';
import type { Layer, LayerContext } from '../scene';
import { CAMERA_FOV_Y_DEG } from '../timeline';
import type { DiveFrame } from '../types';

const EXHALE_PER_BREATH = 18;
const ENTRY_COUNT = 600;
const MAX = EXHALE_PER_BREATH * 2 + ENTRY_COUNT;

const ENTRY_S = 1.2;
const EXHALE_FROM = 0.4;
const SEED_EXHALE = 101;
const SEED_ENTRY = 202;

const TAN_HALF_FOV = Math.tan((CAMERA_FOV_Y_DEG * Math.PI) / 360);

const vertexShader = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec2 aRadius;
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSoft;
  void main() {
    vUv = position.xy;
    vAlpha = aAlpha;
    // Close to the lens a bubble is out of focus.
    vSoft = smoothstep(0.9, 0.25, -aCenter.z);
    vec3 p = aCenter + vec3(position.xy * aRadius, 0.0);
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uRim;
  uniform vec3 uLit;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSoft;
  // Underwater a bubble is a mirror: total internal reflection makes it read
  // silver, brightest towards its edge (Fresnel), with a thin dark outer rim
  // and one hard highlight — a filled sphere, not a ring.
  void main() {
    float r = length(vUv);
    float edge = mix(0.04, 0.22, vSoft);
    float body = 1.0 - smoothstep(1.0 - edge, 1.0, r);
    if (body <= 0.0) discard;
    float silver = 0.22 + 0.55 * smoothstep(0.25, 0.92, r);
    float darkRim = smoothstep(0.86, 0.99, r);
    float spec = 1.0 - smoothstep(0.0, mix(0.2, 0.38, vSoft), length(vUv - vec2(-0.32, 0.36)));
    vec3 col = mix(uLit, uRim, darkRim * 0.85);
    col = mix(col, vec3(1.0), spec);
    float a = clamp(max(silver, darkRim * 0.8) + spec, 0.0, 1.0) * body * vAlpha;
    gl_FragColor = vec4(col, a * mix(1.0, 0.65, vSoft));
    #include <colorspace_fragment>
  }
`;

export default function createBubblesLayer(): Layer {
  let ctx: LayerContext;
  let mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  let centre: THREE.InstancedBufferAttribute;
  let radius: THREE.InstancedBufferAttribute;
  let alpha: THREE.InstancedBufferAttribute;
  const up = new THREE.Vector3();
  const rimColour = new THREE.Color();
  const litColour = new THREE.Color();
  let n = 0;

  const put = (x: number, y: number, z: number, rx: number, ry: number, a: number) => {
    if (a <= 0.001 || n >= MAX) return;
    centre.setXYZ(n, x, y, z);
    radius.setXY(n, rx, ry);
    alpha.setX(n, a);
    n++;
  };

  // The visitor's own exhaled bubbles: this breath's and the last one's,
  // which may still be rising during the next inhale.
  const writeExhale = (timeS: number) => {
    const b = breathAt(timeS);
    for (const [cycle, phase] of [
      [b.cycle - 1, b.phase + 1],
      [b.cycle, b.phase],
    ] as const) {
      for (let i = 0; i < EXHALE_PER_BREATH; i++) {
        const s = cycle * 97 + i;
        // Emitted over the first half of the exhale; age in seconds.
        const age = (phase - EXHALE_FROM - (i / EXHALE_PER_BREATH) * 0.3) * 5;
        if (age < 0 || age > 3.2) continue;
        const side = hash1(s, SEED_EXHALE) < 0.5 ? -1 : 1;
        const sx = side * (0.18 + 0.4 * hash1(s, SEED_EXHALE + 1));
        const sz = -(0.55 + 0.9 * hash1(s, SEED_EXHALE + 2));
        const sy = -0.75 - 0.2 * hash1(s, SEED_EXHALE + 3);
        const speed = 0.8 + 0.5 * hash1(s, SEED_EXHALE + 4);
        const r0 = 0.01 + 0.025 * hash1(s, SEED_EXHALE + 5) ** 2;
        const rise = speed * age;
        const wob = Math.sin(age * 8 + s);
        const r = r0 * (1 + 0.3 * clamp(age / 2, 0, 1));
        const a = smoothstep(0, 0.1, age) * (1 - smoothstep(2.0, 2.8, rise));
        put(
          sx + up.x * rise + 0.025 * wob,
          sy + up.y * rise,
          sz + up.z * rise,
          r * (1 + 0.12 * wob),
          r * (1 - 0.12 * wob),
          a,
        );
      }
    }
  };

  // The back-roll entry: a frame-filling cloud that rises and clears.
  const writeEntry = (entry: number, aspect: number) => {
    if (entry <= 0 || entry >= 1) return;
    const age = entry * ENTRY_S;
    const a = 1 - smoothstep(0.3, 1.0, entry);
    for (let j = 0; j < ENTRY_COUNT; j++) {
      const z = -(0.3 + 2.7 * hash1(j, SEED_ENTRY) ** 1.5);
      const half = TAN_HALF_FOV * -z * 1.15;
      const x = (hash1(j, SEED_ENTRY + 1) * 2 - 1) * half * aspect;
      const y = (hash1(j, SEED_ENTRY + 2) * 2 - 1) * half - 0.4 * -z * (1 - entry);
      const rise = age * (1.5 + hash1(j, SEED_ENTRY + 3));
      const r = (0.01 + 0.05 * hash1(j, SEED_ENTRY + 4) ** 2) * (1 + 0.2 * entry);
      put(x + up.x * rise, y + up.y * rise, z + up.z * rise, r, r, a);
    }
  };

  return {
    id: 'bubbles',
    init(c) {
      ctx = c;
      const base = new THREE.PlaneGeometry(2, 2);
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.index = base.index;
      geometry.setAttribute('position', base.getAttribute('position'));
      centre = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      radius = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
      alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
      for (const attr of [centre, radius, alpha]) attr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aCenter', centre);
      geometry.setAttribute('aRadius', radius);
      geometry.setAttribute('aAlpha', alpha);
      geometry.instanceCount = 0;
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uRim: { value: rimColour }, uLit: { value: litColour } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 100;
      ctx.scene.add(mesh);
    },
    update(frame) {
      const { camera } = ctx;
      camera.updateMatrixWorld();
      up.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
      const { fog, ambient } = frame.water;
      rimColour.setRGB(fog[0] * 0.3, fog[1] * 0.35, fog[2] * 0.4, THREE.SRGBColorSpace);
      const lit = 0.55 + 0.45 * ambient;
      litColour.setRGB(0.82 * lit, 0.94 * lit, lit, THREE.SRGBColorSpace);
      n = 0;
      writeExhale(frame.timeS);
      writeEntry(frame.entry, camera.aspect);
      mesh.geometry.instanceCount = n;
      centre.needsUpdate = true;
      radius.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.material.dispose();
      ctx.scene.remove(mesh);
    },
  };
}
