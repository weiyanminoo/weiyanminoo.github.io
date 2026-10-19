// The point-of-view inserts: Wei Yan's footage, full frame, drawn just over
// the water dome and behind every 3D layer, so snow, bubbles and the snapper
// school still pass in front of it — the same water, the same lens (the
// post pass applies to it too).
//
// The texture is the playing video once it is ready, its poster still
// until then or if playback never starts (Review Focus 3). Cover-fitted to
// the viewport, with a slow push-in across the shot, and a final grade
// that pulls its white balance towards the 3D water at that depth and
// lifts its blacks into the water colour (spec §8).

import * as THREE from 'three';
import type { Footage } from '../footage';
import type { Layer, LayerContext } from '../scene';
import type { ClipId, DiveFrame } from '../types';

const PUSH_IN = 0.08;
const VIDEO_ASPECT = 16 / 9;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tFrame;
  uniform vec2 uCover;
  uniform float uZoom;
  uniform vec3 uBalance;
  uniform vec3 uLift;
  varying vec2 vUv;
  void main() {
    vec2 uv = 0.5 + (vUv - 0.5) * uCover / uZoom;
    vec3 col = texture2D(tFrame, uv).rgb;
    col = col * uBalance + uLift * (1.0 - col);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const CLIPS: readonly ClipId[] = ['wall', 'slope'];

export default function createInsertLayer(footage: Footage): Layer {
  let ctx: LayerContext;
  let mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  const videoTextures = new Map<ClipId, THREE.VideoTexture>();
  const posterTextures = new Map<ClipId, THREE.Texture>();
  const pendingPosters = new Set<ClipId>();
  // Shown only if a cut arrives before its poster has decoded.
  let blank: THREE.DataTexture;
  const fog = new THREE.Color();

  // Textures are made and uploaded as soon as their sources exist — from
  // ~12 m, when the footage is fetched — never at the cut itself: decoding
  // and uploading a 720p poster or first video frame on the cut stalled
  // the GPU 50–180 ms (frame-cost audit). Posters decode off the main
  // thread via createImageBitmap.
  const prepare = (clip: ClipId) => {
    const img = footage.poster(clip);
    if (!posterTextures.has(clip) && !pendingPosters.has(clip) && img.complete && img.naturalWidth > 0) {
      pendingPosters.add(clip);
      createImageBitmap(img, { imageOrientation: 'flipY' }).then(
        (bitmap) => {
          const t = new THREE.Texture(bitmap);
          t.flipY = false;
          t.colorSpace = THREE.SRGBColorSpace;
          t.needsUpdate = true;
          ctx.renderer.initTexture(t);
          posterTextures.set(clip, t);
        },
        () => pendingPosters.delete(clip),
      );
    }
    const video = footage.video(clip);
    if (!videoTextures.has(clip) && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const t = new THREE.VideoTexture(video);
      t.colorSpace = THREE.SRGBColorSpace;
      ctx.renderer.initTexture(t);
      videoTextures.set(clip, t);
    }
  };

  const textureFor = (clip: ClipId): THREE.Texture => {
    const video = videoTextures.get(clip);
    if (video && footage.ready(clip)) {
      // VideoTexture uploads only when the browser presents a new video
      // frame; a paused, just-seeked clip may not have presented yet, so in
      // review mode upload the current frame on every render.
      if (footage.exact) video.needsUpdate = true;
      return video;
    }
    return posterTextures.get(clip) ?? blank;
  };

  return {
    id: 'insert',
    init(c) {
      ctx = c;
      // The deep water colour, sRGB #0a2135.
      blank = new THREE.DataTexture(new Uint8Array([10, 33, 53, 255]), 1, 1);
      blank.colorSpace = THREE.SRGBColorSpace;
      blank.needsUpdate = true;
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          tFrame: { value: null },
          uCover: { value: new THREE.Vector2(1, 1) },
          uZoom: { value: 1 },
          uBalance: { value: new THREE.Vector3(1, 1, 1) },
          uLift: { value: new THREE.Color() },
        },
        depthTest: false,
        depthWrite: false,
        fog: false,
      });
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      mesh.frustumCulled = false;
      // After the water dome (-10), before everything else.
      mesh.renderOrder = -9;
      ctx.scene.add(mesh);
    },
    update(frame: DiveFrame) {
      for (const clip of CLIPS) prepare(clip);
      const insert = frame.state.insert;
      mesh.visible = insert !== null;
      if (!insert) return;
      const u = mesh.material.uniforms;
      u.tFrame.value = textureFor(insert.clip);
      // Cover: crop whichever axis overflows the viewport.
      const view = ctx.camera.aspect;
      (u.uCover.value as THREE.Vector2).set(
        view < VIDEO_ASPECT ? view / VIDEO_ASPECT : 1,
        view > VIDEO_ASPECT ? VIDEO_ASPECT / view : 1,
      );
      u.uZoom.value = 1 + PUSH_IN * insert.pushIn;
      // Balance: the camera auto-exposed brighter and more cyan than the 3D
      // water at this depth, which made both cuts jump (round 15 strips at
      // 0.36 and 0.52). Bring it down to the water's level and towards its
      // blue (linear-light multipliers), and open the deepest shadows a
      // little into the water colour, as distance haze would. Round 1
      // critique: the reference reef tops sit at ~0.15 mean luminance and
      // the footage was at 0.26; these land it at ~0.15.
      const [r, g, b] = frame.water.fog;
      fog.setRGB(r, g, b, THREE.SRGBColorSpace);
      (u.uBalance.value as THREE.Vector3).set(0.36, 0.4, 0.52);
      (u.uLift.value as THREE.Color).copy(fog).multiplyScalar(0.04);
    },
    dispose() {
      for (const t of videoTextures.values()) t.dispose();
      for (const t of posterTextures.values()) t.dispose();
      blank.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
      ctx.scene.remove(mesh);
    },
  };
}
