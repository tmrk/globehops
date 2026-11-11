import { Vector3, type PerspectiveCamera } from 'three';
import type { LabelRect } from '../lib/countryLabels.ts';
import type { GlobeMarker, MarkerRole } from './GlobeRenderer.ts';
import { labelOpacity, LABEL_RADIUS, latLngToVector3, projectToScreen, surfaceFacing } from './math3d.ts';
import { setStyle } from './dom.ts';

const LABEL_HEIGHT = 21;
const LABEL_GAP = 9;
const LABEL_ABOVE = -25;
const LABEL_BELOW = 5;
const COLLISION_PADDING = 2;
const DOT_CLEARANCE = 7;
const FALLBACK_LABEL_WIDTH = 36;

interface MarkerObject {
  key: string;
  position: Vector3;
  el: HTMLDivElement;
  label: HTMLSpanElement;
  labelWidth: number;
  role: MarkerRole;
  code: string;
  rect: LabelRect;
  dotRect: LabelRect;
}

function rolePriority(role: MarkerRole): number {
  if (role === 'origin' || role === 'single') return 0;
  return role === 'destination' ? 1 : 2;
}

/** Airport DOM, cached metrics and priority placement; the renderer owns selection styling. */
export class AirportLabelLayer {
  readonly markers: MarkerObject[] = [];
  private order: MarkerObject[] = [];
  private placed: LabelRect[] = [];
  private projected = new Vector3();
  private disposed = false;

  constructor(
    private parent: HTMLElement,
    private before: HTMLElement,
    requestRender: () => void,
  ) {
    // Initial metrics can be fallback-font widths when the lazy globe mounts before fonts settle.
    void document.fonts.ready.then(() => {
      if (this.disposed) return;
      for (const marker of this.markers) marker.labelWidth = 0;
      requestRender();
    });
  }

  setMarkers(markers: readonly GlobeMarker[]): void {
    this.clear();
    for (const marker of markers) {
      const el = document.createElement('div');
      el.className = `globe-marker globe-marker--${marker.role}`;
      const dot = document.createElement('span');
      dot.className = 'globe-marker__dot';
      const label = document.createElement('span');
      label.className = 'globe-marker__label';
      label.textContent = marker.code;
      el.append(dot, label);
      setStyle(el, 'opacity', '0');
      this.parent.insertBefore(el, this.before);
      this.markers.push({
        ...marker,
        position: latLngToVector3(marker.lat, marker.lng, LABEL_RADIUS),
        el,
        label,
        labelWidth: 0,
        rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
        dotRect: { x0: 0, y0: 0, x1: 0, y1: 0 },
      });
    }
    this.sort();
  }

  updateMarkers(markers: readonly GlobeMarker[]): void {
    markers.forEach((marker, i) => {
      const obj = this.markers[i];
      if (obj.role !== marker.role) {
        obj.el.classList.replace(`globe-marker--${obj.role}`, `globe-marker--${marker.role}`);
        obj.role = marker.role;
      }
      if (obj.code !== marker.code) {
        obj.code = marker.code;
        obj.label.textContent = marker.code;
        obj.labelWidth = 0;
      }
    });
    this.sort();
  }

  private sort(): void {
    this.order = this.markers.slice().sort((a, b) => rolePriority(a.role) - rolePriority(b.role));
  }

  /** Run before any projected-layer style writes, so all uncached airport metrics share a layout. */
  measure(): void {
    for (const marker of this.markers) {
      if (!marker.labelWidth) marker.labelWidth = marker.label.offsetWidth || FALLBACK_LABEL_WIDTH;
    }
  }

  update(camera: PerspectiveCamera, width: number, height: number): readonly LabelRect[] {
    this.placed.length = 0;
    for (const marker of this.order) {
      const projected = projectToScreen(marker.position, camera, width, height, this.projected);
      const opacity = projected ? labelOpacity(surfaceFacing(marker.position, camera.position)) : 0;
      setStyle(marker.el, 'opacity', String(opacity));
      setStyle(marker.el, 'visibility', opacity > 0 ? 'visible' : 'hidden');
      if (!projected || opacity <= 0) continue;
      const { x, y } = this.projected;
      setStyle(marker.el, 'transform', `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
      const w = marker.labelWidth;
      let dx = LABEL_GAP;
      let dy = LABEL_ABOVE;
      // Prefer above-right, above-left, below-right, then below-left.
      for (let i = 0; i < 4; i++) {
        const cx = i % 2 === 0 ? LABEL_GAP : -LABEL_GAP - w;
        const cy = i < 2 ? LABEL_ABOVE : LABEL_BELOW;
        if (!this.collides(x + cx, y + cy, w)) {
          dx = cx;
          dy = cy;
          break;
        }
      }
      const rect = marker.rect;
      rect.x0 = x + dx;
      rect.y0 = y + dy;
      rect.x1 = rect.x0 + w;
      rect.y1 = rect.y0 + LABEL_HEIGHT;
      const dot = marker.dotRect;
      dot.x0 = x - DOT_CLEARANCE;
      dot.y0 = y - DOT_CLEARANCE;
      dot.x1 = x + DOT_CLEARANCE;
      dot.y1 = y + DOT_CLEARANCE;
      this.placed.push(rect, dot);
      setStyle(marker.label, 'transform', `translate(${dx}px, ${dy}px)`);
    }
    return this.placed;
  }

  private collides(x: number, y: number, width: number): boolean {
    for (const rect of this.placed) {
      if (
        x - COLLISION_PADDING < rect.x1 &&
        x + width + COLLISION_PADDING > rect.x0 &&
        y - COLLISION_PADDING < rect.y1 &&
        y + LABEL_HEIGHT + COLLISION_PADDING > rect.y0
      )
        return true;
    }
    return false;
  }

  private clear(): void {
    for (const marker of this.markers) marker.el.remove();
    this.markers.length = 0;
    this.order.length = 0;
    this.placed.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }
}
