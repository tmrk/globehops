// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { AirportLabelLayer } from './airportLabels.ts';
import type { GlobeMarker } from './GlobeRenderer.ts';

const markers: GlobeMarker[] = [
  { key: 'transfer', code: 'BBB', lat: 0, lng: 0, role: 'transfer' },
  { key: 'origin', code: 'AAA', lat: 0, lng: 0, role: 'origin' },
];

afterEach(() => vi.restoreAllMocks());

function setup(ready = Promise.resolve()) {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
  const parent = document.createElement('div');
  const plane = document.createElement('div');
  parent.append(plane);
  const layer = new AirportLabelLayer(parent, plane, vi.fn());
  const camera = new PerspectiveCamera(30, 1.6, 0.1, 100);
  camera.position.set(5, 0, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  layer.setMarkers(markers);
  return { parent, layer, camera };
}

describe('airport label placement', () => {
  it('prioritizes endpoints and reuses placement buffers with no DOM mutations on a repeated frame', () => {
    const { parent, layer, camera } = setup();
    layer.measure();
    const reserved = layer.update(camera, 1440, 900);
    expect(layer.markers[1].label.style.transform).toBe('translate(9px, -25px)');
    expect(layer.markers[0].label.style.transform).toBe('translate(-45px, -25px)');
    expect(reserved).toHaveLength(4);
    const observer = new MutationObserver(() => {});
    observer.observe(parent, { subtree: true, attributes: true, childList: true, characterData: true });
    layer.measure();
    expect(layer.update(camera, 1440, 900)).toBe(reserved);
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    layer.dispose();
  });

  it('only invalidates metrics for changed text and updates role priority without replacing DOM', () => {
    const { parent, layer, camera } = setup();
    const nodes = layer.markers.map((marker) => marker.el);
    const measure = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(50);
    layer.measure();
    expect(measure).toHaveBeenCalledTimes(2);
    layer.updateMarkers(markers);
    layer.measure();
    expect(measure).toHaveBeenCalledTimes(2);
    layer.updateMarkers([
      { ...markers[0], role: 'origin' },
      { ...markers[1], code: 'AAAA', role: 'transfer' },
    ]);
    layer.measure();
    layer.update(camera, 1440, 900);
    expect(measure).toHaveBeenCalledTimes(3);
    expect(layer.markers.map((marker) => marker.el)).toEqual(nodes);
    expect(layer.markers[0].label.style.transform).toBe('translate(9px, -25px)');
    expect(parent.querySelectorAll('.globe-marker--origin')).toHaveLength(1);
    layer.dispose();
  });

  it('remeasures labels after fonts settle and removes every marker on disposal', async () => {
    let fontsReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      fontsReady = resolve;
    });
    const { parent, layer, camera } = setup(ready);
    const measure = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(40);
    layer.measure();
    const reserved = layer.update(camera, 1440, 900);
    expect(reserved[0].x1 - reserved[0].x0).toBe(40);
    measure.mockReturnValue(60);
    fontsReady?.();
    await ready;
    layer.measure();
    layer.update(camera, 1440, 900);
    expect(reserved[0].x1 - reserved[0].x0).toBe(60);
    layer.dispose();
    expect(parent.querySelectorAll('.globe-marker')).toHaveLength(0);
  });
});
