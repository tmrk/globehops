// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GlobeView, { type GlobeViewProps } from './GlobeView.tsx';
import type { GlobeRendererOptions } from './GlobeRenderer.ts';

const { instances } = vi.hoisted(() => ({ instances: [] as RendererStub[] }));

interface RendererStub {
  canvas: HTMLCanvasElement;
  options: GlobeRendererOptions;
  setReducedMotion: ReturnType<typeof vi.fn>;
  setBordersVisible: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

vi.mock('../i18n/I18nProvider.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./GlobeRenderer.ts', () => ({
  GlobeRenderer: class {
    canvas = document.createElement('canvas');
    options: GlobeRendererOptions;
    constructor(parent: HTMLElement, options: GlobeRendererOptions) {
      this.options = options;
      parent.append(this.canvas);
      instances.push(this);
    }
    setReducedMotion = vi.fn();
    setBordersVisible = vi.fn();
    setCountryLabelsVisible = vi.fn();
    setWaterLabelsVisible = vi.fn();
    setUserLocation = vi.fn();
    setLabelLocale = vi.fn();
    setInsets = vi.fn();
    setRoute = vi.fn();
    setFollowAircraft = vi.fn();
    setSelectedLeg = vi.fn();
    setSky = vi.fn();
    setSkyNames = vi.fn();
    showMoon = vi.fn();
    setAircraft = vi.fn();
    setFleet = vi.fn();
    setHighlightLeg = vi.fn();
    setFollow = vi.fn();
    flush = vi.fn();
    dispose = vi.fn();
  },
}));

let container: HTMLDivElement;
let root: Root;
let unmounted: boolean;
let props: GlobeViewProps;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  instances.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  unmounted = false;
  props = {
    route: { markers: [], legs: [] },
    selectedLeg: null,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    showBorders: true,
    showCountryNames: false,
    showWaterNames: false,
    userLocation: null,
    reducedMotion: true,
    followAircraft: false,
    fitNonce: 0,
    moonNonce: 0,
    onFollowAircraftChange: vi.fn(),
    onLegClick: vi.fn(),
    onFitChange: vi.fn(),
    onReady: vi.fn(),
    onError: vi.fn(),
  };
  act(() => root.render(createElement(GlobeView, props)));
});

afterEach(() => {
  if (!unmounted) act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps one renderer across prop changes and dispatches callbacks to the latest props', () => {
  const renderer = instances[0];
  const previous = props.onLegClick;
  props = { ...props, reducedMotion: false, showBorders: false, onLegClick: vi.fn() };
  act(() => root.render(createElement(GlobeView, props)));
  expect(instances).toHaveLength(1);
  expect(renderer.setReducedMotion).toHaveBeenLastCalledWith(false);
  expect(renderer.setBordersVisible).toHaveBeenLastCalledWith(false);
  renderer.options.onLegClick?.(2);
  expect(props.onLegClick).toHaveBeenCalledWith(2);
  expect(previous).not.toHaveBeenCalled();
});

it('clears every context-loss timeout when repeated loss events are followed by restoration', () => {
  const renderer = instances[0];
  renderer.canvas.dispatchEvent(new Event('webglcontextlost'));
  vi.advanceTimersByTime(1000);
  renderer.canvas.dispatchEvent(new Event('webglcontextlost'));
  renderer.canvas.dispatchEvent(new Event('webglcontextrestored'));
  vi.advanceTimersByTime(5000);
  expect(props.onError).not.toHaveBeenCalled();
});

it('unsubscribes replaced simulation feeds and cancels a pending loss timeout on unmount', () => {
  const unsubscribe = vi.fn();
  const feed = {
    subscribe: vi.fn(() => unsubscribe),
    getFrame: () => ({ sky: null, aircraft: null, highlightLeg: null, follow: false }),
  };
  act(() => root.render(createElement(GlobeView, { ...props, sim: feed })));
  expect(feed.subscribe).toHaveBeenCalledOnce();
  act(() => root.render(createElement(GlobeView, props)));
  expect(unsubscribe).toHaveBeenCalledOnce();
  instances[0].canvas.dispatchEvent(new Event('webglcontextlost'));
  act(() => root.unmount());
  vi.advanceTimersByTime(5000);
  expect(instances[0].dispose).toHaveBeenCalledOnce();
  expect(props.onError).not.toHaveBeenCalled();
  unmounted = true;
});
