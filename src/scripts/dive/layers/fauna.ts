// The two big animals (faunaPaths.ts says where), built procedurally —
// no downloaded models (plan deviation). Both are only ever seen at
// distance, through haze or against the light, so silhouette and motion
// carry them:
//
//   manta  a flat grid cut to a manta's planform in the fragment shader
//          (wings, cephalic fins, tail), wings rippling on a ~3.5 s beat;
//          pale belly with dark margins, as seen from below
//   shark  a lathe body with dorsal, pectoral and tail fins, its body
//          swaying from the tail on a ~1.6 s beat; countershaded
//
// Each is in the film only while its pass event is strictly between 0 and 1.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MANTA_SPAN_M, SHARK_LENGTH_M, mantaPath, sharkPath } from '../faunaPaths';
import { lerp } from '../math';
import type { Layer, LayerContext } from '../scene';
import type { DiveFrame, Vec3 } from '../types';

const MANTA_BEAT_S = 3.5;
const SHARK_BEAT_S = 1.6;

function triangle(a: Vec3, b: Vec3, c: Vec3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3));
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return g;
}

function sharkGeometry(): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    // Thin caudal stalk, fullest about a third back from a pointed snout.
    const r = 0.12 * Math.sin(Math.PI * t ** 0.85) ** 0.9 * (t < 0.12 ? 0.35 + 0.65 * (t / 0.12) : 1);
    profile.push(new THREE.Vector2(Math.max(0.004, r), t - 0.5));
  }
  const body = new THREE.LatheGeometry(profile, 16);
  body.deleteAttribute('uv');
  body.rotateX(Math.PI / 2);
  body.scale(0.75, 0.85, 1);
  const parts = [
    body,
    // Dorsal fin.
    triangle([0, 0.09, 0.06], [0, 0.36, -0.08], [0, 0.09, -0.18]),
    // Pectoral fins, swept back.
    triangle([-0.07, -0.04, 0.16], [-0.42, -0.15, -0.06], [-0.07, -0.05, 0.0]),
    triangle([0.07, -0.04, 0.16], [0.07, -0.05, 0.0], [0.42, -0.15, -0.06]),
    // Tail: tall upper lobe, short lower one.
    triangle([0, 0, -0.47], [0, 0.3, -0.68], [0, 0.03, -0.56]),
    triangle([0, 0, -0.47], [0, -0.02, -0.55], [0, -0.17, -0.62]),
  ];
  const g = mergeGeometries(parts)!;
  g.scale(SHARK_LENGTH_M, SHARK_LENGTH_M, SHARK_LENGTH_M);
  const pos = g.getAttribute('position');
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // A grey reef shark's pale bronze-grey back, white belly: against the
    // deep blue it reads light, as the reference's shark does.
    const belly = pos.getY(i) / SHARK_LENGTH_M < -0.02 ? 1 : 0;
    colours.set([lerp(0.62, 0.92, belly), lerp(0.64, 0.92, belly), lerp(0.66, 0.92, belly)], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}

function mantaMaterial(uniforms: Record<string, THREE.IUniform>): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uHalfSpan;\nvarying vec2 vPlan;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPlan = uv * 2.0 - 1.0;
        float a = abs(transformed.x) / uHalfSpan;
        // Wings ripple from root to tip, the wave travelling backwards.
        transformed.y += 0.32 * uHalfSpan * sin(uTime * ${(2 * Math.PI / MANTA_BEAT_S).toFixed(4)}
          - transformed.z * 1.2) * pow(a, 1.6);
        transformed.y += 0.12 * uHalfSpan * pow(1.0 - a, 2.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTint;\nvarying vec2 vPlan;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // The planform: x lateral, y along the body (front +1).
        float a = abs(vPlan.x);
        float z = vPlan.y;
        // Curved, not a kite (round 3 critique): a convex leading edge, a
        // concave trailing edge, both sweeping back into falcate tips.
        float front = 0.45 - 0.45 * pow(a, 1.5) - 0.25 * pow(a, 6.0);
        float back = -0.5 + 0.38 * pow(a, 0.6) - 0.13 * pow(a, 6.0);
        bool wing = z <= front && z >= back && a <= 1.0;
        // Rounded cephalic lobes either side of the broad mouth.
        vec2 lobe = vec2((a - 0.11) / 0.045, (z - 0.5) / 0.12);
        bool cephalic = dot(lobe, lobe) < 1.0;
        bool tail = a < 0.012 && z < -0.45 && z > -1.0;
        if (!(wing || cephalic || tail)) discard;
        float edge = wing ? min(front - z, z - back) : 0.0;
        float margin = max(1.0 - smoothstep(0.0, 0.12, edge), smoothstep(0.75, 1.0, a));
        diffuseColor.rgb = mix(vec3(0.82, 0.84, 0.85), vec3(0.16, 0.18, 0.21), margin) * uTint;`,
      );
  };
  return material;
}

function withSway(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float u = transformed.z / ${SHARK_LENGTH_M.toFixed(2)};
        transformed.x += sin(uTime * ${(2 * Math.PI / SHARK_BEAT_S).toFixed(4)} + u * 3.0)
          * 0.1 * ${SHARK_LENGTH_M.toFixed(2)} * smoothstep(0.2, -0.5, u);`,
      );
  };
}

export default function createFaunaLayer(): Layer {
  let ctx: LayerContext;
  let manta: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  let shark: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const time = { value: 0 };
  const tint = { value: new THREE.Color() };
  const forward = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();

  const place = (mesh: THREE.Object3D, pose: { position: Vec3; heading: Vec3 }) => {
    const cam = ctx.camera.position;
    mesh.position.set(cam.x + pose.position[0], cam.y + pose.position[1], cam.z + pose.position[2]);
    mesh.quaternion.setFromUnitVectors(forward, dir.set(...pose.heading));
  };

  return {
    id: 'fauna',
    init(c) {
      ctx = c;
      const plane = new THREE.PlaneGeometry(MANTA_SPAN_M, MANTA_SPAN_M * 0.95, 48, 40);
      // Lie it flat with the planform's front (uv.y = 1) facing +z.
      plane.rotateX(Math.PI / 2);
      manta = new THREE.Mesh(plane, mantaMaterial({ uTime: time, uHalfSpan: { value: MANTA_SPAN_M / 2 }, uTint: tint }));
      const sharkMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        side: THREE.DoubleSide,
      });
      withSway(sharkMaterial, { uTime: time });
      shark = new THREE.Mesh(sharkGeometry(), sharkMaterial);
      for (const mesh of [manta, shark]) mesh.frustumCulled = false;
      ctx.scene.add(manta, shark);
    },
    update(frame: DiveFrame) {
      const { manta: m, shark: s } = frame.state.events;
      const t = frame.water.transmittance;
      time.value = frame.timeS;
      tint.value.setRGB(lerp(t[0], 1, 0.5), lerp(t[1], 1, 0.5), lerp(t[2], 1, 0.5), THREE.SRGBColorSpace);
      shark.material.color.copy(tint.value);
      manta.visible = m > 0 && m < 1;
      shark.visible = s > 0 && s < 1;
      if (manta.visible) place(manta, mantaPath(m));
      if (shark.visible) place(shark, sharkPath(s));
    },
    dispose() {
      manta.geometry.dispose();
      manta.material.dispose();
      shark.geometry.dispose();
      shark.material.dispose();
      ctx.scene.remove(manta, shark);
    },
  };
}
