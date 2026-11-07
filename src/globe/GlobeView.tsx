import { useI18n } from '../i18n/I18nProvider.tsx';
import { useEffect, useRef } from 'react';
import previewUrl from '../assets/textures/earth-1k.webp';
import mediumUrl from '../assets/textures/earth-4k.webp';
import largeUrl from '../assets/textures/earth-8k.webp';
import lightsSmallUrl from '../assets/textures/lights-2k.webp';
import lightsLargeUrl from '../assets/textures/lights-4k.webp';
import moonUrl from '../assets/textures/moon-512.webp';
import countryLabelsUrl from '../data/generated/country-labels.json?url';
import bordersUrl from '../data/generated/borders.json?url';
import coastlinesUrl from '../data/generated/coastlines.json?url';
import { GlobeRenderer, type GlobeRoute, type Insets } from './GlobeRenderer.ts';
import type { LatLng } from '../types.ts';
import type { SimulationFeed } from './simFeed.ts';
import { routeGeometrySignature } from './routeGeometry.ts';

export interface GlobeViewProps {
  route: GlobeRoute;
  selectedLeg: number | null;
  insets: Insets;
  showBorders: boolean;
  showCountryNames: boolean;
  showWaterNames: boolean;
  userLocation: LatLng | null;
  locale?: string;
  reducedMotion: boolean;
  sim?: SimulationFeed | null;
  followAircraft: boolean;
  onFollowAircraftChange: (enabled: boolean) => void;
  /** Increment to re-frame the camera on the current route / leg. */
  fitNonce: number;
  /** Increment to turn the globe until the Moon stands above its limb. */
  moonNonce: number;
  onLegClick: (leg: number) => void;
  onFitChange: (fits: boolean) => void;
  onReady: () => void;
  onError: (error: unknown) => void;
}

/** React wrapper around the imperative GlobeRenderer. Loaded lazily (Three.js lives in this chunk). */
export default function GlobeView(props: GlobeViewProps) {
  const { t } = useI18n();

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const latest = useRef(props);
  const firstRoute = useRef(true);
  const geometry = useRef<string | null>(null);

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let renderer: GlobeRenderer;
    try {
      renderer = new GlobeRenderer(el, {
        textures: {
          preview: previewUrl,
          medium: mediumUrl,
          large: largeUrl,
          lightsSmall: lightsSmallUrl,
          lightsLarge: lightsLargeUrl,
          moon: moonUrl,
        },
        bordersUrl,
        coastlinesUrl,
        countryLabelsUrl,
        showCountryLabels: latest.current.showCountryNames,
        showWaterLabels: latest.current.showWaterNames,
        labelLocale: latest.current.locale ?? 'en',
        showBorders: latest.current.showBorders,
        reducedMotion: latest.current.reducedMotion,
        onLegClick: (leg) => latest.current.onLegClick(leg),
        onFollowAircraftChange: (enabled) => latest.current.onFollowAircraftChange(enabled),
        onFitChange: (fits) => latest.current.onFitChange(fits),
        onTextureReady: (q) => {
          if (q === 'preview' || q === 'full') latest.current.onReady();
        },
      });
    } catch (error) {
      latest.current.onError(error);
      return;
    }
    rendererRef.current = renderer;
    firstRoute.current = true;
    geometry.current = null;
    // Browsers may drop the WebGL context (e.g. a backgrounded mobile tab). Three.js restores it;
    // only fall back to the "no 3D" message if restoration doesn't happen.
    let lostTimer: number | undefined;
    const lost = () => {
      window.clearTimeout(lostTimer);
      lostTimer = window.setTimeout(() => latest.current.onError(new Error('WebGL context lost')), 4000);
    };
    const restored = () => window.clearTimeout(lostTimer);
    renderer.canvas.addEventListener('webglcontextlost', lost);
    renderer.canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      window.clearTimeout(lostTimer);
      renderer.canvas.removeEventListener('webglcontextlost', lost);
      renderer.canvas.removeEventListener('webglcontextrestored', restored);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  const { route, selectedLeg, insets, showBorders, showCountryNames, reducedMotion, fitNonce, sim } = props;

  useEffect(() => {
    rendererRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    rendererRef.current?.setBordersVisible(showBorders);
  }, [showBorders]);

  useEffect(() => {
    rendererRef.current?.setCountryLabelsVisible(showCountryNames);
  }, [showCountryNames]);

  useEffect(() => {
    rendererRef.current?.setWaterLabelsVisible(props.showWaterNames);
  }, [props.showWaterNames]);

  useEffect(() => {
    rendererRef.current?.setUserLocation(props.userLocation);
  }, [props.userLocation]);

  useEffect(() => {
    rendererRef.current?.setLabelLocale(props.locale ?? 'en');
  }, [props.locale]);

  // Insets first, so the initial framing accounts for panels covering the globe.
  useEffect(() => {
    rendererRef.current?.setInsets(insets, !firstRoute.current);
  }, [insets]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    // The first non-empty route appears already framed (no fly-in); arcs still draw in.
    const initial = firstRoute.current && route.markers.length > 0;
    const signature = routeGeometrySignature(route);
    const changed = geometry.current !== signature;
    geometry.current = signature;
    if (route.markers.length > 0) firstRoute.current = false;
    // Frame once: animated for edits, instantly for the first route.
    r.setRoute(route, { animate: true, frame: changed && !initial });
    if (initial) {
      // Initial data framing is automatic, even if a remembered follow choice loaded before airports.
      r.setFollowAircraft(false);
      r.frameCurrent(false);
      r.setFollowAircraft(latest.current.followAircraft);
    }
  }, [route]);

  useEffect(() => {
    // Reconcile follow before framing so programmatic view updates never echo back as user input.
    rendererRef.current?.setFollowAircraft(props.followAircraft);
    rendererRef.current?.setSelectedLeg(selectedLeg, { frame: !props.followAircraft });
  }, [selectedLeg, props.followAircraft]);

  useEffect(() => {
    if (fitNonce > 0) rendererRef.current?.frameCurrent(true);
  }, [fitNonce]);

  useEffect(() => {
    if (props.moonNonce > 0) rendererRef.current?.showMoon();
  }, [props.moonNonce]);

  useEffect(() => {
    rendererRef.current?.setMoonName(t('sky.moon'));
  }, [t]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (!sim) {
      r.setSky(null);
      r.setAircraft(null);
      r.setFleet(null);
      r.setHighlightLeg(null);
      r.setFollow(false);
      return;
    }
    let previousFollow: boolean | undefined;
    const update = () => {
      const frame = sim.getFrame();
      // Only a feed transition re-enables follow after a user camera gesture.
      if (frame.follow !== previousFollow) {
        r.setFollow(frame.follow);
        previousFollow = frame.follow;
      }
      r.setSky(frame.sky);
      r.setAircraft(frame.aircraft);
      r.setFleet(frame.fleet ?? null);
      r.setHighlightLeg(frame.highlightLeg);
      r.flush();
    };
    const unsubscribe = sim.subscribe(update);
    update();
    return unsubscribe;
  }, [sim]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const step = e.shiftKey ? 30 : 12;
    const map: Record<string, [number, number, number]> = {
      ArrowLeft: [-step, 0, 1],
      ArrowRight: [step, 0, 1],
      ArrowUp: [0, step * 0.7, 1],
      ArrowDown: [0, -step * 0.7, 1],
      '+': [0, 0, 0.8],
      '=': [0, 0, 0.8],
      '-': [0, 0, 1.25],
    };
    const m = map[e.key];
    if (!m) return;
    e.preventDefault();
    r.nudge(m[0], m[1], m[2]);
  };

  return (
    <div
      ref={containerRef}
      className="globe-view"
      tabIndex={0}
      role="application"
      aria-roledescription={t('a11y.globeDescription')}
      aria-label={t('a11y.globeInstructions')}
      onKeyDown={onKeyDown}
    />
  );
}
