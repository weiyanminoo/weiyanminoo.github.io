// The reef: a procedural wall with a shelf at its foot (reefPaths.ts says
// where), built once from seeded noise. Seen from a distance through haze,
// so it is shapes, light and colour rather than detail: a displaced rock
// face with crevices and growth patches in its vertex colours, sea fans
// standing off it, low coral mounds and table corals on the shelf, and the
// shelf's outer edge plunging away into the blue. The shelf is a child of
// the wall and moves with it.
//
// Colour is absorbed with depth (material colour × transmittance). The
// surface — rock grain and caustics — is in reefShading.ts, the fans in
// reefFans.ts. This layer also owns the scene's lights, which the fish and
// animals share.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep } from '../math';
import { hash1 } from '../noise';
import {
  PLATEAU_LENGTH_M,
  PLATEAU_TOP_DEPTH_M,
  SHELF_INSET_M,
  WALL_BOTTOM_DEPTH_M,
  WALL_HALF_LENGTH_M,
  WALL_TOP_DEPTH_M,
  wallPose,
} from '../reefPaths';
import { SURFACE_CLEARANCE_M, type Layer, type LayerContext } from '../scene';
import type { DiveFrame } from '../types';
import { fanGeometry, fanMaterial, laceTexture, type FanPlacement } from './reefFans';
import { withEmerge, withReefShading } from './reefShading';

const SEED = 606;
const WALL_WIDTH_M = WALL_HALF_LENGTH_M * 2;
// The shelf runs the wall's whole length (it is the wall's foot).
const PLATEAU_WIDTH_M = WALL_WIDTH_M + 10;
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
// Gorgonian and soft-coral tones of an Indo-Pacific wall: pale gold, cream,
// a few red and violet.
const FANS: readonly RGBTuple[] = [
  [0.85, 0.72, 0.45],
  [0.86, 0.8, 0.66],
  [0.82, 0.62, 0.38],
  [0.72, 0.3, 0.22],
  [0.55, 0.32, 0.55],
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

const scale3 = (c: RGBTuple, k: number): RGBTuple => [c[0] * k, c[1] * k, c[2] * k];

// Growth tones for the reef rock: muted ochre, olive and sage. Seen from a
// distance through haze a real wall reads as rock with subtle growth; the
// vivid colour is in the fans and the fish (round 1 critique).
const GROWTH: readonly RGBTuple[] = [
  [0.62, 0.52, 0.36],
  [0.5, 0.52, 0.34],
  [0.46, 0.55, 0.5],
];

/** Rock with patches of growth, blended by smooth noise — no hard-edged
 *  cells, which read as camouflage squares (round 1 critique). */
function reefColour(x: number, y: number, seed: number): RGBTuple {
  const rock = mix3(ROCK_A, ROCK_B, 0.5 + 0.5 * fbm2(x * 0.35, y * 0.35, seed + 1, 4));
  const patch = smoothstep(0.05, 0.4, fbm2(x * 0.4, y * 0.4, seed + 2, 4));
  const pick = 0.5 + 0.5 * fbm2(x * 0.12, y * 0.12, seed + 3, 3);
  const growth = pick < 0.5 ? mix3(GROWTH[0], GROWTH[1], pick * 2) : mix3(GROWTH[1], GROWTH[2], pick * 2 - 1);
  return mix3(rock, growth, patch * 0.45);
}

/** Occlusion from local relief: hollows (negative detail) darker, as the
 *  scattered light reaches into them less. */
const occlusion = (detail: number, gain: number, lo: number) => clamp(0.82 + gain * detail, lo, 1.08);

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

/** A lumpy coral mound or boulder: an icosphere with seeded radial noise,
 *  squashed along `axis` so it spreads over its surface instead of sitting
 *  on it like a ball. Welded first — Three's polyhedra are non-indexed,
 *  which would give faceted, rock-in-space normals. */
function coralHead(radius: number, squash: number, axis: 'y' | 'z', seed: number, colour: RGBTuple): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(radius, radius < 0.6 ? 2 : 3);
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
  // Darker towards where it meets the ground.
  setColour(g, (x, y, z) => {
    const up = (axis === 'y' ? y : z) / (radius * squash);
    const shade = lerp(0.6, 1, smoothstep(-0.6, 0.5, up));
    return scale3(mix3(colour, scale3(colour, 0.7), 0.5 + 0.5 * vnoise2(x * 6, (axis === 'y' ? z : y) * 6, seed)), shade);
  });
  return g;
}

/** A table coral: a wide, thin plate on a short stalk, its underside and
 *  stalk in shadow. */
function tableCoral(radius: number, colour: RGBTuple): THREE.BufferGeometry {
  const plate = new THREE.CylinderGeometry(radius, radius * 0.92, 0.18, 18, 1);
  plate.translate(0, 0.9, 0);
  const stalk = new THREE.CylinderGeometry(0.12, 0.2, 0.9, 7, 1);
  stalk.translate(0, 0.45, 0);
  const g = mergeGeometries([plate.toNonIndexed(), stalk.toNonIndexed()])!;
  g.deleteAttribute('uv');
  setColour(g, (_x, y) => (y > 0.95 ? colour : scale3(colour, 0.5)));
  return g;
}

/** The wall face's surface, split into its broad shape and its local
 *  relief (which also drives the occlusion): z offset towards the camera
 *  at (x, y). The top rounds back into a lip instead of a straight edge. */
function wallRelief(x: number, y: number, top: number): { broad: number; detail: number } {
  // Vertical buttresses and gullies.
  let broad = 2.8 * fbm2(x * 0.08, y * 0.08, SEED + 20) + 1.4 * Math.sin(x * 0.21 + 2.0 * fbm2(x * 0.05, y * 0.03, SEED + 22));
  const lip = top - y;
  if (lip < 3) broad -= (3 - lip) ** 2 * 0.9;
  // Crevices: narrow grooves along the zero lines of a stretched noise
  // field (ridged noise), with the finer knobbly relief.
  const groove = (1 - Math.abs(fbm2(x * 0.16, y * 0.45, SEED + 24, 3))) ** 8;
  const detail = 0.9 * fbm2(x * 0.35, y * 0.35, SEED + 21, 3) + 0.35 * fbm2(x * 1.1, y * 1.1, SEED + 23, 2) - 0.9 * groove;
  return { broad, detail };
}

function wallZ(x: number, y: number, top: number): number {
  const { broad, detail } = wallRelief(x, y, top);
  return broad + detail;
}

function buildWall(): { rock: THREE.BufferGeometry; fans: FanPlacement[] } {
  const height = WALL_BOTTOM_DEPTH_M - WALL_TOP_DEPTH_M;
  // Three vertices a metre, enough for the 1 m relief term to show.
  const face = new THREE.PlaneGeometry(WALL_WIDTH_M, height, WALL_WIDTH_M * 3, Math.round(height * 3));
  face.deleteAttribute('uv');
  const top = height / 2;
  const pos = face.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, wallZ(pos.getX(i), pos.getY(i), top));
  face.computeVertexNormals();
  setColour(face, (x, y) => scale3(reefColour(x, y, SEED + 30), occlusion(wallRelief(x, y, top).detail, 0.5, 0.45)));

  // No coral heads on the wall (round 2 critique: they read as floating
  // potatoes); its growth is sea fans standing off the rock at an angle,
  // densest across the middle, where the camera faces it, and down to the
  // drop-off's depths.
  const fans: FanPlacement[] = [];
  for (let i = 0; i < 900; i++) {
    // Two in five crowd the stretch the camera swims along (wall-local
    // -30..60 m; reefPaths.ts slide), the rest anywhere along the face.
    const x =
      i % 5 < 2 ? -30 + 90 * hash1(i, SEED + 40) : (hash1(i, SEED + 40) - 0.5) * (WALL_WIDTH_M - 10);
    const y = top - 1.5 - hash1(i, SEED + 41) ** 1.2 * 40;
    const width = 0.9 + 2.3 * hash1(i, SEED + 42) ** 2;
    const side = hash1(i, SEED + 43) < 0.5 ? -1 : 1;
    const yaw = side * (0.35 + 0.75 * hash1(i, SEED + 44));
    // Out from the rock by however far the turned fan's back edge swings
    // in, so that edge just meets it.
    const z = wallZ(x, y, top) + 0.5 * width * Math.abs(Math.sin(yaw)) + 0.05;
    fans.push({
      position: new THREE.Vector3(x, y, z),
      width,
      yaw,
      tilt: -0.1 - 0.35 * hash1(i, SEED + 45),
      colour: FANS[Math.floor(hash1(i, SEED + 46) * FANS.length)],
    });
  }
  return { rock: face, fans };
}

/** The plateau's surface height at (x, z), split into broad shape and
 *  local relief; z runs from 0 (near edge) to -PLATEAU_DEPTH_EXTENT_M.
 *  Past the far edge it plunges away. */
function plateauRelief(x: number, z: number): { broad: number; detail: number } {
  let broad = 1.2 * fbm2(x * 0.12, z * 0.12, SEED + 50);
  const past = -z - (PLATEAU_LENGTH_M - 2);
  if (past > 0) broad -= past * past * 1.5;
  return { broad, detail: 0.45 * fbm2(x * 0.6, z * 0.6, SEED + 51, 3) };
}

function plateauY(x: number, z: number): number {
  const { broad, detail } = plateauRelief(x, z);
  return broad + detail;
}

function buildPlateau(): { rock: THREE.BufferGeometry; fans: FanPlacement[] } {
  const ground = new THREE.PlaneGeometry(PLATEAU_WIDTH_M, PLATEAU_DEPTH_EXTENT_M, 340, 120);
  ground.deleteAttribute('uv');
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, -PLATEAU_DEPTH_EXTENT_M / 2);
  const pos = ground.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, plateauY(pos.getX(i), pos.getZ(i)));
  ground.computeVertexNormals();
  // Dark clumps of living coral among paler rubble, as reference 2's reef
  // tops are (7:16, 7:40) — not an even pale floor.
  setColour(ground, (x, _y, z) => {
    const clump = smoothstep(0.0, 0.3, fbm2(x * 0.5, z * 0.5, SEED + 61, 3));
    const shade = occlusion(plateauRelief(x, z).detail, 0.9, 0.55) * (1 - 0.5 * clump);
    return scale3(reefColour(x, z, SEED + 60), shade);
  });

  // Low coral mounds and rubble, not pebbles (round 2 critique: small,
  // saturated heads read as sweets on sand): wide, flat, half-buried,
  // mostly the colour of the rock around them.
  const parts: THREE.BufferGeometry[] = [ground];
  for (let i = 0; i < 640; i++) {
    const x = (hash1(i, SEED + 70) - 0.5) * (PLATEAU_WIDTH_M - 8);
    const z = -hash1(i, SEED + 71) * (PLATEAU_LENGTH_M - 3);
    const r = 0.3 + 1.7 * hash1(i, SEED + 72) ** 2;
    const coral = CORALS[Math.floor(hash1(i, SEED + 73) * CORALS.length)];
    const squash = 0.32 + 0.12 * hash1(i, SEED + 74);
    const head = coralHead(r, squash, 'y', 1000 + i, mix3(reefColour(x, z, SEED + 60), coral, 0.12 + 0.18 * hash1(i, SEED + 75)));
    head.translate(x, plateauY(x, z) - r * squash * 0.35, z);
    parts.push(head);
  }
  for (let i = 0; i < 30; i++) {
    const x = (hash1(i, SEED + 80) - 0.5) * (PLATEAU_WIDTH_M - 10);
    const z = -hash1(i, SEED + 81) * (PLATEAU_LENGTH_M - 4);
    const colour = mix3(reefColour(x, z, SEED + 60), mix3(CORALS[2], CORALS[5], hash1(i, SEED + 82)), 0.35);
    const table = tableCoral(0.9 + 1.4 * hash1(i, SEED + 83), colour);
    table.rotateY(hash1(i, SEED + 84) * Math.PI);
    table.translate(x, plateauY(x, z), z);
    // mergeGeometries needs every part indexed or none; weld the tables.
    parts.push(mergeVertices(table));
  }

  const fans: FanPlacement[] = [];
  for (let i = 0; i < 80; i++) {
    const x = (hash1(i, SEED + 90) - 0.5) * (PLATEAU_WIDTH_M - 10);
    const z = -hash1(i, SEED + 91) * (PLATEAU_LENGTH_M - 4);
    fans.push({
      position: new THREE.Vector3(x, plateauY(x, z) - 0.05, z),
      width: 0.6 + 1.3 * hash1(i, SEED + 92) ** 2,
      yaw: hash1(i, SEED + 93) * Math.PI,
      tilt: (hash1(i, SEED + 94) - 0.5) * 0.3,
      colour: FANS[Math.floor(hash1(i, SEED + 95) * FANS.length)],
    });
  }
  return { rock: mergeGeometries(parts)!, fans };
}

export default function createReefLayer(): Layer {
  let ctx: LayerContext;
  let rockMaterial: THREE.MeshStandardMaterial;
  let fansMaterial: THREE.MeshStandardMaterial;
  let lace: THREE.Texture;
  let wall: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  let plateau: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const fanMeshes: THREE.Mesh[] = [];
  let sun: THREE.DirectionalLight;
  let sky: THREE.HemisphereLight;
  const uniforms = { uCausticTime: { value: 0 }, uCaustics: { value: 0 }, uEmerge: { value: 1 } };

  return {
    id: 'reef',
    init(c) {
      ctx = c;
      rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      withReefShading(rockMaterial, uniforms);
      lace = laceTexture(SEED);
      fansMaterial = fanMaterial(lace);
      withEmerge(fansMaterial, uniforms);
      const w = buildWall();
      const p = buildPlateau();
      wall = new THREE.Mesh(w.rock, rockMaterial);
      plateau = new THREE.Mesh(p.rock, rockMaterial);
      // The shelf is the wall's foot, so it rides with the wall: turned to
      // run out from the face (its own -z away from the rock), starting a
      // little inside it.
      const height = WALL_BOTTOM_DEPTH_M - WALL_TOP_DEPTH_M;
      plateau.rotation.y = Math.PI;
      plateau.position.set(0, worldY(PLATEAU_TOP_DEPTH_M) - (worldY(WALL_TOP_DEPTH_M) - height / 2), -SHELF_INSET_M);
      wall.add(plateau);
      for (const [parent, fans] of [
        [wall, w.fans],
        [plateau, p.fans],
      ] as const) {
        const mesh = new THREE.Mesh(fanGeometry(fans), fansMaterial);
        // Fans are blended: after the rock, before the fish and snow.
        mesh.renderOrder = 1;
        parent.add(mesh);
        fanMeshes.push(mesh);
      }
      sun = new THREE.DirectionalLight(0xffffff, 1);
      sun.position.set(0.3, 1, 0.2);
      sky = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
      ctx.scene.add(wall, sun, sky);
    },
    update(frame: DiveFrame) {
      const { state, water } = frame;
      const cam = ctx.camera.position;

      // The wall's centre sits `slide` along the face and `distance` out in
      // front, swung round the camera by `turn` (reefPaths.ts).
      const pose = wallPose(state.progress);
      wall.visible = pose !== null;
      if (pose) {
        const height = WALL_BOTTOM_DEPTH_M - WALL_TOP_DEPTH_M;
        const c = Math.cos(pose.turn);
        const s = Math.sin(pose.turn);
        wall.rotation.y = pose.turn;
        wall.position.set(
          cam.x + pose.slide * c - pose.distance * s,
          worldY(WALL_TOP_DEPTH_M) - height / 2,
          cam.z - pose.slide * s - pose.distance * c,
        );
        plateau.visible = pose.shelf;
        uniforms.uEmerge.value = pose.emerge;
      }

      // Red dies first: the reef's own colour is filtered by the water
      // between it and the surface, softened so a white-balanced camera's
      // view (reference 2) still shows some warmth.
      const t = water.transmittance;
      // 0.8 rather than the fully absorbed value: a white-balanced camera's
      // reef at 18–20 m (the reference stills' reef tops, ~0.15 mean
      // luminance; round 1 critique).
      rockMaterial.color.setRGB(lerp(t[0], 1, 0.8), lerp(t[1], 1, 0.8), lerp(t[2], 1, 0.8), THREE.SRGBColorSpace);
      // The fans' saturated colour soaks into the blue faster, so the
      // drop-off's fans are blue-grey lace, not purple and red (round 2).
      fansMaterial.color.setRGB(lerp(t[0], 1, 0.5), lerp(t[1], 1, 0.5), lerp(t[2], 1, 0.5), THREE.SRGBColorSpace);
      uniforms.uCausticTime.value = frame.timeS;
      // Halved: at the reef top's 19 m the full web read as a sunlit
      // swimming-pool floor (round 2).
      uniforms.uCaustics.value = water.caustics * 0.5;

      // Underwater light is mostly scattered, arriving from everywhere: a
      // gentle sun from above and a strong hemisphere whose "ground" is
      // still lit water, so vertical faces are not left in the dark. Both
      // near-neutral — the material tint and the fog already carry the
      // blue, and blue light on blue-tinted rock went doubly saturated.
      sun.color.setRGB(0.85 + 0.15 * t[0], 0.95, 1, THREE.SRGBColorSpace);
      // A diving camera auto-exposes: lit things stay readable at depth
      // while the water itself (the fog) darkens.
      sun.intensity = 3.0 * water.ambient;
      sky.color.setRGB(0.78, 0.9, 1, THREE.SRGBColorSpace);
      sky.groundColor.setRGB(0.36, 0.45, 0.52, THREE.SRGBColorSpace);
      sky.intensity = 1.6 + 2.6 * water.ambient;
    },
    dispose() {
      wall.geometry.dispose();
      plateau.geometry.dispose();
      for (const mesh of fanMeshes) mesh.geometry.dispose();
      rockMaterial.dispose();
      fansMaterial.dispose();
      lace.dispose();
      ctx.scene.remove(wall, sun, sky);
    },
  };
}
