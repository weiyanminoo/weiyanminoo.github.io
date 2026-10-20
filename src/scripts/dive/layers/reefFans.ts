// Sea fans for the reef: gorgonians, the lace that dominates a tropical
// wall and stands in silhouette on reference 2's reef tops. Each
// fan is one quad cut out by a procedural lace alpha map — a branching
// fan with a fine net between the branches, so close up it reads as lace
// and at distance, where the mipmaps average the net, as a soft solid fan.

import * as THREE from 'three';
import { hash1 } from '../noise';

const LACE_PX = 512;

/** White lace on black, for use as an alphaMap (its green channel is the
 *  coverage, so mipmaps average it correctly — no dark fringes). */
export function laceTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = LACE_PX;
  canvas.height = LACE_PX;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, LACE_PX, LACE_PX);
  g.lineCap = 'round';

  const baseX = LACE_PX / 2;
  const baseY = LACE_PX - 8;

  // The net: two families of fine, slightly wavy lines, drawn on their own
  // layer and faded out radially from the holdfast, so a fan has a soft
  // edge — clipped to a hard outline (or filled) it read as a scrap of
  // paper (round 2).
  const netCanvas = document.createElement('canvas');
  netCanvas.width = LACE_PX;
  netCanvas.height = LACE_PX;
  const net = netCanvas.getContext('2d')!;
  net.strokeStyle = '#fff';
  net.lineWidth = 1.6;
  for (const dir of [1, -1]) {
    for (let k = -LACE_PX; k < LACE_PX * 2; k += 6) {
      net.beginPath();
      for (let s = 0; s <= LACE_PX; s += 16) {
        const wobble = 2.5 * Math.sin(s * 0.05 + k * 0.3 + seed);
        net.lineTo(k + dir * s * 0.8 + wobble, s);
      }
      net.stroke();
    }
  }
  const fade = net.createRadialGradient(baseX, baseY, 0, baseX, baseY, LACE_PX * 0.46);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.15, 'rgba(0,0,0,1)');
  fade.addColorStop(0.7, 'rgba(0,0,0,0.8)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  net.globalCompositeOperation = 'destination-in';
  net.fillStyle = fade;
  net.fillRect(0, 0, LACE_PX, LACE_PX);
  g.globalAlpha = 0.5;
  g.drawImage(netCanvas, 0, 0);
  g.globalAlpha = 1;

  // The branches: a trunk splitting into ever finer twigs.
  let n = 0;
  const branch = (x: number, y: number, angle: number, len: number, width: number, depth: number) => {
    const bend = (hash1(n++, seed + 1) - 0.5) * 0.3;
    const x2 = x + Math.cos(angle + bend) * len;
    const y2 = y - Math.sin(angle + bend) * len;
    g.strokeStyle = '#fff';
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(angle) * len * 0.5, y - Math.sin(angle) * len * 0.5, x2, y2);
    g.stroke();
    if (depth === 0) return;
    const spread = 0.22 + 0.2 * hash1(n++, seed + 2);
    const shrink = 0.74 + 0.1 * hash1(n++, seed + 3);
    branch(x2, y2, angle + spread, len * shrink, Math.max(1.4, width * 0.72), depth - 1);
    branch(x2, y2, angle - spread, len * shrink, Math.max(1.4, width * 0.72), depth - 1);
  };
  const trunks = 6;
  for (let i = 0; i < trunks; i++) {
    const a = Math.PI * (0.2 + 0.6 * (i / (trunks - 1))) + (hash1(i, seed + 4) - 0.5) * 0.15;
    branch(baseX, baseY, a, LACE_PX * 0.09, 7, 7);
  }

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
}

/** All the fans as one geometry: a quad each, holdfast at its bottom
 *  centre, vertex-coloured, uv'd for the lace. */
export function fanGeometry(fans: readonly FanPlacement[]): THREE.BufferGeometry {
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
