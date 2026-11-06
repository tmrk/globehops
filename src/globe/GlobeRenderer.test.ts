// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group, PerspectiveCamera, Vector3 } from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { GlobeRenderer, type GlobeRoute } from './GlobeRenderer.ts';
import { routeGeometrySignature } from './routeGeometry.ts';
import type { FleetAircraft } from './simFeed.ts';

// Keep real Three.js geometry, materials, camera and controls; replace only the GPU boundary.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      capabilities = { maxTextureSize: 1024, getMaxAnisotropy: () => 1 };
      setClearColor = vi.fn();
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      render = vi.fn();
      dispose = vi.fn();
      forceContextLoss = vi.fn();
    },
  };
});

interface RenderState {
  camera: PerspectiveCamera;
  routeGroup: Group;
  legs: {
    arc: Vector3[];
    frame: Vector3[];
    progress: number;
    line: Line2;
    remaining: Line2;
  }[];
  reveal: unknown;
  planeAnim: unknown;
}

const route: GlobeRoute = {
  markers: [0, 15, 30].flatMap((lat, i) => [
    { key: `${i}-start`, code: `${i}S`, lat, lng: -15, role: 'origin' as const },
    { key: `${i}-end`, code: `${i}E`, lat, lng: 15, role: 'destination' as const },
  ]),
  legs: [0, 15, 30].map((lat, i) => ({
    key: `leg-${i}`,
    from: { lat, lng: -15 },
    to: { lat, lng: 15 },
    color: ['#ffc24b', '#5ea8f2', '#f0607e'][i],
    muted: i === 1,
  })),
};
const fleet: FleetAircraft[] = [
  { view: { kind: 'air', leg: 0, fraction: 0.25 }, color: '#ffc24b', tag: 'A', highlightLeg: 0 },
  { view: { kind: 'air', leg: 1, fraction: 0.65 }, color: '#5ea8f2', tag: 'B', highlightLeg: 1 },
];

let container: HTMLDivElement;
let renderer: GlobeRenderer;
const state = () => renderer as unknown as RenderState;
const planes = () => [...container.querySelectorAll<HTMLElement>('.globe-plane')];

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  container = document.createElement('div');
  document.body.append(container);
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900));
  renderer = new GlobeRenderer(container, {
    textures: { preview: '', medium: '', large: '', lightsSmall: '', lightsLarge: '' },
    bordersUrl: '',
    coastlinesUrl: '',
    countryLabelsUrl: '',
    showBorders: false,
    showCountryLabels: false,
    showWaterLabels: false,
    reducedMotion: true,
  });
  renderer.setRoute(route, { animate: false, frame: false });
});

afterEach(() => {
  if (container.contains(renderer.canvas)) renderer.dispose();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fleet renderer', () => {
  it('pools tinted aircraft, keeps badges upright, parks, and restores single mode', () => {
    renderer.setAircraft(fleet[0].view);
    renderer.setFleet(fleet);
    renderer.flush();
    const [single, a, b] = planes();
    expect(single.style.opacity).toBe('0');
    expect(single.querySelector('.globe-plane__tag')).toBeNull();
    expect(a.style.opacity).toBe('1');
    expect(b.style.opacity).toBe('1');
    expect(a.style.getPropertyValue('--plane-color')).toBe('#ffc24b');
    expect(b.querySelector('.globe-plane__tag')?.textContent).toBe('B');
    expect(a.style.transform).not.toContain('rotate');
    expect(a.style.getPropertyValue('--plane-heading')).toMatch(/deg$/);
    const parked: FleetAircraft = { ...fleet[1], view: { kind: 'ground', leg: 1, at: 'end' } };
    renderer.setFleet([fleet[0], parked]);
    renderer.flush();
    expect(planes()[1]).toBe(a);
    expect(planes()[2]).toBe(b);
    expect(b.classList.contains('is-ground')).toBe(true);
    expect(b.style.opacity).toBe('1');
    renderer.setFleet([fleet[0]]);
    expect(b.isConnected).toBe(false);
    renderer.setFleet(null);
    renderer.flush();
    expect(a.isConnected).toBe(false);
    expect(planes()).toEqual([single]);
    expect(single.style.opacity).toBe('1');
  });

  it('draws independent flown and remaining trails, then restores the whole leg on landing', () => {
    renderer.setAircraft(fleet[0].view);
    renderer.setHighlightLeg(0);
    renderer.setFleet(fleet);
    for (const index of [0, 1]) {
      const leg = state().legs[index];
      expect(leg.line.visible).toBe(true);
      expect(leg.remaining.visible).toBe(true);
      expect(leg.line.geometry.instanceCount).toBeGreaterThan(0);
      expect(leg.line.geometry.instanceCount).toBeLessThan(leg.arc.length - 1);
      expect(leg.remaining.geometry.instanceCount).toBeGreaterThan(0);
    }
    expect(state().legs[2].remaining.visible).toBe(false);
    renderer.setFleet([fleet[0], { ...fleet[1], view: { kind: 'ground', leg: 1, at: 'end' } }]);
    expect(state().legs[0].remaining.visible).toBe(true);
    expect(state().legs[1].remaining.visible).toBe(false);
    expect(state().legs[1].line.geometry.instanceCount).toBe(state().legs[1].arc.length - 1);
  });

  it('emphasises all fleet highlights and their markers, overriding muted styling', () => {
    renderer.setFleet(fleet);
    const lines = state().legs.map((leg) => leg.line.material);
    expect(lines.map((material) => material.opacity)).toEqual([1, 1, 0.55]);
    expect(lines[1].linewidth).toBe(3.6);
    const markers = [...container.querySelectorAll('.globe-marker')];
    expect(markers.slice(0, 4).every((el) => el.classList.contains('is-emph'))).toBe(true);
    expect(markers.slice(4).every((el) => el.classList.contains('is-dim'))).toBe(true);
    renderer.setFleet([]);
    expect(lines[1].opacity).toBe(0.38);
    expect(lines[1].linewidth).toBeLessThan(lines[0].linewidth);
    renderer.setSelectedLeg(1, { frame: false });
    expect(lines[1].opacity).toBe(1);
    expect(lines[1].linewidth).toBe(3.6);
  });

  it('occludes each plane on the far side and hides entries whose legs disappeared', () => {
    renderer.setFleet(fleet);
    state().camera.position.negate();
    state().camera.lookAt(0, 0, 0);
    renderer.flush();
    expect(planes().every((plane) => plane.style.opacity === '0')).toBe(true);
    renderer.setRoute({ markers: [], legs: [] }, { animate: false, frame: false });
    renderer.flush();
    expect(planes().every((plane) => plane.style.opacity === '0')).toBe(true);
  });

  it('preserves geometry, reveal progress and camera when only styles change', () => {
    renderer.setReducedMotion(false);
    renderer.setRoute(
      { ...route, legs: route.legs.map((leg) => ({ ...leg, key: `new-${leg.key}` })) },
      { animate: true, frame: false },
    );
    const legs = [...state().legs];
    const reveal = state().reveal;
    const cameraPosition = state().camera.position.clone();
    const frame = vi.spyOn(renderer, 'frameCurrent');
    renderer.setRoute(
      { ...route, legs: route.legs.map((leg) => ({ ...leg, key: `new-${leg.key}`, color: '#56d3a6', muted: true })) },
      { animate: true, frame: false },
    );
    expect(state().legs).toEqual(legs);
    expect(state().legs[0]).toBe(legs[0]);
    expect(state().legs[0].progress).toBe(0);
    expect(state().reveal).toBe(reveal);
    expect(state().legs[0].line.material.color.getHexString()).toBe('56d3a6');
    expect(state().camera.position).toEqual(cameraPosition);
    expect(frame).not.toHaveBeenCalled();
  });

  it('multiplies arc height while preserving endpoints and framing samples', () => {
    const before = state().legs[0];
    renderer.setRoute(
      { ...route, legs: route.legs.map((leg) => ({ ...leg, lift: 1.66 })) },
      { animate: false, frame: false },
    );
    const lifted = state().legs[0];
    const peak = Math.floor(lifted.arc.length / 2);
    const surfaceRadius = before.arc[0].length();
    expect(lifted.arc[0].length()).toBeCloseTo(surfaceRadius, 12);
    expect(lifted.arc.at(-1)!.length()).toBeCloseTo(before.arc.at(-1)!.length(), 12);
    expect(lifted.arc[peak].length() - surfaceRadius).toBeCloseTo(
      (before.arc[peak].length() - surfaceRadius) * 1.66,
      12,
    );
    expect(lifted.frame).toEqual(before.frame);
  });

  it('disposes pooled DOM aircraft', () => {
    renderer.setFleet(fleet);
    const pooled = planes().slice(1);
    renderer.dispose();
    expect(pooled.every((plane) => !plane.isConnected)).toBe(true);
  });

  it('retains selection animation across empty fleet updates', () => {
    renderer.setReducedMotion(false);
    renderer.setSelectedLeg(0, { frame: false });
    renderer.setFleet([]);
    const animation = state().planeAnim;
    expect(animation).not.toBeNull();
    renderer.setFleet([]);
    expect(state().planeAnim).toBe(animation);
    renderer.setFleet(fleet);
    expect(state().planeAnim).toBeNull();
  });

  it('settles without scheduling more frames for a paused fleet', async () => {
    // Let the mocked texture uploads finish; those legitimately request their own initial draw.
    await Promise.resolve();
    await Promise.resolve();
    renderer.setFleet(fleet);
    renderer.flush();
    renderer.flush();
    vi.mocked(requestAnimationFrame).mockClear();
    renderer.flush();
    renderer.setFleet(fleet);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});

it('keys framing by marker keys, leg keys and lifts, with a default lift of one', () => {
  const signature = routeGeometrySignature(route);
  expect(
    routeGeometrySignature({
      ...route,
      legs: route.legs.map((leg) => ({ ...leg, color: '#56d3a6', muted: !leg.muted, lift: 1 })),
    }),
  ).toBe(signature);
  expect(routeGeometrySignature({ ...route, legs: route.legs.map((leg) => ({ ...leg, lift: 1.22 })) })).not.toBe(
    signature,
  );
  expect(routeGeometrySignature({ ...route, markers: route.markers.slice(1) })).not.toBe(signature);
  expect(routeGeometrySignature({ ...route, legs: route.legs.slice(1) })).not.toBe(signature);
});
