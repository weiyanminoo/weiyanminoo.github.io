// Schools of fish (schoolPaths.ts says where each fish is): instanced
// procedural fish — a laterally flattened lathe body and a tail fin —
// with a travelling tail wave in the vertex shader, so a school reads as
// a mass of swimming fish rather than particles. Lit by the reef layer's
// lights and faded by the scene fog like any other mesh.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep } from '../math';
import { hash1 } from '../noise';
import { SCHOOLS, fishPose, type SchoolSpec } from '../schoolPaths';
import type { Layer, LayerContext } from '../scene';
import type { DiveFrame } from '../types';
import { withWaterOptics } from './absorb';

// Where an out-of-window school parks its one still-drawn fish: well past
// the camera's 400 m far plane.
const PARKED_M = 5000;

interface SchoolLook {
  /** Fish length, metres. */
  length: number;
  /** Progress window in which the school is in the film. */
  visible: readonly [number, number];
  /** The scroll pass s as a function of progress. */
  pass(progress: number): number;
  colour(y: number, z: number): [number, number, number];
  /** Blue lengthwise stripes, drawn per pixel (vertex colours smeared
   *  them into blotches — round 2 critique). */
  stripes: boolean;
  /** How much of its own colour survives the depth tint (0 = fully
   *  absorbed, 1 = none). A white-balanced camera keeps snapper yellow. */
  keepColour: number;
  /** Body height and width, as multiples of the fusiform body's: tall and
   *  thin for a butterflyfish, low for a barracuda. */
  height?: number;
  width?: number;
  /** Three bars across the body in this colour, drawn per pixel. */
  bars?: readonly [number, number, number];
}

const LOOKS: Record<SchoolSpec['id'], SchoolLook> = {
  'open-blue': {
    length: 0.36,
    // Over the crest; in from far enough out in the haze not to pop.
    visible: [0.12, 0.38],
    pass: (p) => clamp((p - 0.24) / 0.08, 0, 1),
    // Countershaded: dark blue-grey back, silver belly.
    colour: (y) => {
      const t = smoothstep(0.02, -0.03, y);
      return [lerp(0.34, 0.86, t), lerp(0.44, 0.9, t), lerp(0.55, 0.93, t)];
    },
    stripes: false,
    keepColour: 0.8,
  },
  snapper: {
    length: 0.3,
    visible: [0.3, 0.52],
    pass: (p) => clamp((p - 0.36) / 0.12, 0, 1),
    // Bluestripe snapper: golden yellow above, pale below; the four blue
    // stripes are added per pixel in the shader.
    colour: (y) => {
      const t = smoothstep(-0.02, -0.07, y);
      return [lerp(0.92, 0.9, t), lerp(0.74, 0.86, t), lerp(0.22, 0.7, t)];
    },
    stripes: true,
    keepColour: 0.9,
  },
  jacks: {
    length: 0.6,
    visible: [0.84, 1],
    pass: (p) => clamp((p - 0.88) / 0.12, 0, 1),
    // Silver, a little darker above: in the deep blue jacks read as pale
    // flashes (grey-blue at 20 m they were lost in the haze).
    colour: (y) => {
      const t = smoothstep(0.02, -0.03, y);
      return [lerp(0.5, 0.85, t), lerp(0.55, 0.87, t), lerp(0.6, 0.88, t)];
    },
    stripes: false,
    keepColour: 0.75,
  },
  chromis: {
    length: 0.11,
    // Ahead of the camera over the reef top until it turns out over the
    // edge.
    visible: [0.3, 0.5],
    pass: (p) => clamp((p - 0.42) / 0.06, 0, 1),
    // Pale green-silver, as a chromis cloud catches the light: blue-green
    // fish were lost against the blue (round 8).
    colour: (y) => {
      const t = smoothstep(0.01, -0.03, y);
      return [lerp(0.7, 0.9, t), lerp(0.92, 0.96, t), lerp(0.8, 0.9, t)];
    },
    stripes: false,
    keepColour: 0.9,
  },
  anthias: {
    length: 0.13,
    // Down the face, from going over the edge to the deep wall.
    visible: [0.46, 0.86],
    pass: (p) => p,
    // Orange, paler below: the colour a wall dive is remembered by.
    colour: (y) => {
      const t = smoothstep(0.0, -0.05, y);
      return [lerp(0.98, 0.98, t), lerp(0.46, 0.68, t), lerp(0.26, 0.5, t)];
    },
    stripes: false,
    keepColour: 0.9,
  },
  // The reef's small fish are a size or two over life: from the camera's
  // line, 3–5 m above the reef top, life-size would be specks.
  clownfish: {
    length: 0.25,
    visible: [0.36, 0.5],
    pass: (p) => p,
    // Orange, three white bars.
    colour: (y) => {
      const t = smoothstep(0.0, -0.04, y);
      return [0.98, lerp(0.48, 0.62, t), lerp(0.08, 0.3, t)];
    },
    stripes: false,
    keepColour: 0.9,
    height: 1.25,
    width: 0.8,
    bars: [0.96, 0.96, 0.94],
  },
  wrasse: {
    length: 0.6,
    visible: [0.3, 0.5],
    pass: (p) => p,
    // A parrotfish: turquoise back, pink below.
    colour: (y) => {
      const t = smoothstep(0.01, -0.04, y);
      return [lerp(0.2, 0.74, t), lerp(0.64, 0.5, t), lerp(0.6, 0.62, t)];
    },
    stripes: false,
    keepColour: 0.85,
    height: 1.15,
  },
  butterfly: {
    length: 0.28,
    visible: [0.34, 0.5],
    pass: (p) => p,
    // Yellow, deep-bodied and thin, black bars.
    colour: (y) => {
      const t = smoothstep(0.0, -0.05, y);
      return [lerp(0.95, 0.96, t), lerp(0.78, 0.9, t), lerp(0.2, 0.6, t)];
    },
    stripes: false,
    keepColour: 0.9,
    height: 1.9,
    width: 0.5,
    bars: [0.12, 0.1, 0.1],
  },
  napoleon: {
    // A big one, as they get: seen from 9–13 m.
    length: 1.9,
    visible: [0.48, 0.62],
    pass: (p) => clamp((p - 0.5) / 0.1, 0, 1),
    // Dark green, paler below: a pale fish was lost against the blue.
    colour: (y) => {
      const t = smoothstep(0.0, -0.05, y);
      return [lerp(0.16, 0.36, t), lerp(0.38, 0.56, t), lerp(0.36, 0.5, t)];
    },
    stripes: false,
    keepColour: 0.7,
    height: 1.4,
    width: 1.1,
  },
  fusiliers: {
    length: 0.3,
    // With the manta, and gone before the shark (its pass starts at 0.66).
    visible: [0.55, 0.65],
    pass: (p) => clamp((p - 0.56) / 0.09, 0, 1),
    // Yellowback fusilier: blue, the back yellow.
    colour: (y) => (y > 0.03 ? [0.9, 0.78, 0.3] : [0.4, 0.58, 0.85]),
    stripes: false,
    keepColour: 0.5,
  },
  barracuda: {
    length: 0.75,
    // In from the haze ahead well after the shark, at 27–30 m; gone
    // behind and below before the window closes.
    visible: [0.73, 0.86],
    pass: (p) => clamp((p - 0.74) / 0.1, 0, 1),
    // Dark silver: silhouettes against the light.
    colour: (y) => {
      const t = smoothstep(0.01, -0.03, y);
      return [lerp(0.3, 0.5, t), lerp(0.34, 0.52, t), lerp(0.4, 0.56, t)];
    },
    stripes: false,
    keepColour: 0.3,
    height: 0.7,
    width: 0.7,
  },
  deepRiver: {
    length: 0.3,
    visible: [0.9, 1],
    pass: (p) => clamp((p - 0.9) / 0.1, 0, 1),
    colour: () => [0.2, 0.26, 0.34],
    stripes: false,
    keepColour: 0.2,
    height: 1.3,
  },
  deepBand: {
    length: 0.5,
    // From when the camera is turned to the wall, so the band is already
    // there in the blue when the camera turns back out to it.
    visible: [0.8, 1],
    pass: (p) => p,
    colour: () => [0.18, 0.24, 0.32],
    stripes: false,
    keepColour: 0.25,
    height: 1.2,
  },
};

/** A fish pointing along +z, `length` long: lathe body flattened sideways
 *  plus a forked tail fin, vertex-coloured by `colour`. */
function fishGeometry(length: number, colour: SchoolLook['colour'], height = 1, width = 1): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  // Enough rings and sides that lengthwise stripes stay lines rather than
  // smearing across large faces.
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Slim at the tail stalk, fullest a third back from the head.
    const r = 0.11 * Math.sin(Math.PI * Math.min(1, t * 1.04)) ** 0.75 * (t < 0.18 ? 0.45 + 0.55 * (t / 0.18) : 1);
    profile.push(new THREE.Vector2(Math.max(0.003, r), t - 0.5));
  }
  const body = new THREE.LatheGeometry(profile, 20);
  body.deleteAttribute('uv');
  // Lathe axis is y; turn it to z (head forward), then flatten sideways.
  body.rotateX(Math.PI / 2);
  body.scale(0.5 * width, height, 1);

  const fin = new THREE.BufferGeometry();
  fin.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, -0.45, 0, 0.14, -0.7, 0, 0.0, -0.6, 0, 0, -0.45, 0, 0.0, -0.6, 0, -0.14, -0.7]), 3),
  );
  fin.setIndex([0, 1, 2, 3, 4, 5]);
  fin.computeVertexNormals();

  const g = mergeGeometries([body, fin])!;
  g.scale(length, length, length);
  const pos = g.getAttribute('position');
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [r, gr, b] = colour(pos.getY(i) / length, pos.getZ(i) / length);
    colours.set([r, gr, b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}

/** The tail wave: a travelling sine, stronger towards the tail, phase-
 *  offset per fish so a school never beats in unison. With `stripes`, four
 *  thin blue lengthwise stripes, antialiased per pixel, on the body; with
 *  `bars`, three bars across it. */
function withTailWave(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>, look: SchoolLook) {
  const { stripes, bars } = look;
  // Three caches programs by the hook's source text, which is the same for
  // every school; without a key the snapper reused the unstriped program.
  material.customProgramCacheKey = () => `fish-${+stripes}-${bars ? bars.join(',') : 0}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uLength;\nvarying vec3 vFish;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFish = position / uLength;
        float tailW = smoothstep(0.1, -0.7, transformed.z / uLength);
        transformed.x += sin(uTime * 9.0 + float(gl_InstanceID) * 1.7 + transformed.z * 7.0 / uLength)
          * 0.08 * uLength * tailW;`,
      );
    // Colour lost over the water to the lens, as on the reef (absorb.ts).
    withWaterOptics(shader);
    if (!stripes && !bars) return;
    const pattern = stripes
      ? `{
          // Stripes 4 cm apart (in body lengths) from the belly line up,
          // a quarter of the spacing wide, on the body only (not the tail).
          float k = (vFish.y + 0.05) / 0.038;
          float d = abs(fract(k) - 0.5);
          float aa = fwidth(k);
          float line = 1.0 - smoothstep(0.12 - aa, 0.12 + aa, d);
          line *= step(0.0, k) * step(k, 4.0) * smoothstep(-0.42, -0.3, vFish.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.32, 0.85), line);
        }`
      : `{
          // Three bars across the body: behind the head, the middle, the
          // tail stalk (in body lengths from the centre, nose at +0.5).
          float bar = 0.0;
          float aa = fwidth(vFish.z);
          for (int i = 0; i < 3; i++) {
            float c = 0.3 - 0.28 * float(i);
            bar = max(bar, 1.0 - smoothstep(0.035 - aa, 0.035 + aa, abs(vFish.z - c)));
          }
          bar *= smoothstep(-0.42, -0.36, vFish.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${bars!.map((v) => v.toFixed(3)).join(', ')}), bar);
        }`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFish;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${pattern}`);
  };
}

export default function createSchoolsLayer(): Layer {
  let ctx: LayerContext;
  const meshes: {
    spec: SchoolSpec;
    look: SchoolLook;
    mesh: THREE.InstancedMesh;
    time: THREE.IUniform;
    capacity: number;
  }[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const forward = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();

  return {
    id: 'schools',
    init(c) {
      ctx = c;
      for (const spec of SCHOOLS) {
        const look = LOOKS[spec.id];
        const time = { value: 0 };
        const material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.45,
          metalness: 0.1,
          side: THREE.DoubleSide,
        });
        withTailWave(material, { uTime: time, uLength: { value: look.length } }, look);
        const count = Math.max(1, Math.floor(spec.count * ctx.settings.schoolScale));
        const mesh = new THREE.InstancedMesh(
          fishGeometry(look.length, look.colour, look.height, look.width),
          material,
          count,
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        ctx.scene.add(mesh);
        meshes.push({ spec, look, mesh, time, capacity: count });
      }
    },
    update(frame: DiveFrame) {
      const { progress } = frame.state;
      const t = frame.water.transmittance;
      const cam = ctx.camera.position;
      for (const { spec, look, mesh, time, capacity } of meshes) {
        const inWindow = progress >= look.visible[0] && progress <= look.visible[1];
        // Out of its window a school keeps drawing one fish, parked far
        // beyond the far plane (so it costs nothing), rather than stopping.
        // Measured: on ANGLE/D3D11, the first draw of the instanced fish
        // after any gap stalled the GPU for 100–230 ms — every time the
        // visitor scrolled back into a school (the frame-cost audit's
        // 38 fps). Never letting the draw go idle removes the stall.
        mesh.count = inWindow ? capacity : 1;
        if (!inWindow) {
          m.makeTranslation(cam.x, cam.y - PARKED_M, cam.z);
          mesh.setMatrixAt(0, m);
          mesh.instanceMatrix.needsUpdate = true;
          continue;
        }
        time.value = frame.timeS;
        // Absorbed with depth, but softened: a white-balanced camera still
        // shows the snapper yellow (ref 2, 2:05).
        (mesh.material as THREE.MeshStandardMaterial).color.setRGB(
          lerp(t[0], 1, look.keepColour),
          lerp(t[1], 1, look.keepColour),
          lerp(t[2], 1, look.keepColour),
          THREE.SRGBColorSpace,
        );
        const s = look.pass(progress);
        for (let i = 0; i < mesh.count; i++) {
          const pose = fishPose(spec, i, frame.timeS, s);
          pos.set(...pose.position);
          q.setFromUnitVectors(forward, dir.set(pose.heading[0], pose.heading[1], pose.heading[2]));
          const k = 0.8 + 0.4 * hash1(i, spec.seed + 9);
          m.compose(pos, q, scale.set(k, k, k));
          mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const { mesh } of meshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        // Frees the per-instance matrix buffer, which the geometry's dispose
        // does not.
        mesh.dispose();
        ctx.scene.remove(mesh);
      }
    },
  };
}
