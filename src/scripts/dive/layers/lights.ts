// The scene's lights, which the reef, the fish and the big animals share.
// A layer of their own, in the scene from the first frame, because a lit
// material's program is keyed on the lights it is compiled with: the deep
// set is compiled in the background while the surface already shows
// (index.ts), and must be compiled against the lights it will be drawn
// with. (They used to arrive with the reef.)

import * as THREE from 'three';
import type { Layer, LayerContext } from '../scene';
import type { DiveFrame } from '../types';

export default function createLightsLayer(): Layer {
  let ctx: LayerContext;
  let sun: THREE.DirectionalLight;
  let sky: THREE.HemisphereLight;

  return {
    id: 'lights',
    init(c) {
      ctx = c;
      sun = new THREE.DirectionalLight(0xffffff, 1);
      sun.position.set(0.3, 1, 0.2);
      sky = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
      ctx.scene.add(sun, sky);
    },
    update(frame: DiveFrame) {
      const { water } = frame;
      const t = water.transmittance;
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
      ctx.scene.remove(sun, sky);
    },
  };
}
