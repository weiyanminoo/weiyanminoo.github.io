// Sea fans for the reef: gorgonians, the lace that dominates a tropical
// wall and stands in silhouette on reference 2's reef tops. Each fan is
// one quad cut out by an alpha map of a grown fan — branches that ramify
// and rejoin into a mesh, as a real gorgonian's do — so close up it reads
// as lace and at distance, where the mipmaps average the mesh, as a soft
// solid fan.

import * as THREE from 'three';
import { hash1 } from '../noise';

const LACE_PX = 512;
/** Fans in the atlas, side by side: the same silhouette on every fan read
 *  as stamped (round 8). */
export const FAN_VARIANTS = 2;

/** Grown by space colonisation (Runions et al. 2007): points scattered
 *  through the fan's outline draw the nearest branch tip towards them and
 *  are consumed as it arrives, so the branches fill the outline evenly,
 *  fork where the points spread, and thin outwards — the venation of a
 *  real fan rather than a drawn tree. Widths follow the pipe model: each
 *  branch as thick as what it carries. */
function growFan(g: CanvasRenderingContext2D, ox: number, seed: number) {
  let n = 0;
  const rand = (k: number) => hash1(n++, seed + k);
  const baseX = ox + LACE_PX / 2;
  const baseY = LACE_PX - 6;
  const rx = LACE_PX * 0.47;
  const ry = LACE_PX * 0.9;

  // The outline: a half-ellipse with a wobbled rim and a few deeper bays,
  // so no two fans are the same shape.
  const rim = (a: number) => 0.9 + 0.07 * Math.sin(a * 3 + seed) + 0.05 * Math.sin(a * 7.3 + seed * 2) - 0.06 * Math.max(0, Math.sin(a * 11 + seed * 3));
  const attractors: { x: number; y: number; alive: boolean }[] = [];
  for (let i = 0; i < 1600; i++) {
    const a = Math.PI * (0.05 + 0.9 * rand(1));
    const r = Math.sqrt(rand(2)) * rim(a);
    if (r < 0.1) continue;
    attractors.push({ x: baseX + rx * r * Math.cos(a), y: baseY - ry * r * Math.sin(a), alive: true });
  }

  const INFLUENCE = 44;
  const KILL = 9;
  const STEP = 4.5;
  const CELL = INFLUENCE;
  const nodes: { x: number; y: number; parent: number; width: number }[] = [];
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number) => Math.floor(x / CELL) * 4096 + Math.floor(y / CELL);
  const addNode = (x: number, y: number, parent: number) => {
    const k = key(x, y);
    let cell = grid.get(k);
    if (!cell) grid.set(k, (cell = []));
    cell.push(nodes.length);
    nodes.push({ x, y, parent, width: 0 });
  };
  // A short stem before the fan spreads.
  addNode(baseX, baseY, -1);
  for (let i = 1; i <= 4; i++) addNode(baseX, baseY - i * STEP, i - 1);

  for (let iteration = 0; iteration < 500; iteration++) {
    const pull = new Map<number, [number, number]>();
    for (const a of attractors) {
      if (!a.alive) continue;
      let best = -1;
      let bestD = INFLUENCE;
      const cx = Math.floor(a.x / CELL);
      const cy = Math.floor(a.y / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get((cx + dx) * 4096 + cy + dy);
          if (!cell) continue;
          for (const i of cell) {
            const d = Math.hypot(nodes[i].x - a.x, nodes[i].y - a.y);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      if (best < 0) continue;
      if (bestD < KILL) {
        a.alive = false;
        continue;
      }
      const p = pull.get(best) ?? [0, 0];
      p[0] += (a.x - nodes[best].x) / bestD;
      p[1] += (a.y - nodes[best].y) / bestD;
      pull.set(best, p);
    }
    if (pull.size === 0) break;
    for (const [i, [px, py]] of pull) {
      // A little jitter: two points pulling square against each other
      // would otherwise hold a tip still for ever.
      const jx = px + (rand(3) - 0.5) * 0.3;
      const jy = py + (rand(4) - 0.5) * 0.3;
      const len = Math.hypot(jx, jy) || 1;
      addNode(nodes[i].x + (jx / len) * STEP, nodes[i].y + (jy / len) * STEP, i);
    }
  }

  // Widths, tips to trunk: w = (Σ children w^2.6)^(1/2.6), a shade past
  // Murray's law so the trunk stays a trunk and the fan stays lace.
  const LEAF = 1.5;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.width === 0) node.width = LEAF;
    if (node.parent >= 0) {
      const parent = nodes[node.parent];
      parent.width = (parent.width ** 2.6 + node.width ** 2.6) ** (1 / 2.6);
    }
  }
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  for (const node of nodes) {
    if (node.parent < 0) continue;
    const parent = nodes[node.parent];
    g.lineWidth = Math.min(14, 0.5 * (node.width + parent.width));
    g.beginPath();
    g.moveTo(parent.x, parent.y);
    g.lineTo(node.x, node.y);
    g.stroke();
  }
}

/** White fans on black, FAN_VARIANTS side by side, for use as an alphaMap
 *  (its green channel is the coverage, so mipmaps average it correctly —
 *  no dark fringes). */
export function fanTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LACE_PX * FAN_VARIANTS;
  canvas.height = LACE_PX;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let v = 0; v < FAN_VARIANTS; v++) growFan(g, v * LACE_PX, seed + v * 101);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export interface FanPlacement {
  /** Holdfast position, object space of the mesh the fans join. */
  position: THREE.Vector3;
  /** Fan width, metres (height is ~0.95 of it). */
  width: number;
  /** Yaw about the vertical, then tilt about the fan's own horizontal. */
  yaw: number;
  tilt: number;
  colour: [number, number, number];
  /** Which of the atlas's fans, 0..variants−1 (default 0). */
  variant?: number;
}

/** All the fans as one geometry: a quad each, holdfast at its bottom
 *  centre, vertex-coloured, uv'd for its fan in an atlas of `variants`. */
export function fanGeometry(fans: readonly FanPlacement[], variants = 1): THREE.BufferGeometry {
  const quad = new THREE.PlaneGeometry(1, 0.95);
  quad.translate(0, 0.475, 0);
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const rot = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const fan of fans) {
    const g = quad.clone();
    m.compose(
      fan.position,
      q.setFromEuler(rot.set(fan.tilt, fan.yaw, 0, 'YXZ')),
      new THREE.Vector3(fan.width, fan.width, fan.width),
    );
    g.applyMatrix4(m);
    if (variants > 1) {
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + (fan.variant ?? 0)) / variants);
    }
    const count = g.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colours.set(fan.colour, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    parts.push(g);
  }
  quad.dispose();
  const merged = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv', 'color'] as const;
  for (const name of attrs) {
    const size = parts[0].getAttribute(name).itemSize;
    const total = parts.reduce((s, p) => s + p.getAttribute(name).count, 0);
    const data = new Float32Array(total * size);
    let offset = 0;
    for (const p of parts) {
      const a = p.getAttribute(name).array as Float32Array;
      data.set(a, offset);
      offset += a.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  const index: number[] = [];
  let base = 0;
  for (const p of parts) {
    const idx = p.getIndex()!.array;
    for (let i = 0; i < idx.length; i++) index.push(idx[i] + base);
    base += p.getAttribute('position').count;
  }
  merged.setIndex(index);
  for (const p of parts) p.dispose();
  return merged;
}

/** The fans' material: lit like the reef, cut out by the lace, blended
 *  rather than alpha-tested so distant fans fade softly instead of
 *  breaking up. */
export function fanMaterial(lace: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    alphaMap: lace,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
}

/** A carpet anemone's tentacles: a dense bed of short, wavy tentacles with
 *  swollen tips, across the lower third of the canvas (the quad stands
 *  0.95 of its width tall, so a metre-wide anemone is 30 cm high). Green is
 *  coverage, red marks the tips, where the colour goes. */
export function anemoneTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LACE_PX;
  canvas.height = LACE_PX;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, LACE_PX, LACE_PX);
  g.lineCap = 'round';
  let n = 0;
  const rand = (k: number) => hash1(n++, seed + k);
  const base = LACE_PX - 4;
  // The disc the tentacles rise from.
  g.fillStyle = '#00ff00';
  g.beginPath();
  g.ellipse(LACE_PX / 2, base, LACE_PX * 0.48, 12, 0, 0, Math.PI * 2);
  g.fill();
  const tentacles = 150;
  for (let i = 0; i < tentacles; i++) {
    // Shorter towards the disc's edge, so the bed is domed.
    const t = (i + 0.5) / tentacles;
    const x0 = 12 + (LACE_PX - 24) * t + (rand(1) - 0.5) * 8;
    const dome = Math.sin(Math.PI * t) ** 0.5;
    const h = (0.14 + 0.16 * dome + 0.06 * rand(2)) * LACE_PX;
    const lean = (rand(3) - 0.5) * 0.7;
    const x1 = x0 + lean * h;
    const y1 = base - h;
    g.strokeStyle = '#00ff00';
    g.lineWidth = 6 + 4 * rand(4);
    g.beginPath();
    g.moveTo(x0, base);
    g.quadraticCurveTo(x0 + lean * h * 0.2 + (rand(5) - 0.5) * 24, base - h * 0.55, x1, y1);
    g.stroke();
    g.fillStyle = '#ffff00';
    g.beginPath();
    g.arc(x1, y1, 6 + 3 * rand(6), 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

/** A soft-coral tree (Dendronephthya), as on Komodo's walls: a pale trunk
 *  forking into stalks, each ending in a dense cauliflower of polyps. One
 *  canvas, two channels: green is coverage (the alphaMap), red marks the
 *  polyps, where the colour goes (reefShading.ts `polyps`); the stalks stay
 *  pale. */
export function softCoralTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LACE_PX;
  canvas.height = LACE_PX;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, LACE_PX, LACE_PX);
  g.lineCap = 'round';
  let n = 0;
  const rand = (k: number) => hash1(n++, seed + k);

  const clusters: [number, number, number][] = [];
  const branch = (x: number, y: number, angle: number, len: number, width: number, depth: number) => {
    const x2 = x + Math.cos(angle) * len;
    const y2 = y - Math.sin(angle) * len;
    g.strokeStyle = '#00ff00';
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(angle + 0.2) * len * 0.5, y - Math.sin(angle + 0.2) * len * 0.5, x2, y2);
    g.stroke();
    if (depth === 0) {
      clusters.push([x2, y2, 22 + 18 * rand(1)]);
      return;
    }
    if (depth <= 2) clusters.push([x2, y2, 12 + 10 * rand(2)]);
    const forks = 2 + (rand(3) < 0.35 ? 1 : 0);
    for (let k = 0; k < forks; k++) {
      const spread = (k - (forks - 1) / 2) * (0.5 + 0.3 * rand(4));
      branch(x2, y2, angle + spread, len * (0.68 + 0.12 * rand(5)), Math.max(3, width * 0.66), depth - 1);
    }
  };
  branch(LACE_PX / 2, LACE_PX - 10, Math.PI / 2, LACE_PX * 0.22, 26, 4);

  // The polyps: overlapping round heads in each cluster, a few loose ones.
  g.fillStyle = '#ffff00';
  for (const [cx, cy, r] of clusters) {
    const heads = Math.round(r * 0.9);
    for (let k = 0; k < heads; k++) {
      const a = rand(6) * Math.PI * 2;
      const d = Math.sqrt(rand(7)) * r;
      g.beginPath();
      g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, 3 + 4.5 * rand(8), 0, Math.PI * 2);
      g.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}
