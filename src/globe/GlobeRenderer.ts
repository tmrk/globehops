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
 * - With day and night shading, the Sun and Moon appear at their true directions and apparent sizes.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Group,
  InterleavedBufferAttribute,
  Mesh,
  MeshLambertMaterial,
  NotEqualStencilFunc,
  PerspectiveCamera,
  ReplaceStencilOp,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
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
import { EARTH_RADIUS_KM, enclosingCap, greatCircleDistanceKm, greatCirclePath, slerpVec, toVec3 } from '../lib/geo.ts';
import { mergeFractions, pathLengthKm, pathVertexFractions, vectorAlongPath } from '../lib/routePath.ts';
import { SOLAR_SHADING_GLSL } from '../lib/sun.ts';
import type { LatLng } from '../types.ts';
import {
  clamp01,
  LABEL_RADIUS,
  LABEL_FADE_START,
  easeInOutCubic,
  ecefToScene,
  latLngToVector3,
  sceneToEcef,
  slerpUnit,
  sunDirectionScene,
  projectToScreen,
  surfaceFacing,
} from './math3d.ts';
import { CountryLabelLayer } from './countryLabels.ts';
import { GlobeTextures } from './textures.ts';
import { AirportLabelLayer } from './airportLabels.ts';
import { setClass, setStyle } from './dom.ts';
import { FOLLOW_APPROACH_MS, followBlend, followDistance, followLead } from './followCamera.ts';
import type { AircraftView, FleetAircraft, Sky } from './simFeed.ts';
import { moonVantage, SkyBodies } from './skyBodies.ts';
import { routeGeometrySignature } from './routeGeometry.ts';

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
  /** Detour waypoints around restricted airspace; absent or null follows the great circle. */
  path?: readonly LatLng[] | null;
  color: string;
  /** Height multiplier; endpoints retain the same surface clearance. */
  lift?: number;
  muted?: boolean;
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
  /** The Moon's surface, fetched when the sky is first shown. */
  moon: string;
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
  showWaterLabels: boolean;
  labelLocale?: string;
  reducedMotion: boolean;
  onLegClick?: (leg: number) => void;
  onFollowAircraftChange?: (enabled: boolean) => void;
  onFitChange?: (fitsInView: boolean) => void;
  onTextureReady?: (quality: 'preview' | 'full') => void;
}

const GLOBE_SEGMENTS = 128;
const INSET_KEYS = ['top', 'right', 'bottom', 'left'] as const;
const ILLUMINATION_FADE_MS = 360;
const CAMERA_REPORT_INTERVAL_MS = 100;
const LEG_HIT_TOLERANCE_PX = 18;
/** Smaller-dimension field of view (degrees). Narrow FOV keeps the globe photographic. */
const BASE_FOV = 30;
const MIN_DISTANCE = 1.32;
const CAMERA_POLE_CLEARANCE = 0.05;
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
const ATMOSPHERE_RADIUS = 1.055;
/** Without a route, the globe's glowing limb fills this share of the unobstructed area's smaller side. */
const EMPTY_GLOBE_FILL = 0.94;
/** The empty globe resizes with the panels a little quicker than a flight to a new route. */
const EMPTY_FIT_MS = 600;

const ATMOSPHERE_COLOR = new Color('#7fb4ff');

interface LegObject {
  key: string;
  muted: boolean;
  angle: number;
  profile: ReturnType<typeof altitudeProfile>;
  /** Fractions of the leg distance (0 … 1) at which ground/arc are sampled; denser in climb and descent. */
  fractions: number[];
  ground: Vector3[]; // unit vectors along the route
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
  private fleet: FleetAircraft[] | null = null;
  private fleetPlanes: HTMLDivElement[] = [];
  private routeGeometry = '';
  private userLocationDot: HTMLDivElement;
  private userLocation: Vector3 | null = null;
  private legs: (LegObject | undefined)[] = [];
  private airportLabels: AirportLabelLayer;
  private borderLayers: { line: LineSegments2; material: LineMaterial }[] = [];
  private bordersState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private borderAbort = new AbortController();
  private textures: GlobeTextures;
  private width = 1;
  private height = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private targetInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Camera distance of the empty globe's last automatic fit; null with a route or once the visitor zooms. */
  private emptyFit: number | null = null;
  private drawn = false;
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
  private sky: Sky | null = null;
  private skyBodies: SkyBodies;
  private sunScene = new Vector3(1, 0, 0);
  private sunView = { value: new Vector3(1, 0, 0) };
  private dayNight = { value: 0 };
  private cityLights = { value: 0 };
  private illuminationTween: { from: number; to: number; start: number } | null = null;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private lastFits: boolean | null = null;
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private projected = new Vector3();
  private projectedStart = new Vector3();
  private projectedEnd = new Vector3();
  private followTarget = new Vector3();
  private followCurrent = new Vector3();
  private followSample = new Vector3();
  private followPrediction = { fraction: 0, response: 0 };
  private contextLost = false;

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
    this.countryLabels.setVisible(options.showCountryLabels, options.showWaterLabels);
    this.userLocationDot = document.createElement('div');
    this.userLocationDot.className = 'globe-user-location';
    this.userLocationDot.setAttribute('aria-hidden', 'true');
    setStyle(this.userLocationDot, 'display', 'none');
    this.labelLayer.append(this.userLocationDot);

    this.plane = this.createPlane();
    this.airportLabels = new AirportLabelLayer(this.labelLayer, this.plane, this.requestRender);

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
    this.controls.minPolarAngle = CAMERA_POLE_CLEARANCE;
    this.controls.maxPolarAngle = Math.PI - CAMERA_POLE_CLEARANCE;
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
    // The globe opens fitted to the screen; a route, when one arrives, is framed from here.
    this.emptyFit = this.camera.position.length();
    this.resizeObserver.observe(container);
    this.resize();
    this.textures = new GlobeTextures({
      material: this.earthMaterial,
      capabilities: this.renderer.capabilities,
      urls: options.textures,
      cityLights: this.cityLights,
      reducedMotion: () => this.options.reducedMotion,
      illuminated: () => this.sky !== null,
      requestRender: this.requestRender,
      onReady: options.onTextureReady,
    });
    void this.textures.load();
    this.skyBodies = new SkyBodies({
      sunDirection: this.sunScene,
      fade: this.dayNight,
      far: this.camera.far,
      labelLayer: this.labelLayer,
      showNames: options.showCountryLabels,
      loadMoonMap: () => this.textures.moon(),
      requestRender: this.requestRender,
    });
    this.scene.add(this.skyBodies.object);
    if (options.showBorders) this.ensureBorders();
  }

  // ---------------------------------------------------------------------------------------------
  // Public API

  /** Sunlit shading, the Sun and the Moon for one instant; null returns to camera-relative daylight. */
  setSky(sky: Sky | null) {
    if (sky?.sun.lat === this.sky?.sun.lat && sky?.sun.lng === this.sky?.sun.lng) return;
    const toggled = (sky === null) !== (this.sky === null);
    this.sky = sky;
    if (sky) {
      sunDirectionScene(sky.sun, this.sunScene);
      this.skyBodies.set(sky);
      if (this.keyLight.parent !== this.scene) this.scene.add(this.keyLight);
      this.keyLight.position.copy(this.sunScene).multiplyScalar(5);
      this.textures.ensureCityLights();
    }
    if (toggled) {
      const to = sky ? 1 : 0;
      this.illuminationTween = this.options.reducedMotion
        ? null
        : { from: this.dayNight.value, to, start: performance.now() };
      if (this.options.reducedMotion) this.dayNight.value = to;
    }
    if (!sky && !this.illuminationTween) this.restoreCameraLight();
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
    setClass(this.plane, 'is-ground', view?.kind === 'ground');
    // The next frame (or flush()) places a simulated aircraft; hiding it here would make it blink.
    if (view) this.planeAnim = null;
    else {
      setStyle(this.plane, 'opacity', '0');
      this.startSelectionPlane();
    }
    this.applyAllProgress();
    this.requestRender();
  }

  setHighlightLeg(index: number | null) {
    if (index === this.highlightLeg) return;
    this.highlightLeg = index;
    this.applySelectionStyles();
    this.applyAllProgress();
    if (this.follow && !this.followAircraft && index !== null && this.legs[index] && this.lastFits === false) {
      // Preserve the whole-route fit result while following individual legs.
      this.frameView(true, index, false);
    }
    this.requestRender();
  }

  setFleet(fleet: FleetAircraft[] | null) {
    if (fleet === this.fleet) return;
    const previous = this.fleet;
    const highlightsChanged =
      previous?.length !== fleet?.length ||
      (fleet?.some((entry, i) => entry.highlightLeg !== previous?.[i]?.highlightLeg) ?? false);
    this.fleet = fleet;
    const size = fleet?.length ?? 0;
    while (this.fleetPlanes.length > size) this.fleetPlanes.pop()?.remove();
    while (this.fleetPlanes.length < size) this.fleetPlanes.push(this.createPlane(true));
    for (let i = 0; fleet && i < fleet.length; i++) {
      const entry = fleet[i];
      const plane = this.fleetPlanes[i];
      if (plane.style.getPropertyValue('--plane-color') !== entry.color)
        plane.style.setProperty('--plane-color', entry.color);
      const badge = plane.lastElementChild;
      if (badge && badge.textContent !== entry.tag) badge.textContent = entry.tag;
      setClass(plane, 'is-ground', entry.view.kind === 'ground');
    }
    if (size > 0) {
      setStyle(this.plane, 'opacity', '0');
      this.planeAnim = null;
    } else if (previous === null || previous.length > 0) {
      this.startSelectionPlane();
    }
    if (highlightsChanged) this.applySelectionStyles();
    this.applyAllProgress();
    this.requestRender();
  }

  private createPlane(badge = false): HTMLDivElement {
    const plane = document.createElement('div');
    plane.className = 'globe-plane';
    plane.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 1.8c.75 0 1.25.9 1.25 2.1v5.3l7.25 4.35v2.05l-7.25-2.25v4.4l2.25 1.7v1.6L12 20.1l-3.5.95v-1.6l2.25-1.7v-4.4L3.5 15.6v-2.05l7.25-4.35V3.9c0-1.2.5-2.1 1.25-2.1z"/></svg>';
    if (badge) {
      const tag = document.createElement('span');
      tag.className = 'globe-plane__tag';
      plane.append(tag);
    }
    this.labelLayer.append(plane);
    return plane;
  }

  private hasSimulatedAircraft(): boolean {
    return this.fleet !== null ? this.fleet.length > 0 : this.aircraft !== null;
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
    const geometry = routeGeometrySignature(route);
    if (geometry === this.routeGeometry) {
      // Style-only edits preserve geometry, partial reveals, and the current camera pose.
      route.legs.forEach((leg, i) => {
        const obj = this.legs[i];
        if (!obj) return;
        obj.muted = leg.muted ?? false;
        obj.material.color.set(leg.color);
        obj.remainingMaterial.color.set(leg.color);
      });
      this.airportLabels.updateMarkers(route.markers);
      this.applySelectionStyles();
      this.requestRender();
      return;
    }
    this.routeGeometry = geometry;
    const previousKeys = new Set<string>();
    for (const leg of this.legs) if (leg) previousKeys.add(leg.key);
    this.clearLegs();
    for (const plane of this.fleetPlanes) setStyle(plane, 'opacity', '0');

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
    this.airportLabels.setMarkers(route.markers);

    setStyle(this.plane, 'opacity', '0');
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
    for (const leg of legs) if (leg) for (const point of leg.frame) points.push(point);
    if (!points.length) for (const m of this.airportLabels.markers) points.push(m.position);
    if (!points.length) {
      if (reportFit) this.notifyFit(true);
      this.fitEmptyGlobe(animate);
      return;
    }
    this.emptyFit = null;
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
    // The empty globe keeps filling the room the panels leave it, easing along once it is on screen.
    const fitting = this.isEmptyFit();
    const ease = (animate || (fitting && this.drawn)) && !this.options.reducedMotion;
    this.targetInsets = { ...insets };
    if (!ease) {
      this.insets = { ...insets };
      this.updateProjection();
    }
    if (fitting) this.fitEmptyGlobe(ease);
    this.requestRender();
  }

  /** Whether the camera still shows (or is flying to) the empty globe's automatic fit. */
  private isEmptyFit(): boolean {
    if (this.emptyFit === null) return false;
    const distance = this.cameraTween?.toDist ?? this.camera.position.length();
    return Math.abs(distance - this.emptyFit) < 0.01;
  }

  /** Without a route, the whole globe is as large as the unobstructed area allows, seen from where it is. */
  private fitEmptyGlobe(animate: boolean) {
    const distance = ATMOSPHERE_RADIUS / Math.sin(this.availableHalfFov() * EMPTY_GLOBE_FILL);
    const current = this.cameraTween?.toDist ?? this.camera.position.length();
    this.emptyFit = distance;
    if (Math.abs(current - distance) < 0.005) return;
    const direction = this.cameraTween?.toDir ?? this.camera.position;
    this.flyTo(direction, distance, animate, EMPTY_FIT_MS);
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
      if (!this.sky) this.restoreCameraLight();
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
    this.options.showCountryLabels = visible;
    this.countryLabels.setVisible(visible, this.options.showWaterLabels);
    // The Sun's and Moon's names are place names too.
    this.skyBodies.setNamesVisible(visible);
    this.requestRender();
  }

  setWaterLabelsVisible(visible: boolean) {
    this.options.showWaterLabels = visible;
    this.countryLabels.setVisible(this.options.showCountryLabels, visible);
    this.requestRender();
  }

  setUserLocation(position: LatLng | null) {
    this.userLocation = position ? latLngToVector3(position.lat, position.lng, LABEL_RADIUS) : null;
    this.requestRender();
  }

  setSkyNames(names: { sun: string; moon: string }) {
    this.skyBodies.setNames(names);
    this.requestRender();
  }

  /** Turns the globe until the Moon stands just above Earth's limb, ready for the user to look around. */
  showMoon() {
    const moon = this.skyBodies.moonPosition;
    if (!this.sky || !moon) return;
    this.exitFollowAircraft();
    this.follow = false;
    const reach = this.availableHalfFov() * 0.85;
    const { direction, distance } = moonVantage(moon, this.camera.position.length(), reach, ATMOSPHERE_RADIUS);
    this.flyTo(direction, distance, true);
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
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.borderAbort.abort();
    this.controls.removeEventListener('start', this.onControlsStart);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    this.canvas.removeEventListener('wheel', this.onControlsStart);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.clearLegs();
    for (const plane of this.fleetPlanes) plane.remove();
    this.fleetPlanes = [];
    this.fleet = null;
    this.plane.remove();
    this.airportLabels.dispose();
    this.countryLabels.dispose();
    this.userLocationDot.remove();
    for (const layer of this.borderLayers) {
      this.scene.remove(layer.line);
      layer.line.geometry.dispose();
      layer.material.dispose();
    }
    this.borderLayers = [];
    this.earth.geometry.dispose();
    this.earthMaterial.onBeforeCompile = () => {};
    this.earthMaterial.dispose();
    this.atmosphere.geometry.dispose();
    (this.atmosphere.material as ShaderMaterial).dispose();
    this.skyBodies.dispose();
    this.textures.dispose();
    this.keyLight.removeFromParent();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labelLayer.remove();
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering loop

  requestRender = () => {
    if (this.disposed || this.contextLost || this.frame) return;
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
    if (this.disposed || this.contextLost) return;
    let active = false;

    active = this.stepInsets() || active;
    let cameraMoving = this.stepFollowAircraft(now);
    cameraMoving = this.stepTween(now) || cameraMoving;
    active = this.stepReveal(now) || active;
    active = this.stepPlane(now) || active;
    active = this.stepIllumination(now) || active;
    active = this.textures.stepLights(now) || active;
    // OrbitControls.update() returns true while damping is still moving the camera.
    if (!this.cameraTween && !(this.followAircraft && this.aircraft))
      cameraMoving = this.controls.update() || cameraMoving;
    active = cameraMoving || active;
    const motion = cameraMoving ? 'moving' : 'settled';
    if (this.container.dataset.cameraMotion !== motion) this.container.dataset.cameraMotion = motion;
    this.updateRotateSpeed();
    this.textures.maybeUpgrade(this.camera.position.length());

    const distance = this.camera.position.length().toFixed(2);
    if (
      distance !== this.reportedCameraDistance &&
      (!cameraMoving || now - this.reportedCameraAt >= CAMERA_REPORT_INTERVAL_MS)
    ) {
      this.container.dataset.cameraDistance = distance;
      this.reportedCameraDistance = distance;
      this.reportedCameraAt = now;
    }
    this.camera.updateMatrixWorld();
    // Recompute even for paused sunlight: orbit/damping changes the normals' view space every frame.
    this.sunView.value.copy(this.sunScene).transformDirection(this.camera.matrixWorldInverse);
    this.renderer.render(this.scene, this.camera);
    this.drawn = true;
    this.airportLabels.measure();
    this.countryLabels.measure(this.camera, this.height);
    this.updateUserLocation();
    this.skyBodies.placeLabels(this.camera, this.width, this.height);
    const reserved = this.airportLabels.update(this.camera, this.width, this.height);
    this.countryLabels.update(this.camera, this.width, this.height, reserved);
    if (this.fleet?.length) {
      setStyle(this.plane, 'opacity', '0');
      const points = this.fleet.map((entry, i) => this.placeAircraft(this.fleetPlanes[i], entry.view));
      this.staggerFleetTags(points);
    } else if (this.fleet === null && this.aircraft) {
      const view = this.aircraft;
      this.placeAircraft(this.plane, view);
    }
    if (active) this.requestRender();
  };

  // ---------------------------------------------------------------------------------------------
  // Country borders

  private async ensureBorders() {
    if (this.disposed || this.bordersState !== 'idle') return;
    this.bordersState = 'loading';
    // Land borders and coastlines load in parallel; either one can fail without the other.
    const layers = [
      { url: this.options.bordersUrl, opacity: BORDER_OPACITY, order: 0.5, name: 'Country borders' },
      { url: this.options.coastlinesUrl, opacity: COAST_OPACITY, order: 0.51, name: 'Coastlines' },
    ];
    const results = await Promise.allSettled(
      layers.map(async (layer) => {
        const response = await fetch(layer.url, { signal: this.borderAbort.signal });
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
      if (!this.disposed && result.status === 'rejected') console.warn(`${layers[i].name} unavailable`, result.reason);
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
    const path = leg.path && leg.path.length > 1 ? leg.path : null;
    const distanceKm = path ? pathLengthKm(path) : greatCircleDistanceKm(leg.from, leg.to);
    const profile = altitudeProfile(distanceKm);
    // A detour is sampled at its own vertices too, so its turns are drawn where they are.
    const fractions = path
      ? mergeFractions(profileFractions(profile), pathVertexFractions(path))
      : profileFractions(profile);
    const u = toVec3(leg.from);
    const v = toVec3(leg.to);
    const ground = fractions.map((f) => ecefToScene(path ? vectorAlongPath(path, f) : slerpVec(u, v, f)));
    // Detour vertices are ≤ 1° apart; every other one is enough to frame the route.
    const frame = path
      ? path.filter((_, i) => i % 2 === 0 || i === path.length - 1).map((p) => ecefToScene(toVec3(p)))
      : greatCirclePath(leg.from, leg.to, Math.max(2, Math.ceil((angle * 90) / Math.PI))).map((p) => ecefToScene(p));
    const n = ground.length - 1;
    // Follow distance and the plane's zoom profile use the flown length, not the end-to-end angle.
    const followAngle = path ? distanceKm / EARTH_RADIUS_KM : ground[0].angleTo(ground[n]);
    const arc = ground.map((g, i) =>
      g
        .clone()
        .multiplyScalar(
          1 + ROUTE_LIFT + exaggeratedLift(altitudeAt(profile, fractions[i] * distanceKm)) * (leg.lift ?? 1),
        ),
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
      angle: followAngle,
      profile: altitudeProfile(followAngle * EARTH_RADIUS_KM),
      muted: leg.muted ?? false,
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

  private applyAllProgress() {
    for (const leg of this.legs) if (leg) this.applyProgress(leg);
  }

  private applyProgress(leg: LegObject) {
    // Progress is a fraction of the distance flown. The drawn line ends exactly at that point (the
    // last visible segment is shortened), so the trail grows continuously instead of in steps.
    let aircraft: AircraftView | null = null;
    if (this.fleet !== null) {
      for (const entry of this.fleet) {
        if (entry.view.kind === 'air' && this.legs[entry.view.leg] === leg) {
          aircraft = entry.view;
          break;
        }
      }
    } else if (this.aircraft?.leg === this.highlightLeg && this.legs[this.aircraft.leg] === leg) {
      aircraft = this.aircraft;
    }
    const trail = aircraft?.kind === 'air';
    const progress = clamp01(aircraft?.kind === 'air' ? aircraft.fraction : leg.progress);
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
    const highlighted = new Set<number>();
    if (this.highlightLeg !== null) highlighted.add(this.highlightLeg);
    for (const entry of this.fleet ?? []) if (entry.highlightLeg !== null) highlighted.add(entry.highlightLeg);
    const hasHighlight = highlighted.size > 0;
    if (!hasHighlight && this.selectedLeg !== null) highlighted.add(this.selectedLeg);
    this.legs.forEach((leg, i) => {
      if (!leg) return;
      const emphasised = highlighted.has(i);
      const active = emphasised || (highlighted.size === 0 && !leg.muted);
      leg.material.linewidth = emphasised ? 3.6 : leg.muted ? 2 : 2.6;
      leg.material.opacity = active ? 1 : hasHighlight ? 0.55 : 0.38;
      leg.casingMaterial.opacity = active ? 0.38 : 0.12;
      leg.casingMaterial.linewidth = emphasised ? 6.6 : leg.muted ? 4.2 : 5.2;
    });
    // Emphasise the endpoints of every highlighted fleet leg (or the selected leg when idle).
    const emph = new Set<string>();
    for (const index of highlighted) {
      const l = this.legs[index];
      if (!l) continue;
      for (const m of this.airportLabels.markers) {
        const p = this.tmp.copy(m.position).normalize();
        if (p.angleTo(l.ground[0]) < 1e-5 || p.angleTo(l.ground[l.ground.length - 1]) < 1e-5) emph.add(m.key);
      }
    }
    for (const m of this.airportLabels.markers) {
      setClass(m.el, 'is-dim', highlighted.size > 0 && !emph.has(m.key));
      setClass(m.el, 'is-emph', emph.has(m.key));
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

  // ---------------------------------------------------------------------------------------------
  // Animation steps

  private restoreCameraLight() {
    this.camera.add(this.keyLight);
    this.keyLight.position.set(-1.6, 1.4, 2.2);
  }

  private stepIllumination(now: number): boolean {
    const tween = this.illuminationTween;
    if (!tween) return false;
    const t = clamp01((now - tween.start) / ILLUMINATION_FADE_MS);
    this.dayNight.value = tween.from + (tween.to - tween.from) * easeInOutCubic(t);
    if (t >= 1) {
      this.illuminationTween = null;
      if (!this.sky) this.restoreCameraLight();
    }
    return t < 1;
  }

  private startSelectionPlane() {
    this.planeAnim = null;
    const valid = this.selectedLeg;
    if (this.hasSimulatedAircraft() || valid === null || this.options.reducedMotion || this.reveal) return;
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
      if (!this.hasSimulatedAircraft()) this.placePlaneOnLeg(this.plane, leg, leg.progress, t < 1);
    }
    if (t >= 1) {
      r.current++;
      r.start = now;
      if (r.current >= r.queue.length) {
        this.reveal = null;
        if (!this.hasSimulatedAircraft()) setStyle(this.plane, 'opacity', '0');
        return true;
      }
    }
    return true;
  }

  private stepPlane(now: number): boolean {
    const p = this.planeAnim;
    if (!p || this.reveal || this.hasSimulatedAircraft()) return false;
    const leg = this.legs[p.leg];
    if (!leg) {
      this.planeAnim = null;
      return false;
    }
    const t = (now - p.start) / p.duration;
    if (t < 0) return true;
    if (t >= 1) {
      this.planeAnim = null;
      setStyle(this.plane, 'opacity', '0');
      return true;
    }
    this.placePlaneOnLeg(this.plane, leg, easeInOutCubic(t), true);
    return true;
  }

  private placeAircraft(plane: HTMLDivElement, view: AircraftView) {
    const leg = this.legs[view.leg];
    if (leg) {
      return this.placePlaneOnLeg(
        plane,
        leg,
        view.kind === 'air' ? clamp01(view.fraction) : view.at === 'start' ? 0 : 1,
        true,
        true,
      );
    } else {
      setStyle(plane, 'opacity', '0');
    }
  }

  private placePlaneOnLeg(plane: HTMLDivElement, leg: LegObject, f: number, visible: boolean, simulated = false) {
    const pts = leg.arc;
    const { index: i, t } = locateFraction(leg.fractions, f);
    const pos = this.tmp.copy(pts[i]).lerp(pts[i + 1], t);
    const a = this.project(pos, this.projected) ? this.projected : null;
    // Heading from the current segment's direction on screen.
    const s0 = this.project(pts[i], this.projectedStart) ? this.projectedStart : null;
    const s1 = this.project(pts[i + 1], this.projectedEnd) ? this.projectedEnd : null;
    const facing = this.facing(pos);
    // The lifted aircraft can still clear the horizon after its surface normal turns away.
    // Test the camera sightline against the unit sphere instead of fading it near the limb.
    let hidden = facing < LABEL_FADE_START;
    if (simulated) {
      const toCamera = this.tmp2.copy(this.camera.position).sub(pos);
      const t = clamp01(-pos.dot(toCamera) / toCamera.lengthSq());
      hidden = toCamera.multiplyScalar(t).add(pos).lengthSq() < 1;
    }
    if (!a || !s0 || !s1 || hidden) {
      setStyle(plane, 'opacity', '0');
      return;
    }
    const angle = (Math.atan2(s1.y - s0.y, s1.x - s0.x) * 180) / Math.PI + 90;
    const fade = Math.min(1, f * 12, (1 - f) * 12);
    setStyle(plane, 'opacity', visible ? (simulated ? '1' : String(Math.min(fade, facing * 6))) : '0');
    setStyle(plane, 'transform', `translate3d(${a.x}px, ${a.y}px, 0) translate(-50%, -50%)`);
    const heading = `${angle}deg`;
    if (plane.style.getPropertyValue('--plane-heading') !== heading)
      plane.style.setProperty('--plane-heading', heading);
    return { x: a.x, y: a.y };
  }

  /** Connected screen neighbours share a stack, ordered by fleet position rather than traversal order. */
  private staggerFleetTags(points: ({ x: number; y: number } | undefined)[]) {
    const visited = new Set<number>();
    const shifts = points.map(() => 0);
    for (let i = 0; i < points.length; i++) {
      if (visited.has(i) || !points[i] || this.fleetPlanes[i].style.opacity === '0') continue;
      const cluster = [i];
      visited.add(i);
      for (let k = 0; k < cluster.length; k++) {
        const point = points[cluster[k]]!;
        for (let j = 0; j < points.length; j++) {
          const other = points[j];
          if (visited.has(j) || !other || this.fleetPlanes[j].style.opacity === '0') continue;
          if (Math.hypot(point.x - other.x, point.y - other.y) <= 28) {
            visited.add(j);
            cluster.push(j);
          }
        }
      }
      cluster.sort((a, b) => a - b).forEach((index, order) => (shifts[index] = order * 16));
    }
    for (let i = 0; i < this.fleetPlanes.length; i++) {
      const plane = this.fleetPlanes[i];
      const shift = `${shifts[i]}px`;
      if (plane.style.getPropertyValue('--tag-shift') !== shift) plane.style.setProperty('--tag-shift', shift);
    }
  }

  /** Uses only origin-facing, north-up poses so OrbitControls can take over without a jump. */
  private stepFollowAircraft(now: number): boolean {
    const view = this.aircraft;
    if (!this.followAircraft || !view) return false;
    const leg = this.legs[view.leg];
    if (!leg) return false;
    const start = leg.ground[0];
    const angle = leg.angle;
    const fraction = view.kind === 'air' ? clamp01(view.fraction) : view.at === 'start' ? 0 : 1;
    const halfFov = this.availableHalfFov();
    const distance = Math.max(
      this.controls.minDistance,
      Math.min(this.controls.maxDistance, followDistance(angle, fraction, view.kind === 'air', halfFov, leg.profile)),
    );
    const lead = followLead(
      angle,
      fraction,
      view.kind === 'air' && !this.options.reducedMotion ? (view.fractionPerSecond ?? 0) : 0,
      distance,
      halfFov,
      this.followPrediction,
    );
    // Use the sampled track, including its deterministic choice of great circle at antipodes.
    const target = this.sampleGround(leg, view.kind === 'air' ? lead.fraction : fraction, this.followTarget);
    // OrbitControls has a polar singularity: stay 0.05 radians away, keeping camera.up = +Y.
    const maxY = Math.cos(CAMERA_POLE_CLEARANCE);
    if (Math.abs(target.y) > maxY) {
      const horizontal = this.tmp.set(target.x, 0, target.z);
      if (horizontal.lengthSq() < 1e-12) horizontal.set(start.x, 0, start.z);
      if (horizontal.lengthSq() < 1e-12) horizontal.set(1, 0, 0);
      horizontal.normalize().multiplyScalar(Math.sin(CAMERA_POLE_CLEARANCE));
      target.set(horizontal.x, Math.sign(target.y) * maxY, horizontal.z);
    }
    if (this.options.reducedMotion) {
      this.cameraTween = null;
      const aircraft = this.sampleGround(leg, fraction, this.followSample);
      this.camera.updateMatrixWorld();
      const projected = this.project(aircraft, this.projected) ? this.projected : null;
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
    const current = this.followCurrent.copy(this.camera.position).normalize();
    const angularError = current.angleTo(target);
    const distanceError = distance - this.camera.position.length();
    if (angularError < 0.00002 && Math.abs(distanceError) < 0.0001) {
      this.followPreviousTime = null;
      this.camera.position.copy(target).multiplyScalar(distance);
      this.camera.lookAt(0, 0, 0);
      return false;
    }
    // Fast playback uses velocity prediction. Zoom responds more slowly than the ground track.
    const direction = slerpUnit(current, target, followBlend(dt, lead.response), this.tmp);
    const nextDistance = this.camera.position.length() + distanceError * followBlend(dt, 0.45);
    this.camera.position.copy(direction).multiplyScalar(nextDistance);
    this.camera.lookAt(0, 0, 0);
    return true;
  }

  private sampleGround(leg: LegObject, fraction: number, target: Vector3): Vector3 {
    const { index, t } = locateFraction(leg.fractions, fraction);
    return slerpUnit(leg.ground[index], leg.ground[index + 1], t, target);
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
    let moving = false;
    let changed = false;
    for (const k of INSET_KEYS) {
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
    if (this.isEmptyFit()) this.fitEmptyGlobe(false);
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

  private project(point: Vector3, target: Vector3): boolean {
    return projectToScreen(point, this.camera, this.width, this.height, target);
  }

  private facing(point: Vector3): number {
    return surfaceFacing(point, this.camera.position);
  }

  private updateUserLocation() {
    const position = this.userLocation;
    const projected = position && this.project(position, this.projected) ? this.projected : null;
    if (!position || !projected || this.facing(position) <= LABEL_FADE_START) {
      setStyle(this.userLocationDot, 'display', 'none');
      return;
    }
    setStyle(this.userLocationDot, 'display', '');
    setStyle(
      this.userLocationDot,
      'transform',
      `translate3d(${projected.x}px, ${projected.y}px, 0) translate(-50%, -50%)`,
    );
  }

  private hitTestLeg(x: number, y: number): number | null {
    let best: number | null = null;
    let bestDist = LEG_HIT_TOLERANCE_PX;
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      if (!leg) continue;
      let hasPrevious = false;
      const previous = this.projectedStart;
      const projected = this.projectedEnd;
      for (let k = 0; k < leg.arc.length; k += 2) {
        const point = leg.arc[k];
        if (this.facing(point) < 0 || !this.project(point, projected)) {
          hasPrevious = false;
          continue;
        }
        if (hasPrevious) {
          const distance = distToSegment(x, y, previous, projected);
          if (distance < bestDist) {
            bestDist = distance;
            best = i;
          }
        }
        previous.copy(projected);
        hasPrevious = true;
      }
    }
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
    this.contextLost = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  };

  private onContextRestored = () => {
    this.contextLost = false;
    this.textures.restore();
    this.requestRender();
  };
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
