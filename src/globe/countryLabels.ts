import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Object3D,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import {
  decodeCountryLabels,
  labelStyle,
  labelLocale,
  labelPriority,
  labelText,
  type LabelKind,
  type LabelLocale,
  type LabelStyle,
  mapZoom,
  placeLabels,
  type CountryLabel,
  type LabelRect,
} from '../lib/countryLabels.ts';
import { clamp01, LABEL_RADIUS, LABEL_FADE_RANGE, LABEL_FADE_START, latLngToVector3 } from './math3d.ts';
import { createLabelTextPainter, LABEL_TEXT_PAD, type LabelTextBox, type LabelTextPainter } from './labelText.ts';

/** What the layer needs from the WebGL renderer: its pixel ratio, and uploading a texture straight away. */
export interface LabelRenderer {
  getPixelRatio(): number;
  initTexture(texture: Texture): void;
}

/** A name as placed this frame: its text box in CSS pixels from the globe's top left. */
export interface PlacedName extends LabelRect {
  kind: LabelKind;
  name: string;
  opacity: number;
}

interface LabelEntry {
  label: CountryLabel;
  /** Position in priority order (0 first). */
  order: number;
  /** The name as set in the current locale (capitals included). */
  text: string;
  position: Vector3;
  sizes: Map<number, LabelTextBox>;
  rect: LabelRect;
  x: number;
  y: number;
  opacity: number;
  fontPx: number;
  /** This label's look at the measured zoom: `look` itself, or null while the zoom hides it. */
  style: LabelStyle | null;
  look: LabelStyle;
  /** How squarely the label's spot faces the camera this frame (see `surfaceFacing`). */
  facing: number;
  mesh: Mesh<PlaneGeometry, ShaderMaterial> | null;
  /** The drawn name: at what size and scale, and its texture's size in CSS pixels. */
  texture: Texture | null;
  textureFontPx: number;
  textureScale: number;
  textureWidth: number;
  textureHeight: number;
}

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
/** Zoom steps finer than this change no label visibly, so a drifting camera need not restyle every frame. */
const ZOOM_STEP = 0.01;
/** Above every route line; the airport labels and aircraft stay on the page above the globe. */
const RENDER_ORDER = 1_000_000;
/** Setting names is the costly part (blurred shadows), so a frame sets at most this long's worth. */
const DRAW_BUDGET_MS = 3;

/** A quad drawn straight in clip space: `box` is its centre and size there; the texture is premultiplied. */
const VERTEX_SHADER = /* glsl */ `
uniform vec4 box;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(box.xy + position.xy * box.zw, 0.0, 1.0);
}`;
const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
uniform float opacity;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(map, vUv) * opacity;
}`;

/**
 * Country, ocean and sea names, drawn by the globe itself: each name it places is a texture (set once per size
 * with the 2D canvas) on a quad in the same frame as the Earth. As page elements, moving ~100 names a frame
 * cost a compositing layer each and dropped frames while following an aircraft.
 */
export class CountryLabelLayer {
  private group = new Group();
  private geometry = new PlaneGeometry(1, 1);
  private labels: LabelEntry[] = [];
  private candidates: LabelEntry[] = [];
  private rectangles: LabelRect[] = [];
  private placed: boolean[] = [];
  private shown: LabelEntry[] = [];
  private projected = new Vector3();
  private measuredZoom = NaN;
  private abort = new AbortController();
  private placesVisible = false;
  private waterVisible = false;
  private locale: LabelLocale = 'en';
  private disposed = false;
  private started = false;
  private painter: LabelTextPainter | null;

  constructor(
    scene: Object3D,
    private renderer: LabelRenderer,
    private url: string,
    private requestRender: () => void,
    styleSource: Element,
    painter: (onFontLoaded: () => void) => LabelTextPainter | null = (loaded) =>
      createLabelTextPainter(styleSource, loaded),
  ) {
    this.group.name = 'Place names';
    this.group.visible = false;
    scene.add(this.group);
    // A face that arrives later sets every name again, in it.
    this.painter = painter(() => {
      if (this.disposed) return;
      this.forgetText();
      this.requestRender();
    });
  }

  setVisible(places: boolean, water: boolean): void {
    if (this.disposed || (places === this.placesVisible && water === this.waterVisible)) return;
    this.placesVisible = places;
    this.waterVisible = water;
    const visible = places || water;
    this.group.visible = visible;
    if (visible && !this.started) void this.load();
    this.requestRender();
  }

  setLocale(locale: string): void {
    const next = labelLocale(locale);
    if (this.disposed || next === this.locale) return;
    this.locale = next;
    for (const entry of this.labels) entry.text = labelText(entry.label, next);
    this.forgetText();
    this.requestRender();
  }

  /** After a lost WebGL context the textures are gone; names are set again as they show. */
  restore(): void {
    for (const entry of this.labels) this.releaseTexture(entry);
    this.requestRender();
  }

  /** The names placed in the last frame (for tests and diagnostics; worked out when asked). */
  placedNames(): PlacedName[] {
    if (!this.group.visible) return [];
    return this.shown.map((entry) => ({
      kind: entry.label.kind,
      name: entry.label.names[this.locale],
      opacity: entry.opacity,
      ...entry.rect,
    }));
  }

  private forgetText(): void {
    for (const entry of this.labels) {
      entry.sizes.clear();
      this.releaseTexture(entry);
    }
  }

  private async load(): Promise<void> {
    this.started = true;
    try {
      const response = await fetch(this.url, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw: unknown = await response.json();
      const labels = decodeCountryLabels(raw);
      if (this.disposed) return;
      this.labels = labels.sort(labelPriority).map((label, order) => ({
        label,
        order,
        text: labelText(label, this.locale),
        position: latLngToVector3(label.lat, label.lng, LABEL_RADIUS),
        sizes: new Map<number, LabelTextBox>(),
        rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
        x: 0,
        y: 0,
        opacity: 0,
        fontPx: 0,
        style: null,
        look: { opacity: 0, fontPx: 0 },
        facing: 0,
        mesh: null,
        texture: null,
        textureFontPx: 0,
        textureScale: 0,
        textureWidth: 0,
        textureHeight: 0,
      }));
      this.measuredZoom = NaN;
      this.requestRender();
    } catch (error) {
      // One attempt per layer; aborted teardown is silent and data failures never affect the globe.
      if (!this.disposed) console.warn('Country names could not be loaded', error);
    }
  }

  /** Works out each label's look and text size for the camera, before the frame draws. */
  measure(cameraObject: PerspectiveCamera, height: number): void {
    if ((!this.placesVisible && !this.waterVisible) || this.disposed || !this.painter) return;
    const pxPerRadian =
      height / 2 / Math.tan((cameraObject.fov * Math.PI) / 360) / (cameraObject.position.length() - 1);
    const zoom = Math.round(mapZoom(pxPerRadian) / ZOOM_STEP) * ZOOM_STEP;
    const changed = zoom !== this.measuredZoom;
    this.measuredZoom = zoom;
    const camera = cameraObject.position;
    // Both loops here and in update() run for every label each frame, so they index rather than iterate and
    // write their arithmetic out instead of calling helpers that would box each number they return.
    for (let i = 0; i < this.labels.length; i++) {
      const entry = this.labels[i];
      const p = entry.position;
      const dx = camera.x - p.x;
      const dy = camera.y - p.y;
      const dz = camera.z - p.z;
      // surfaceFacing(): every label sits at LABEL_RADIUS.
      entry.facing = (p.x * dx + p.y * dy + p.z * dz) / (Math.sqrt(dx * dx + dy * dy + dz * dz) * LABEL_RADIUS);
      if (changed) entry.style = labelStyle(entry.label, zoom, entry.look);
      const style = entry.style;
      if (
        !style ||
        !(entry.label.kind === 'country' ? this.placesVisible : this.waterVisible) ||
        entry.facing <= LABEL_FADE_START
      )
        continue;
      const fontPx = Math.round(style.fontPx * 2) / 2;
      entry.fontPx = fontPx;
      if (entry.sizes.has(fontPx)) continue;
      const size = this.painter.measure(entry.text, entry.label.kind, fontPx);
      if (size) entry.sizes.set(fontPx, size);
    }
  }

  /**
   * Places labels for the camera measure() saw, around the airport labels' `reserved` boxes and only within
   * `room`, the part of the view no panel covers, and readies their quads for this frame's draw. While the
   * camera is `settled`, quads sit on whole device pixels so the text is as sharp as the page's.
   */
  update(
    camera: PerspectiveCamera,
    width: number,
    height: number,
    reserved: readonly LabelRect[],
    room: { top: number; right: number; bottom: number; left: number } = NO_INSETS,
    settled = true,
  ): void {
    this.shown.length = 0;
    if ((!this.placesVisible && !this.waterVisible) || this.disposed) return;
    this.candidates.length = 0;
    this.rectangles.length = 0;
    for (let i = 0; i < this.labels.length; i++) {
      const entry = this.labels[i];
      if (!(entry.label.kind === 'country' ? this.placesVisible : this.waterVisible)) {
        this.hide(entry);
        continue;
      }
      const style = entry.style;
      // labelOpacity(), written out.
      const opacity = style ? style.opacity * clamp01((entry.facing - LABEL_FADE_START) / LABEL_FADE_RANGE) : 0;
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
      if (!size) {
        this.hide(entry);
        continue;
      }
      entry.x = ((p.x + 1) / 2) * width;
      entry.y = ((1 - p.y) / 2) * height;
      entry.opacity = opacity;
      const r = entry.rect;
      r.x0 = entry.x - size.width / 2;
      r.x1 = entry.x + size.width / 2;
      r.y0 = entry.y - size.height / 2;
      r.y1 = entry.y + size.height / 2;
      if (r.x0 < room.left || r.y0 < room.top || r.x1 > width - room.right || r.y1 > height - room.bottom) {
        this.hide(entry);
        continue;
      }
      this.candidates.push(entry);
      this.rectangles.push(r);
    }
    const placed = placeLabels(this.rectangles, reserved, this.placed);
    const scale = this.renderer.getPixelRatio();
    const deadline = performance.now() + DRAW_BUDGET_MS;
    let waiting = false;
    for (let i = 0; i < this.candidates.length; i++) {
      const entry = this.candidates[i];
      if (!placed[i]) {
        this.hide(entry);
        continue;
      }
      this.shown.push(entry);
      // A name whose size changed keeps its last texture, scaled, until its turn to be set again.
      if (entry.textureFontPx !== entry.fontPx || entry.textureScale !== scale) {
        if (!entry.texture || performance.now() < deadline) this.drawText(entry, scale);
        if (entry.textureFontPx !== entry.fontPx || entry.textureScale !== scale) waiting = true;
      }
      if (!entry.texture || !entry.mesh) {
        this.hide(entry);
        continue;
      }
      this.placeQuad(entry, width, height, scale, settled);
    }
    if (waiting) this.requestRender();
  }

  /** Sets the name in its current size into a texture, uploaded now because the canvas is shared. */
  private drawText(entry: LabelEntry, scale: number): void {
    const canvas = this.painter?.draw(entry.text, entry.label.kind, entry.fontPx, scale);
    if (!canvas) return;
    this.releaseTexture(entry);
    const texture = new CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.premultiplyAlpha = true;
    this.renderer.initTexture(texture);
    entry.texture = texture;
    entry.textureFontPx = entry.fontPx;
    entry.textureScale = scale;
    entry.textureWidth = canvas.width / scale;
    entry.textureHeight = canvas.height / scale;
    if (!entry.mesh) {
      const material = new ShaderMaterial({
        uniforms: { map: { value: texture }, opacity: { value: 0 }, box: { value: new Vector4() } },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      });
      entry.mesh = new Mesh(this.geometry, material);
      entry.mesh.name = entry.label.name;
      entry.mesh.frustumCulled = false;
      entry.mesh.matrixAutoUpdate = false;
      // Higher-priority names draw last, so where shadows meet theirs stay on top.
      entry.mesh.renderOrder = RENDER_ORDER + this.labels.length - entry.order;
      entry.mesh.visible = false;
      this.group.add(entry.mesh);
    } else entry.mesh.material.uniforms.map.value = texture;
  }

  private placeQuad(entry: LabelEntry, width: number, height: number, scale: number, settled: boolean): void {
    const mesh = entry.mesh;
    if (!mesh) return;
    // The texture's text box sits LABEL_TEXT_PAD from its top left; a stale size is scaled to the new one.
    const k = entry.fontPx / entry.textureFontPx;
    let left = entry.rect.x0 - LABEL_TEXT_PAD * k;
    let top = entry.rect.y0 - LABEL_TEXT_PAD * k;
    if (settled && k === 1) {
      left = Math.round(left * scale) / scale;
      top = Math.round(top * scale) / scale;
    }
    const w = entry.textureWidth * k;
    const h = entry.textureHeight * k;
    const uniforms = mesh.material.uniforms;
    (uniforms.box.value as Vector4).set(
      ((left + w / 2) / width) * 2 - 1,
      1 - ((top + h / 2) / height) * 2,
      (w / width) * 2,
      (h / height) * 2,
    );
    uniforms.opacity.value = entry.opacity;
    mesh.visible = true;
  }

  private hide(entry: LabelEntry): void {
    if (entry.mesh) entry.mesh.visible = false;
  }

  private releaseTexture(entry: LabelEntry): void {
    entry.texture?.dispose();
    entry.texture = null;
    entry.textureFontPx = entry.textureScale = 0;
    this.hide(entry);
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    for (const entry of this.labels) {
      entry.texture?.dispose();
      entry.mesh?.material.dispose();
    }
    this.group.removeFromParent();
    this.group.clear();
    this.geometry.dispose();
    this.labels = [];
    this.candidates = [];
    this.rectangles = [];
    this.shown = [];
  }
}
