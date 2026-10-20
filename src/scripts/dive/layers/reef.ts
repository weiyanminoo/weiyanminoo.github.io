// The reef: one dive site, built once from seeded noise and fixed in place
// (world.ts says where): a reef top with coral mounds, table corals and
// spur-and-groove sand channels, rolling over a rounded crest into a single
// long wall face, its rock creviced and hung with sea fans. The camera
// swims through it; nothing here moves. Seen through haze, so it is shapes,
// light and colour rather than detail.
//
// Colour is absorbed with depth (material colour × transmittance), and the
// face darkens the further below the camera it falls. The surface — rock
// grain, caustics, that depth fall-off — is in reefShading.ts, the fans in
// reefFans.ts. This layer also owns the scene's lights, which the fish and
// animals share.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep } from '../math';
import { hash1 } from '../noise';
import type { Layer, LayerContext } from '../scene';
import type { DiveFrame } from '../types';
import {
  EDGE_X,
  REEF_NORTH_Z,
  REEF_SOUTH_Z,
  REEF_TOP_DEPTH_M,
  REEF_WEST_X,
  WALL_BOTTOM_DEPTH_M,
  worldY,
} from '../world';
import { fanGeometry, fanMaterial, laceTexture, type FanPlacement } from './reefFans';
import { withReefShading } from './reefShading';

const SEED = 606;
const REEF_LENGTH_M = REEF_NORTH_Z - REEF_SOUTH_Z;
const REEF_MID_Z = (REEF_NORTH_Z + REEF_SOUTH_Z) / 2;
// The face's top rolls back over the crest into a rim standing a little
// proud of the reef top, which tucks in under it: one surface turns the
// corner, so there is no seam where two meet.
const WALL_TOP_DEPTH_M = REEF_TOP_DEPTH_M - 1.5;
// The reef top stops this far west of the crest line, under the rim.
const REEF_TOP_EAST_U = -4;
// Where the camera's dive passes (timeline.ts CAMERA_PATH): growth is
// densest here, as the reef a diver remembers is the stretch they swam.
const PATH_NORTH_Z = -10;
const PATH_SOUTH_Z = -170;

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

/** How far east of EDGE_X the crest runs at world z: bays and promontories,
 *  shared by the face and the reef top so they always meet. */
function meander(z: number): number {
  return 2.0 * fbm2(z * 0.025, 3.7, SEED + 55, 3) + 0.8 * Math.sin(z * 0.11 + 1.3);
}

/** The wall face's surface in its own frame (x along the wall, y up, z out
 *  of the rock), split into its broad shape and its local relief (which
 *  also drives the occlusion). The top rolls back west over the crest into
 *  the rim; the buttresses grow in below it, so the rim follows the crest
 *  line exactly and the reef top always tucks in under it. */
function wallRelief(x: number, y: number, top: number): { broad: number; detail: number } {
  const lip = top - y;
  // Vertical buttresses and gullies, and big spurs tens of metres apart that
  // break the face's silhouette when seen along it.
  let broad =
    (1.8 * fbm2(x * 0.08, y * 0.08, SEED + 20) +
      0.8 * Math.sin(x * 0.21 + 2.0 * fbm2(x * 0.05, y * 0.03, SEED + 22)) +
      2.0 * fbm2(x * 0.025, y * 0.015, SEED + 26, 2)) *
    smoothstep(0, 6, lip);
  broad += meander(REEF_MID_Z - x);
  // Leaning back as it drops, so the face falls away beneath you rather
  // than standing as a vertical slab.
  broad -= 0.15 * Math.max(0, lip - 4);
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

/** The face, built in its own frame (see wallRelief): the layer turns it to
 *  run north–south along the crest, facing east into the blue. */
function buildWall(): { rock: THREE.BufferGeometry; fans: FanPlacement[]; height: number } {
  const height = WALL_BOTTOM_DEPTH_M - WALL_TOP_DEPTH_M;
  // Two vertices a metre: the rock grain in the shader carries the rest.
  const face = new THREE.PlaneGeometry(REEF_LENGTH_M, height, REEF_LENGTH_M * 2, Math.round(height * 2));
  face.deleteAttribute('uv');
  const top = height / 2;
  const pos = face.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, wallZ(pos.getX(i), pos.getY(i), top));
  face.computeVertexNormals();
  setColour(face, (x, y) => scale3(reefColour(x, y, SEED + 30), occlusion(wallRelief(x, y, top).detail, 0.5, 0.45)));

  // No coral heads on the face (round 2 critique: they read as floating
  // potatoes); its growth is sea fans standing off the rock at an angle,
  // densest down the camera's line of descent (wall-local x is north–south
  // reversed: x = REEF_MID_Z − z).
  const fans: FanPlacement[] = [];
  for (let i = 0; i < 1100; i++) {
    const onPath = i % 5 < 3;
    const z = onPath
      ? lerp(PATH_NORTH_Z - 40, PATH_SOUTH_Z, hash1(i, SEED + 40))
      : lerp(REEF_NORTH_Z - 5, REEF_SOUTH_Z + 5, hash1(i, SEED + 40));
    const x = REEF_MID_Z - z;
    const below = onPath ? 1 + hash1(i, SEED + 41) ** 1.3 * 26 : 1 + hash1(i, SEED + 41) ** 1.2 * 45;
    const y = top - below;
    const width = 0.9 + 2.3 * hash1(i, SEED + 42) ** 2;
    const side = hash1(i, SEED + 43) < 0.5 ? -1 : 1;
    const yaw = side * (0.35 + 0.75 * hash1(i, SEED + 44));
    // Out from the rock by however far the turned fan's back edge swings
    // in, so that edge just meets it.
    const out = wallZ(x, y, top) + 0.5 * width * Math.abs(Math.sin(yaw)) + 0.05;
    fans.push({
      position: new THREE.Vector3(x, y, out),
      width,
      yaw,
      tilt: -0.1 - 0.35 * hash1(i, SEED + 45),
      colour: FANS[Math.floor(hash1(i, SEED + 46) * FANS.length)],
    });
  }
  return { rock: face, fans, height };
}

// The reef top is laid out in (u, z): u is metres east of the crest line
// (negative: west of it, on the reef top), so it follows the meander.
const crestX = (u: number, z: number) => EDGE_X + u + meander(z);

/** Spur-and-groove: sand channels running out to the edge between coral
 *  spurs, as on the seaward side of real reef tops. 0 on a spur, 1 in a
 *  channel. */
function channel(u: number, z: number): number {
  const wave = 0.5 + 0.5 * Math.sin(z * 0.28 + 1.6 * fbm2(u * 0.04, z * 0.04, SEED + 52, 3));
  return smoothstep(0.62, 0.92, wave) * smoothstep(-36, -8, u);
}

/** The reef top's height at (u, z), split into broad shape and local
 *  relief. It dips gently as it reaches the crest, to run in under the
 *  face's rim. */
function reefTopRelief(u: number, z: number): { broad: number; detail: number } {
  let broad = worldY(REEF_TOP_DEPTH_M) + 1.2 * fbm2(u * 0.12, z * 0.12, SEED + 50) - 1.0 * channel(u, z);
  const under = u - (REEF_TOP_EAST_U - 2);
  if (under > 0) broad -= under * 0.4;
  return { broad, detail: 0.45 * fbm2(u * 0.6, z * 0.6, SEED + 51, 3) * (1 - 0.7 * channel(u, z)) };
}

function reefTopY(u: number, z: number): number {
  const { broad, detail } = reefTopRelief(u, z);
  return broad + detail;
}

// Sand in the channels.
const SAND: RGBTuple = [0.8, 0.76, 0.64];

function buildReefTop(): { rock: THREE.BufferGeometry; fans: FanPlacement[] } {
  const width = REEF_TOP_EAST_U - REEF_WEST_X;
  const ground = new THREE.PlaneGeometry(width, REEF_LENGTH_M, Math.round(width * 1.6), Math.round(REEF_LENGTH_M * 1.6));
  ground.deleteAttribute('uv');
  ground.rotateX(-Math.PI / 2);
  ground.translate((REEF_TOP_EAST_U + REEF_WEST_X) / 2, 0, REEF_MID_Z);
  // Colours are set from (u, z) below, before the vertices move to x.
  const pos = ground.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, reefTopY(pos.getX(i), pos.getZ(i)));
  // Dark clumps of living coral among paler rubble, as reference 2's reef
  // tops are (7:16, 7:40), and pale sand in the channels.
  setColour(ground, (u, _y, z) => {
    const clump = smoothstep(0.0, 0.3, fbm2(u * 0.5, z * 0.5, SEED + 61, 3));
    const shade = occlusion(reefTopRelief(u, z).detail, 0.9, 0.55) * (1 - 0.5 * clump);
    return mix3(scale3(reefColour(u, z, SEED + 60), shade), SAND, 0.8 * channel(u, z));
  });
  for (let i = 0; i < pos.count; i++) pos.setX(i, crestX(pos.getX(i), pos.getZ(i)));
  ground.computeVertexNormals();

  // Where the camera swims over the reef top: u −25..−5, z −10..−90 (u as
  // above). Every placement is chosen in (u, z) and set down at crestX.
  const near = (i: number, seed: number): [number, number] => [
    lerp(-25, REEF_TOP_EAST_U - 1, hash1(i, seed)),
    lerp(PATH_NORTH_Z, -90, hash1(i, seed + 1)),
  ];
  const anywhere = (i: number, seed: number): [number, number] => [
    lerp(REEF_WEST_X + 4, REEF_TOP_EAST_U - 1, hash1(i, seed)),
    lerp(REEF_NORTH_Z - 4, REEF_SOUTH_Z + 4, hash1(i, seed + 1)),
  ];

  // Low coral mounds and rubble, not pebbles (round 2 critique: small,
  // saturated heads read as sweets on sand): wide, flat, half-buried,
  // mostly the colour of the rock around them, and on the spurs, not in the
  // sand channels.
  const parts: THREE.BufferGeometry[] = [ground];
  for (let i = 0; i < 760; i++) {
    const [u, z] = i % 10 < 7 ? near(i, SEED + 70) : anywhere(i, SEED + 70);
    if (channel(u, z) > 0.4) continue;
    const r = 0.3 + 1.7 * hash1(i, SEED + 72) ** 2;
    const coral = CORALS[Math.floor(hash1(i, SEED + 73) * CORALS.length)];
    const squash = 0.32 + 0.12 * hash1(i, SEED + 74);
    const head = coralHead(r, squash, 'y', 1000 + i, mix3(reefColour(u, z, SEED + 60), coral, 0.12 + 0.18 * hash1(i, SEED + 75)));
    head.translate(crestX(u, z), reefTopY(u, z) - r * squash * 0.35, z);
    parts.push(head);
  }
  for (let i = 0; i < 44; i++) {
    const [u, z] = i % 4 < 3 ? near(i, SEED + 80) : anywhere(i, SEED + 80);
    if (channel(u, z) > 0.3 || u > REEF_TOP_EAST_U - 3) continue;
    const colour = mix3(reefColour(u, z, SEED + 60), mix3(CORALS[2], CORALS[5], hash1(i, SEED + 82)), 0.35);
    const table = tableCoral(0.9 + 1.4 * hash1(i, SEED + 83), colour);
    table.rotateY(hash1(i, SEED + 84) * Math.PI);
    table.translate(crestX(u, z), reefTopY(u, z), z);
    // mergeGeometries needs every part indexed or none; weld the tables.
    parts.push(mergeVertices(table));
  }

  const fans: FanPlacement[] = [];
  for (let i = 0; i < 110; i++) {
    const [u, z] = i % 4 < 3 ? near(i, SEED + 90) : anywhere(i, SEED + 90);
    if (channel(u, z) > 0.4) continue;
    fans.push({
      position: new THREE.Vector3(crestX(u, z), reefTopY(u, z) - 0.05, z),
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
  let reefTop: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const fanMeshes: THREE.Mesh[] = [];
  let sun: THREE.DirectionalLight;
  let sky: THREE.HemisphereLight;
  const uniforms = { uCausticTime: { value: 0 }, uCamY: { value: 0 } };

  return {
    id: 'reef',
    init(c) {
      ctx = c;
      rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      withReefShading(rockMaterial, uniforms);
      lace = laceTexture(SEED);
      fansMaterial = fanMaterial(lace);
      withReefShading(fansMaterial, uniforms, { grain: false });
      const w = buildWall();
      const t = buildReefTop();
      wall = new THREE.Mesh(w.rock, rockMaterial);
      // Its own frame turned so the face runs north–south along the crest,
      // facing east (wall-local +z → world +x, wall-local x → world −z).
      wall.rotation.y = Math.PI / 2;
      wall.position.set(EDGE_X, worldY(WALL_TOP_DEPTH_M) - w.height / 2, REEF_MID_Z);
      reefTop = new THREE.Mesh(t.rock, rockMaterial);
      for (const [parent, fans] of [
        [wall, w.fans],
        [reefTop, t.fans],
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
      ctx.scene.add(wall, reefTop, sun, sky);
    },
    update(frame: DiveFrame) {
      const { water } = frame;
      uniforms.uCamY.value = ctx.camera.position.y;
      uniforms.uCausticTime.value = frame.timeS;

      // Red dies first: the reef's own colour is filtered by the water
      // between it and the surface, softened so a white-balanced camera's
      // view (reference 2) still shows some warmth.
      const t = water.transmittance;
      // 0.8 rather than the fully absorbed value: a white-balanced camera's
      // reef at 18–20 m (the reference stills' reef tops, ~0.15 mean
      // luminance; round 1 critique).
      rockMaterial.color.setRGB(lerp(t[0], 1, 0.8), lerp(t[1], 1, 0.8), lerp(t[2], 1, 0.8), THREE.SRGBColorSpace);
      // The fans' saturated colour soaks into the blue faster, so the deep
      // fans are blue-grey lace, not purple and red (round 2).
      fansMaterial.color.setRGB(lerp(t[0], 1, 0.5), lerp(t[1], 1, 0.5), lerp(t[2], 1, 0.5), THREE.SRGBColorSpace);

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
      reefTop.geometry.dispose();
      for (const mesh of fanMeshes) mesh.geometry.dispose();
      rockMaterial.dispose();
      fansMaterial.dispose();
      lace.dispose();
      ctx.scene.remove(wall, reefTop, sun, sky);
    },
  };
}
