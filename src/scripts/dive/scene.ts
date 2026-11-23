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
  /** Gives the film a frame between the heavy steps of a build made while
   *  it is running (DiveScene.extend); resolves at once otherwise. */
  pace(): Promise<void>;
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
  /** Adds layers to the scene. With `live`, the film is already showing:
   *  the layers are built off-scene, giving it frames as they go, their
   *  programs compiled in parallel, and only then attached, each of
   *  `frames` drawn once inside a real frame so first draws do not stall
   *  later. Without it, they are built and warmed outright. */
  extend(layers: Layer[], frames: readonly DiveFrame[], live: boolean): Promise<void>;
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
// A build made while the film shows hands it a frame back once it has held
// the main thread this long (LayerContext.pace).
const PACE_SLICE_MS = 10;
// A camera layer no object uses, for drawing one mesh alone (primeEach).
const PRIME_LAYER = 31;

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
  // Reading every shader's error log on first use is a development aid: in
  // production it is a synchronous query per program, 380 ms in all while
  // the opening shows (round 12).
  renderer.debug.checkShaderErrors = import.meta.env.DEV;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_Y_DEG, 1, 0.1, 400);
  // Yaw about the world's up axis first, then pitch: a diver turning their
  // head, not a plane banking.
  camera.rotation.order = 'YXZ';

  // The layers drawn, in update order: those of createScene, then those
  // extend() attaches once they are ready.
  const live: Layer[] = [];
  const ctx: LayerContext = { renderer, scene, camera, settings, pace: async () => {} };
  // A layer that fails to start takes its group with it, but not before the
  // ones already started give back their GPU memory.
  const initAll = async (group: Layer[], groupCtx: LayerContext) => {
    const started: Layer[] = [];
    try {
      for (const layer of group) {
        await layer.init(groupCtx);
        started.push(layer);
      }
    } catch (err) {
      for (const layer of started) layer.dispose();
      throw err;
    }
  };
  try {
    await initAll(layers, ctx);
  } catch (err) {
    renderer.dispose();
    throw err;
  }
  live.push(...layers);
  // The low tier renders straight to the screen: no lens pass, and so no
  // thermocline band (plan Task 13).
  const post: DivePost | null = settings.post ? createPost(renderer, 1, 1) : null;

  // Frames to draw once, unseen, before the next real one (extend).
  const warmQueue: DiveFrame[] = [];

  const draw = (frame: DiveFrame) => {
    const { state, timeS } = frame;
    // The camera swims a real path through the dive site (timeline.ts).
    camera.position.set(...state.position);
    camera.rotation.set(
      state.camera.pitch + DRIFT_RAD * noise1(timeS * DRIFT_RATE, DRIFT_SEED_PITCH),
      state.camera.yaw + DRIFT_RAD * noise1(timeS * DRIFT_RATE, DRIFT_SEED_YAW),
      0,
    );
    for (const layer of live) layer.update(frame);
    if (post) post.render(scene, camera, frame);
    else renderer.render(scene, camera);
  };

  // A queued warm frame is drawn in the same task as the real frame after
  // it, so only the real one is ever presented.
  const render = (frame: DiveFrame) => {
    const warmFrame = warmQueue.shift();
    if (warmFrame) draw(warmFrame);
    draw(frame);
  };

  // Each mesh under `stage` drawn once, unseen, into the lens pass's target,
  // a frame apart, so that its first real draw has nothing left to set up —
  // its geometry's upload, the driver's per-draw state: the first frame
  // after the deep set attached took 112 ms, round 12. Its top-level
  // ancestor is moved into the live scene for the one draw and straight
  // back, in one task, so no real frame sees it; only it and the lights
  // pass the camera's layer test (the lights keep the program the one it
  // was compiled as); and the target is redrawn whole by the next real
  // frame. Only with a lens pass: drawn to the canvas it could be seen.
  const primeEach = async (stage: THREE.Scene, target: THREE.WebGLRenderTarget) => {
    const meshes: THREE.Object3D[] = [];
    stage.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    const lights = scene.children.filter((o) => (o as THREE.Light).isLight);
    for (const mesh of meshes) {
      let root = mesh;
      while (root.parent && root.parent !== stage) root = root.parent;
      const mask = camera.layers.mask;
      const culled = mesh.frustumCulled;
      const previous = renderer.getRenderTarget();
      scene.add(root);
      for (const o of [mesh, ...lights]) o.layers.enable(PRIME_LAYER);
      camera.layers.set(PRIME_LAYER);
      mesh.frustumCulled = false;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      mesh.frustumCulled = culled;
      camera.layers.mask = mask;
      for (const o of [mesh, ...lights]) o.layers.disable(PRIME_LAYER);
      stage.add(root);
      if (renderer.getContext().isContextLost()) throw new Error('WebGL context lost while priming');
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
  };

  // Every texture the materials under `root` sample: their own slots, and
  // the uniforms their shader hooks added (set once they have compiled).
  const texturesUnder = (root: THREE.Object3D): Set<THREE.Texture> => {
    const found = new Set<THREE.Texture>();
    const add = (value: unknown) => {
      if (value && (value as THREE.Texture).isTexture) found.add(value as THREE.Texture);
    };
    root.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        for (const value of Object.values(m)) add(value);
        const uniforms = (renderer.properties.get(m) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
        for (const u of Object.values(uniforms ?? {})) add(u?.value);
      }
    });
    return found;
  };

  // Starts every program under `root` compiling against what it will
  // really be drawn with — the live scene's lights, and the lens pass's
  // target where there is one (its linear output is part of the program's
  // key: compiled against the canvas instead, they were the wrong programs,
  // waited on for 2 s and then compiled again, synchronously, by the first
  // draws, round 12) — and waits until the GPU has them. In parallel where
  // the GPU allows, off the main thread. Not renderer.compileAsync: it polls
  // until every program reports ready, which a lost context never does, so
  // it can hang the mount for good. This gives up on a lost context or after
  // a while (a draw then finishes the compile itself, synchronously).
  const compileAll = async (root: THREE.Object3D, withPost: boolean) => {
    const gl = renderer.getContext();
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(post ? post.target : null);
    const pending = renderer.compile(root, camera, scene);
    renderer.setRenderTarget(previous);
    if (post && withPost) for (const m of post.compile()) pending.add(m);
    const deadline = performance.now() + WARM_COMPILE_MS;
    while (pending.size > 0 && !gl.isContextLost() && performance.now() < deadline) {
      for (const material of pending) {
        const program = (renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } })
          .currentProgram;
        if (!program || program.isReady() === true) pending.delete(material);
      }
      if (pending.size > 0) await new Promise((r) => setTimeout(r, 10));
    }
    if (gl.isContextLost()) throw new Error('WebGL context lost while compiling');
  };

  return {
    render,
    async warm(frames) {
      await compileAll(scene, true);
      for (const frame of frames) draw(frame);
    },
    async extend(more, frames, showing) {
      // Built into a scene of their own, unseen and undrawn, then moved
      // across whole. The layers keep this context, so it is repointed at
      // the live scene once they are in it, for their dispose().
      const stage = new THREE.Scene();
      // Returns at once until the slice is used up, so a builder can call it
      // in its loops; then waits for the film to draw a frame.
      let sliceStart = performance.now();
      const pace = () =>
        performance.now() - sliceStart < PACE_SLICE_MS
          ? Promise.resolve()
          : new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                setTimeout(() => {
                  sliceStart = performance.now();
                  resolve();
                }, 0),
              ),
            );
      const stageCtx: LayerContext = { ...ctx, scene: stage, pace: showing ? pace : ctx.pace };
      // A failed init has already disposed what it started; a failed
      // compile (a lost context) leaves every layer built, so all go.
      await initAll(more, stageCtx);
      try {
        await compileAll(stage, false);
        // Their textures go up one at a time, a frame between, rather than
        // all inside the first draw that needs them (300 ms, round 12).
        for (const texture of texturesUnder(stage)) {
          renderer.initTexture(texture);
          await stageCtx.pace();
        }
        if (showing && post) await primeEach(stage, post.target);
      } catch (err) {
        for (const layer of more) layer.dispose();
        throw err;
      }
      for (const child of [...stage.children]) scene.add(child);
      stageCtx.scene = scene;
      live.push(...more);
      if (showing) warmQueue.push(...frames);
      else for (const frame of frames) draw(frame);
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
      for (const layer of live) layer.dispose();
      post?.dispose();
      renderer.dispose();
    },
  };
}
