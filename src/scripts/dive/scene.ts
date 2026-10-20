// The Three.js side of the dive: one renderer, one camera, an ordered list
// of layers. render(frame) is a pure function of the frame (spec §5): the
// camera pose comes from the timeline plus seeded drift, and every layer
// derives what it draws from the same frame.

import * as THREE from 'three';
import { noise1 } from './noise';
import { createPost, type DivePost } from './post';
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
  /** Compiles every material and draws each given frame once, so first-use
   *  costs are paid up front instead of as a stall mid-dive. */
  warm(frames: readonly DiveFrame[]): Promise<void>;
  resize(w: number, h: number, dpr: number): void;
  /** True once the GPU context is gone (the browser's event may lag). */
  isLost(): boolean;
  dispose(): void;
}

// A swimmer's sway: radians of drift, and how fast it wanders.
const DRIFT_RAD = 0.02;
const DRIFT_RATE = 0.15;
const DRIFT_SEED_PITCH = 11;
const DRIFT_SEED_YAW = 23;
// The longest the pre-roll waits for shaders before drawing anyway (a draw
// then finishes their compile itself, just synchronously).
const WARM_COMPILE_MS = 5000;

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
  // A layer that fails to start takes the scene with it, but not before
  // the ones already started (and the renderer) give back their GPU memory.
  const started: Layer[] = [];
  try {
    for (const layer of layers) {
      await layer.init(ctx);
      started.push(layer);
    }
  } catch (err) {
    for (const layer of started) layer.dispose();
    renderer.dispose();
    throw err;
  }
  // The low tier renders straight to the screen: no lens pass, and so no
  // thermocline band (plan Task 13).
  const post: DivePost | null = settings.post ? createPost(renderer, 1, 1) : null;

  const render = (frame: DiveFrame) => {
    const { state, timeS } = frame;
    // The camera swims a real path through the dive site (timeline.ts).
    camera.position.set(...state.position);
    camera.rotation.set(
      state.camera.pitch + DRIFT_RAD * noise1(timeS * DRIFT_RATE, DRIFT_SEED_PITCH),
      state.camera.yaw + DRIFT_RAD * noise1(timeS * DRIFT_RATE, DRIFT_SEED_YAW),
      0,
    );
    for (const layer of layers) layer.update(frame);
    if (post) post.render(scene, camera, frame);
    else renderer.render(scene, camera);
  };

  return {
    render,
    async warm(frames) {
      // Shader programs compile in parallel where the GPU allows; then one
      // draw of each shot builds whatever per-draw state the driver keeps
      // (measured: first draws stalled 50–370 ms each without this).
      // Not renderer.compileAsync: it polls until every program reports
      // ready, which a lost context never does, so it can hang the mount
      // for good. This wait gives up on a lost context or after a while.
      const gl = renderer.getContext();
      const pending = renderer.compile(scene, camera);
      const deadline = performance.now() + WARM_COMPILE_MS;
      while (pending.size > 0 && !gl.isContextLost() && performance.now() < deadline) {
        for (const material of pending) {
          const program = (renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } })
            .currentProgram;
          if (!program || program.isReady() === true) pending.delete(material);
        }
        if (pending.size > 0) await new Promise((r) => setTimeout(r, 10));
      }
      if (gl.isContextLost()) throw new Error('WebGL context lost during warm-up');
      for (const frame of frames) render(frame);
    },
    resize(w, h, dpr) {
      renderer.setPixelRatio(Math.min(dpr, settings.maxDpr));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      post?.resize(w, h);
    },
    isLost() {
      return renderer.getContext().isContextLost();
    },
    dispose() {
      for (const layer of layers) layer.dispose();
      post?.dispose();
      renderer.dispose();
    },
  };
}
