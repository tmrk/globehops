import {
  AdditiveBlending,
  Group,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
} from 'three';
import { EARTH_RADIUS_KM } from '../lib/geo.ts';
import { MOON_RADIUS_KM } from '../lib/moon.ts';
import { ecefToScene, latLngToVector3 } from './math3d.ts';
import type { Sky } from './simFeed.ts';

const SUN_RADIUS_KM = 695_700;
const AU_KM = 149_597_870.7;
/** Glare reaches this many solar radii; the disc itself keeps the Sun's true angular size. */
const GLARE_RADII = 8;
/** Earth's shadow narrows (umbra) and widens (penumbra) by these Earth radii per Earth radius behind it. */
const UMBRA_TAPER = (SUN_RADIUS_KM - EARTH_RADIUS_KM) / AU_KM;
const PENUMBRA_FLARE = (SUN_RADIUS_KM + EARTH_RADIUS_KM) / AU_KM;
const glsl = (value: number) => value.toFixed(6);

interface SkyBodiesOptions {
  /** Scene-space unit vector towards the Sun, shared with the Earth's shading. */
  sunDirection: Vector3;
  /** Day-and-night blend (0–1): the bodies fade in and out with sunlit shading. */
  fade: { value: number };
  /** The camera's far plane; the Sun is drawn just inside it, beyond the Moon. */
  far: number;
  loadMoonMap: () => Promise<Texture | null>;
  requestRender: () => void;
}

/**
 * The Sun and Moon at their true directions and apparent sizes, as seen from the camera.
 * - The Moon is a real sphere at its real distance (about 60 Earth radii), so perspective gives its
 *   apparent size and parallax, and lighting it from the Sun's direction gives its exact phase.
 * - The Sun is effectively at infinity: a camera-facing disc placed along its direction from the camera,
 *   so it never parallaxes, sized to its angular radius at the Earth–Sun distance of the moment.
 * Both depth-test against Earth and each other, so the Earth hides them and the Moon can eclipse the Sun.
 */
export class SkyBodies {
  readonly object = new Group();
  private sun: Mesh<PlaneGeometry, ShaderMaterial>;
  private moon: Mesh<SphereGeometry, ShaderMaterial>;
  private basis = new Matrix4();
  private axes = [new Vector3(), new Vector3(), new Vector3()] as const;
  private map: Promise<void> | null = null;
  private disposed = false;

  constructor(private options: SkyBodiesOptions) {
    const sunDistance = glsl(options.far * 0.9);
    this.sun = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: { uDirection: { value: options.sunDirection }, uSize: { value: 0 }, uFade: options.fade },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        premultipliedAlpha: true,
        vertexShader: /* glsl */ `
          uniform vec3 uDirection;
          uniform float uSize;
          varying vec2 vOffset;
          void main() {
            // w = 0 rotates without translating: the Sun stays at infinity however the camera moves.
            vec3 centre = (viewMatrix * vec4(uDirection, 0.0)).xyz * ${sunDistance};
            vOffset = position.xy * ${glsl(GLARE_RADII)};
            gl_Position = projectionMatrix * vec4(centre + vec3(position.xy * uSize, 0.0), 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uFade;
          varying vec2 vOffset;
          void main() {
            float r = length(vOffset);
            float disc = 1.0 - smoothstep(1.0 - fwidth(r), 1.0 + fwidth(r), r);
            // Linear limb darkening (u = 0.6), then a lens's glare, which is not part of the Sun's size.
            vec3 photosphere = vec3(1.0, 0.97, 0.9) * (0.4 + 0.6 * sqrt(max(1.0 - r * r, 0.0)));
            float glare = 0.45 * pow(max(r, 1.0), -2.2) * (1.0 - smoothstep(${glsl(GLARE_RADII / 2)}, ${glsl(GLARE_RADII)}, r));
            vec3 color = mix(vec3(1.0, 0.78, 0.5) * glare, photosphere, disc) * uFade;
            gl_FragColor = vec4(color, max(color.r, max(color.g, color.b)));
          }`,
      }),
    );
    // The quad's geometry sits at the origin; its shader moves it out to the sky.
    this.sun.frustumCulled = false;
    this.sun.renderOrder = -1;

    this.moon = new Mesh(
      new SphereGeometry(MOON_RADIUS_KM / EARTH_RADIUS_KM, 48, 24),
      new ShaderMaterial({
        uniforms: { uMap: { value: null }, uSun: { value: options.sunDirection }, uFade: options.fade },
        transparent: true,
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vWorld;
          varying vec2 vUv;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            vNormal = normalize(mat3(modelMatrix) * normal);
            vUv = uv;
            gl_Position = projectionMatrix * viewMatrix * world;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uSun;
          uniform float uFade;
          varying vec3 vNormal;
          varying vec3 vWorld;
          varying vec2 vUv;
          void main() {
            vec3 normal = normalize(vNormal);
            float incidence = max(dot(normal, uSun), 0.0);
            float emission = max(dot(normal, normalize(cameraPosition - vWorld)), 0.0);
            // Lommel–Seeliger scattering suits regolith: no limb darkening, so the full Moon looks flat.
            float sunlight = 2.0 * incidence / max(incidence + emission, 1e-3);
            // Earth's shadow cones, in Earth radii at this distance behind Earth: a lunar eclipse.
            float behind = -dot(vWorld, uSun);
            float shadow = behind > 0.0
              ? smoothstep(1.0 - behind * ${glsl(UMBRA_TAPER)}, 1.0 + behind * ${glsl(PENUMBRA_FLARE)}, length(vWorld + uSun * behind))
              : 1.0;
            // Inside the umbra, sunlight bent through Earth's atmosphere glows faintly red; earthshine
            // keeps the unlit side barely visible.
            vec3 light = sunlight * mix(vec3(0.1, 0.035, 0.015), vec3(1.0), shadow) + vec3(0.012, 0.014, 0.018);
            gl_FragColor = vec4(texture2D(uMap, vUv).rgb * light * 1.25, uFade);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.moon.visible = false;
    this.object.add(this.sun, this.moon);
  }

  /** Places both bodies for this instant; the first call fetches the Moon's surface. */
  set(sky: Sky): void {
    const { moon } = sky;
    latLngToVector3(moon.sublunar.lat, moon.sublunar.lng, moon.distanceKm / EARTH_RADIUS_KM, this.moon.position);
    // Local axes match the Earth's (x: prime meridian, y: north, z: 90° west), so the map wraps the same way.
    const [x, y, z] = this.axes;
    ecefToScene(moon.primeMeridian, 1, x);
    ecefToScene(moon.pole, 1, y);
    z.crossVectors(x, y);
    this.moon.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
    const angularRadius = Math.asin(SUN_RADIUS_KM / sky.sunDistanceKm);
    this.sun.material.uniforms.uSize.value = this.options.far * 0.9 * Math.tan(angularRadius) * GLARE_RADII;
    this.map ??= this.options.loadMoonMap().then((texture) => {
      if (!texture || this.disposed) return;
      this.moon.material.uniforms.uMap.value = texture;
      this.moon.visible = true;
      this.options.requestRender();
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const body of [this.sun, this.moon]) {
      body.geometry.dispose();
      body.material.dispose();
    }
    this.object.clear();
  }
}
