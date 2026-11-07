import type { LatLng } from '../types.ts';
import { normalizeLng, type Vec3 } from './geo.ts';

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

/** IAU mean radius. */
export const MOON_RADIUS_KM = 1737.4;

export interface MoonState {
  /** Ground point beneath the Moon's centre. */
  sublunar: LatLng;
  /** Centre to centre; sets the Moon's apparent size and its parallax as the camera moves. */
  distanceKm: number;
  /** Earth-fixed unit vectors (geo.ts axes) of the Moon's north pole and prime meridian. */
  pole: Vec3;
  primeMeridian: Vec3;
}

/**
 * The leading periodic terms of Meeus, Astronomical Algorithms, tables 47.A and 47.B: multiples of the
 * mean elongation D, the Sun's and Moon's mean anomalies M and M′, and the argument of latitude F,
 * with longitude (10⁻⁶ °) and distance (m) coefficients, then latitude (10⁻⁶ °) coefficients.
 */
type Multiples = readonly [d: number, m: number, mm: number, f: number];
const LONGITUDE_AND_DISTANCE: readonly (readonly [...Multiples, longitude: number, distance: number])[] = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
];
const LATITUDE: readonly (readonly [...Multiples, latitude: number])[] = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
];

/** The lunar equator's inclination to the ecliptic (Meeus ch. 53). */
const EQUATOR_INCLINATION = 1.54242;
/** TT − UT near 2025: the lunar theory runs on Terrestrial Time, Earth's rotation on UT. */
const DELTA_T_DAYS = 69 / 86_400;
const spherical = (lng: number, lat: number): Vec3 => [cos(lat) * cos(lng), cos(lat) * sin(lng), sin(lat)];

/**
 * The geocentric Moon from the leading terms of Meeus, Astronomical Algorithms, ch. 47 (ELP-2000/82),
 * within 0.04° of astronomy-engine across 1900–2100 (0.02° today) and 50 km in distance. Ecliptic
 * coordinates of date become Earth-fixed through the mean obliquity and Greenwich mean sidereal time
 * (Meeus 12.4). Orientation follows Cassini's laws (Meeus ch. 53) in the same frame, so the near side
 * rocks with the optical libration; the Moon's own small physical libration is left out.
 */
export function moonAt(epochMs: number): MoonState {
  const days = epochMs / DAY_MS + 2440587.5 - 2451545;
  const t = (days + DELTA_T_DAYS) / 36525;
  const L = 218.3164477 + 481267.88123421 * t - 0.0015786 * t * t;
  const D = 297.8501921 + 445267.1114034 * t - 0.0018819 * t * t;
  const M = 357.5291092 + 35999.0502909 * t - 0.0001536 * t * t;
  const Mm = 134.9633964 + 477198.8675055 * t + 0.0087414 * t * t;
  const F = 93.272095 + 483202.0175233 * t - 0.0036539 * t * t;
  // Terms involving the Sun's anomaly shrink with Earth's decreasing orbital eccentricity.
  const E = 1 - 0.002516 * t - 0.0000074 * t * t;
  const argument = ([d, m, mm, f]: readonly number[]) => d * D + m * M + mm * Mm + f * F;
  const A1 = 119.75 + 131.849 * t;
  let longitude = 3958 * sin(A1) + 1962 * sin(L - F) + 318 * sin(53.09 + 479264.29 * t);
  let distance = 0;
  for (const term of LONGITUDE_AND_DISTANCE) {
    const e = E ** Math.abs(term[1]);
    longitude += term[4] * e * sin(argument(term));
    distance += term[5] * e * cos(argument(term));
  }
  let latitude =
    -2235 * sin(L) +
    382 * sin(313.45 + 481266.484 * t) +
    175 * (sin(A1 - F) + sin(A1 + F)) +
    127 * sin(L - Mm) -
    115 * sin(L + Mm);
  for (const term of LATITUDE) latitude += term[4] * E ** Math.abs(term[1]) * sin(argument(term));

  const obliquity = 23.4392911 - 0.0130042 * t;
  const gmst = 280.46061837 + 360.98564736629 * days + 0.000387933 * t * t;
  const earthFixed = ([x, y, z]: Vec3): Vec3 => {
    const north = y * sin(obliquity) + z * cos(obliquity);
    const east = y * cos(obliquity) - z * sin(obliquity);
    return [x * cos(gmst) + east * sin(gmst), east * cos(gmst) - x * sin(gmst), north];
  };
  const [x, y, z] = earthFixed(spherical(L + longitude / 1e6, latitude / 1e6));

  // The equator's ascending node lies on the orbit's descending node, Ω + 180°, and the prime meridian
  // (which faces Earth on average) is the mean argument of latitude F beyond it.
  const node = L - F;
  const tilt = EQUATOR_INCLINATION;
  const ascending: Vec3 = [-cos(node), -sin(node), 0];
  const ahead: Vec3 = [cos(tilt) * sin(node), -cos(tilt) * cos(node), sin(tilt)];
  return {
    sublunar: { lat: Math.asin(z) / RAD, lng: normalizeLng(Math.atan2(y, x) / RAD) },
    distanceKm: 385000.56 + distance / 1000,
    pole: earthFixed([-sin(tilt) * sin(node), sin(tilt) * cos(node), cos(tilt)]),
    primeMeridian: earthFixed([0, 1, 2].map((i) => ascending[i] * cos(F) + ahead[i] * sin(F)) as Vec3),
  };
}
