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
import { fanGeometry, fanMaterial, laceTexture, softCoralTexture, type FanPlacement } from './reefFans';
import { withReefShading, type ReefPhotos } from './reefShading';
import {
  REEF_LENGTH_M,
  REEF_MID_Z,
  REEF_SEED,
  WALL_TOP_DEPTH_M,
  fbm2,
  meander,
  vnoise2,
  wallRelief,
  wallZ,
} from '../reefShape';

const SEED = REEF_SEED;
// The reef top stops this far west of the crest line, under the rim.
const REEF_TOP_EAST_U = -4;
// Where the camera's dive passes (timeline.ts CAMERA_PATH): growth is
// densest here, as the reef a diver remembers is the stretch they swam.
const PATH_NORTH_Z = -10;
const PATH_SOUTH_Z = -170;

type RGBTuple = [number, number, number];

// The rock under the life: the pale aqua-olive of coral rubble and old
// limestone in the reference slope (Wei Yan's clip 3), not grey.
const ROCK_A: RGBTuple = [0.64, 0.68, 0.58];
const ROCK_B: RGBTuple = [0.42, 0.47, 0.41];
// Hard and soft coral, sponge and algae tones of the reference reef.
const CORALS: readonly RGBTuple[] = [
  [0.88, 0.44, 0.26],
  [0.56, 0.34, 0.64],
  [0.7, 0.72, 0.28],
  [0.84, 0.3, 0.42],
  [0.88, 0.74, 0.3],
  [0.42, 0.62, 0.52],
];
// Sea fans and hydroids: mostly the olive-gold and cream feathers that
// cover the reference wall (clip 4), with the deep red gorgonians of
// Komodo's walls.
const FANS: readonly RGBTuple[] = [
  [0.78, 0.7, 0.36],
  [0.86, 0.8, 0.56],
  [0.7, 0.62, 0.3],
  [0.9, 0.84, 0.7],
  [0.64, 0.14, 0.14],
  [0.82, 0.5, 0.26],
];
// Plate and foliose corals: the lime-yellow tiers that stack out of the
// reference wall's ledges, a few olive and brown.
const PLATES: readonly RGBTuple[] = [
  [0.74, 0.8, 0.26],
  [0.68, 0.74, 0.3],
  [0.8, 0.76, 0.32],
  [0.56, 0.6, 0.3],
  [0.5, 0.42, 0.32],
];
// Soft-coral trees (Dendronephthya): the polyp colours of Komodo's walls
// (Cannibal Rock; Mini Wall's pinks, purples and oranges).
const SOFT_CORALS: readonly RGBTuple[] = [
  [0.98, 0.52, 0.32],
  [0.95, 0.42, 0.58],
  [0.86, 0.22, 0.52],
  [0.62, 0.34, 0.84],
  [0.88, 0.2, 0.22],
  [0.98, 0.8, 0.28],
  [0.96, 0.62, 0.42],
];

function mix3(a: RGBTuple, b: RGBTuple, t: number): RGBTuple {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

const scale3 = (c: RGBTuple, k: number): RGBTuple => [c[0] * k, c[1] * k, c[2] * k];

// Growth tones under the shader's mosaic (reefShading.ts): olive, gold
// and sage, so even the broad patches read as living cover.
const GROWTH: readonly RGBTuple[] = [
  [0.68, 0.6, 0.32],
  [0.56, 0.6, 0.32],
  [0.48, 0.62, 0.52],
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

/** A share, 0..1, the shader reads at each vertex: 'life', how much of the
 *  living mosaic it carries; 'rock', how much of it is bare rock under the
 *  photographs (coral tissue is not). */
function setShare(
  geometry: THREE.BufferGeometry,
  name: 'life' | 'rock',
  at: number | ((x: number, y: number, z: number) => number),
) {
  const pos = geometry.getAttribute('position');
  const share = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    share[i] = typeof at === 'number' ? at : at(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  geometry.setAttribute(name, new THREE.BufferAttribute(share, 1));
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
  setShare(g, 'life', 0.55);
  setShare(g, 'rock', 0.7);
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
  setShare(g, 'life', 0.5);
  setShare(g, 'rock', 0.2);
  return g;
}

/** A plate (foliose) coral, as stacks out of the reference wall's ledges: a
 *  thin, gently cupped disc with a wavy rim, paler at its growing edge, its
 *  underside in shadow. Level, in its own xz plane. */
function plateCoral(radius: number, seed: number, colour: RGBTuple): THREE.BufferGeometry {
  const upper = new THREE.RingGeometry(0.02, radius, 22, 5);
  upper.deleteAttribute('uv');
  upper.rotateX(-Math.PI / 2);
  const pos = upper.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z) / radius;
    const a = Math.atan2(z, x);
    pos.setY(i, radius * (0.14 * r * r + 0.05 * r * Math.sin(a * 5 + seed) + 0.03 * r * Math.sin(a * 11 + seed * 2)));
  }
  upper.computeVertexNormals();
  setColour(upper, (x, _y, z) => {
    const r = Math.hypot(x, z) / radius;
    const body = scale3(colour, lerp(0.72, 1.12, r * r));
    return r > 0.9 ? mix3(body, [0.92, 0.94, 0.74], 0.6) : body;
  });
  // The underside: the same surface a little lower, wound the other way.
  const lower = upper.clone();
  lower.translate(0, -0.07, 0);
  const index = lower.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  lower.computeVertexNormals();
  setColour(lower, () => scale3(colour, 0.42));
  const g = mergeGeometries([upper, lower])!;
  setShare(g, 'life', 0.45);
  setShare(g, 'rock', 0.15);
  return g;
}

/** The face, built in its own frame (see wallRelief): the layer turns it to
 *  run north–south along the crest, facing east into the blue. */
function buildWall(): { rock: THREE.BufferGeometry; fans: FanPlacement[]; bushes: FanPlacement[]; height: number } {
  const height = WALL_BOTTOM_DEPTH_M - WALL_TOP_DEPTH_M;
  // Two vertices a metre: the rock grain in the shader carries the rest.
  const face = new THREE.PlaneGeometry(REEF_LENGTH_M, height, REEF_LENGTH_M * 2, Math.round(height * 2));
  face.deleteAttribute('uv');
  const top = height / 2;
  const pos = face.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, wallZ(pos.getX(i), pos.getY(i), top));
  face.computeVertexNormals();
  setColour(face, (x, y) => scale3(reefColour(x, y, SEED + 30), occlusion(wallRelief(x, y, top).detail, 0.5, 0.45)));
  setShare(face, 'life', 1);
  setShare(face, 'rock', 1);

  // Plate corals in tiers of two to four, stacking out of the face down the
  // camera's line of descent, as on the reference wall (clip 4).
  const parts: THREE.BufferGeometry[] = [face];
  for (let i = 0; i < 80; i++) {
    const z = lerp(PATH_NORTH_Z - 50, PATH_SOUTH_Z, hash1(i, SEED + 100));
    const x = REEF_MID_Z - z;
    let y = top - 2 - hash1(i, SEED + 101) ** 1.2 * 24;
    let r = 0.6 + 1.0 * hash1(i, SEED + 102) ** 1.5;
    const colour = PLATES[Math.floor(hash1(i, SEED + 103) * PLATES.length)];
    const tiers = 2 + Math.floor(hash1(i, SEED + 104) * 3);
    for (let k = 0; k < tiers; k++) {
      const plate = plateCoral(r, i * 7 + k, colour);
      plate.rotateY(hash1(i * 5 + k, SEED + 105) * Math.PI * 2);
      plate.rotateX((hash1(i * 5 + k, SEED + 106) - 0.5) * 0.25);
      plate.translate(x + (hash1(i * 5 + k, SEED + 107) - 0.5) * r, y, wallZ(x, y, top) + 0.6 * r);
      parts.push(plate);
      y -= 0.45 + 0.4 * hash1(i * 5 + k, SEED + 108);
      r *= 0.78;
    }
  }

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
  // Soft-coral trees, upright on the ledges or hanging from overhangs, as
  // they grow on a current-swept wall; two crossed quads each, for body.
  const bushes: FanPlacement[] = [];
  for (let i = 0; i < 320; i++) {
    const z = lerp(PATH_NORTH_Z - 45, PATH_SOUTH_Z, hash1(i, SEED + 110));
    const x = REEF_MID_Z - z;
    const y = top - 1.5 - hash1(i, SEED + 111) ** 1.2 * 28;
    const width = 0.6 + 1.1 * hash1(i, SEED + 112) ** 2;
    const hanging = hash1(i, SEED + 113) < 0.4;
    const yaw = (hash1(i, SEED + 114) - 0.5) * 1.6;
    const tilt = hanging ? Math.PI - 0.25 - 0.4 * hash1(i, SEED + 115) : -0.15 - 0.3 * hash1(i, SEED + 115);
    const colour = SOFT_CORALS[Math.floor(hash1(i, SEED + 116) * SOFT_CORALS.length)];
    const position = new THREE.Vector3(x, y, wallZ(x, y, top) + 0.25 * width);
    bushes.push({ position, width, yaw, tilt, colour });
    bushes.push({ position: position.clone(), width: width * 0.92, yaw: yaw + Math.PI / 2, tilt, colour });
  }
  return { rock: mergeGeometries(parts)!, fans, bushes, height };
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

function buildReefTop(): { rock: THREE.BufferGeometry; fans: FanPlacement[]; bushes: FanPlacement[] } {
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
  // Living cover on the spurs; the sand channels stay sand, with less of
  // the rubble in them.
  setShare(ground, 'life', (u, _y, z) => 1 - channel(u, z));
  setShare(ground, 'rock', (u, _y, z) => 1 - 0.4 * channel(u, z));
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
    const colour = mix3(reefColour(u, z, SEED + 60), PLATES[Math.floor(hash1(i, SEED + 82) * PLATES.length)], 0.75);
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
  const bushes: FanPlacement[] = [];
  for (let i = 0; i < 60; i++) {
    const [u, z] = near(i, SEED + 120);
    if (channel(u, z) > 0.3) continue;
    const position = new THREE.Vector3(crestX(u, z), reefTopY(u, z) - 0.05, z);
    const width = 0.5 + 0.8 * hash1(i, SEED + 122) ** 2;
    const yaw = hash1(i, SEED + 123) * Math.PI;
    const tilt = (hash1(i, SEED + 124) - 0.5) * 0.3;
    const colour = SOFT_CORALS[Math.floor(hash1(i, SEED + 125) * SOFT_CORALS.length)];
    bushes.push({ position, width, yaw, tilt, colour });
    bushes.push({ position: position.clone(), width: width * 0.92, yaw: yaw + Math.PI / 2, tilt, colour });
  }
  return { rock: mergeGeometries(parts)!, fans, bushes };
}

// Photographs of real rock (Poly Haven, CC0): mossy_rock, lichen crust on
// granite, standing in for a wall's encrusting algae and sponge; and
// coral_ground_02, porous coral rubble. Re-encoded small by
// scripts/dive-textures.mjs, which also measures the means.
const PHOTOS_URL = '/dive/textures';
// Past this, the dive starts on the procedural surface rather than wait.
const PHOTOS_WAIT_MS = 8000;

async function loadPhotos(renderer: THREE.WebGLRenderer): Promise<ReefPhotos | null> {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const load = async (file: string, colour: boolean) => {
    const t = await loader.loadAsync(`${PHOTOS_URL}/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (colour) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const all = Promise.all([
    load('crust.webp', true),
    load('crust-normal.jpg', false),
    load('rubble.webp', true),
    load('rubble-normal.jpg', false),
  ]);
  const late = new Promise<null>((r) => setTimeout(() => r(null), PHOTOS_WAIT_MS));
  try {
    const got = await Promise.race([all, late]);
    if (!got) {
      // Too late to use: let them go when they do arrive.
      all.then((ts) => ts.forEach((t) => t.dispose())).catch(() => {});
      return null;
    }
    const [crust, crustNormal, rubble, rubbleNormal] = got;
    return {
      // The crust keeps half its hue (grey rock against yellow-green lichen
      // is what makes it read as encrusted); the rubble's sandy orange,
      // which the water takes, hardly any.
      crust: { map: crust, mean: [0.161, 0.156, 0.101], normal: crustNormal, tileM: 3, hue: 0.5 },
      rubble: { map: rubble, mean: [0.335, 0.209, 0.109], normal: rubbleNormal, tileM: 2, hue: 0.15 },
    };
  } catch {
    return null;
  }
}

export default function createReefLayer(): Layer {
  let ctx: LayerContext;
  let photos: ReefPhotos | null = null;
  let rockMaterial: THREE.MeshStandardMaterial;
  let fansMaterial: THREE.MeshStandardMaterial;
  let softMaterial: THREE.MeshStandardMaterial;
  let lace: THREE.Texture;
  let softTexture: THREE.Texture;
  let wall: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  let reefTop: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const fanMeshes: THREE.Mesh[] = [];
  let sun: THREE.DirectionalLight;
  let sky: THREE.HemisphereLight;
  const uniforms = { uCausticTime: { value: 0 }, uCamY: { value: 0 } };

  return {
    id: 'reef',
    async init(c) {
      ctx = c;
      photos = await loadPhotos(ctx.renderer);
      rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      withReefShading(rockMaterial, uniforms, { grain: true, mosaic: true, photos: photos ?? undefined });
      lace = laceTexture(SEED);
      fansMaterial = fanMaterial(lace);
      withReefShading(fansMaterial, uniforms);
      softTexture = softCoralTexture(SEED + 7);
      softMaterial = fanMaterial(softTexture);
      softMaterial.roughness = 0.75;
      withReefShading(softMaterial, uniforms, { polyps: true });
      const w = buildWall();
      const t = buildReefTop();
      wall = new THREE.Mesh(w.rock, rockMaterial);
      // Its own frame turned so the face runs north–south along the crest,
      // facing east (wall-local +z → world +x, wall-local x → world −z).
      wall.rotation.y = Math.PI / 2;
      wall.position.set(EDGE_X, worldY(WALL_TOP_DEPTH_M) - w.height / 2, REEF_MID_Z);
      reefTop = new THREE.Mesh(t.rock, rockMaterial);
      for (const [parent, fans, material] of [
        [wall, w.fans, fansMaterial],
        [reefTop, t.fans, fansMaterial],
        [wall, w.bushes, softMaterial],
        [reefTop, t.bushes, softMaterial],
      ] as const) {
        const mesh = new THREE.Mesh(fanGeometry(fans), material);
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

      // The light reaching the reef is filtered by the water above it, which
      // the dive camera mostly white-balances away: only a light cast here.
      // The colour lost between the reef and the lens is per pixel, by
      // distance (absorb.ts) — vivid close, blue-green far — which is what
      // made the old, uniform depth tint read as dull.
      const t = water.transmittance;
      const cast = (keep: number, m: THREE.MeshStandardMaterial) =>
        m.color.setRGB(lerp(t[0], 1, keep), lerp(t[1], 1, keep), lerp(t[2], 1, keep), THREE.SRGBColorSpace);
      cast(0.9, rockMaterial);
      cast(0.82, fansMaterial);
      cast(0.88, softMaterial);

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
      sky.intensity = 1.9 + 2.8 * water.ambient;
    },
    dispose() {
      wall.geometry.dispose();
      reefTop.geometry.dispose();
      for (const mesh of fanMeshes) mesh.geometry.dispose();
      rockMaterial.dispose();
      fansMaterial.dispose();
      softMaterial.dispose();
      lace.dispose();
      softTexture.dispose();
      if (photos) {
        for (const p of [photos.crust, photos.rubble]) {
          p.map.dispose();
          p.normal.dispose();
        }
      }
      ctx.scene.remove(wall, reefTop, sun, sky);
    },
  };
}
