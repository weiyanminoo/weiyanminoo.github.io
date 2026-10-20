// Light shafts: sunlight broken by the surface ripples into tall beams that
// reach down from the window and fade into the blue. Each beam is a thin
// plane turned about its own (slightly tilted) axis to face the camera, so it
// never reads as a flat card, with a scrolling noise mask breaking it up.
// Opacity follows water.shafts and is capped so beams never wash out the
// text in front of them (plan Task 8).

import * as THREE from 'three';
import { hash1, noise1 } from '../noise';
import type { Layer, LayerContext } from '../scene';
import type { DiveFrame } from '../types';

const COUNT = 9;
const LENGTH_M = 46;
const MAX_OPACITY = 0.25;
const SEED = 404;
// The sun is a little off vertical, so every beam leans the same way.
const LEAN = new THREE.Vector3(0.16, -1, 0.06).normalize();

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uOpacity;
  uniform vec3 uColour;
  uniform vec3 uCam;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying vec3 vWorld;

  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i.x + i.y * 57.0 + uSeed);
    float b = hash(i.x + 1.0 + i.y * 57.0 + uSeed);
    float c = hash(i.x + (i.y + 1.0) * 57.0 + uSeed);
    float d = hash(i.x + 1.0 + (i.y + 1.0) * 57.0 + uSeed);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    // Soft across the beam, strongest just below the surface (vUv.y = 1).
    float across = exp(-pow((vUv.x - 0.5) * 3.2, 2.0));
    float along = pow(vUv.y, 1.6);
    float mask = noise(vec2(vUv.x * 4.0, vUv.y * 9.0 - uTime * 0.25)) * 0.6
      + noise(vec2(vUv.x * 9.0 + uTime * 0.05, vUv.y * 22.0 - uTime * 0.6)) * 0.4;
    float dist = length(vWorld - uCam);
    float fogged = exp(-pow(uFogDensity * dist, 2.0));
    // Fade in from the surface, over more of the beam the farther it is:
    // a distant beam's top outlasted the fogged-out surface and hung in
    // mid-water as a hard line (round 3 critique).
    float band = 0.05 + dist * 0.004;
    float top = 1.0 - smoothstep(1.0 - band, 1.0, vUv.y);
    float a = across * along * top * smoothstep(0.25, 0.85, mask) * fogged * uOpacity;
    gl_FragColor = vec4(uColour, a);
    #include <colorspace_fragment>
  }
`;

export default function createShaftsLayer(): Layer {
  let ctx: LayerContext;
  const beams: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  const colour = new THREE.Color();
  const toCam = new THREE.Vector3();
  const side = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const along = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  return {
    id: 'shafts',
    init(c) {
      ctx = c;
      for (let i = 0; i < COUNT; i++) {
        const width = 0.8 + 2.2 * hash1(i, SEED);
        const geometry = new THREE.PlaneGeometry(width, LENGTH_M);
        // Pivot at the top edge, where the beam leaves the surface.
        geometry.translate(0, -LENGTH_M / 2, 0);
        const material = new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          uniforms: {
            uTime: { value: 0 },
            uSeed: { value: i * 13.7 },
            uOpacity: { value: 0 },
            uColour: { value: colour },
            uCam: { value: new THREE.Vector3() },
            uFogDensity: { value: 0.03 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = -4;
        beams.push(mesh);
        ctx.scene.add(mesh);
      }
    },
    update(frame: DiveFrame) {
      const { shafts, fogDensity, transmittance } = frame.water;
      const visible = shafts > 0.001;
      const cam = ctx.camera.position;
      colour.setRGB(0.55 + 0.35 * transmittance[0], 0.85, 0.95, THREE.SRGBColorSpace);
      beams.forEach((mesh, i) => {
        mesh.visible = visible;
        if (!visible) return;
        const angle = hash1(i, SEED + 1) * Math.PI * 2;
        const radius = 4 + 20 * hash1(i, SEED + 2);
        const sway = 0.4 * noise1(frame.timeS * 0.08 + i * 3.1, SEED + 3);
        mesh.position.set(cam.x + Math.cos(angle) * radius + sway, 0, cam.z + Math.sin(angle) * radius);
        // Face the camera around the beam's own leaning axis. A right-handed
        // basis: x across the beam, y up along it, z = x × y.
        toCam.copy(cam).sub(mesh.position);
        side.crossVectors(LEAN, toCam).normalize();
        along.copy(LEAN).negate();
        facing.crossVectors(side, along).normalize();
        basis.makeBasis(side, along, facing);
        mesh.quaternion.setFromRotationMatrix(basis);
        const u = mesh.material.uniforms;
        u.uTime.value = frame.timeS;
        u.uOpacity.value = Math.min(MAX_OPACITY, 0.25 * shafts);
        (u.uCam.value as THREE.Vector3).copy(cam);
        u.uFogDensity.value = fogDensity * 0.7;
      });
    },
    dispose() {
      for (const mesh of beams) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        ctx.scene.remove(mesh);
      }
    },
  };
}
