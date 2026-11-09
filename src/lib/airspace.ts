/**
 * Airspace-aware routing: keeps the great circle unless it crosses an applicable avoidance zone,
 * then finds a short, smooth detour on the sphere.
 *
 * Zones are rasterised once onto a 0.5° grid: a cell blocks when a zone covers any part of it. A*
 * over that grid (16 directions, wrapping across the antimeridian and over the poles) finds the way
 * around; string-pulling and tightening turn the cell path into a few great-circle arcs that hug
 * the zones, and every corner is rounded into a gentle curve. Crossings are decided, and every
 * result validated, against the zones' own outlines; a missing or implausible detour keeps the
 * great circle and reports that avoidance is not guaranteed.
 */
import type { LatLng, LegRoute } from '../types.ts';
import { zoneContains, type AirspaceDataset, type AirspaceZone, type OperatorGroup } from '../data/airspace.ts';
import { EARTH_RADIUS_KM, fromVec3, greatCircleDistanceKm, slerpVec, toVec3, type Vec3 } from './geo.ts';
import { altitudeProfile } from './altitude.ts';

/** `other`: an airline none of the advisories address (none apply). */
export type Operator = OperatorGroup | 'other';
export interface RouteEndpoint extends LatLng {
  /** ISO country of the airport, for advisory exemptions. */
  countryCode?: string;
}
export interface RouteOptions {
  /** Flight date (UTC ms); advisories apply only on days they are valid. */
  epochMs: number;
  /** Defaults to an EASA (EU/EEA) operator when the airline is unknown. */
  operator?: Operator;
}
export interface AirspaceRouter {
  readonly dataset: AirspaceDataset;
  route(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): LegRoute;
}

const RAD = Math.PI / 180;
const RES = 0.5;
const W = 360 / RES;
const H = 180 / RES;
const N = W * H;
const FT_PER_KM = 3280.84;
const SAMPLE_STEP = 0.15 * RAD;
const DENSIFY_STEP = 1 * RAD;
/**
 * Corners are rounded over about 5% of the route on each side (200–500 km), so bends read as
 * curves at any zoom; gentler bends are left as they are.
 */
const CORNER_SHARE = 0.05;
const CORNER_MIN_KM = 200;
const CORNER_MAX_KM = 500;
const CORNER_MIN_TURN = 0.5 * RAD;
/** Longer detours are treated as failures: the airline would not fly it, or the search went astray. */
const MAX_DETOUR_FACTOR = 2.2;
const MAX_DETOUR_EXTRA_KM = 500;
const CACHE_LIMIT = 256;

export const dayOf = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);

/** Peak flight level of the modelled vertical profile for a leg of this length. */
export function peakFlightLevel(distanceKm: number): number {
  return (altitudeProfile(distanceKm).peakKm * FT_PER_KM) / 100;
}

export interface ApplicabilityContext {
  day: string;
  operator: Operator;
  peakFl: number;
  countries: (string | undefined)[];
}
export function zoneApplies(zone: AirspaceZone, ctx: ApplicabilityContext): boolean {
  if (ctx.day < zone.issued || (zone.validUntil !== null && ctx.day > zone.validUntil)) return false;
  if (ctx.operator === 'other' || !zone.operators.includes(ctx.operator)) return false;
  if (zone.ceilingFl !== null && ctx.peakFl > zone.ceilingFl) return false;
  return !ctx.countries.some((code) => code !== undefined && zone.exemptCountries.includes(code));
}

// ---------------------------------------------------------------------------------------------
// Grid

const sinLat = new Float64Array(H);
const cosLat = new Float64Array(H);
const sinLng = new Float64Array(W);
const cosLng = new Float64Array(W);
for (let r = 0; r < H; r++) {
  const lat = (-90 + (r + 0.5) * RES) * RAD;
  sinLat[r] = Math.sin(lat);
  cosLat[r] = Math.cos(lat);
}
for (let c = 0; c < W; c++) {
  const lng = (-180 + (c + 0.5) * RES) * RAD;
  sinLng[c] = Math.sin(lng);
  cosLng[c] = Math.cos(lng);
}
const rowOf = (lat: number) => Math.min(H - 1, Math.max(0, Math.floor((lat + 90) / RES)));
const colOf = (lng: number) => ((Math.floor((lng + 180) / RES) % W) + W) % W;
const cellOf = (lat: number, lng: number) => rowOf(lat) * W + colOf(lng);
function cellOfVec(v: Vec3): number {
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD;
  return cellOf(lat, Math.atan2(v[1], v[0]) / RAD);
}
const dotCell = (idx: number, v: Vec3) => {
  const r = (idx / W) | 0;
  const c = idx - r * W;
  return cosLat[r] * (cosLng[c] * v[0] + sinLng[c] * v[1]) + sinLat[r] * v[2];
};
const cellVec = (idx: number): Vec3 => {
  const r = (idx / W) | 0;
  const c = idx - r * W;
  return [cosLat[r] * cosLng[c], cosLat[r] * sinLng[c], sinLat[r]];
};

/** Bit z is set where zone z covers any part of the cell. */
function rasterise(zones: AirspaceZone[]): Uint32Array {
  const inside = new Uint32Array(N);
  const xs: number[] = [];
  zones.forEach((zone, z) => {
    const bit = 1 << z;
    for (let r = rowOf(zone.bbox.minLat); r <= rowOf(zone.bbox.maxLat); r++) {
      const y = -90 + (r + 0.5) * RES;
      xs.length = 0;
      for (const ring of zone.rings)
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
          const yi = ring[i + 1],
            yj = ring[j + 1];
          if (yi > y !== yj > y) xs.push(ring[i] + ((y - yi) * (ring[j] - ring[i])) / (yj - yi));
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const first = Math.max(0, Math.ceil((xs[k] + 180) / RES - 0.5));
        const last = Math.min(W - 1, Math.floor((xs[k + 1] + 180) / RES - 0.5));
        for (let c = first; c <= last; c++) inside[r * W + c] |= bit;
      }
    }
    // Cells the outline passes through, so slivers narrower than a cell still block.
    for (const ring of zone.rings)
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const dx = ring[i] - ring[j],
          dy = ring[i + 1] - ring[j + 1];
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (RES / 4)));
        for (let s = 0; s <= steps; s++)
          inside[cellOf(ring[j + 1] + (dy * s) / steps, ring[j] + (dx * s) / steps)] |= bit;
      }
  });
  return inside;
}

// 16 moves: orthogonal, diagonal and knight moves; knight moves cut across fewer cells than two steps.
const MOVES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
];
// Cells a move passes through besides its ends; both must be free (no corner cutting).
const THROUGH: [number, number][][] = MOVES.map(([dr, dc]) =>
  Math.abs(dr) === 1 && Math.abs(dc) === 1
    ? [
        [dr, 0],
        [0, dc],
      ]
    : Math.abs(dc) === 2
      ? [
          [0, dc / 2],
          [dr, dc / 2],
        ]
      : Math.abs(dr) === 2
        ? [
            [dr / 2, 0],
            [dr / 2, dc],
          ]
        : [],
);
let moveCosts: Float64Array | null = null;
function costs(): Float64Array {
  if (moveCosts) return moveCosts;
  moveCosts = new Float64Array(H * MOVES.length).fill(NaN);
  for (let r = 0; r < H; r++)
    MOVES.forEach(([dr, dc], k) => {
      const rr = r + dr;
      if (rr < 0 || rr >= H) return;
      const cos = sinLat[r] * sinLat[rr] + cosLat[r] * cosLat[rr] * Math.cos(dc * RES * RAD);
      moveCosts![r * MOVES.length + k] = Math.acos(Math.max(-1, Math.min(1, cos)));
    });
  return moveCosts;
}
const POLAR_COST = RES * RAD; // across the pole between opposite cells of the first/last row

// ---------------------------------------------------------------------------------------------
// Search

interface Search {
  grid: Uint32Array;
  mask: number;
  to: Vec3;
  start: number;
  goal: number;
}

/** The airports' own cells stay open so flights can leave airports beside a zone. */
const blocked = (s: Search, idx: number) => idx !== s.start && idx !== s.goal && (s.grid[idx] & s.mask) !== 0;

const vecAngle = (a: Vec3, b: Vec3) =>
  Math.atan2(
    Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]),
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  );

/** Calls `visit` with samples along the arc a → b (both ends included); stops when it returns true. */
function sampleArc(a: Vec3, b: Vec3, step: number, visit: (p: Vec3) => boolean): boolean {
  const theta = vecAngle(a, b);
  const n = Math.max(1, Math.ceil(theta / step));
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const w: Vec3 = [b[0] - a[0] * d, b[1] - a[1] * d, b[2] - a[2] * d];
  const wl = Math.hypot(...w);
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i <= n; i++) {
    if (wl < 1e-12) {
      const q = slerpVec(a, b, i / n);
      p[0] = q[0];
      p[1] = q[1];
      p[2] = q[2];
    } else {
      const t = (theta * i) / n;
      const c = Math.cos(t),
        sn = Math.sin(t) / wl;
      p[0] = a[0] * c + w[0] * sn;
      p[1] = a[1] * c + w[1] * sn;
      p[2] = a[2] * c + w[2] * sn;
    }
    if (visit(p)) return true;
  }
  return false;
}

const visible = (s: Search, a: Vec3, b: Vec3) => !sampleArc(a, b, SAMPLE_STEP, (p) => blocked(s, cellOfVec(p)));

const latOf = (p: Vec3) => Math.asin(Math.max(-1, Math.min(1, p[2]))) / RAD;
const lngOf = (p: Vec3) => Math.atan2(p[1], p[0]) / RAD;

/** Bits of the zones (within `mask`) whose outlines contain any sample (≤ 0.1° apart) along the arcs. */
function zonesAlong(zones: AirspaceZone[], grid: Uint32Array, mask: number, points: Vec3[], stopAtFirst = false) {
  let found = 0;
  for (let i = 1; i < points.length; i++) {
    const stop = sampleArc(points[i - 1], points[i], 0.1 * RAD, (p) => {
      // The grid narrows the exact test to zones that touch the sample's cell.
      let bits = grid[cellOfVec(p)] & mask & ~found;
      for (let z = 0; bits; z++, bits >>>= 1)
        if (bits & 1 && zoneContains(zones[z], latOf(p), lngOf(p))) found |= 1 << z;
      return stopAtFirst && found !== 0;
    });
    if (stop) break;
  }
  return found;
}

class MinHeap {
  private nodes: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.nodes.length;
  }
  push(node: number, key: number) {
    const { nodes, keys } = this;
    let i = nodes.length;
    nodes.push(node);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      nodes[i] = nodes[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    nodes[i] = node;
    keys[i] = key;
  }
  pop(): number {
    const { nodes, keys } = this;
    const top = nodes[0];
    const node = nodes.pop()!;
    const key = keys.pop()!;
    if (nodes.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= nodes.length) break;
        const child = l + 1 < nodes.length && keys[l + 1] < keys[l] ? l + 1 : l;
        if (keys[child] >= key) break;
        nodes[i] = nodes[child];
        keys[i] = keys[child];
        i = child;
      }
      nodes[i] = node;
      keys[i] = key;
    }
    return top;
  }
}

interface Buffers {
  g: Float64Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  generation: number;
}

function astar(s: Search, b: Buffers): number[] | null {
  const generation = ++b.generation;
  const { g, parent, seen, closed } = b;
  const cost = costs();
  const heuristic = (idx: number) => Math.acos(Math.max(-1, Math.min(1, dotCell(idx, s.to))));
  const heap = new MinHeap();
  g[s.start] = 0;
  parent[s.start] = -1;
  seen[s.start] = generation;
  heap.push(s.start, heuristic(s.start));
  const relax = (from: number, next: number, step: number) => {
    if (closed[next] === generation || blocked(s, next)) return;
    const candidate = g[from] + step;
    if (seen[next] === generation && candidate >= g[next]) return;
    g[next] = candidate;
    parent[next] = from;
    seen[next] = generation;
    heap.push(next, candidate + heuristic(next));
  };
  while (heap.size) {
    const current = heap.pop();
    if (closed[current] === generation) continue;
    closed[current] = generation;
    if (current === s.goal) {
      const cells: number[] = [];
      for (let at = current; at >= 0; at = parent[at]) cells.push(at);
      return cells.reverse();
    }
    const r = (current / W) | 0;
    const c = current - r * W;
    moves: for (let k = 0; k < MOVES.length; k++) {
      const step = cost[r * MOVES.length + k];
      if (Number.isNaN(step)) continue;
      for (const [tr, tc] of THROUGH[k]) if (blocked(s, (r + tr) * W + ((c + tc + W) % W))) continue moves;
      relax(current, (r + MOVES[k][0]) * W + ((c + MOVES[k][1] + W) % W), step);
    }
    if (r === 0 || r === H - 1) relax(current, r * W + ((c + W / 2) % W), POLAR_COST);
  }
  return null;
}

/** Drops cell centres the route can see past, leaving the corners of an any-angle path. */
function stringPull(s: Search, points: Vec3[]): Vec3[] {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (!visible(s, out[out.length - 1], points[i + 1])) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}

/** Slides each corner towards the straight line between its neighbours while the arcs stay clear. */
function tighten(s: Search, points: Vec3[]): Vec3[] {
  let pts = points.slice();
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let k = 1; k < pts.length - 1; k++) {
      const p = pts[k - 1],
        x = pts[k],
        q = pts[k + 1];
      if (visible(s, p, q)) {
        pts.splice(k--, 1);
        moved = true;
        continue;
      }
      const n: Vec3 = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const nl = Math.hypot(...n);
      if (nl < 1e-12) continue;
      const off = (x[0] * n[0] + x[1] * n[1] + x[2] * n[2]) / (nl * nl);
      const target: Vec3 = [x[0] - n[0] * off, x[1] - n[1] * off, x[2] - n[2] * off];
      const tl = Math.hypot(...target);
      if (tl < 1e-12) continue;
      const projected: Vec3 = [target[0] / tl, target[1] / tl, target[2] / tl];
      let lo = 0,
        hi = 1;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        const y = slerpVec(x, projected, mid);
        if (visible(s, p, y) && visible(s, y, q)) lo = mid;
        else hi = mid;
      }
      if (lo > 0) {
        if (vecAngle(x, projected) * lo > 1e-4) moved = true;
        pts[k] = slerpVec(x, projected, lo);
      }
    }
    if (!moved) break;
  }
  pts = pts.filter((p, i) => i === 0 || vecAngle(p, pts[i - 1]) > 1e-9);
  return pts;
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Direction of travel at `from` along the arc towards `to`. */
const heading = (from: Vec3, to: Vec3): Vec3 => {
  const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  return unit([to[0] - from[0] * d, to[1] - from[1] * d, to[2] - from[2] * d]);
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Change of direction (radians) where the arc p → x meets x → q. */
export function turnAngle(p: Vec3, x: Vec3, q: Vec3): number {
  return vecAngle(unit(cross(p, x)), unit(cross(x, q)));
}

/** Inside the corner: a spherical quadratic Bézier from t1 to t2 with x as its control point. */
function innerCurve(t1: Vec3, x: Vec3, t2: Vec3, segments: number): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    const u = (1 - t) * (1 - t),
      v = 2 * (1 - t) * t,
      w = t * t;
    return unit([u * t1[0] + v * x[0] + w * t2[0], u * t1[1] + v * x[1] + w * t2[1], u * t1[2] + v * x[2] + w * t2[2]]);
  });
}

/** Through the corner: Hermite curves t1 → x → t2, crossing x along the bisector, so they bulge outwards. */
function outerCurve(p: Vec3, t1: Vec3, x: Vec3, t2: Vec3, q: Vec3, segments: number): Vec3[] {
  const bisector = unit(heading(x, q).map((c, i) => c - heading(x, p)[i]) as Vec3);
  const hermite = (a: Vec3, ta: Vec3, b: Vec3, tb: Vec3, n: number, skipFirst: boolean) => {
    const length = vecAngle(a, b);
    const out: Vec3[] = [];
    for (let i = skipFirst ? 1 : 0; i <= n; i++) {
      const t = i / n;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1,
        h10 = t ** 3 - 2 * t ** 2 + t,
        h01 = -2 * t ** 3 + 3 * t ** 2,
        h11 = t ** 3 - t ** 2;
      out.push(unit([0, 1, 2].map((j) => h00 * a[j] + h01 * b[j] + length * (h10 * ta[j] + h11 * tb[j])) as Vec3));
    }
    return out;
  };
  const half = Math.max(2, Math.ceil(segments / 2));
  return [
    ...hermite(t1, heading(t1, x), x, bisector, half, false),
    ...hermite(x, bisector, t2, unit(heading(t2, q)), half, true),
  ];
}

/**
 * Rounds every corner a little so routes bend instead of kinking. Inside the corner (shorter) is
 * tried first, then a curve through the corner that bulges away from the zone it hugs; each is
 * checked against the grid margin, then against the zones' outlines. Only a corner with no clear
 * curve at any size stays sharp.
 */
function roundCorners(s: Search, points: Vec3[], outlinesClear: (points: Vec3[]) => boolean): Vec3[] {
  if (points.length < 3) return points;
  const out: Vec3[] = [points[0]];
  const routeKm = lengthOf(points) * EARTH_RADIUS_KM;
  const corner = Math.min(CORNER_MAX_KM, Math.max(CORNER_MIN_KM, CORNER_SHARE * routeKm)) / EARTH_RADIUS_KM;
  const gridClear = (curve: Vec3[]) => curve.every((point, i) => i === 0 || visible(s, curve[i - 1], point));
  for (let k = 1; k < points.length - 1; k++) {
    const p = points[k - 1],
      x = points[k],
      q = points[k + 1];
    const turn = turnAngle(p, x, q);
    if (!(turn > CORNER_MIN_TURN)) {
      out.push(x);
      continue;
    }
    const a = vecAngle(x, p),
      b = vecAngle(x, q);
    // Dense enough that no step along a curve turns by more than a few degrees.
    const segments = Math.max(8, Math.ceil(turn / RAD));
    // The largest curve that fits wins; tight corridors get smaller ones.
    const sizes = [1, 0.75, 0.56, 0.42, 0.32, 0.24, 0.18, 0.13].map((f) => f * Math.min(corner, 0.4 * a, 0.4 * b));
    let curve: Vec3[] | null = null;
    search: for (const clear of [gridClear, outlinesClear])
      for (const inside of [true, false])
        for (const d of sizes) {
          const t1 = slerpVec(x, p, d / a);
          const t2 = slerpVec(x, q, d / b);
          const candidate = inside ? innerCurve(t1, x, t2, segments) : outerCurve(p, t1, x, t2, q, segments);
          if (clear(candidate)) {
            curve = candidate;
            break search;
          }
        }
    if (curve) out.push(...curve);
    else out.push(x);
  }
  out.push(points[points.length - 1]);
  return out;
}

function densify(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const n = Math.max(1, Math.ceil(vecAngle(points[i - 1], points[i]) / DENSIFY_STEP));
    for (let j = 1; j <= n; j++) out.push(j === n ? points[i] : slerpVec(points[i - 1], points[i], j / n));
  }
  return out;
}

const lengthOf = (points: Vec3[]) => points.reduce((sum, p, i) => (i ? sum + vecAngle(points[i - 1], p) : 0), 0);

// ---------------------------------------------------------------------------------------------
// Router

export function createAirspaceRouter(dataset: AirspaceDataset): AirspaceRouter {
  let grid: Uint32Array | null = null;
  let buffers: Buffers | null = null;
  const cache = new Map<string, LegRoute>();
  const zoneIndex = new Map(dataset.zones.map((zone, i) => [zone.id, i]));
  const idsOf = (bits: number) => dataset.zones.filter((_, i) => bits & (1 << i)).map((zone) => zone.id);
  const placesOf = (ids: string[]) => [...new Set(ids.map((id) => dataset.zones[zoneIndex.get(id)!].place))];
  const result = (
    status: LegRoute['status'],
    path: LatLng[] | null,
    greatCircleKm: number,
    distanceKm: number,
    avoided: string[] = [],
    crossed: string[] = [],
  ): LegRoute => ({
    status,
    path,
    distanceKm,
    greatCircleKm,
    avoided,
    crossed,
    avoidedPlaces: placesOf(avoided),
    crossedPlaces: placesOf(crossed),
  });

  function compute(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): LegRoute {
    const greatCircleKm = greatCircleDistanceKm(from, to);
    if (!(greatCircleKm >= 1)) return result('clear', null, greatCircleKm, greatCircleKm);
    const ctx: ApplicabilityContext = {
      day: dayOf(options.epochMs),
      operator: options.operator ?? 'easa',
      peakFl: peakFlightLevel(greatCircleKm),
      countries: [from.countryCode, to.countryCode],
    };
    const applicable = dataset.zones.map((zone) => zoneApplies(zone, ctx));
    if (!applicable.includes(true)) return result('clear', null, greatCircleKm, greatCircleKm);
    grid ??= rasterise(dataset.zones);
    const g = grid;
    // An airport inside a zone must cross it; simplified coastlines can leave coastal airports just
    // outside their own country's outline, so a touching cell in the same country counts too.
    const holds = (zone: AirspaceZone, bit: number, p: RouteEndpoint) =>
      zoneContains(zone, p.lat, p.lng) || (zone.place === p.countryCode && (g[cellOf(p.lat, p.lng)] & bit) !== 0);
    let mask = 0;
    let endpointMask = 0;
    dataset.zones.forEach((zone, i) => {
      if (!applicable[i]) return;
      if (holds(zone, 1 << i, from) || holds(zone, 1 << i, to)) endpointMask |= 1 << i;
      else mask |= 1 << i;
    });
    const u = toVec3(from),
      v = toVec3(to);
    const endpoint = idsOf(endpointMask);
    const crossing = zonesAlong(dataset.zones, g, mask, [u, v]);
    if (!crossing)
      return result(endpoint.length ? 'partial' : 'clear', null, greatCircleKm, greatCircleKm, [], endpoint);
    const unavoided = () => result('unavoided', null, greatCircleKm, greatCircleKm, [], idsOf(crossing | endpointMask));
    const search: Search = { grid: g, mask, to: v, start: cellOf(from.lat, from.lng), goal: cellOf(to.lat, to.lng) };
    buffers ??= {
      g: new Float64Array(N),
      parent: new Int32Array(N),
      seen: new Uint32Array(N),
      closed: new Uint32Array(N),
      generation: 0,
    };
    const cells = search.start === search.goal ? null : astar(search, buffers);
    if (!cells) return unavoided();
    const corners = tighten(search, stringPull(search, [u, ...cells.slice(1, -1).map(cellVec), v]));
    // Validate against the zones' outlines, not just the grid; fall back to sharp corners first.
    const outlinesClear = (points: Vec3[]) => zonesAlong(dataset.zones, g, mask, points, true) === 0;
    const path = [densify(roundCorners(search, corners, outlinesClear)), densify(corners)].find(
      (points) => zonesAlong(dataset.zones, g, mask, points, true) === 0,
    );
    if (!path) return unavoided();
    const distanceKm = lengthOf(path) * EARTH_RADIUS_KM;
    if (distanceKm > MAX_DETOUR_FACTOR * greatCircleKm + MAX_DETOUR_EXTRA_KM) return unavoided();
    const latLngs = path.map(fromVec3);
    latLngs[0] = { lat: from.lat, lng: from.lng };
    latLngs[latLngs.length - 1] = { lat: to.lat, lng: to.lng };
    return result(
      endpoint.length ? 'partial' : 'detour',
      latLngs,
      greatCircleKm,
      distanceKm,
      idsOf(crossing),
      endpoint,
    );
  }

  return {
    dataset,
    route(from, to, options) {
      const key = [
        from.lat,
        from.lng,
        from.countryCode ?? '',
        to.lat,
        to.lng,
        to.countryCode ?? '',
        dayOf(options.epochMs),
        options.operator ?? 'easa',
      ].join('|');
      let routed = cache.get(key);
      if (!routed) {
        try {
          routed = compute(from, to, options);
        } catch {
          // A routing bug must never break the journey: keep the great circle and say so.
          const km = greatCircleDistanceKm(from, to);
          routed = result('unavoided', null, km, km);
        }
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        cache.set(key, routed);
      }
      return routed;
    },
  };
}
