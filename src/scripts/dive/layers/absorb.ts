// Colour lost over the water between a surface and the lens: Beer–Lambert
// per channel over the view distance, red first, then green, blue last.
// This is why a reef is vivid within a few metres and blue-green beyond:
// "even a water column of 1 m absorbs more than 20% of the red light…
// 10 m transmit less than 10%" (reefcolors.de). The rates are gentler than
// raw sea water's because the dive camera white-balances for its depth, as
// the reference footage's does; the fog then adds the haze of scattering.
//
// Applied to the lit colour in linear light, before the fog.

/** Per metre of view distance, linear RGB. */
const VIEW_ABSORB_PER_M = [0.13, 0.05, 0.03] as const;

const ABSORB_GLSL = /* glsl */ `
  gl_FragColor.rgb *= exp(-vec3(${VIEW_ABSORB_PER_M.map((k) => k.toFixed(3)).join(', ')}) * length(vViewPosition));
`;

/** Adds the absorption to a standard material's fragment shader. */
export function withViewAbsorption(fragmentShader: string): string {
  return fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${ABSORB_GLSL}`);
}
