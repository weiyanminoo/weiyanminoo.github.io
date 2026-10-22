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
import {
  FAN_VARIANTS,
  anemoneTexture,
  fanGeometry,
  fanMaterial,
  fanTexture,
  softCoralTexture,
  type FanPlacement,
} from './reefFans';
import { TORCH } from './absorb';
import { withReefShading, type ReefPhotos } from './reefShading';
import {
  ANEMONES,
  BOMMIES,
  PATH_BOMMIE,
  REEF_LENGTH_M,
  REEF_MID_Z,
  REEF_SEED,
  REEF_TOP_EAST_U,
  WALL_TOP_DEPTH_M,
  anemoneTop,
  channel,
  crestX,
  fbm2,
  reefTopRelief,
  reefTopY,
  vnoise2,
  wallRelief,
  wallZ,
} from '../reefShape';

const SEED = REEF_SEED;
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
// Table corals: the tan, cream and pale brown of Acropora tables, one
// lilac-tipped, one olive.
const TABLES: readonly RGBTuple[] = [
  [0.86, 0.72, 0.48],
  [0.9, 0.82, 0.6],
  [0.78, 0.62, 0.4],
  [0.7, 0.64, 0.76],
  [0.74, 0.7, 0.42],
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
// Sponges: the rust and orange of barrel sponges, the purple, yellow and
// red of tube sponges — the shapes a tropical wall is known by.
const BARRELS: readonly RGBTuple[] = [
  [0.74, 0.34, 0.18],
  [0.62, 0.26, 0.2],
  [0.86, 0.5, 0.22],
  [0.7, 0.42, 0.26],
];
const TUBES: readonly RGBTuple[] = [
  [0.56, 0.3, 0.72],
  [0.9, 0.78, 0.3],
  [0.42, 0.36, 0.64],
  [0.86, 0.36, 0.3],
  [0.94, 0.6, 0.24],
];
// Anemones: tan-olive tentacles tipped pink or violet.
const ANEMONE_STALK = [0.62, 0.6, 0.42] as const;
const ANEMONE_TIPS: readonly RGBTuple[] = [
  [0.92, 0.5, 0.68],
  [0.66, 0.46, 0.84],
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
  // A big head (a bommie) is lobed at the same 30–50 cm as a small one, so
  // it needs the vertices to carry it.
  const big = radius > 1.4;
  const raw = new THREE.IcosahedronGeometry(radius, radius < 0.6 ? 2 : big ? 4 : 3);
  raw.deleteAttribute('normal');
  raw.deleteAttribute('uv');
  const g = mergeVertices(raw);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  const freq = big ? 3.4 : 2.1;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm2(v.x * freq + seed, v.y * freq + v.z * freq * 0.8, SEED + 9, 3);
    v.multiplyScalar(1 + (big ? 0.18 : 0.28) * n);
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
  // The colonies' one projection streaks round a head (reefShading.ts), so
  // a head carries them lightly and takes its surface from the photograph.
  setShare(g, 'life', big ? 0.4 : 0.55);
  setShare(g, 'rock', big ? 0.65 : 0.7);
  return g;
}

/** A table coral (Acropora): a wide, thin plate on a short stalk, its rim
 *  uneven and its top a close stubble of branch tips, which the rubble
 *  photograph and a little relief carry — flat and smooth it read as a
 *  lily pad (round 8). Underside and stalk in shadow. */
function tableCoral(radius: number, colour: RGBTuple, seed = 0): THREE.BufferGeometry {
  const plate = new THREE.CylinderGeometry(radius, radius * 0.9, 0.1, 24, 3);
  const pos = plate.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z) / radius;
    const a = Math.atan2(z, x);
    // The rim wanders in and out; the top is stubbled.
    const rim = 1 + 0.08 * Math.sin(a * 5 + seed) + 0.05 * Math.sin(a * 9 + seed * 1.7);
    const y = pos.getY(i);
    const stubble = y > 0.04 ? 0.08 * fbm2(x * 4 + seed, z * 4, SEED + 11, 2) : 0;
    pos.setXYZ(i, x * rim, y + stubble, z * rim);
  }
  plate.translate(0, 0.45, 0);
  const stalk = new THREE.CylinderGeometry(0.2, 0.3, 0.45, 7, 1);
  stalk.translate(0, 0.22, 0);
  const g = mergeGeometries([plate.toNonIndexed(), stalk.toNonIndexed()])!;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  setColour(g, (x, y, z) => {
    if (y < 0.49) return scale3(colour, 0.5);
    // Paler at the growing rim.
    const r = Math.hypot(x, z) / radius;
    return mix3(colour, [0.94, 0.9, 0.78], 0.5 * smoothstep(0.8, 1.05, r));
  });
  setShare(g, 'life', 0.3);
  // Mostly the rubble photograph: a flat tan disc read as a slab of slate.
  setShare(g, 'rock', 0.9);
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
  // Enough of the photograph to give the plate a surface: flat colour
  // read as a cut-out leaf.
  setShare(g, 'rock', 0.45);
  return g;
}

/** A barrel sponge: a thick-walled vase, ribbed and warty, open at the top
 *  into a dark cavity. Upright, holdfast at the origin. */
function barrelSponge(radius: number, height: number, seed: number, colour: RGBTuple): THREE.BufferGeometry {
  const R = radius;
  const H = height;
  const profile = [
    [0.5, 0],
    [0.78, 0.22],
    [0.93, 0.55],
    [1.0, 0.86],
    [0.97, 1.0],
    [0.72, 1.0],
    [0.62, 0.86],
    [0.58, 0.5],
    [0.01, 0.42],
  ].map(([r, y]) => new THREE.Vector2(r * R, y * H));
  const lathe = new THREE.LatheGeometry(profile, 20);
  lathe.deleteAttribute('uv');
  const g = mergeVertices(lathe);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const rr = Math.hypot(x, z);
    if (rr < 0.05 * R) continue;
    const a = Math.atan2(z, x);
    const k = 1 + 0.07 * Math.sin(a * 8 + seed) + 0.06 * vnoise2(a * 3, (pos.getY(i) / H) * 4, seed);
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  g.computeVertexNormals();
  setColour(g, (x, y, z) =>
    Math.hypot(x, z) < 0.76 * R && y > 0.45 * H ? scale3(colour, 0.3) : scale3(colour, lerp(0.7, 1.05, y / H)),
  );
  setShare(g, 'life', 0.1);
  setShare(g, 'rock', 0.45);
  return g;
}

/** A cluster of tube sponges: three to six tapered tubes leaning apart,
 *  each open at the top. Upright, holdfast at the origin. */
function tubeSponges(seed: number, colour: RGBTuple): THREE.BufferGeometry {
  const tubes = 3 + Math.floor(hash1(0, seed) * 4);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 1; k <= tubes; k++) {
    const h = 0.35 + 0.65 * hash1(k, seed + 1) ** 1.5;
    const r = 0.05 + 0.05 * hash1(k, seed + 2);
    const tube = new THREE.CylinderGeometry(r, r * 0.6, h, 9, 1);
    tube.deleteAttribute('uv');
    tube.translate(0, h / 2, 0);
    tube.rotateZ((hash1(k, seed + 3) - 0.5) * 0.7);
    tube.rotateY(hash1(k, seed + 4) * Math.PI * 2);
    tube.translate((hash1(k, seed + 5) - 0.5) * 0.3, 0, (hash1(k, seed + 6) - 0.5) * 0.3);
    const top = h - 0.001;
    // The lip of each tube is its own point up: its opening is dark.
    const cap = tube.getAttribute('position');
    let yMax = -Infinity;
    for (let i = 0; i < cap.count; i++) yMax = Math.max(yMax, cap.getY(i));
    setColour(tube, (_x, y) => (y > yMax - 0.02 ? scale3(colour, 0.25) : scale3(colour, 0.85 + 0.2 * hash1(k, seed + 7))));
    parts.push(tube);
    void top;
  }
  const g = mergeGeometries(parts)!;
  setShare(g, 'life', 0.1);
  setShare(g, 'rock', 0.35);
  return g;
}

/** Scales each ring of a tube about its own point on the curve, so the
 *  tube tapers: `scale(t)` along the curve, 0 at its start. */
function taperTube(tube: THREE.TubeGeometry, curve: THREE.Curve<THREE.Vector3>, scale: (t: number) => [number, number, number]) {
  const { tubularSegments, radialSegments } = tube.parameters;
  const pos = tube.getAttribute('position');
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / (radialSegments + 1)) / tubularSegments;
    curve.getPointAt(t, c);
    const [kx, ky, kz] = scale(t);
    pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * kx, c.y + (pos.getY(i) - c.y) * ky, c.z + (pos.getZ(i) - c.z) * kz);
  }
}

function blob(radius: number, detail: number): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(radius, detail);
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  return mergeVertices(raw);
}

/** A giant moray out of a hole in the face, in the wall's frame (z out of
 *  the rock): its neck from inside the rock out and up to the head, which
 *  is thicker, flattened a little sideways, and dark under the snout where
 *  the mouth gapes. Tan, dark-speckled, pale below; a big one, as it has
 *  to read from the camera's line 5 m off the face. */
function moray(seed: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -0.6),
    new THREE.Vector3(0.08, 0.03, -0.2),
    new THREE.Vector3(-0.06, 0.16, 0.25),
    new THREE.Vector3(0.04, 0.2, 0.62),
  ]);
  // Vertices every 7 cm, so the pattern (per vertex) keeps its blotches.
  const tube = new THREE.TubeGeometry(curve, 36, 0.1, 14, false);
  tube.deleteAttribute('uv');
  tube.deleteAttribute('normal');
  taperTube(tube, curve, (t) => {
    const k = lerp(0.85, 1.15, t) * (t > 0.9 ? lerp(1, 0.6, (t - 0.9) / 0.1) : 1);
    return [k * 0.85, k, k];
  });
  const end = curve.getPointAt(1);
  const tip = blob(0.075, 2);
  tip.scale(0.85, 0.8, 1.3);
  tip.translate(end.x, end.y, end.z);
  // The lower jaw, dropped: a moray holds its mouth open to breathe, and
  // the gape is what says moray from across the water.
  const jaw = blob(0.06, 2);
  jaw.scale(0.75, 0.45, 1.15);
  jaw.translate(end.x, end.y - 0.13, end.z + 0.02);
  const parts = [tube, tip, jaw];
  const eyes = [-1, 1].map((side) => new THREE.Vector3(end.x + side * 0.06, end.y + 0.045, end.z - 0.03));
  for (const at of eyes) {
    const eye = blob(0.024, 1);
    eye.translate(at.x, at.y, at.z);
    parts.push(eye);
  }
  const SCALE = 2.2;
  const g = mergeGeometries(parts)!;
  g.scale(SCALE, SCALE, SCALE);
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const colours = new Float32Array(pos.count * 3);
  const colour: RGBTuple = [0.84, 0.7, 0.4];
  const jawTop = (end.y - 0.08) * SCALE;
  const snout = 1.15;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const { y, z } = v;
    const ny = nor.getY(i);
    const below = smoothstep(-0.2, -0.7, ny);
    // Dark blotches over tan, 30 cm across: a leopard pattern that still
    // reads at 8 m, where fine speckles averaged to mud.
    const blotch = smoothstep(0.1, 0.4, vnoise2(v.x * 7 + seed, z * 4.5 + y * 3, seed));
    let c = mix3(mix3(colour, [0.18, 0.12, 0.06], 0.9 * blotch), [0.92, 0.88, 0.72], below);
    if (z > snout) {
      const inJaw = y < jawTop;
      // The inside of the mouth: the snout's underside, the jaw's top.
      if (inJaw ? ny > 0.2 : ny < -0.35) c = [0.14, 0.08, 0.08];
      else if (inJaw) c = [0.92, 0.88, 0.72];
    }
    if (eyes.some((e) => v.distanceToSquared(e.clone().multiplyScalar(SCALE)) < (0.024 * SCALE * 1.4) ** 2)) {
      c = [0.05, 0.04, 0.03];
    }
    colours.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  setShare(g, 'life', 0);
  setShare(g, 'rock', 0.2);
  return g;
}

/** An octopus settled on the rock: a mantle, two eyes, and eight arms
 *  curling out and up from under it, each a tube tapering to its tip.
 *  Mottled rust-brown, paler underneath. Upright, on the ground at the
 *  origin. */
function octopus(seed: number): THREE.BufferGeometry {
  const colour: RGBTuple = [0.58, 0.3, 0.2];
  const mantle = blob(0.24, 3);
  mantle.scale(1, 0.8, 1.35);
  mantle.translate(0, 0.22, -0.12);
  const parts = [mantle];
  for (const side of [-1, 1]) {
    const eye = blob(0.035, 2);
    eye.translate(side * 0.13, 0.36, 0.14);
    parts.push(eye);
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const spread = 0.6 + 0.35 * hash1(k, seed);
    const curl = 0.5 + 0.8 * hash1(k, seed + 1);
    const at = (r: number, turn: number, y: number) =>
      new THREE.Vector3(r * spread * Math.cos(a + turn * curl), y, r * spread * Math.sin(a + turn * curl));
    const curve = new THREE.CatmullRomCurve3([at(0.2, 0, 0.1), at(0.4, 0, 0.02), at(0.75, 0.25, 0), at(0.9, 0.7, 0.12 * curl)]);
    const arm = new THREE.TubeGeometry(curve, 14, 0.055, 8, false);
    arm.deleteAttribute('uv');
    arm.deleteAttribute('normal');
    taperTube(arm, curve, (t) => {
      const k2 = lerp(1, 0.2, t);
      return [k2, k2, k2];
    });
    parts.push(arm);
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  setColour(g, (x, y, z) => {
    // The eyes: a dull gold, dark where they face forward (the pupil).
    if (y > 0.33 && Math.abs(x) > 0.09 && z > 0.1) return z > 0.165 ? [0.1, 0.08, 0.05] : [0.5, 0.42, 0.18];
    const mottle = lerp(0.7, 1.15, 0.5 + 0.5 * vnoise2(x * 14 + seed, z * 14, seed));
    return scale3(colour, mottle * (y < 0.03 ? 0.8 : 1));
  });
  setShare(g, 'life', 0);
  setShare(g, 'rock', 0.25);
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

  const parts: THREE.BufferGeometry[] = [face];

  // Two giant morays looking out of the face where the camera looks at it
  // (timeline.ts CAMERA_KEYS): down the wall ahead at the first from the
  // drop-off (0.5–0.54), left at the second as the camera turns to the
  // deep wall at its own depth (0.78–0.81). Each on the spur that comes
  // nearest the camera's line, and nothing grows over its hole.
  const holes: { x: number; y: number }[] = [];
  for (const [i, zFrom, zTo, depth, yaw] of [
    [0, -78, -84, 22.5, 0.3],
    [1, -138, -144, 33, -0.25],
  ] as const) {
    const y = top - (depth - WALL_TOP_DEPTH_M);
    let x = REEF_MID_Z - zFrom;
    for (let z = zFrom; z >= zTo; z -= 0.5) {
      if (wallZ(REEF_MID_Z - z, y, top) > wallZ(x, y, top)) x = REEF_MID_Z - z;
    }
    const eel = moray(70 + i);
    eel.rotateY(yaw);
    eel.rotateX(-0.15);
    eel.translate(x, y, wallZ(x, y, top) - 0.05);
    parts.push(eel);
    holes.push({ x, y });
  }
  const overHole = (x: number, y: number) => holes.some((h) => Math.hypot(h.x - x, h.y - y) < 2.5);

  // Plate corals in tiers of two to four, stacking out of the face down the
  // camera's line of descent, as on the reference wall (clip 4).
  for (let i = 0; i < 80; i++) {
    const z = lerp(PATH_NORTH_Z - 50, PATH_SOUTH_Z, hash1(i, SEED + 100));
    const x = REEF_MID_Z - z;
    let y = top - 2 - hash1(i, SEED + 101) ** 1.2 * 24;
    if (overHole(x, y)) continue;
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

  // Sponges down the dive's line: barrels growing out from the rock,
  // tipped up, and clusters of tubes.
  for (let i = 0; i < 26; i++) {
    const z = lerp(PATH_NORTH_Z - 45, PATH_SOUTH_Z, hash1(i, SEED + 140));
    const x = REEF_MID_Z - z;
    const y = top - 2 - hash1(i, SEED + 141) ** 1.2 * 26;
    if (overHole(x, y)) continue;
    const r = 0.3 + 0.4 * hash1(i, SEED + 142);
    const barrel = barrelSponge(r, r * (1.4 + 0.8 * hash1(i, SEED + 143)), i, BARRELS[Math.floor(hash1(i, SEED + 144) * BARRELS.length)]);
    barrel.rotateX(Math.PI / 2 - 0.45 - 0.4 * hash1(i, SEED + 145));
    barrel.rotateY((hash1(i, SEED + 146) - 0.5) * 0.8);
    barrel.translate(x, y, wallZ(x, y, top) - 0.1);
    parts.push(barrel);
  }
  for (let i = 0; i < 70; i++) {
    const z = lerp(PATH_NORTH_Z - 45, PATH_SOUTH_Z, hash1(i, SEED + 150));
    const x = REEF_MID_Z - z;
    const y = top - 1.5 - hash1(i, SEED + 151) ** 1.2 * 27;
    if (overHole(x, y)) continue;
    const tubes = tubeSponges(300 + i, TUBES[Math.floor(hash1(i, SEED + 152) * TUBES.length)]);
    tubes.rotateX(Math.PI / 2 - 0.6 - 0.5 * hash1(i, SEED + 153));
    tubes.rotateY((hash1(i, SEED + 154) - 0.5) * 0.8);
    tubes.translate(x, y, wallZ(x, y, top) - 0.05);
    parts.push(tubes);
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
    if (overHole(x, y)) continue;
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
      variant: Math.floor(hash1(i, SEED + 47) * FAN_VARIANTS),
    });
  }
  // Soft-coral trees, upright on the ledges or hanging from overhangs, as
  // they grow on a current-swept wall; two crossed quads each, for body.
  const bushes: FanPlacement[] = [];
  for (let i = 0; i < 320; i++) {
    const z = lerp(PATH_NORTH_Z - 45, PATH_SOUTH_Z, hash1(i, SEED + 110));
    const x = REEF_MID_Z - z;
    const y = top - 1.5 - hash1(i, SEED + 111) ** 1.2 * 28;
    if (overHole(x, y)) continue;
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

// Sand in the channels.
const SAND: RGBTuple = [0.8, 0.76, 0.64];

function buildReefTop(): {
  rock: THREE.BufferGeometry;
  fans: FanPlacement[];
  bushes: FanPlacement[];
  anemones: FanPlacement[];
} {
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
  // Bommies (reefShape.ts): big lobed heads standing up from the spurs
  // along the dive's line, each crowned with a table coral and skirted
  // with plates — the foreground the reef top was missing, close enough
  // to the camera for the torch to reach (round 8).
  BOMMIES.forEach((b, i) => {
    const squash = b.h / b.r;
    const tint = CORALS[Math.floor(hash1(i, SEED + 160) * CORALS.length)];
    const head = coralHead(b.r, squash, 'y', 2000 + i, mix3(reefColour(b.u, b.z, SEED + 60), tint, 0.3));
    const x = crestX(b.u, b.z);
    const ground = reefTopY(b.u, b.z);
    head.translate(x, ground - b.h * 0.2, b.z);
    parts.push(head);
    const crown = tableCoral(0.35 * b.r + 0.3 * hash1(i, SEED + 161), TABLES[i % TABLES.length], i * 3.1);
    crown.rotateY(hash1(i, SEED + 162) * Math.PI);
    crown.translate(x + (hash1(i, SEED + 163) - 0.5) * 0.6, ground + b.h * 0.95, b.z + (hash1(i, SEED + 164) - 0.5) * 0.6);
    parts.push(mergeVertices(crown));
    for (let k = 0; k < 3; k++) {
      const a = hash1(i * 3 + k, SEED + 165) * Math.PI * 2;
      const plate = plateCoral(0.4 + 0.5 * hash1(i * 3 + k, SEED + 166), i * 3 + k, PLATES[(i + k) % PLATES.length]);
      plate.rotateX((hash1(i * 3 + k, SEED + 167) - 0.5) * 0.4);
      plate.translate(x + Math.cos(a) * b.r * 0.85, ground + b.h * (0.3 + 0.4 * hash1(i * 3 + k, SEED + 168)), b.z + Math.sin(a) * b.r * 0.85);
      parts.push(plate);
    }
  });
  // Anemones beside the line (reefShape.ts): a low disc under four crossed
  // quads of tentacles.
  const anemones: FanPlacement[] = [];
  ANEMONES.forEach((a, i) => {
    const [x, y, z] = anemoneTop(a);
    const colour = ANEMONE_TIPS[i % ANEMONE_TIPS.length];
    for (let k = 0; k < 4; k++) {
      anemones.push({ position: new THREE.Vector3(x, y - 0.12, z), width: 2 * a.r, yaw: (k * Math.PI) / 4, tilt: 0, colour });
    }
    const disc = coralHead(a.r * 0.9, 0.3, 'y', 3000 + i, [0.5, 0.46, 0.32]);
    disc.translate(x, y - 0.25, z);
    parts.push(disc);
  });
  // An octopus at the foot of the bommie beside the line, on its north
  // side, facing the camera as it comes down over the reef top: the head
  // behind it gives it a shape to stand against.
  {
    const u = PATH_BOMMIE.u + 0.3;
    const z = PATH_BOMMIE.z + PATH_BOMMIE.r * 1.05 + 0.2;
    const o = octopus(80);
    o.rotateY(0.3);
    o.translate(crestX(u, z), reefTopY(u, z) - 0.02, z);
    parts.push(o);
  }
  // Sponges on the spurs: barrels upright, tube clusters among them.
  for (let i = 0; i < 14; i++) {
    const [u, z] = near(i, SEED + 170);
    if (channel(u, z) > 0.3) continue;
    const r = 0.3 + 0.4 * hash1(i, SEED + 172);
    const barrel = barrelSponge(r, r * (1.3 + 0.8 * hash1(i, SEED + 173)), 50 + i, BARRELS[Math.floor(hash1(i, SEED + 174) * BARRELS.length)]);
    barrel.rotateY(hash1(i, SEED + 175) * Math.PI * 2);
    barrel.translate(crestX(u, z), reefTopY(u, z) - 0.1, z);
    parts.push(barrel);
  }
  for (let i = 0; i < 30; i++) {
    const [u, z] = near(i, SEED + 180);
    if (channel(u, z) > 0.3) continue;
    const tubes = tubeSponges(400 + i, TUBES[Math.floor(hash1(i, SEED + 182) * TUBES.length)]);
    tubes.rotateY(hash1(i, SEED + 183) * Math.PI * 2);
    tubes.translate(crestX(u, z), reefTopY(u, z) - 0.05, z);
    parts.push(tubes);
  }
  for (let i = 0; i < 44; i++) {
    const [u, z] = i % 4 < 3 ? near(i, SEED + 80) : anywhere(i, SEED + 80);
    if (channel(u, z) > 0.3 || u > REEF_TOP_EAST_U - 3) continue;
    const colour = mix3(reefColour(u, z, SEED + 60), TABLES[Math.floor(hash1(i, SEED + 82) * TABLES.length)], 0.9);
    const table = tableCoral(0.7 + 1.0 * hash1(i, SEED + 83), colour, i * 2.3);
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
      variant: Math.floor(hash1(i, SEED + 96) * FAN_VARIANTS),
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
  return { rock: mergeGeometries(parts)!, fans, bushes, anemones };
}

// Photographs of real rock (Poly Haven, CC0): mossy_rock, lichen crust on
// granite, standing in for a wall's encrusting algae and sponge; and
// coral_ground_02, porous coral rubble. Re-encoded small by
// scripts/dive-textures.mjs, which also measures the means.
const PHOTOS_URL = '/dive/textures';
// Past this, the dive starts on the procedural surface rather than wait.
const PHOTOS_WAIT_MS = 8000;
// The camera's video light (absorb.ts). Without the post pass's shoulder
// its brightest rock would clip, so it is turned down there.
const TORCH_LEVEL = 7;

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
  let anemoneMaterial: THREE.MeshStandardMaterial;
  let lace: THREE.Texture;
  let softTexture: THREE.Texture;
  let anemoneTex: THREE.Texture;
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
      TORCH.uTorch.value = TORCH_LEVEL * (ctx.settings.post ? 1 : 0.7);
      photos = await loadPhotos(ctx.renderer);
      rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
      withReefShading(rockMaterial, uniforms, { grain: true, mosaic: true, photos: photos ?? undefined });
      lace = fanTexture(SEED);
      fansMaterial = fanMaterial(lace);
      withReefShading(fansMaterial, uniforms);
      softTexture = softCoralTexture(SEED + 7);
      softMaterial = fanMaterial(softTexture);
      softMaterial.roughness = 0.75;
      withReefShading(softMaterial, uniforms, { polyps: true });
      anemoneTex = anemoneTexture(SEED + 11);
      anemoneMaterial = fanMaterial(anemoneTex);
      anemoneMaterial.roughness = 0.8;
      withReefShading(anemoneMaterial, uniforms, { polyps: ANEMONE_STALK });
      const w = buildWall();
      const t = buildReefTop();
      wall = new THREE.Mesh(w.rock, rockMaterial);
      // Its own frame turned so the face runs north–south along the crest,
      // facing east (wall-local +z → world +x, wall-local x → world −z).
      wall.rotation.y = Math.PI / 2;
      wall.position.set(EDGE_X, worldY(WALL_TOP_DEPTH_M) - w.height / 2, REEF_MID_Z);
      reefTop = new THREE.Mesh(t.rock, rockMaterial);
      for (const [parent, fans, material, variants] of [
        [wall, w.fans, fansMaterial, FAN_VARIANTS],
        [reefTop, t.fans, fansMaterial, FAN_VARIANTS],
        [wall, w.bushes, softMaterial, 1],
        [reefTop, t.bushes, softMaterial, 1],
        [reefTop, t.anemones, anemoneMaterial, 1],
      ] as const) {
        const mesh = new THREE.Mesh(fanGeometry(fans, variants), material);
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
      cast(0.88, anemoneMaterial);

      // Underwater light is mostly scattered, arriving from everywhere: a
      // gentle sun from above and a strong hemisphere whose "ground" is
      // still lit water, so vertical faces are not left in the dark. Both
      // all but neutral: the camera white-balances, and the blue is the
      // water's — per metre of view (absorb.ts) and in the fog. Blue light
      // on top of that left even the nearest rock teal (round 8).
      sun.color.setRGB(0.92 + 0.08 * t[0], 0.97, 1, THREE.SRGBColorSpace);
      // A diving camera auto-exposes: lit things stay readable at depth
      // while the water itself (the fog) darkens.
      sun.intensity = 3.0 * water.ambient;
      sky.color.setRGB(0.92, 0.96, 1, THREE.SRGBColorSpace);
      sky.groundColor.setRGB(0.44, 0.49, 0.54, THREE.SRGBColorSpace);
      sky.intensity = 1.9 + 2.8 * water.ambient;
    },
    dispose() {
      wall.geometry.dispose();
      reefTop.geometry.dispose();
      for (const mesh of fanMeshes) mesh.geometry.dispose();
      rockMaterial.dispose();
      fansMaterial.dispose();
      softMaterial.dispose();
      anemoneMaterial.dispose();
      lace.dispose();
      softTexture.dispose();
      anemoneTex.dispose();
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
