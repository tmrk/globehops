import { LABEL_SHADOWS, LABEL_TYPE, labelLines, type LabelKind } from '../lib/countryLabels.ts';

/** Room around a name's text for its shadows, in CSS pixels. */
export const LABEL_TEXT_PAD = 12;

/** A name's text box in CSS pixels: its widest line by its lines' height, without the shadows' room. */
export interface LabelTextBox {
  width: number;
  height: number;
}

/** Sets place names with the 2D canvas in the interface font, for the globe to draw as textures. */
export interface LabelTextPainter {
  /** The text box at `fontPx`, or null while the font is still loading (the painter reports when it arrives). */
  measure(text: string, kind: LabelKind, fontPx: number): LabelTextBox | null;
  /**
   * Draws the text with its shadows, its box `LABEL_TEXT_PAD` from the top left, at `scale` device pixels per
   * CSS pixel. The canvas is shared: upload it before the next call. Null while the font is still loading.
   */
  draw(text: string, kind: LabelKind, fontPx: number, scale: number): HTMLCanvasElement | null;
}

interface Layout extends LabelTextBox {
  lines: string[];
  widths: number[];
  tracking: number;
  baseline: number;
  lineHeight: number;
}

/**
 * A painter in the font family of `styleSource` (the interface's `--font`), with capitals tracked by its
 * `--track-caps`. `onFontLoaded` runs when a face it was waiting for has loaded, so names can be set again.
 */
export function createLabelTextPainter(styleSource: Element, onFontLoaded: () => void): LabelTextPainter | null {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const ctx = context;
  const style = getComputedStyle(styleSource);
  const family = style.fontFamily || 'sans-serif';
  const capsTracking = parseFloat(style.getPropertyValue('--track-caps')) || 0.13;
  // Canvas letter spacing follows CSS letter-spacing; older engines get it glyph by glyph (without kerning).
  const nativeTracking = typeof (ctx as { letterSpacing?: unknown }).letterSpacing === 'string';
  const fonts = typeof document.fonts?.check === 'function' ? document.fonts : null;
  const loading = new Set<string>();

  const font = (kind: LabelKind, fontPx: number) => {
    const type = LABEL_TYPE[kind];
    return `${type.italic ? 'italic ' : ''}${type.weight} ${fontPx}px ${family}`;
  };
  /** Whether the faces `text` needs have loaded; if not, loads them and reports when they have. */
  const ready = (kind: LabelKind, text: string): boolean => {
    if (!fonts) return true;
    const face = font(kind, 16);
    if (fonts.check(face, text)) return true;
    const key = `${face}|${text}`;
    if (!loading.has(key)) {
      loading.add(key);
      void fonts.load(face, text).then(
        () => onFontLoaded(),
        () => {},
      );
    }
    return false;
  };
  const setFont = (kind: LabelKind, fontPx: number): number => {
    const type = LABEL_TYPE[kind];
    const tracking = (type.tracking ?? capsTracking) * fontPx;
    ctx.font = font(kind, fontPx);
    if (nativeTracking) ctx.letterSpacing = `${tracking}px`;
    return tracking;
  };
  /** A line's width without the spacing CSS leaves after its last letter. */
  const lineWidth = (line: string, tracking: number): number => {
    if (nativeTracking) return Math.max(0, ctx.measureText(line).width - tracking);
    let width = 0;
    let letters = 0;
    for (const letter of line) {
      width += ctx.measureText(letter).width;
      letters++;
    }
    return width + tracking * Math.max(0, letters - 1);
  };
  const layout = (text: string, kind: LabelKind, fontPx: number): Layout | null => {
    if (!ready(kind, text)) return null;
    const type = LABEL_TYPE[kind];
    const tracking = setFont(kind, fontPx);
    const maxWidth = type.wrapEm === null ? Infinity : type.wrapEm * fontPx;
    const lines = labelLines(text, maxWidth, (line) => lineWidth(line, tracking));
    const widths = lines.map((line) => lineWidth(line, tracking));
    const metrics = ctx.measureText('Hg');
    const ascent = metrics.fontBoundingBoxAscent ?? fontPx * 0.9;
    const descent = metrics.fontBoundingBoxDescent ?? fontPx * 0.25;
    const lineHeight = type.lineHeight * fontPx;
    return {
      lines,
      widths,
      tracking,
      lineHeight,
      // As in a CSS line box: half the leading above the font's ascent.
      baseline: (lineHeight - ascent - descent) / 2 + ascent,
      width: Math.max(0, ...widths),
      height: lineHeight * lines.length,
    };
  };
  /** Each line centred in the box, its left edge `dx` from where it belongs. */
  const fillLines = (set: Layout, dx: number) => {
    for (let i = 0; i < set.lines.length; i++) {
      let x = LABEL_TEXT_PAD + (set.width - set.widths[i]) / 2 + dx;
      const y = LABEL_TEXT_PAD + i * set.lineHeight + set.baseline;
      if (nativeTracking) {
        ctx.fillText(set.lines[i], x, y);
        continue;
      }
      for (const letter of set.lines[i]) {
        ctx.fillText(letter, x, y);
        x += ctx.measureText(letter).width + set.tracking;
      }
    }
  };

  return {
    measure(text, kind, fontPx) {
      const set = layout(text, kind, fontPx);
      return set && { width: set.width, height: set.height };
    },
    draw(text, kind, fontPx, scale) {
      const set = layout(text, kind, fontPx);
      if (!set) return null;
      const width = set.width + 2 * LABEL_TEXT_PAD;
      const height = set.height + 2 * LABEL_TEXT_PAD;
      // Resizing clears the canvas and resets its state, font included.
      canvas.width = Math.max(1, Math.ceil(width * scale));
      canvas.height = Math.max(1, Math.ceil(height * scale));
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      setFont(kind, fontPx);
      ctx.textBaseline = 'alphabetic';
      // Only the shadows land on the canvas: the text casting them is drawn a canvas-width to the left. Shadow
      // offsets and blur ignore the transform, so they are in device pixels. The lowest shadow goes first.
      const away = width + 2 * LABEL_TEXT_PAD;
      ctx.fillStyle = '#000';
      for (let i = LABEL_SHADOWS.length - 1; i >= 0; i--) {
        const shadow = LABEL_SHADOWS[i];
        ctx.shadowColor = shadow.color;
        ctx.shadowBlur = shadow.blur * scale;
        ctx.shadowOffsetX = away * scale;
        ctx.shadowOffsetY = shadow.y * scale;
        fillLines(set, -away);
      }
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = LABEL_TYPE[kind].color;
      fillLines(set, 0);
      return canvas;
    },
  };
}
