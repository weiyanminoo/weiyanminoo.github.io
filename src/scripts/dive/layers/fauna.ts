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
//   turtle a domed carapace over a flat plastron, head, tail, four
//          flippers — the front pair long and swept, beating on a ~2.6 s
//          stroke; olive shell mottled in scutes, seen from above on the
//          descent, lit by the camera's torch (absorb.ts) at 8 m
//
// Each is in the film only while its pass event is strictly between 0 and 1.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MANTA_SPAN_M, SHARK_LENGTH_M, TURTLE_LENGTH_M, mantaPath, sharkPath, turtlePath } from '../faunaPaths';
import { lerp, smoothstep } from '../math';
import { hash1 } from '../noise';
import { vnoise2 } from '../reefShape';
import type { Layer, LayerContext } from '../scene';
import type { DiveFrame, Vec3 } from '../types';
import { withWaterOptics } from './absorb';

const MANTA_BEAT_S = 3.5;
const SHARK_BEAT_S = 1.6;
const TURTLE_BEAT_S = 2.6;
/** Where the front flippers hinge, as a share of the turtle's length out
 *  from its midline. */
const TURTLE_HINGE = 0.36;

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

function ellipsoid(rx: number, ry: number, rz: number, detail: number): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(1, detail);
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  const g = mergeVertices(raw);
  g.scale(rx, ry, rz);
  return g;
}

/** A flipper: a flattened, rounded blade with real thickness — a paddle,
 *  not a plane, so its edge catches the light and it shades across its
 *  width — from (0,0,0) out along +x, swept back (−z) and tapering
 *  towards its tip, `len` long and `width` wide at its root. Mirrored with
 *  a negative `side`. */
function flipper(len: number, width: number, thick: number, sweep: number, side: number): THREE.BufferGeometry {
  const g = ellipsoid(len / 2, thick / 2, width / 2, 2);
  g.translate(len / 2, 0, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) / len;
    pos.setZ(i, pos.getZ(i) * (1 - 0.4 * t) - sweep * t * t);
    pos.setY(i, pos.getY(i) * (1 - 0.5 * t));
  }
  g.scale(side, 1, 1);
  if (side < 0) {
    // Mirroring turns the triangles inside out; turn them back, or the
    // blade's normals point in and it is lit as underside.
    const index = g.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
  }
  return g;
}

/** Heading +z, length TURTLE_LENGTH_M nose to tail (carapace about 0.85
 *  of it), flippers out past the sides. */
function turtleGeometry(): THREE.BufferGeometry {
  const L = TURTLE_LENGTH_M;
  // A high dome — a flat one read as a disc (round 10) — with a low keel
  // along its length and the marginal scutes standing out as a rim.
  const shell = ellipsoid(0.36 * L, 0.27 * L, 0.42 * L, 3);
  const sp = shell.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const y = sp.getY(i);
    const z = sp.getZ(i);
    if (y < 0) {
      // The underside flat: a plastron, not a second dome.
      sp.setY(i, y * 0.22);
      continue;
    }
    const keel = 0.03 * L * Math.max(0, 1 - Math.abs(x) / (0.2 * L)) * (y / (0.27 * L));
    // The rim: the equator pushed out a little.
    const rim = 1 + 0.05 * Math.max(0, 1 - Math.abs(y) / (0.06 * L));
    sp.setXYZ(i, x * rim, y + keel, z * rim);
  }
  const head = ellipsoid(0.085 * L, 0.07 * L, 0.11 * L, 2);
  head.translate(0, 0.01 * L, 0.5 * L);
  const neck = new THREE.CylinderGeometry(0.06 * L, 0.075 * L, 0.14 * L, 8, 1);
  neck.deleteAttribute('uv');
  neck.deleteAttribute('normal');
  neck.rotateX(Math.PI / 2);
  neck.translate(0, 0.0, 0.41 * L);
  const tail = new THREE.ConeGeometry(0.035 * L, 0.16 * L, 6, 1);
  tail.deleteAttribute('uv');
  tail.deleteAttribute('normal');
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, -0.02 * L, -0.46 * L);
  const parts = [shell, head, neck, tail];
  for (const side of [-1, 1]) {
    const front = flipper(0.52 * L, 0.18 * L, 0.05 * L, 0.24 * L, side);
    front.translate(side * TURTLE_HINGE * L, -0.01 * L, 0.2 * L);
    parts.push(front);
    const rear = flipper(0.24 * L, 0.15 * L, 0.04 * L, 0.1 * L, side);
    rear.rotateY(side * 0.5);
    rear.translate(side * 0.3 * L, -0.02 * L, -0.3 * L);
    parts.push(rear);
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / L;
    const y = pos.getY(i) / L;
    const z = pos.getZ(i) / L;
    const onShell = Math.abs(x) < 0.39 && Math.abs(z) < 0.45 && Math.abs(y) > 0.005;
    let c: [number, number, number];
    if (onShell && y > 0) {
      // Scutes: olive-brown, each plate a shade of its own, the seams
      // between them dark. A hex-ish grid of plates 15 cm across.
      const u = x * 7.5;
      const v = z * 7.5 + (Math.floor(u) % 2 === 0 ? 0.5 : 0);
      const cellU = Math.floor(u);
      const cellV = Math.floor(v);
      const seam = Math.min(Math.abs(u - cellU - 0.5), Math.abs(v - cellV - 0.5));
      const plate = 0.78 + 0.34 * hash1(cellU * 31 + cellV, 606);
      const mottle = 0.9 + 0.2 * vnoise2(x * 20, z * 20, 7);
      // The dome's own shading, baked: bright at the apex, falling off
      // down the sides to the rim, so it reads as a dome under the flat
      // light of 10 m, where the lighting alone could not say so.
      const dome = lerp(0.42, 1.2, smoothstep(0.0, 0.26, y));
      const base: [number, number, number] = [0.5 * plate * mottle * dome, 0.43 * plate * mottle * dome, 0.2 * plate * dome];
      const edge = smoothstep(0.34, 0.47, seam);
      c = [base[0] * (1 - 0.55 * edge), base[1] * (1 - 0.55 * edge), base[2] * (1 - 0.5 * edge)];
    } else if (onShell) {
      c = [0.86, 0.82, 0.66];
    } else {
      // Head and flippers: dark olive-grey with the pale scales' speckle,
      // paler underneath.
      const speck = 0.85 + 0.35 * smoothstep(0.4, 0.7, vnoise2(x * 28 + 3, z * 28, 9));
      const under = smoothstep(-0.2, -0.7, nor.getY(i));
      c = [lerp(0.32, 0.7, under) * speck, lerp(0.32, 0.68, under) * speck, lerp(0.24, 0.52, under) * speck];
    }
    colours.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}

/** The front flippers' stroke: out past the hinge the blade rotates about
 *  the body's long axis, down and back up, both sides together, as a
 *  turtle swims. */
function withFlipperStroke(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float hinge = ${(TURTLE_HINGE * TURTLE_LENGTH_M).toFixed(3)};
          float reach = abs(transformed.x) - hinge;
          // Only the front pair, which sit forward of the body's middle.
          if (reach > 0.0 && transformed.z > 0.0) {
            float stroke = 0.55 * sin(uTime * ${(2 * Math.PI / TURTLE_BEAT_S).toFixed(4)});
            float c = cos(stroke);
            float s = sin(stroke);
            float sx = sign(transformed.x);
            transformed.x = sx * (hinge + reach * c);
            transformed.y += reach * s;
            objectNormal = normalize(vec3(objectNormal.x * c - sx * objectNormal.y * s, sx * objectNormal.x * s + objectNormal.y * c, objectNormal.z));
          }
        }`,
      );
    withWaterOptics(shader);
  };
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
  let turtle: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const time = { value: 0 };
  const tint = { value: new THREE.Color() };
  const forward = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();

  // Paths are in the dive site's coordinates (faunaPaths.ts).
  const place = (mesh: THREE.Object3D, pose: { position: Vec3; heading: Vec3 }) => {
    mesh.position.set(...pose.position);
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
      // A wet shell: glossy enough for the sun to put a highlight on the
      // dome, the strongest cue that it is round.
      const turtleMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.42,
        side: THREE.DoubleSide,
      });
      withFlipperStroke(turtleMaterial, { uTime: time });
      turtle = new THREE.Mesh(turtleGeometry(), turtleMaterial);
      for (const mesh of [manta, shark, turtle]) mesh.frustumCulled = false;
      ctx.scene.add(manta, shark, turtle);
    },
    update(frame: DiveFrame) {
      const { manta: m, shark: s, turtle: u } = frame.state.events;
      const t = frame.water.transmittance;
      time.value = frame.timeS;
      tint.value.setRGB(lerp(t[0], 1, 0.5), lerp(t[1], 1, 0.5), lerp(t[2], 1, 0.5), THREE.SRGBColorSpace);
      shark.material.color.copy(tint.value);
      // Near, and under the torch: keeps more of its own colour.
      turtle.material.color.setRGB(lerp(t[0], 1, 0.85), lerp(t[1], 1, 0.85), lerp(t[2], 1, 0.85), THREE.SRGBColorSpace);
      manta.visible = m > 0 && m < 1;
      shark.visible = s > 0 && s < 1;
      turtle.visible = u > 0 && u < 1;
      if (manta.visible) place(manta, mantaPath(m));
      if (shark.visible) place(shark, sharkPath(s));
      if (turtle.visible) place(turtle, turtlePath(u));
    },
    dispose() {
      for (const mesh of [manta, shark, turtle]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      ctx.scene.remove(manta, shark, turtle);
    },
  };
}
