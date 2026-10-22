// What the water does between a lit surface and the lens, added to every
// lit material in one place so reef, fans and fish agree:
//
//   absorption   colour lost over the view distance: Beer–Lambert per
//                channel, red first, then green, blue last. This is why a
//                reef is vivid within a few metres and blue-green beyond:
//                "even a water column of 1 m absorbs more than 20% of the
//                red light… 10 m transmit less than 10%" (reefcolors.de).
//                The rates are gentler than raw sea water's because the
//                dive camera white-balances for its depth, as the reference
//                footage's does; the fog then adds the haze of scattering.
//   torch        the video light the camera carries, as every reference
//                reef is shot with: near-white, strong within a few metres
//                and gone by ten, losing its own red on the way out as the
//                reflected light does on the way back. It is what puts the
//                colour back into the foreground against the blue — without
//                it, blue sun and blue sky left the near reef blue-grey
//                (round 8).
//
// Both applied in linear light: the torch with the other lights, the
// absorption to the lit colour, before the fog.

import type * as THREE from 'three';

/** Per metre of path, linear RGB. */
const ABSORB_PER_M = [0.13, 0.05, 0.03] as const;

/** The torch's intensity, shared by every material that carries it. */
export const TORCH: Record<string, THREE.IUniform<number>> = { uTorch: { value: 0 } };

const ABSORB_VEC = `vec3(${ABSORB_PER_M.map((k) => k.toFixed(3)).join(', ')})`;

const TORCH_GLSL = /* glsl */ `
  {
    float torchD = length(vViewPosition);
    vec3 torchL = vViewPosition / max(torchD, 1e-3);
    vec3 torch = vec3(1.0, 0.94, 0.84) * uTorch / (1.0 + 0.1 * torchD * torchD) * exp(-${ABSORB_VEC} * torchD);
    reflectedLight.directDiffuse += saturate(dot(normal, torchL)) * torch * BRDF_Lambert(diffuseColor.rgb);
  }
`;

const ABSORB_GLSL = /* glsl */ `
  gl_FragColor.rgb *= exp(-${ABSORB_VEC} * length(vViewPosition));
`;

/** Adds the torch and the absorption to a standard material's shader. */
export function withWaterOptics(shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }) {
  Object.assign(shader.uniforms, TORCH);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uTorch;')
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${TORCH_GLSL}`)
    .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${ABSORB_GLSL}`);
}
