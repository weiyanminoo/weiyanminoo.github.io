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

interface SchoolLook {
  /** Fish length, metres. */
  length: number;
  /** Progress window in which the school is in the film. */
  visible: readonly [number, number];
  /** The scroll pass s as a function of progress. */
  pass(progress: number): number;
  colour(y: number, z: number): [number, number, number];
  /** How much of its own colour survives the depth tint (0 = fully
   *  absorbed, 1 = none). A white-balanced camera keeps snapper yellow. */
  keepColour: number;
}

const LOOKS: Record<SchoolSpec['id'], SchoolLook> = {
  'open-blue': {
    length: 0.36,
    visible: [0.2, 0.34],
    pass: (p) => clamp((p - 0.24) / 0.08, 0, 1),
    // Countershaded: dark blue-grey back, silver belly.
    colour: (y) => {
      const t = smoothstep(0.02, -0.03, y);
      return [lerp(0.34, 0.86, t), lerp(0.44, 0.9, t), lerp(0.55, 0.93, t)];
    },
    keepColour: 0.6,
  },
  snapper: {
    length: 0.3,
    visible: [0.44, 0.6],
    pass: (p) => clamp((p - 0.46) / 0.12, 0, 1),
    // Bright yellow with thin blue lengthwise stripes.
    colour: (y) => {
      const stripe = smoothstep(0.84, 0.9, (((y + 0.2) * 30) % 1 + 1) % 1);
      return [lerp(0.98, 0.42, stripe), lerp(0.84, 0.64, stripe), lerp(0.2, 0.9, stripe)];
    },
    keepColour: 0.82,
  },
};

/** A fish pointing along +z, `length` long: lathe body flattened sideways
 *  plus a forked tail fin, vertex-coloured by `colour`. */
function fishGeometry(length: number, colour: SchoolLook['colour']): THREE.BufferGeometry {
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
  body.scale(0.5, 1, 1);

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
 *  offset per fish so a school never beats in unison. */
function withTailWave(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uLength;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float tailW = smoothstep(0.1, -0.7, transformed.z / uLength);
        transformed.x += sin(uTime * 9.0 + float(gl_InstanceID) * 1.7 + transformed.z * 7.0 / uLength)
          * 0.08 * uLength * tailW;`,
      );
  };
}

export default function createSchoolsLayer(): Layer {
  let ctx: LayerContext;
  const meshes: { spec: SchoolSpec; look: SchoolLook; mesh: THREE.InstancedMesh; time: THREE.IUniform }[] = [];
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
        withTailWave(material, { uTime: time, uLength: { value: look.length } });
        const count = Math.max(1, Math.floor(spec.count * ctx.settings.schoolScale));
        const mesh = new THREE.InstancedMesh(fishGeometry(look.length, look.colour), material, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        ctx.scene.add(mesh);
        meshes.push({ spec, look, mesh, time });
      }
    },
    update(frame: DiveFrame) {
      const { progress } = frame.state;
      const t = frame.water.transmittance;
      const cam = ctx.camera.position;
      for (const { spec, look, mesh, time } of meshes) {
        mesh.visible = progress >= look.visible[0] && progress <= look.visible[1];
        if (!mesh.visible) continue;
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
          pos.set(cam.x + pose.position[0], cam.y + pose.position[1], cam.z + pose.position[2]);
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
        ctx.scene.remove(mesh);
      }
    },
  };
}
