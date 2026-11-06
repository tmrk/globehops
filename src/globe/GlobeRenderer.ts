/**
 * Imperative Three.js globe. Owned by <GlobeView>; React never touches the scene directly.
 *
 * Design notes
 * - Render on demand: a frame is drawn only while something changes (camera damping, tweens,
 *   reveal animations, texture uploads). An idle globe costs no GPU time.
 * - Routes are true great circles (spherical interpolation of unit vectors). The visual arc follows
 *   a simplified flight profile (climb to cruising altitude, cruise, descend; see lib/altitude.ts)
 *   with the vertical axis exaggerated. It lies entirely in the great-circle plane, so its ground
 *   projection is exactly the great-circle track.
 * - Translucent lines use the stencil buffer so each pixel blends once: overlapping segment joints
 *   never form brighter beads, and every line reads as one smooth stroke.
 * - Airport labels are HTML elements projected from 3D and hidden on the far side of the globe.
 * - Country borders and fainter coastlines (Natural Earth) are fetched only when first shown.
 * - The night side shows city lights (NASA Black Marble), fetched after the day texture.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  Color,
  type ColorSpace,
  DirectionalLight,
  Group,
  InterleavedBufferAttribute,
  Mesh,
  MeshLambertMaterial,
  NoColorSpace,
  NotEqualStencilFunc,
  PerspectiveCamera,
  ReplaceStencilOp,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import {
  altitudeAt,
  altitudeProfile,
  DEFAULT_ALTITUDE_MODEL,
  exaggeratedLift,
  locateFraction,
  profileFractions,
} from '../lib/altitude.ts';
import { countSegments, decodeBorders, densifyLine } from '../lib/borders.ts';
import { enclosingCap, greatCircleDistanceKm, greatCirclePath, slerpVec, toVec3 } from '../lib/geo.ts';
import { SOLAR_SHADING_GLSL } from '../lib/sun.ts';
import type { LatLng } from '../types.ts';
import {
  clamp01,
  easeInOutCubic,
  ecefToScene,
  latLngToVector3,
  sceneToEcef,
  slerpUnit,
  sunDirectionScene,
} from './math3d.ts';
import { CountryLabelLayer } from './countryLabels.ts';
import { FOLLOW_APPROACH_MS, followBlend, followDistance, followLead } from './followCamera.ts';
import type { AircraftView } from './simFeed.ts';

export type MarkerRole = 'origin' | 'transfer' | 'destination' | 'single';

export interface GlobeMarker {
  key: string;
  code: string;
  lat: number;
  lng: number;
  role: MarkerRole;
}

export interface GlobeLeg {
  /** Stable identity, e.g. "2542>2434"; unchanged legs are not re-animated. */
  key: string;
  from: LatLng;
  to: LatLng;
  color: string;
}

export interface GlobeRoute {
  markers: GlobeMarker[];
  legs: GlobeLeg[];
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TextureSet {
  preview: string;
  medium: string;
  large: string;
  /** Night-light masks: `small` for GPUs below 4096 px and coarse pointers, `large` otherwise. */
  lightsSmall: string;
  lightsLarge: string;
}

export interface GlobeRendererOptions {
  textures: TextureSet;
  /** URL of the generated country-border dataset. */
  bordersUrl: string;
  /** URL of the generated coastline dataset, shown with the borders. */
  coastlinesUrl: string;
  showBorders: boolean;
  countryLabelsUrl: string;
  showCountryLabels: boolean;
  labelLocale?: string;
  reducedMotion: boolean;
  onLegClick?: (leg: number) => void;
  onFollowAircraftChange?: (enabled: boolean) => void;
  onFitChange?: (fitsInView: boolean) => void;
  onTextureReady?: (quality: 'preview' | 'full') => void;
}

const GLOBE_SEGMENTS = 128;
/** Smaller-dimension field of view (degrees). Narrow FOV keeps the globe photographic. */
const BASE_FOV = 30;
const MIN_DISTANCE = 1.32;
/** Arcs start just above the surface so their ends never sink into the tessellated sphere. */
const ROUTE_LIFT = 0.0018;
/** Highest point of any arc: cruising altitude (exaggerated) above the base lift. */
const ARC_PEAK = ROUTE_LIFT + exaggeratedLift(DEFAULT_ALTITUDE_MODEL.cruiseAltitudeKm);
/** Borders sit just above the sphere's flat facets. */
const BORDER_RADIUS = 1.0004;
const BORDER_STEP_DEG = 0.5;
/** Land borders read clearly; coastlines only outline the land so it stays legible at night. */
const BORDER_OPACITY = 0.42;
const COAST_OPACITY = 0.2;
/** Brightness of the city lights on the night side once their texture has faded in. */
const CITY_LIGHTS = 1.4;
const CITY_LIGHTS_FADE_MS = 700;
const ATMOSPHERE_RADIUS = 1.055;
const LABEL_LIFT = 1.002;

const ATMOSPHERE_COLOR = new Color('#7fb4ff');

interface LegObject {
  key: string;
  /** Fractions of the leg distance (0 … 1) at which ground/arc are sampled; denser in climb and descent. */
  fractions: number[];
  ground: Vector3[]; // unit vectors along the great circle
  /** Sparse ground samples (≤ 2° apart) for camera framing; the enclosing-cap search is O(points). */
  frame: Vector3[];
  arc: Vector3[]; // lifted arc points
  /** The arc from destination to origin; drawing its first part shows what remains to be flown. */
  arcReversed: Vector3[];
  line: Line2;
  casing: Line2;
  remaining: Line2;
  material: LineMaterial;
  casingMaterial: LineMaterial;
  remainingMaterial: LineMaterial;
  segments: number;
  /** 0..1 reveal progress */
  progress: number;
}

interface MarkerObject {
  key: string;
  position: Vector3;
  el: HTMLDivElement;
  label: HTMLSpanElement;
  labelWidth: number;
  role: MarkerRole;
  code: string;
}

interface CameraTween {
  fromDir: Vector3;
  toDir: Vector3;
  fromDist: number;
  toDist: number;
  lift: number;
  start: number;
  duration: number;
}

interface RevealAnim {
  queue: number[]; // leg indices to reveal, in order
  current: number; // position in queue
  start: number;
  perLeg: number;
}

interface PlaneAnim {
  leg: number;
  start: number;
  duration: number;
}

export class GlobeRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(BASE_FOV, 1, 0.01, 100);
  private controls: OrbitControls;
  private earthMaterial: MeshLambertMaterial;
  private earth: Mesh;
  private atmosphere: Mesh;
  private routeGroup = new Group();
  private labelLayer: HTMLDivElement;
  private countryLabels: CountryLabelLayer;
  private plane: HTMLDivElement;
  private legs: LegObject[] = [];
  private markers: MarkerObject[] = [];
  private borderLayers: { line: LineSegments2; material: LineMaterial }[] = [];
  private bordersState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private textures: Texture[] = [];
  private width = 1;
  private height = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private targetInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private frame = 0;
  private cameraTween: CameraTween | null = null;
  private reveal: RevealAnim | null = null;
  private planeAnim: PlaneAnim | null = null;
  private selectedLeg: number | null = null;
  private highlightLeg: number | null = null;
  private aircraft: AircraftView | null = null;
  private follow = false;
  private followAircraft = false;
  private followApproachPending = false;
  private followPreviousTime: number | null = null;
  private followPagePending = false;
  private reportedCameraDistance = '';
  private reportedCameraAt = -Infinity;
  private keyLight = new DirectionalLight(0xfff6ea, 2.1);
  private subsolar: LatLng | null = null;
  private sunScene = new Vector3(1, 0, 0);
  private sunView = { value: new Vector3(1, 0, 0) };
  private dayNight = { value: 0 };
  private cityLights = { value: 0 };
  private lightsFadeStart: number | null = null;
  private lightsState: 'idle' | 'loading' | 'done' = 'idle';
  private dayTextureSettled = false;
  private illuminationTween: { from: number; to: number; start: number } | null = null;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private lastFits: boolean | null = null;
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor(
    private container: HTMLElement,
    private options: GlobeRendererOptions,
  ) {
    // The stencil buffer lets translucent border segments blend once where they overlap at joints.
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      stencil: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'globe-canvas';
    container.appendChild(this.canvas);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'globe-labels';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    container.appendChild(this.labelLayer);
    this.countryLabels = new CountryLabelLayer(this.labelLayer, options.countryLabelsUrl, this.requestRender);
    this.countryLabels.setLocale(options.labelLocale ?? 'en');
    this.countryLabels.setVisible(options.showCountryLabels);

    this.plane = document.createElement('div');
    this.plane.className = 'globe-plane';
    this.plane.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 1.8c.75 0 1.25.9 1.25 2.1v5.3l7.25 4.35v2.05l-7.25-2.25v4.4l2.25 1.7v1.6L12 20.1l-3.5.95v-1.6l2.25-1.7v-4.4L3.5 15.6v-2.05l7.25-4.35V3.9c0-1.2.5-2.1 1.25-2.1z"/></svg>';
    this.labelLayer.appendChild(this.plane);

    // Lighting: a soft key light that travels with the camera keeps the visible hemisphere
    // daylit with a gentle falloff toward the lower-right limb.
    this.scene.add(new AmbientLight(0xffffff, 1.35));
    this.keyLight.position.set(-1.6, 1.4, 2.2);
    this.camera.add(this.keyLight);
    this.scene.add(this.camera);

    // Black emissive: the night-light mask rides on emissiveMap but is applied by the custom shader.
    this.earthMaterial = new MeshLambertMaterial({ color: 0xffffff, emissive: 0x000000 });
    this.earthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uAtmo = { value: ATMOSPHERE_COLOR };
      shader.uniforms.uSunView = this.sunView;
      shader.uniforms.uDayNight = this.dayNight;
      shader.uniforms.uCityLights = this.cityLights;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform vec3 uAtmo;\nuniform vec3 uSunView;\nuniform float uDayNight;\nuniform float uCityLights;\n${SOLAR_SHADING_GLSL}`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
          {
            // Both normals and uSunView are in view space. mu = sin(geometric solar elevation).
            float mu = dot(normalize(normal), uSunView);
            float day = solarDayLightLevel(mu);
            vec3 nightTint = vec3(0.86, 0.93, 1.1);
            vec3 lit = gl_FragColor.rgb;
            // Keep the subsolar brightness while reducing ambient flattening. Direct Lambert
            // irradiance follows max(mu, 0); diffuse fill represents unresolved sky scattering.
            vec3 daylight = reflectedLight.directDiffuse * 1.2 + reflectedLight.indirectDiffuse * 0.65;
            vec3 timed = mix(diffuseColor.rgb * 0.06 * nightTint, daylight, day);
            float twilight = 4.0 * day * (1.0 - day) * 0.012;
            timed += diffuseColor.rgb * vec3(1.0, 0.38, 0.12) * twilight;
            #ifdef USE_EMISSIVEMAP
              // The emissive colour is black, so three.js adds nothing itself; the map is only a
              // convenient carrier for the night-light mask and its UVs. Lights come on at dusk.
              float city = texture2D(emissiveMap, vEmissiveMapUv).r;
              float dusk = solarCityDusk(mu);
              timed += vec3(1.0, 0.66, 0.32) * (city * city * 0.55 + city * 0.45) * dusk * uCityLights;
            #endif
            gl_FragColor.rgb = mix(lit, timed, uDayNight);
            float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            float fres = pow(1.0 - facing, 3.0);
            float rimLight = mix(1.0, mix(0.16, 1.0, day), uDayNight);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uAtmo * 0.9 * rimLight, fres * 0.55);
          }`,
        );
    };
    this.earth = new Mesh(new SphereGeometry(1, GLOBE_SEGMENTS, GLOBE_SEGMENTS / 2), this.earthMaterial);
    this.earth.renderOrder = 0;
    this.scene.add(this.earth);

    this.atmosphere = new Mesh(
      new SphereGeometry(ATMOSPHERE_RADIUS, 96, 48),
      new ShaderMaterial({
        side: BackSide,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: ATMOSPHERE_COLOR },
          uLimb: { value: Math.sqrt(1 - 1 / (ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS)) },
          uSunView: this.sunView,
          uDayNight: this.dayNight,
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uLimb;
          uniform vec3 uSunView;
          uniform float uDayNight;
          varying vec3 vNormal;
          varying vec3 vView;
          ${SOLAR_SHADING_GLSL}
          void main() {
            float d = -dot(normalize(vNormal), normalize(vView));
            float t = clamp(d / uLimb, 0.0, 1.0);
            float glow = pow(t, 3.2) * 0.85;
            float day = solarDayLightLevel(dot(normalize(vNormal), uSunView));
            glow *= mix(1.0, mix(0.16, 1.0, day), uDayNight);
            gl_FragColor = vec4(uColor * glow, glow);
          }`,
      }),
    );
    this.scene.add(this.atmosphere);
    this.scene.add(this.routeGroup);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.zoomSpeed = 0.7;
    this.controls.rotateSpeed = 0.6;
    this.controls.minDistance = MIN_DISTANCE;
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = Math.PI - 0.05;
    this.controls.addEventListener('start', this.onControlsStart);
    this.controls.addEventListener('change', this.requestRender);

    this.camera.position.copy(latLngToVector3(30, 0, 5));
    this.camera.lookAt(0, 0, 0);

    this.canvas.addEventListener('wheel', this.onControlsStart, { passive: true });
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loadTextures();
    if (options.showBorders) this.ensureBorders();
  }

  // ---------------------------------------------------------------------------------------------
  // Public API

  setIllumination(subsolar: LatLng | null) {
    if (subsolar?.lat === this.subsolar?.lat && subsolar?.lng === this.subsolar?.lng) return;
    const toggled = (subsolar === null) !== (this.subsolar === null);
    this.subsolar = subsolar ? { ...subsolar } : null;
    if (subsolar) {
      sunDirectionScene(subsolar, this.sunScene);
      if (this.keyLight.parent !== this.scene) this.scene.add(this.keyLight);
      this.keyLight.position.copy(this.sunScene).multiplyScalar(5);
      this.ensureCityLights();
    }
    if (toggled) {
      const to = subsolar ? 1 : 0;
      this.illuminationTween = this.options.reducedMotion
        ? null
        : { from: this.dayNight.value, to, start: performance.now() };
      if (this.options.reducedMotion) this.dayNight.value = to;
    }
    if (!subsolar && !this.illuminationTween) this.restoreCameraLight();
    this.requestRender();
  }

  setAircraft(view: AircraftView | null) {
    const old = this.aircraft;
    if (
      (old === null && view === null) ||
      (old &&
        view &&
        old.kind === view.kind &&
        old.leg === view.leg &&
        (old.kind === 'air' && view.kind === 'air'
          ? old.fraction === view.fraction && old.fractionPerSecond === view.fractionPerSecond
          : old.kind === 'ground' && view.kind === 'ground' && old.at === view.at))
    )
      return;
    this.aircraft = view ? { ...view } : null;
    if (!view) {
      if (this.followAircraft) this.cancelTween();
      this.followPreviousTime = null;
      this.followApproachPending = this.followAircraft;
      this.followPagePending = this.followAircraft;
    }
    this.plane.classList.toggle('is-ground', view?.kind === 'ground');
    // The next frame (or flush()) places a simulated aircraft; hiding it here would make it blink.
    if (view) this.planeAnim = null;
    else {
      this.plane.style.opacity = '0';
      this.startSelectionPlane();
    }
    for (const leg of this.legs) if (leg) this.applyProgress(leg);
    this.requestRender();
  }

  setHighlightLeg(index: number | null) {
    if (index === this.highlightLeg) return;
    this.highlightLeg = index;
    this.applySelectionStyles();
    for (const leg of this.legs) if (leg) this.applyProgress(leg);
    if (this.follow && !this.followAircraft && index !== null && this.legs[index] && this.lastFits === false) {
      // Preserve the whole-route fit result while following individual legs.
      this.frameView(true, index, false);
    }
    this.requestRender();
  }

  setFollow(enabled: boolean) {
    this.follow = enabled;
  }

  setFollowAircraft(enabled: boolean) {
    if (enabled === this.followAircraft) return;
    this.followAircraft = enabled;
    this.followApproachPending = enabled;
    this.followPagePending = enabled;
    this.followPreviousTime = null;
    this.cancelTween();
    this.plane.classList.toggle('is-following', enabled);
    this.container.dataset.follow = enabled ? 'on' : 'off';
    this.requestRender();
  }

  private exitFollowAircraft() {
    if (!this.followAircraft) return;
    this.setFollowAircraft(false);
    this.options.onFollowAircraftChange?.(false);
  }

  setRoute(route: GlobeRoute, opts: { animate: boolean; frame: boolean }) {
    const previousKeys = new Set(this.legs.map((l) => l.key));
    this.clearLegs();
    this.clearMarkers();

    const toReveal: number[] = [];
    route.legs.forEach((leg, i) => {
      const obj = this.buildLeg(leg);
      if (!obj) return;
      this.legs[i] = obj;
      const isNew = !previousKeys.has(leg.key);
      if (opts.animate && isNew && !this.options.reducedMotion) {
        obj.progress = 0;
        toReveal.push(i);
      } else {
        obj.progress = 1;
      }
      this.applyProgress(obj);
    });
    for (const m of route.markers) this.markers.push(this.buildMarker(m));

    this.plane.style.opacity = '0';
    this.reveal = toReveal.length
      ? { queue: toReveal, current: 0, start: performance.now(), perLeg: Math.max(650, 1500 / toReveal.length) }
      : null;
    this.planeAnim = null;
    if (this.selectedLeg !== null && this.selectedLeg >= route.legs.length) this.selectedLeg = null;
    this.applySelectionStyles();
    if (opts.frame && !this.followAircraft) this.frameCurrent(true);
    this.requestRender();
  }

  setSelectedLeg(index: number | null, opts: { frame: boolean } = { frame: true }) {
    const valid = index !== null && index >= 0 && index < this.legs.length && this.legs[index] ? index : null;
    const changed = valid !== this.selectedLeg;
    if (!changed) return;
    this.selectedLeg = valid;
    this.applySelectionStyles();
    this.startSelectionPlane();
    if (opts.frame) this.frameCurrent(true);
    this.requestRender();
  }

  /** Fly the camera to show the selected leg, or the whole route. */
  frameCurrent(animate = true) {
    this.exitFollowAircraft();
    this.frameView(animate, this.selectedLeg);
  }

  private frameView(animate: boolean, index: number | null, reportFit = true) {
    const points: Vector3[] = [];
    const legs = index !== null ? [this.legs[index]] : this.legs;
    for (const leg of legs) if (leg) points.push(...leg.frame);
    if (!points.length) for (const m of this.markers) points.push(m.position.clone().normalize());
    if (!points.length) {
      if (reportFit) this.notifyFit(true);
      return;
    }
    const cap = enclosingCap(points.map(sceneToEcef));
    let center = ecefToScene(cap.center);
    let radius = cap.radius;
    // Seen from directly above its midpoint, a great circle projects to a straight line. Viewing
    // the route from slightly nearer the equator reveals its characteristic poleward bow.
    const lat = Math.asin(Math.max(-1, Math.min(1, center.y)));
    const tilt = Math.min(radius * 0.45, 0.2) * Math.min(1, Math.abs(lat) / 0.35);
    if (tilt > 0.01 && radius < 1.2) {
      const lng = Math.atan2(-center.z, center.x);
      const tilted = lat - Math.sign(lat) * tilt;
      center = latLngToVector3((tilted * 180) / Math.PI, (lng * 180) / Math.PI);
      radius += tilt * 0.7;
    }
    const { distance, fits } = this.distanceForCap(radius, points.length === 1);
    if (reportFit) this.notifyFit(fits);
    this.flyTo(center, distance, animate);
  }

  setInsets(insets: Insets, animate = true) {
    this.targetInsets = { ...insets };
    if (!animate || this.options.reducedMotion) {
      this.insets = { ...insets };
      this.updateProjection();
    }
    this.requestRender();
  }

  setReducedMotion(reduced: boolean) {
    this.options.reducedMotion = reduced;
    if (reduced && this.followAircraft) {
      this.cancelTween();
      this.followPagePending = true;
      this.requestRender();
    }
    if (reduced && this.illuminationTween) {
      this.dayNight.value = this.illuminationTween.to;
      this.illuminationTween = null;
      if (!this.subsolar) this.restoreCameraLight();
      this.requestRender();
    }
  }

  setBordersVisible(visible: boolean) {
    this.options.showBorders = visible;
    if (visible) this.ensureBorders();
    for (const layer of this.borderLayers) layer.line.visible = visible;
    this.requestRender();
  }

  setLabelLocale(locale: string) {
    this.countryLabels.setLocale(locale);
  }

  setCountryLabelsVisible(visible: boolean) {
    this.countryLabels.setVisible(visible);
    this.requestRender();
  }

  /** Keyboard rotation / zoom for accessibility. */
  nudge(dLng: number, dLat: number, zoom = 1) {
    this.exitFollowAircraft();
    this.follow = false;
    this.cancelTween();
    const pos = this.camera.position;
    const dist = pos.length() * zoom;
    const lat = Math.asin(pos.y / pos.length()) * (180 / Math.PI);
    const lng = Math.atan2(-pos.z, pos.x) * (180 / Math.PI);
    const nextLat = Math.max(-80, Math.min(80, lat + dLat));
    const clamped = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, dist));
    this.flyTo(latLngToVector3(nextLat, lng + dLng, 1), clamped, true, 280);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('start', this.onControlsStart);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    this.canvas.removeEventListener('wheel', this.onControlsStart);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.clearLegs();
    this.clearMarkers();
    this.countryLabels.dispose();
    for (const layer of this.borderLayers) {
      this.scene.remove(layer.line);
      layer.line.geometry.dispose();
      layer.material.dispose();
    }
    this.borderLayers = [];
    this.earth.geometry.dispose();
    this.earthMaterial.dispose();
    this.atmosphere.geometry.dispose();
    (this.atmosphere.material as ShaderMaterial).dispose();
    for (const t of this.textures) t.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labelLayer.remove();
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering loop

  requestRender = () => {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(this.renderFrame);
  };

  /**
   * Draws a pending frame now. Simulation updates arrive inside the clock's animation frame; drawing
   * there (instead of in the next one) keeps the aircraft, trail and labels in step with the clock.
   */
  flush() {
    if (this.disposed || !this.frame) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.renderFrame(performance.now());
  }

  private renderFrame = (now: number) => {
    this.frame = 0;
    if (this.disposed) return;
    let active = false;

    active = this.stepInsets() || active;
    let cameraMoving = this.stepFollowAircraft(now);
    cameraMoving = this.stepTween(now) || cameraMoving;
    active = this.stepReveal(now) || active;
    active = this.stepPlane(now) || active;
    active = this.stepIllumination(now) || active;
    active = this.stepCityLights(now) || active;
    // OrbitControls.update() returns true while damping is still moving the camera.
    if (!this.cameraTween && !(this.followAircraft && this.aircraft))
      cameraMoving = this.controls.update() || cameraMoving;
    active = cameraMoving || active;
    const motion = cameraMoving ? 'moving' : 'settled';
    if (this.container.dataset.cameraMotion !== motion) this.container.dataset.cameraMotion = motion;
    this.updateRotateSpeed();
    this.maybeLoadLargeTexture();

    const distance = this.camera.position.length().toFixed(2);
    if (distance !== this.reportedCameraDistance && (!cameraMoving || now - this.reportedCameraAt >= 100)) {
      this.container.dataset.cameraDistance = distance;
      this.reportedCameraDistance = distance;
      this.reportedCameraAt = now;
    }
    this.camera.updateMatrixWorld();
    // Recompute even for paused sunlight: orbit/damping changes the normals' view space every frame.
    this.sunView.value.copy(this.sunScene).transformDirection(this.camera.matrixWorldInverse);
    this.renderer.render(this.scene, this.camera);
    const reserved = this.updateLabels();
    this.countryLabels.update({ camera: this.camera, width: this.width, height: this.height, reserved });
    if (this.aircraft) {
      const view = this.aircraft;
      const leg = this.legs[view.leg];
      if (leg)
        this.placePlaneOnLeg(
          leg,
          view.kind === 'air' ? clamp01(view.fraction) : view.at === 'start' ? 0 : 1,
          true,
          true,
        );
      else this.plane.style.opacity = '0';
    }
    if (active) this.requestRender();
  };

  // ---------------------------------------------------------------------------------------------
  // Textures

  /**
   * Progressive texture loading: a 1K placeholder appears almost instantly, then the 4K texture
   * (or the placeholder alone on GPUs limited below 4096 px). The 8K texture (~2 MB download,
   * ~170 MB of GPU memory with mipmaps) is fetched only when the user zooms in close on a
   * capable non-touch device, where the extra detail is actually visible.
   */
  private async loadTextures() {
    const preview = await this.loadTexture(this.options.textures.preview).catch(() => null);
    if (this.disposed) return;
    if (preview) {
      this.applyTexture(preview);
      this.options.onTextureReady?.('preview');
    }
    // A close-up first view may already have started the 8K texture; don't download both.
    if (this.renderer.capabilities.maxTextureSize >= 4096 && this.largeTextureState !== 'loading') {
      await this.loadMediumTexture(preview);
    }
    this.dayTextureSettled = true;
    this.ensureCityLights();
  }

  /** Night lights matter only with day/night shading, so they load after the day texture, once needed. */
  private ensureCityLights() {
    if (this.lightsState !== 'idle' || this.disposed || !this.subsolar || !this.dayTextureSettled) return;
    this.lightsState = 'loading';
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const url =
      this.renderer.capabilities.maxTextureSize >= 4096 && !coarse
        ? this.options.textures.lightsLarge
        : this.options.textures.lightsSmall;
    this.loadTexture(url, NoColorSpace)
      .then((lights) => {
        if (this.disposed) return lights.dispose();
        this.earthMaterial.emissiveMap = lights;
        this.earthMaterial.needsUpdate = true;
        this.cityLights.value = 0;
        // Fade in from the next frame so the shader recompilation doesn't eat the transition.
        if (this.options.reducedMotion) this.cityLights.value = CITY_LIGHTS;
        else this.lightsFadeStart = performance.now() + 50;
        this.requestRender();
      })
      // Decorative: without the mask the night side is simply dark.
      .catch((error: unknown) => console.warn('City lights unavailable', error))
      .finally(() => (this.lightsState = 'done'));
  }

  private async loadMediumTexture(previous: Texture | null) {
    const full = await this.loadTexture(this.options.textures.medium).catch(() => null);
    if (this.disposed || !full) return;
    this.swapTexture(full, previous);
    this.options.onTextureReady?.('full');
  }

  private largeTextureState: 'idle' | 'loading' | 'done' = 'idle';

  private canUseLargeTexture(): boolean {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    return this.renderer.capabilities.maxTextureSize >= 8192 && !coarse && memory >= 4;
  }

  /** Called every rendered frame; cheap until the zoom threshold is crossed once. */
  private maybeLoadLargeTexture() {
    if (this.largeTextureState !== 'idle' || this.camera.position.length() > 2.2) return;
    if (!this.canUseLargeTexture()) {
      this.largeTextureState = 'done';
      return;
    }
    this.largeTextureState = 'loading';
    const current = this.earthMaterial.map;
    this.loadTexture(this.options.textures.large)
      .then((large) => {
        if (this.disposed) return large.dispose();
        this.swapTexture(large, current);
        this.options.onTextureReady?.('full');
      })
      // Fall back to the 4K texture if the large one fails (e.g. out of memory or offline).
      .catch(() => (this.earthMaterial.map === current ? this.loadMediumTexture(current ?? null) : undefined))
      .finally(() => (this.largeTextureState = 'done'));
  }

  private swapTexture(next: Texture, previous: Texture | null) {
    this.applyTexture(next);
    if (!previous) return;
    // Keep the previous texture alive until the new one has been uploaded on the next frame.
    requestAnimationFrame(() => {
      previous.dispose();
      this.textures = this.textures.filter((t) => t !== previous);
    });
  }

  private async loadTexture(url: string, colorSpace: ColorSpace = SRGBColorSpace): Promise<Texture> {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const tex = new Texture(img);
    tex.colorSpace = colorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.textures.push(tex);
    return tex;
  }

  private applyTexture(tex: Texture) {
    this.earthMaterial.map = tex;
    this.earthMaterial.color.set(0xffffff);
    this.earthMaterial.needsUpdate = true;
    this.requestRender();
  }

  // ---------------------------------------------------------------------------------------------
  // Country borders

  private async ensureBorders() {
    if (this.bordersState !== 'idle') return;
    this.bordersState = 'loading';
    // Land borders and coastlines load in parallel; either one can fail without the other.
    const layers = [
      { url: this.options.bordersUrl, opacity: BORDER_OPACITY, order: 0.5, name: 'Country borders' },
      { url: this.options.coastlinesUrl, opacity: COAST_OPACITY, order: 0.51, name: 'Coastlines' },
    ];
    const results = await Promise.allSettled(
      layers.map(async (layer) => {
        const response = await fetch(layer.url);
        if (!response.ok) throw new Error(`HTTP ${response.status} loading ${layer.name.toLowerCase()}`);
        const lines = decodeBorders(await response.json());
        if (this.disposed) return;
        this.buildBorderLayer(
          lines.map((line) => densifyLine(line, BORDER_STEP_DEG)),
          layer.opacity,
          layer.order,
        );
      }),
    );
    // Borders are decorative: the globe and routes stay fully usable without them.
    results.forEach((result, i) => {
      if (result.status === 'rejected') console.warn(`${layers[i].name} unavailable`, result.reason);
    });
    this.bordersState = results.every((r) => r.status === 'rejected') ? 'failed' : 'ready';
  }

  private buildBorderLayer(lines: LatLng[][], opacity: number, renderOrder: number) {
    const positions = new Float32Array(countSegments(lines) * 6);
    const p = new Vector3();
    let o = 0;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        for (const point of [line[i - 1], line[i]]) {
          latLngToVector3(point.lat, point.lng, BORDER_RADIUS, p);
          positions[o++] = p.x;
          positions[o++] = p.y;
          positions[o++] = p.z;
        }
      }
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      color: 0xf4f1ea,
      linewidth: 0.9,
      transparent: true,
      opacity,
      worldUnits: false,
      depthWrite: false,
      // Each pixel is drawn at most once, so overlapping segment ends don't form brighter beads.
      // Borders and coastlines share the stencil value; where they meet, the border (drawn first) wins.
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: NotEqualStencilFunc,
      stencilZPass: ReplaceStencilOp,
    });
    material.resolution.set(this.width, this.height);
    const line = new LineSegments2(geometry, material);
    line.renderOrder = renderOrder;
    line.frustumCulled = false;
    line.visible = this.options.showBorders;
    this.scene.add(line);
    this.borderLayers.push({ line, material });
    this.requestRender();
  }

  // ---------------------------------------------------------------------------------------------
  // Route objects

  private buildLeg(leg: GlobeLeg): LegObject | null {
    const angle = latLngToVector3(leg.from.lat, leg.from.lng).angleTo(latLngToVector3(leg.to.lat, leg.to.lng));
    if (!(angle > 1e-4)) return null; // same airport: nothing to draw
    // Climb to cruising altitude, hold it, descend before landing (vertical axis exaggerated).
    const distanceKm = greatCircleDistanceKm(leg.from, leg.to);
    const profile = altitudeProfile(distanceKm);
    const fractions = profileFractions(profile);
    const u = toVec3(leg.from);
    const v = toVec3(leg.to);
    const ground = fractions.map((f) => ecefToScene(slerpVec(u, v, f)));
    const frame = greatCirclePath(leg.from, leg.to, Math.max(2, Math.ceil((angle * 90) / Math.PI))).map((p) =>
      ecefToScene(p),
    );
    const n = ground.length - 1;
    const arc = ground.map((g, i) =>
      g.clone().multiplyScalar(1 + ROUTE_LIFT + exaggeratedLift(altitudeAt(profile, fractions[i] * distanceKm))),
    );

    const color = new Color(leg.color);
    const material = new LineMaterial({ color, linewidth: 2.6, transparent: true, worldUnits: false });
    const remainingMaterial = new LineMaterial({
      color,
      linewidth: 1.6,
      transparent: true,
      opacity: 0.45,
      worldUnits: false,
    });
    const casingMaterial = new LineMaterial({
      color: 0x050a14,
      linewidth: 5.2,
      transparent: true,
      opacity: 0.35,
      worldUnits: false,
    });
    for (const m of [material, casingMaterial, remainingMaterial]) {
      m.resolution.set(this.width, this.height);
      // Lines are depth-tested against the globe (so far-side routes hide) but don't write
      // depth themselves — avoids z-fighting between the casing and the coloured line.
      m.depthWrite = false;
      // One stencil value per line: a pixel already covered by this line is not blended again, so
      // translucent strokes stay even instead of beading where segment ends overlap.
      m.stencilWrite = true;
      m.stencilRef = this.nextStencilRef();
      m.stencilFunc = NotEqualStencilFunc;
      m.stencilZPass = ReplaceStencilOp;
    }

    const line = makeLine(arc, material, 3);
    const casing = makeLine(arc, casingMaterial, 2);
    const arcReversed = [...arc].reverse();
    const remaining = makeLine(arcReversed, remainingMaterial, 2.5);
    remaining.visible = false;
    this.routeGroup.add(casing, remaining, line);
    return {
      key: leg.key,
      fractions,
      ground,
      frame,
      arc,
      arcReversed,
      line,
      casing,
      remaining,
      material,
      casingMaterial,
      remainingMaterial,
      segments: n,
      progress: 1,
    };
  }

  private applyProgress(leg: LegObject) {
    // Progress is a fraction of the distance flown. The drawn line ends exactly at that point (the
    // last visible segment is shortened), so the trail grows continuously instead of in steps.
    const aircraft = this.aircraft;
    const trail = aircraft?.kind === 'air' && aircraft.leg === this.highlightLeg && this.legs[aircraft.leg] === leg;
    const progress = clamp01(trail ? aircraft.fraction : leg.progress);
    const { index, t } = locateFraction(leg.fractions, progress);
    const flown = progress > 0;
    revealLine(leg.line, leg.arc, flown ? index : -1, t);
    revealLine(leg.casing, leg.arc, flown ? index : -1, t);
    revealLine(leg.remaining, leg.arcReversed, trail && progress < 1 ? leg.segments - 1 - index : -1, 1 - t);
  }

  /** Stencil values for translucent route lines; 1 belongs to the borders. */
  private stencilRef = 1;
  private nextStencilRef(): number {
    this.stencilRef = this.stencilRef >= 255 ? 2 : this.stencilRef + 1;
    return this.stencilRef;
  }

  private applySelectionStyles() {
    const sel = this.highlightLeg ?? this.selectedLeg;
    this.legs.forEach((leg, i) => {
      if (!leg) return;
      const active = sel === null || sel === i;
      leg.material.linewidth = sel === i ? 3.6 : 2.6;
      leg.material.opacity = active ? 1 : this.highlightLeg !== null ? 0.55 : 0.38;
      leg.casingMaterial.opacity = active ? 0.38 : 0.12;
      leg.casingMaterial.linewidth = sel === i ? 6.6 : 5.2;
    });
    // Emphasise endpoints of the selected leg.
    const emph = new Set<string>();
    if (sel !== null && this.legs[sel]) {
      const l = this.legs[sel];
      for (const m of this.markers) {
        const p = m.position.clone().normalize();
        if (p.angleTo(l.ground[0]) < 1e-5 || p.angleTo(l.ground[l.ground.length - 1]) < 1e-5) emph.add(m.key);
      }
    }
    for (const m of this.markers) {
      m.el.classList.toggle('is-dim', sel !== null && !emph.has(m.key));
      m.el.classList.toggle('is-emph', emph.has(m.key));
    }
  }

  private clearLegs() {
    for (const leg of this.legs) {
      if (!leg) continue;
      for (const l of [leg.line, leg.casing, leg.remaining]) {
        this.routeGroup.remove(l);
        l.geometry.dispose();
      }
      leg.material.dispose();
      leg.casingMaterial.dispose();
      leg.remainingMaterial.dispose();
    }
    this.legs = [];
    this.stencilRef = 1;
  }

  private buildMarker(m: GlobeMarker): MarkerObject {
    const el = document.createElement('div');
    el.className = `globe-marker globe-marker--${m.role}`;
    const dot = document.createElement('span');
    dot.className = 'globe-marker__dot';
    const label = document.createElement('span');
    label.className = 'globe-marker__label';
    label.textContent = m.code;
    el.append(dot, label);
    el.style.opacity = '0';
    this.labelLayer.insertBefore(el, this.plane);
    return {
      key: m.key,
      position: latLngToVector3(m.lat, m.lng, LABEL_LIFT),
      el,
      label,
      labelWidth: 0,
      role: m.role,
      code: m.code,
    };
  }

  private clearMarkers() {
    for (const m of this.markers) m.el.remove();
    this.markers = [];
  }

  // ---------------------------------------------------------------------------------------------
  // Animation steps

  private restoreCameraLight() {
    this.camera.add(this.keyLight);
    this.keyLight.position.set(-1.6, 1.4, 2.2);
  }

  private stepIllumination(now: number): boolean {
    const tween = this.illuminationTween;
    if (!tween) return false;
    const t = clamp01((now - tween.start) / 360);
    this.dayNight.value = tween.from + (tween.to - tween.from) * easeInOutCubic(t);
    if (t >= 1) {
      this.illuminationTween = null;
      if (!this.subsolar) this.restoreCameraLight();
    }
    return t < 1;
  }

  private stepCityLights(now: number): boolean {
    if (this.lightsFadeStart === null) return false;
    const t = clamp01((now - this.lightsFadeStart) / CITY_LIGHTS_FADE_MS);
    this.cityLights.value = CITY_LIGHTS * easeInOutCubic(t);
    if (t >= 1) this.lightsFadeStart = null;
    return t < 1;
  }

  private startSelectionPlane() {
    this.planeAnim = null;
    const valid = this.selectedLeg;
    if (this.aircraft || valid === null || this.options.reducedMotion || this.reveal) return;
    const obj = this.legs[valid];
    if (!obj) return;
    const duration = Math.min(2600, 1100 + obj.ground[0].angleTo(obj.ground[obj.ground.length - 1]) * 600);
    this.planeAnim = { leg: valid, start: performance.now() + 450, duration };
  }

  private stepReveal(now: number): boolean {
    const r = this.reveal;
    if (!r) return false;
    const idx = r.queue[r.current];
    const leg = this.legs[idx];
    const t = clamp01((now - r.start) / r.perLeg);
    if (leg) {
      leg.progress = easeInOutCubic(t);
      this.applyProgress(leg);
      if (!this.aircraft) this.placePlaneOnLeg(leg, leg.progress, t < 1);
    }
    if (t >= 1) {
      r.current++;
      r.start = now;
      if (r.current >= r.queue.length) {
        this.reveal = null;
        if (!this.aircraft) this.plane.style.opacity = '0';
        return true;
      }
    }
    return true;
  }

  private stepPlane(now: number): boolean {
    const p = this.planeAnim;
    if (!p || this.reveal || this.aircraft) return false;
    const leg = this.legs[p.leg];
    if (!leg) {
      this.planeAnim = null;
      return false;
    }
    const t = (now - p.start) / p.duration;
    if (t < 0) return true;
    if (t >= 1) {
      this.planeAnim = null;
      this.plane.style.opacity = '0';
      return true;
    }
    this.placePlaneOnLeg(leg, easeInOutCubic(t), true);
    return true;
  }

  private placePlaneOnLeg(leg: LegObject, f: number, visible: boolean, simulated = false) {
    const pts = leg.arc;
    const { index: i, t } = locateFraction(leg.fractions, f);
    const pos = this.tmp.copy(pts[i]).lerp(pts[i + 1], t);
    const a = this.project(pos);
    // Heading from the current segment's direction on screen.
    const s0 = this.project(pts[i]);
    const s1 = this.project(this.tmp2.copy(pts[i + 1]));
    const facing = this.facing(pos);
    // The lifted aircraft can still clear the horizon after its surface normal turns away.
    // Test the camera sightline against the unit sphere instead of fading it near the limb.
    let hidden = facing < 0.02;
    if (simulated) {
      const toCamera = this.tmp2.copy(this.camera.position).sub(pos);
      const t = clamp01(-pos.dot(toCamera) / toCamera.lengthSq());
      hidden = toCamera.multiplyScalar(t).add(pos).lengthSq() < 1;
    }
    if (!a || !s0 || !s1 || hidden) {
      this.plane.style.opacity = '0';
      return;
    }
    const angle = (Math.atan2(s1.y - s0.y, s1.x - s0.x) * 180) / Math.PI + 90;
    const fade = Math.min(1, f * 12, (1 - f) * 12);
    this.plane.style.opacity = visible ? (simulated ? '1' : String(Math.min(fade, facing * 6))) : '0';
    this.plane.style.transform = `translate3d(${a.x}px, ${a.y}px, 0) translate(-50%, -50%) rotate(${angle}deg)`;
  }

  /** Uses only origin-facing, north-up poses so OrbitControls can take over without a jump. */
  private stepFollowAircraft(now: number): boolean {
    const view = this.aircraft;
    if (!this.followAircraft || !view) return false;
    const leg = this.legs[view.leg];
    if (!leg) return false;
    const start = leg.ground[0];
    const end = leg.ground[leg.ground.length - 1];
    const angle = start.angleTo(end);
    const fraction = view.kind === 'air' ? clamp01(view.fraction) : view.at === 'start' ? 0 : 1;
    const halfFov = this.availableHalfFov();
    const distance = Math.max(
      this.controls.minDistance,
      Math.min(this.controls.maxDistance, followDistance(angle, fraction, view.kind === 'air', halfFov)),
    );
    const lead = followLead(
      angle,
      fraction,
      view.kind === 'air' && !this.options.reducedMotion ? (view.fractionPerSecond ?? 0) : 0,
      distance,
      halfFov,
    );
    // Use the sampled track, including its deterministic choice of great circle at antipodes.
    const sample = (f: number) => {
      const { index, t } = locateFraction(leg.fractions, f);
      return slerpUnit(leg.ground[index], leg.ground[index + 1], t);
    };
    const target = sample(view.kind === 'air' ? lead.fraction : fraction);
    // OrbitControls has a polar singularity: stay 0.05 radians away, keeping camera.up = +Y.
    const maxY = Math.cos(0.05);
    if (Math.abs(target.y) > maxY) {
      const horizontal = new Vector3(target.x, 0, target.z);
      if (horizontal.lengthSq() < 1e-12) horizontal.set(start.x, 0, start.z);
      if (horizontal.lengthSq() < 1e-12) horizontal.set(1, 0, 0);
      horizontal.normalize().multiplyScalar(Math.sin(0.05));
      target.set(horizontal.x, Math.sign(target.y) * maxY, horizontal.z);
    }
    if (this.options.reducedMotion) {
      this.cameraTween = null;
      const aircraft = sample(fraction);
      this.camera.updateMatrixWorld();
      const projected = this.project(aircraft);
      const i = this.insets;
      const w = Math.max(80, this.width - i.left - i.right);
      const h = Math.max(80, this.height - i.top - i.bottom);
      const outside =
        !projected ||
        this.facing(aircraft) <= 0 ||
        Math.abs(projected.x - (i.left + w / 2)) > w * 0.25 ||
        Math.abs(projected.y - (i.top + h / 2)) > h * 0.25;
      if (this.followPagePending || outside) {
        this.camera.position.copy(target).multiplyScalar(distance);
        this.camera.lookAt(0, 0, 0);
        this.followPagePending = false;
        this.followApproachPending = false;
      }
      return false;
    }
    const dt = this.followPreviousTime === null ? 0 : Math.max(0, (now - this.followPreviousTime) / 1000);
    this.followPreviousTime = now;
    if (this.followApproachPending) {
      this.followApproachPending = false;
      this.flyTo(target, distance, true, FOLLOW_APPROACH_MS);
    }
    if (this.cameraTween) {
      this.cameraTween.toDir.copy(target);
      this.cameraTween.toDist = distance;
      return true;
    }
    const current = this.camera.position.clone().normalize();
    const angularError = current.angleTo(target);
    const distanceError = distance - this.camera.position.length();
    if (angularError < 0.00002 && Math.abs(distanceError) < 0.0001) {
      this.followPreviousTime = null;
      this.camera.position.copy(target).multiplyScalar(distance);
      this.camera.lookAt(0, 0, 0);
      return false;
    }
    // Fast playback uses velocity prediction. Zoom responds more slowly than the ground track.
    const direction = slerpUnit(current, target, followBlend(dt, lead.response));
    const nextDistance = this.camera.position.length() + distanceError * followBlend(dt, 0.45);
    this.camera.position.copy(direction).multiplyScalar(nextDistance);
    this.camera.lookAt(0, 0, 0);
    return true;
  }

  private flyTo(dir: Vector3, distance: number, animate: boolean, durationOverride?: number) {
    const toDir = dir.clone().normalize();
    // Keep the camera away from the exact poles (OrbitControls' up-axis singularity).
    const maxY = Math.sin((82 * Math.PI) / 180);
    if (Math.abs(toDir.y) > maxY) {
      const h = Math.sqrt(1 - maxY * maxY);
      const horiz = new Vector3(toDir.x, 0, toDir.z);
      if (horiz.lengthSq() < 1e-9) horiz.set(1, 0, 0);
      horiz.normalize().multiplyScalar(h);
      toDir.set(horiz.x, Math.sign(toDir.y) * maxY, horiz.z);
    }
    const toDist = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, distance));
    // Flush any residual damping so it doesn't fight the tween.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;

    const fromDir = this.camera.position.clone().normalize();
    const fromDist = this.camera.position.length();
    const angle = fromDir.angleTo(toDir);
    if (!animate || this.options.reducedMotion) {
      this.cameraTween = null;
      this.camera.position.copy(toDir).multiplyScalar(toDist);
      this.camera.lookAt(0, 0, 0);
      this.controls.update();
      this.requestRender();
      return;
    }
    const duration =
      durationOverride ?? Math.min(1900, 650 + angle * 520 + Math.abs(Math.log(toDist / fromDist)) * 350);
    const lift = angle > 0.6 ? Math.min(1.6, (angle - 0.6) * 0.75) : 0;
    this.cameraTween = { fromDir, toDir, fromDist, toDist, lift, start: performance.now(), duration };
    this.requestRender();
  }

  private stepTween(now: number): boolean {
    const tw = this.cameraTween;
    if (!tw) return false;
    const t = clamp01((now - tw.start) / tw.duration);
    const e = easeInOutCubic(t);
    const dir = slerpUnit(tw.fromDir, tw.toDir, e, this.tmp);
    const dist = tw.fromDist + (tw.toDist - tw.fromDist) * e + tw.lift * Math.sin(Math.PI * e);
    this.camera.position.copy(dir).multiplyScalar(dist);
    this.camera.lookAt(0, 0, 0);
    if (t >= 1) {
      this.cameraTween = null;
      this.controls.update();
    }
    return true;
  }

  private cancelTween() {
    if (this.cameraTween) {
      this.cameraTween = null;
      this.controls.update();
    }
  }

  private stepInsets(): boolean {
    const a = this.insets;
    const b = this.targetInsets;
    const keys: (keyof Insets)[] = ['top', 'right', 'bottom', 'left'];
    let moving = false;
    let changed = false;
    for (const k of keys) {
      const d = b[k] - a[k];
      if (d === 0) continue;
      changed = true;
      if (Math.abs(d) > 0.5) {
        a[k] += d * 0.22;
        moving = true;
      } else a[k] = b[k];
    }
    if (changed) this.updateProjection();
    return moving;
  }

  // ---------------------------------------------------------------------------------------------
  // Camera geometry

  /** Half field of view (radians) of the unobstructed viewport region, in its smaller dimension. */
  private availableHalfFov(): number {
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const tanV = Math.tan(vHalf);
    const tanH = tanV * (this.width / this.height);
    const i = this.targetInsets;
    const availW = Math.max(80, this.width - i.left - i.right) / this.width;
    const availH = Math.max(80, this.height - i.top - i.bottom) / this.height;
    return Math.min(Math.atan(tanV * availH), Math.atan(tanH * availW));
  }

  private distanceForCap(radius: number, single: boolean): { distance: number; fits: boolean } {
    const half = this.availableHalfFov();
    const maxDist = this.overviewDistance();
    if (single) return { distance: Math.min(maxDist, 2.6), fits: true };
    // Leave margin around the route (labels, arc height).
    const alpha = half * 0.64;
    const r = Math.max(radius, 0.02);
    // Camera at distance d along the cap centre sees a rim point at off-axis angle atan(sin r / (d − cos r)).
    let d = Math.cos(r) + Math.sin(r) / Math.tan(alpha);
    d *= 1 + 0.8 * ARC_PEAK; // account for lifted arcs
    // Wide routes look best with the whole planet in view rather than a slightly cropped globe.
    if (d > maxDist * 0.7) d = Math.max(d, maxDist * 0.93);
    d = Math.max(MIN_DISTANCE + 0.05, Math.min(maxDist, d));
    // The route "fits" when its farthest point is on the visible hemisphere (with some margin
    // from the limb) and inside the unobstructed viewport at the distance actually used.
    const rimVisible = Math.cos(r) > 1 / d + 0.08;
    const rimInView = Math.atan2(Math.sin(r), d - Math.cos(r)) <= half * 0.96;
    const fits = rimVisible && rimInView;
    return { distance: d, fits };
  }

  /** Distance at which the whole globe comfortably fits the unobstructed region. */
  private overviewDistance(): number {
    const half = this.availableHalfFov();
    return 1 / Math.sin(half * 0.86);
  }

  private notifyFit(fits: boolean) {
    if (fits !== this.lastFits) {
      this.lastFits = fits;
      this.options.onFitChange?.(fits);
    }
  }

  private updateRotateSpeed() {
    const d = this.camera.position.length();
    this.controls.rotateSpeed = Math.max(0.12, Math.min(0.75, (d - 1) * 0.28));
    this.controls.zoomSpeed = 0.7;
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 2 : 2));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const aspect = w / h;
    // Apply BASE_FOV to the smaller dimension so portrait phones see the same globe size.
    this.camera.fov =
      aspect >= 1 ? BASE_FOV : (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) / aspect) * 180) / Math.PI;
    this.camera.aspect = aspect;
    this.controls.maxDistance = this.overviewDistance() * 1.6;
    for (const leg of this.legs) {
      if (!leg) continue;
      for (const m of [leg.material, leg.casingMaterial, leg.remainingMaterial]) m.resolution.set(w, h);
    }
    for (const layer of this.borderLayers) layer.material.resolution.set(w, h);
    this.updateProjection();
    this.requestRender();
  }

  private updateProjection() {
    const i = this.insets;
    const dx = (i.left - i.right) / 2;
    const dy = (i.top - i.bottom) / 2;
    this.camera.setViewOffset(this.width, this.height, -dx, -dy, this.width, this.height);
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------------------------
  // Labels & picking

  private project(p: Vector3): { x: number; y: number } | null {
    const v = new Vector3().copy(p).project(this.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** Cosine of the angle between the surface normal at p and the direction to the camera. */
  private facing(p: Vector3): number {
    const toCam = new Vector3().copy(this.camera.position).sub(p).normalize();
    return new Vector3().copy(p).normalize().dot(toCam);
  }

  private updateLabels() {
    // Endpoints get first pick of label positions, then transfers.
    const order = [...this.markers].sort((a, b) => rolePriority(a.role) - rolePriority(b.role));
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const LABEL_H = 21;
    for (const m of order) {
      const s = this.project(m.position);
      const f = this.facing(m.position);
      const opacity = s ? clamp01((f - 0.02) / 0.12) : 0;
      m.el.style.opacity = String(opacity);
      m.el.style.visibility = opacity > 0 ? 'visible' : 'hidden';
      if (!s || opacity <= 0) continue;
      m.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
      if (!m.labelWidth) m.labelWidth = m.label.offsetWidth || 36;
      const w = m.labelWidth;
      // Candidate offsets relative to the marker: above-right, above-left, below-right, below-left.
      const candidates: [number, number][] = [
        [9, -25],
        [-9 - w, -25],
        [9, 5],
        [-9 - w, 5],
      ];
      let choice = candidates[0];
      for (const c of candidates) {
        const r = { x0: s.x + c[0] - 2, y0: s.y + c[1] - 2, x1: s.x + c[0] + w + 2, y1: s.y + c[1] + LABEL_H + 2 };
        if (!placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) {
          choice = c;
          break;
        }
      }
      placed.push({ x0: s.x + choice[0], y0: s.y + choice[1], x1: s.x + choice[0] + w, y1: s.y + choice[1] + LABEL_H });
      // Also reserve the dot itself so other labels avoid covering it.
      placed.push({ x0: s.x - 7, y0: s.y - 7, x1: s.x + 7, y1: s.y + 7 });
      m.label.style.transform = `translate(${choice[0]}px, ${choice[1]}px)`;
    }
    return placed;
  }

  private hitTestLeg(x: number, y: number): number | null {
    let best: number | null = null;
    let bestDist = 18; // px tolerance, finger friendly
    this.legs.forEach((leg, i) => {
      if (!leg) return;
      let prev: { x: number; y: number } | null = null;
      for (let k = 0; k < leg.arc.length; k += 2) {
        const p = leg.arc[k];
        if (this.facing(p) < 0) {
          prev = null;
          continue;
        }
        const s = this.project(p);
        if (s && prev) {
          const d = distToSegment(x, y, prev, s);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        prev = s;
      }
    });
    return best;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.hitTestLeg(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== null) this.options.onLegClick?.(hit);
  };

  private onControlsStart = () => {
    // Direct manipulation always wins over automatic camera movement.
    this.exitFollowAircraft();
    this.follow = false;
    this.cancelTween();
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  };

  private onContextRestored = () => {
    for (const t of this.textures) t.needsUpdate = true;
    this.requestRender();
  };
}

function rolePriority(role: MarkerRole): number {
  return role === 'origin' || role === 'single' ? 0 : role === 'destination' ? 1 : 2;
}

function makeLine(points: Vector3[], material: LineMaterial, order: number): Line2 {
  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  });
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const line = new Line2(geometry, material);
  line.renderOrder = order;
  line.frustumCulled = false;
  return line;
}

/**
 * Shows a polyline up to segment `index`, cut at fraction `t` of that segment (index < 0 hides it).
 * Only the end of the partial segment is rewritten; the previously cut segment is restored first.
 */
function revealLine(line: Line2, points: Vector3[], index: number, t: number) {
  const geometry = line.geometry;
  const end = geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute;
  const segments = points.length - 1;
  const cut = index >= 0 && index < segments ? index : -1;
  const previous = (line.userData.cut as number | undefined) ?? -1;
  if (previous !== -1 && previous !== cut) {
    const p = points[previous + 1];
    end.setXYZ(previous, p.x, p.y, p.z);
    end.data.needsUpdate = true;
  }
  if (cut !== -1) {
    const a = points[cut];
    const b = points[cut + 1];
    const k = Math.min(1, Math.max(0, t));
    end.setXYZ(cut, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    end.data.needsUpdate = true;
  }
  line.userData.cut = cut;
  geometry.instanceCount = cut === -1 ? (index >= segments ? segments : 0) : cut + 1;
  line.visible = geometry.instanceCount > 0;
}

function distToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = vx * vx + vy * vy;
  const t = len ? Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len)) : 0;
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}
