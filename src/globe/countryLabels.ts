import { Vector3, type PerspectiveCamera } from 'three';
import {
  decodeCountryLabels,
  labelStyle,
  labelLocale,
  labelPriority,
  type LabelLocale,
  mapZoom,
  placeLabels,
  type CountryLabel,
  type LabelRect,
} from '../lib/countryLabels.ts';
import { labelOpacity, LABEL_RADIUS, LABEL_FADE_START, latLngToVector3, surfaceFacing } from './math3d.ts';
import { setStyle } from './dom.ts';

interface LabelEntry {
  label: CountryLabel;
  position: Vector3;
  el: HTMLSpanElement;
  sizes: Map<number, { width: number; height: number }>;
  rect: LabelRect;
  x: number;
  y: number;
  opacity: number;
  fontPx: number;
  style: ReturnType<typeof labelStyle>;
  measure: HTMLSpanElement | null;
}
/** Decorative HTML layer, updated only by the renderer's existing on-demand frame. */
export class CountryLabelLayer {
  private container = document.createElement('div');
  private labels: LabelEntry[] = [];
  private candidates: LabelEntry[] = [];
  private rectangles: LabelRect[] = [];
  private projected = new Vector3();
  private pendingMeasurements: LabelEntry[] = [];
  private measuredZoom = NaN;
  private abort = new AbortController();
  private placesVisible = false;
  private waterVisible = false;
  private locale: LabelLocale = 'en';
  private disposed = false;
  private started = false;
  private url: string;
  private requestRender: () => void;

  constructor(parent: HTMLElement, url: string, requestRender: () => void) {
    this.url = url;
    this.requestRender = requestRender;
    this.container.className = 'country-labels';
    this.container.setAttribute('aria-hidden', 'true');
    this.container.style.display = 'none';
    parent.prepend(this.container);
    // Fonts can finish loading after the first labels are measured. Re-measure once in that case.
    void document.fonts.ready.then(() => {
      if (this.disposed) return;
      for (const entry of this.labels) entry.sizes.clear();
      this.requestRender();
    });
  }

  setVisible(places: boolean, water: boolean): void {
    if (this.disposed || (places === this.placesVisible && water === this.waterVisible)) return;
    this.placesVisible = places;
    this.waterVisible = water;
    const visible = places || water;
    this.container.style.display = visible ? '' : 'none';
    if (visible && !this.started) void this.load();
    this.requestRender();
  }

  setLocale(locale: string): void {
    const next = labelLocale(locale);
    if (this.disposed || next === this.locale) return;
    this.locale = next;
    for (const entry of this.labels) {
      entry.el.textContent = this.text(entry.label);
      entry.sizes.clear();
    }
    this.requestRender();
  }

  private text(label: CountryLabel): string {
    const name = label.names[this.locale];
    // Keep the ocean identity together; use a second line for its generic geographic term.
    if (label.kind === 'ocean' && name.length > 12 && name.includes(' ')) {
      const split = name.lastIndexOf(' ');
      return name.slice(0, split) + '\n' + name.slice(split + 1);
    }
    return name;
  }

  private async load(): Promise<void> {
    this.started = true;
    try {
      const response = await fetch(this.url, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw: unknown = await response.json();
      const labels = decodeCountryLabels(raw);
      if (this.disposed) return;
      this.labels = labels.sort(labelPriority).map((label) => {
        const el = document.createElement('span');
        el.className = `country-label country-label--${label.kind}`;
        el.textContent = this.text(label);
        el.style.display = 'none';
        this.container.append(el);
        return {
          label,
          el,
          position: latLngToVector3(label.lat, label.lng, LABEL_RADIUS),
          sizes: new Map<number, { width: number; height: number }>(),
          rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
          x: 0,
          y: 0,
          opacity: 0,
          fontPx: 0,
          style: null,
          measure: null,
        };
      });
      this.measuredZoom = NaN;
      this.requestRender();
    } catch (error) {
      // One attempt per layer; aborted teardown is silent and data failures never affect the globe.
      if (!this.disposed) console.warn('Country names could not be loaded', error);
    }
  }

  /** Batch all metric writes, then reads, before the renderer places any projected DOM. */
  measure(camera: PerspectiveCamera, height: number): void {
    if ((!this.placesVisible && !this.waterVisible) || this.disposed) return;
    const pxPerRadian = height / 2 / Math.tan((camera.fov * Math.PI) / 360) / (camera.position.length() - 1);
    const zoom = mapZoom(pxPerRadian);
    const changed = zoom !== this.measuredZoom;
    this.measuredZoom = zoom;
    this.pendingMeasurements.length = 0;
    for (const entry of this.labels) {
      if (changed) entry.style = labelStyle(entry.label, zoom);
      const style = entry.style;
      if (
        !style ||
        !(entry.label.kind === 'country' ? this.placesVisible : this.waterVisible) ||
        surfaceFacing(entry.position, camera.position) <= LABEL_FADE_START
      )
        continue;
      const fontPx = Math.round(style.fontPx * 2) / 2;
      entry.fontPx = fontPx;
      if (entry.sizes.has(fontPx)) continue;
      if (!entry.measure) {
        entry.measure = document.createElement('span');
        entry.measure.className = entry.el.className;
        entry.measure.style.visibility = 'hidden';
        entry.measure.style.transform = 'translate3d(-10000px, -10000px, 0)';
        this.container.append(entry.measure);
      }
      entry.measure.textContent = entry.el.textContent;
      entry.measure.style.fontSize = `${fontPx}px`;
      entry.measure.style.display = '';
      this.pendingMeasurements.push(entry);
    }
    for (const entry of this.pendingMeasurements) {
      const measure = entry.measure;
      if (measure) entry.sizes.set(entry.fontPx, { width: measure.offsetWidth, height: measure.offsetHeight });
    }
    for (const entry of this.pendingMeasurements) if (entry.measure) entry.measure.style.display = 'none';
  }

  update(camera: PerspectiveCamera, width: number, height: number, reserved: readonly LabelRect[]): void {
    if ((!this.placesVisible && !this.waterVisible) || this.disposed) return;
    this.candidates.length = 0;
    this.rectangles.length = 0;
    for (const entry of this.labels) {
      if (!(entry.label.kind === 'country' ? this.placesVisible : this.waterVisible)) {
        this.hide(entry);
        continue;
      }
      const style = entry.style;
      const facing = surfaceFacing(entry.position, camera.position);
      const opacity = style ? style.opacity * labelOpacity(facing) : 0;
      if (!style || opacity <= 0) {
        this.hide(entry);
        continue;
      }
      const p = this.projected.copy(entry.position).project(camera);
      if (p.z > 1) {
        this.hide(entry);
        continue;
      }
      const size = entry.sizes.get(entry.fontPx);
      if (!size) continue;
      entry.x = Math.round(((p.x + 1) / 2) * width * 10) / 10;
      entry.y = Math.round(((1 - p.y) / 2) * height * 10) / 10;
      entry.opacity = Math.round(opacity * 100) / 100;
      const r = entry.rect;
      r.x0 = entry.x - size.width / 2;
      r.x1 = entry.x + size.width / 2;
      r.y0 = entry.y - size.height / 2;
      r.y1 = entry.y + size.height / 2;
      if (r.x0 < 0 || r.y0 < 0 || r.x1 > width || r.y1 > height || entry.opacity <= 0) {
        this.hide(entry);
        continue;
      }
      this.candidates.push(entry);
      this.rectangles.push(r);
    }
    const placed = placeLabels(this.rectangles, reserved);
    for (let i = 0; i < this.candidates.length; i++) {
      const entry = this.candidates[i];
      if (!placed[i]) {
        this.hide(entry);
        continue;
      }
      const transform = `translate3d(${entry.x}px, ${entry.y}px, 0px) translate(-50%, -50%)`;
      setStyle(entry.el, 'transform', transform);
      setStyle(entry.el, 'opacity', String(entry.opacity));
      setStyle(entry.el, 'fontSize', `${entry.fontPx}px`);
      setStyle(entry.el, 'display', '');
    }
  }

  private hide(entry: LabelEntry): void {
    if (entry.el.style.display !== 'none') entry.el.style.display = 'none';
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.container.remove();
    this.labels = [];
    this.candidates = [];
    this.rectangles = [];
    this.pendingMeasurements = [];
  }
}
