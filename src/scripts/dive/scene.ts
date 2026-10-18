// The Three.js side of the dive: one renderer, one camera, an ordered list
// of layers. render(frame) is a pure function of the frame (spec §5): the
// camera pose comes from the timeline plus seeded drift, and every layer
// derives what it draws from the same frame.

import * as THREE from 'three';
import { noise1 } from './noise';
import type { TierSettings } from './quality';
import { CAMERA_FOV_Y_DEG } from './timeline';
import type { DiveFrame } from './types';

export interface LayerContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  settings: TierSettings;
}

export interface Layer {
  readonly id: string;
  init(ctx: LayerContext): void | Promise<void>;
  update(frame: DiveFrame): void;
  dispose(): void;
}

export interface DiveScene {
  render(frame: DiveFrame): void;
  resize(w: number, h: number, dpr: number): void;
  dispose(): void;
}

// A handheld swimmer's sway: radians of drift, and how fast it wanders.
const DRIFT_RAD = 0.02;
const DRIFT_RATE = 0.15;
const DRIFT_SEED_PITCH = 11;
const DRIFT_SEED_YAW = 23;
// "0 m" is just under the surface, not in it. Snell's window is a disc of
// radius depth·tan(48.6°): at under a metre it is smaller than the ripples
// and breaks into blobs, while at 3 m it is a 6.8 m disc with a fringed
// edge. The depth gauge still reads the timeline's depth; only the rendered
// camera sits this much lower.
export const SURFACE_CLEARANCE_M = 3;

export async function createScene(
  canvas: HTMLCanvasElement,
  settings: TierSettings,
  layers: Layer[],
): Promise<DiveScene> {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_Y_DEG, 1, 0.1, 400);
  // Yaw about the world's up axis first, then pitch: a diver turning their
  // head, not a plane banking.
  camera.rotation.order = 'YXZ';

  const ctx: LayerContext = { renderer, scene, camera, settings };
  for (const layer of layers) await layer.init(ctx);

  return {
    render(frame) {
      const { state, timeS } = frame;
      camera.position.set(0, -(state.depth + SURFACE_CLEARANCE_M), 0);
      camera.rotation.set(
        state.camera.pitch + DRIFT_RAD * noise1(timeS * DRIFT_RATE, DRIFT_SEED_PITCH),
        state.camera.yaw + DRIFT_RAD * noise1(timeS * DRIFT_RATE, DRIFT_SEED_YAW),
        0,
      );
      for (const layer of layers) layer.update(frame);
      renderer.render(scene, camera);
    },
    resize(w, h, dpr) {
      renderer.setPixelRatio(Math.min(dpr, settings.maxDpr));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const layer of layers) layer.dispose();
      renderer.dispose();
    },
  };
}
