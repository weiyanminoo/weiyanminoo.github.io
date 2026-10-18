// The reef: a procedural wall and a plateau (reefPaths.ts says where), built
// once from seeded noise. Seen from a distance through haze, so it is
// shapes, light and colour rather than detail: a displaced rock face with
// coral patches in its vertex colours, lumpy coral heads, table corals on
// the plateau, and the plateau's far edge plunging away for the drop-off.
//
// Colour is absorbed with depth (material colour × transmittance), and
// caustics are injected into the standard material so they ripple across
// upward-facing surfaces near the surface. This layer also owns the scene's
// lights, which the fish and animals share.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, smoothstep } from '../math';
import { hash1 } from '../noise';
import {
  PLATEAU_LENGTH_M,
  PLATEAU_TOP_DEPTH_M,
  WALL_BOTTOM_DEPTH_M,
  WALL_TOP_DEPTH_M,
  plateauTravel,
  wallDistance,
} from '../reefPaths';
import { SURFACE_CLEARANCE_M, type Layer, type LayerContext } from '../scene';
import type { DiveFrame } from '../types';

const SEED = 606;
const WALL_WIDTH_M = 90;
const PLATEAU_WIDTH_M = 100;
const PLATEAU_DEPTH_EXTENT_M = 48;

type RGBTuple = [number, number, number];

const ROCK_A: RGBTuple = [0.58, 0.55, 0.48];
const ROCK_B: RGBTuple = [0.36, 0.37, 0.35];
// Hard and soft coral, sponge and algae tones; absorbed towards blue-grey
// at depth by the material tint.
const CORALS: readonly RGBTuple[] = [
  [0.86, 0.46, 0.3],
  [0.56, 0.37, 0.62],
  [0.66, 0.64, 0.3],
  [0.8, 0.45, 0.55],
  [0.87, 0.74, 0.32],
  [0.45, 0.58, 0.5],
];

const worldY = (depthM: number) => -(depthM + SURFACE_CLEARANCE_M);

function vnoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash1(i * 374761 + j * 668265, seed);
  return lerp(lerp(h(ix, iy), h(ix + 1, iy), u), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), u), v) * 2 - 1;
}

function fbm2(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise2(x * f, y * f, seed + o * 17);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

function mix3(a: RGBTuple, b: RGBTuple, t: number): RGBTuple {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Rock with coral patches: a patch noise picks where coral grows and a
 *  coarse cell hash picks which coral. */
function reefColour(x: number, y: number, seed: number): RGBTuple {
  const rock = mix3(ROCK_A, ROCK_B, 0.5 + 0.5 * fbm2(x * 0.35, y * 0.35, seed + 1, 4));
  const patch = smoothstep(0.0, 0.3, fbm2(x * 0.5, y * 0.5, seed + 2, 4));
  const cell = hash1(Math.floor(x / 1.2) * 7919 + Math.floor(y / 1.2) * 104729, seed + 3);
  const coral = CORALS[Math.floor(cell * CORALS.length)];
  return mix3(rock, coral, patch * 0.8);
}

function setColour(geometry: THREE.BufferGeometry, colourAt: (x: number, y: number, z: number) => RGBTuple) {
  const pos = geometry.getAttribute('position');
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = colourAt(pos.getX(i), pos.getY(i), pos.getZ(i));
    colours[i * 3] = r;
    colours[i * 3 + 1] = g;
    colours[i * 3 + 2] = b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/** A lumpy coral head or boulder: an icosphere with seeded radial noise,
 *  squashed along `axis` so it encrusts its surface instead of sitting on it
 *  like a ball. Welded first — Three's polyhedra are non-indexed, which
 *  would give faceted, rock-in-space normals. */
function coralHead(radius: number, squash: number, axis: 'y' | 'z', seed: number, colour: RGBTuple): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(radius, 3);
  raw.deleteAttribute('normal');
  raw.deleteAttribute('uv');
  const g = mergeVertices(raw);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm2(v.x * 2.1 + seed, v.y * 2.1 + v.z * 1.7, SEED + 9, 3);
    v.multiplyScalar(1 + 0.28 * n);
    v[axis] *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  setColour(g, (x, y) => mix3(colour, [colour[0] * 0.6, colour[1] * 0.6, colour[2] * 0.6], 0.5 + 0.5 * vnoise2(x * 6, y * 6, seed)));
  return g;
}

/** A table coral: a wide, thin plate on a short stalk. */
function tableCoral(radius: number, colour: RGBTuple): THREE.BufferGeometry {
  const plate = new THREE.CylinderGeometry(radius, radius * 0.92, 0.18, 18, 1);
  plate.translate(0, 0.9, 0);
  const stalk = new THREE.CylinderGeometry(0.12, 0.2, 0.9, 7, 1);
  stalk.translate(0, 0.45, 0);
  const g = mergeGeometries([plate.toNonIndexed(), stalk.toNonIndexed()])!;
  g.deleteAttribute('uv');
  setColour(g, () => colour);
  return g;
}

/** The wall face's surface: z offset (towards the camera) at (x, y). The
 *  top rounds back into a lip instead of ending in a straight edge. */
function wallZ(x: number, y: number, top: number): number {
  let z =
    2.8 * fbm2(x * 0.08, y * 0.08, SEED + 20) +
    0.9 * fbm2(x * 0.35, y * 0.35, SEED + 21, 3) +
    0.35 * fbm2(x * 1.1, y * 1.1, SEED + 23, 2);
  // Vertical buttresses and gullies.
  z += 1.4 * Math.sin(x * 0.21 + 2.0 * fbm2(x * 0.05, y * 0.03, SEED + 22));
  const lip = top - y;
  if (lip < 3) z -= (3 - lip) ** 2 * 0.9;
  return z;
}

function buildWall(): THREE.BufferGeometry {
  const height = WALL_BOTTOM_DEPTH_M - WALL_TOP_DEPTH_M;
  // Three vertices a metre, enough for the 1 m relief term to show.
  const face = new THREE.PlaneGeometry(WALL_WIDTH_M, height, WALL_WIDTH_M * 3, Math.round(height * 3));
  face.deleteAttribute('uv');
  const top = height / 2;
  const pos = face.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, wallZ(pos.getX(i), pos.getY(i), top));
  face.computeVertexNormals();
  setColour(face, (x, y) => reefColour(x, y, SEED + 30));

  const parts: THREE.BufferGeometry[] = [face];
  for (let i = 0; i < 320; i++) {
    const x = (hash1(i, SEED + 40) - 0.5) * (WALL_WIDTH_M - 6);
    const y = top - 1 - hash1(i, SEED + 41) * (height * 0.6);
    const r = 0.3 + 1.3 * hash1(i, SEED + 42) ** 2;
    const colour = CORALS[Math.floor(hash1(i, SEED + 43) * CORALS.length)];
    const head = coralHead(r, 0.5, 'z', i, colour);
    head.translate(x, y, wallZ(x, y, top) + r * 0.15);
    parts.push(head);
  }
  return mergeGeometries(parts)!;
}

/** The plateau's surface height at (x, z); z runs from 0 (near edge) to
 *  -PLATEAU_DEPTH_EXTENT_M. Past the far edge it plunges away. */
function plateauY(x: number, z: number): number {
  let y = 1.2 * fbm2(x * 0.12, z * 0.12, SEED + 50) + 0.35 * fbm2(x * 0.6, z * 0.6, SEED + 51, 3);
  const past = -z - (PLATEAU_LENGTH_M - 2);
  if (past > 0) y -= past * past * 1.5;
  return y;
}

function buildPlateau(): THREE.BufferGeometry {
  const ground = new THREE.PlaneGeometry(PLATEAU_WIDTH_M, PLATEAU_DEPTH_EXTENT_M, 200, 120);
  ground.deleteAttribute('uv');
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, -PLATEAU_DEPTH_EXTENT_M / 2);
  const pos = ground.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, plateauY(pos.getX(i), pos.getZ(i)));
  ground.computeVertexNormals();
  setColour(ground, (x, _y, z) => reefColour(x, z, SEED + 60));

  const parts: THREE.BufferGeometry[] = [ground];
  for (let i = 0; i < 220; i++) {
    const x = (hash1(i, SEED + 70) - 0.5) * (PLATEAU_WIDTH_M - 8);
    const z = -hash1(i, SEED + 71) * (PLATEAU_LENGTH_M - 3);
    const r = 0.35 + 1.4 * hash1(i, SEED + 72) ** 2;
    const colour = CORALS[Math.floor(hash1(i, SEED + 73) * CORALS.length)];
    const head = coralHead(r, 0.55, 'y', 1000 + i, colour);
    head.translate(x, plateauY(x, z) + r * 0.1, z);
    parts.push(head);
  }
  for (let i = 0; i < 26; i++) {
    const x = (hash1(i, SEED + 80) - 0.5) * (PLATEAU_WIDTH_M - 10);
    const z = -hash1(i, SEED + 81) * (PLATEAU_LENGTH_M - 4);
    const colour = mix3(CORALS[2], CORALS[5], hash1(i, SEED + 82));
    const table = tableCoral(0.9 + 1.4 * hash1(i, SEED + 83), colour);
    table.rotateY(hash1(i, SEED + 84) * Math.PI);
    table.translate(x, plateauY(x, z), z);
    // mergeGeometries needs every part indexed or none; weld the tables.
    parts.push(mergeVertices(table));
  }
  return mergeGeometries(parts)!;
}

// Caustics: two warped ripple fields, bright where they agree, laid on
// upward-facing surfaces. Strength is water.caustics (gone by 25 m).
const CAUSTIC_GLSL = /* glsl */ `
  uniform float uCausticTime;
  uniform float uCaustics;
  varying vec3 vCausticWorld;
  varying float vCausticUp;
  float causticLayer(vec2 p, float t) {
    vec2 q = p + vec2(sin(p.y * 1.3 + t * 0.7), cos(p.x * 1.1 - t * 0.6)) * 0.6;
    float a = abs(sin(q.x * 2.2 + t * 0.9) + sin(q.y * 2.6 - t * 0.8));
    return pow(max(0.0, 1.0 - a * 0.6), 6.0);
  }
  float causticField(vec2 p, float t) {
    return causticLayer(p, t) + 0.6 * causticLayer(p * 1.7 + 3.1, t * 1.3);
  }
`;

function withCaustics(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCausticWorld;\nvarying float vCausticUp;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCausticWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCausticUp = normalize(mat3(modelMatrix) * objectNormal).y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CAUSTIC_GLSL}`)
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb *= 1.0 + uCaustics * 2.2 * causticField(vCausticWorld.xz * 0.5, uCausticTime) * smoothstep(0.0, 0.6, vCausticUp);',
      );
  };
}

export default function createReefLayer(): Layer {
  let ctx: LayerContext;
  let wall: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  let plateau: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  let sun: THREE.DirectionalLight;
  let sky: THREE.HemisphereLight;
  const uniforms = { uCausticTime: { value: 0 }, uCaustics: { value: 0 } };

  return {
    id: 'reef',
    init(c) {
      ctx = c;
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      withCaustics(material, uniforms);
      wall = new THREE.Mesh(buildWall(), material);
      plateau = new THREE.Mesh(buildPlateau(), material);
      wall.matrixAutoUpdate = true;
      sun = new THREE.DirectionalLight(0xffffff, 1);
      sun.position.set(0.3, 1, 0.2);
      sky = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
      ctx.scene.add(wall, plateau, sun, sky);
    },
    update(frame: DiveFrame) {
      const { state, water } = frame;
      const cam = ctx.camera.position;
      const inInsert = state.insert !== null;

      const wd = wallDistance(state.progress);
      wall.visible = !inInsert && wd !== null;
      if (wd !== null) {
        const height = WALL_BOTTOM_DEPTH_M - WALL_TOP_DEPTH_M;
        wall.position.set(cam.x, worldY(WALL_TOP_DEPTH_M) - height / 2, cam.z - wd);
      }

      const travel = plateauTravel(state.progress);
      plateau.visible = !inInsert && travel !== null;
      if (travel !== null) plateau.position.set(cam.x, worldY(PLATEAU_TOP_DEPTH_M), cam.z + travel);

      // Red dies first: the reef's own colour is filtered by the water
      // between it and the surface, softened so a white-balanced camera's
      // view (reference 2) still shows some warmth.
      const t = water.transmittance;
      (wall.material as THREE.MeshStandardMaterial).color.setRGB(
        lerp(t[0], 1, 0.5),
        lerp(t[1], 1, 0.5),
        lerp(t[2], 1, 0.5),
        THREE.SRGBColorSpace,
      );
      uniforms.uCausticTime.value = frame.timeS;
      uniforms.uCaustics.value = water.caustics;

      // Underwater light is mostly scattered, arriving from everywhere: a
      // gentle sun from above and a strong hemisphere whose "ground" is
      // still lit water, so vertical faces are not left in the dark. Both
      // near-neutral — the material tint and the fog already carry the
      // blue, and blue light on blue-tinted rock went doubly saturated.
      sun.color.setRGB(0.85 + 0.15 * t[0], 0.95, 1, THREE.SRGBColorSpace);
      sun.intensity = 1.6 * water.ambient;
      sky.color.setRGB(0.78, 0.9, 1, THREE.SRGBColorSpace);
      sky.groundColor.setRGB(0.32, 0.4, 0.46, THREE.SRGBColorSpace);
      sky.intensity = 0.5 + 1.3 * water.ambient;
    },
    dispose() {
      wall.geometry.dispose();
      plateau.geometry.dispose();
      wall.material.dispose();
      ctx.scene.remove(wall, plateau, sun, sky);
    },
  };
}
