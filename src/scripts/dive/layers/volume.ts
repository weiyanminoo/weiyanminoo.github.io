// The water itself: a dome around the camera, graded from the light above
// to the dark below, plus the scene fog every mesh fades into. Both read
// the same WaterSample, so distant reef and open water meet in one colour.

import * as THREE from 'three';
import type { Layer, LayerContext } from '../scene';
import type { DiveFrame } from '../types';

const DOME_RADIUS = 300;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Looking up, the water brightens towards the surface; looking down it
// sinks towards the dark. Horizontal is the fog colour exactly, so meshes
// fogged at distance dissolve into the dome without a seam.
const fragmentShader = /* glsl */ `
  uniform vec3 uFog;
  uniform float uAmbient;
  uniform float uShafts;
  varying vec3 vDir;
  void main() {
    float up = vDir.y;
    vec3 glow = uFog * (1.0 + 1.6 * uAmbient) + vec3(0.18, 0.24, 0.26) * uShafts;
    vec3 below = uFog * mix(0.45, 0.8, uAmbient);
    vec3 col = up >= 0.0
      ? mix(uFog, glow, smoothstep(0.0, 1.0, up))
      : mix(uFog, below, smoothstep(0.0, 0.9, -up));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export default function createVolumeLayer(): Layer {
  let ctx: LayerContext;
  let dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  let fog: THREE.FogExp2;
  const fogColour = new THREE.Color();

  return {
    id: 'volume',
    init(c) {
      ctx = c;
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uFog: { value: new THREE.Color() },
          uAmbient: { value: 1 },
          uShafts: { value: 1 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 48, 24), material);
      dome.renderOrder = -10;
      dome.frustumCulled = false;
      fog = new THREE.FogExp2(0x000000, 0.03);
      ctx.scene.fog = fog;
      ctx.scene.add(dome);
    },
    update(frame: DiveFrame) {
      const { fog: rgb, fogDensity, ambient, shafts } = frame.water;
      // sRGB in, linear working space out: Three converts on setRGB.
      fogColour.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      fog.color.copy(fogColour);
      fog.density = fogDensity;
      const u = dome.material.uniforms;
      (u.uFog.value as THREE.Color).copy(fogColour);
      u.uAmbient.value = ambient;
      u.uShafts.value = shafts;
      dome.position.copy(ctx.camera.position);
      ctx.renderer.setClearColor(fogColour, 1);
    },
    dispose() {
      dome.geometry.dispose();
      dome.material.dispose();
      ctx.scene.remove(dome);
      ctx.scene.fog = null;
    },
  };
}
