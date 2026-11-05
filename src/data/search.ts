import type { Airport } from '../types.ts';
import { normalizeText } from '../lib/normalize.ts';
import { PRIMARY_AIRPORT_BOOST, PRIMARY_AIRPORTS } from './rankHints.ts';
interface Entry {
  airport: Airport;
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  keywords: string[];
  tokens: string[];
  boost: number;
}
export interface SearchIndex {
  entries: Entry[];
  /** Prefix postings keep keystroke searches away from a full dataset scan. */
  prefixes: Map<string, number[]>;
  iata: Map<string, Airport>;
  icao: Map<string, Airport>;
  ident: Map<string, Airport>;
  ids: Map<number, Airport>;
}
export function buildSearchIndex(airports: Airport[]): SearchIndex {
  const index: SearchIndex = {
    entries: [],
    prefixes: new Map(),
    iata: new Map(),
    icao: new Map(),
    ident: new Map(),
    ids: new Map(),
  };
  for (const airport of airports) {
    const iata = normalizeText(airport.iata ?? ''),
      icao = normalizeText(airport.icao ?? '');
    const name = normalizeText(airport.name),
      city = normalizeText(airport.city.split(/[,(]/)[0]),
      country = normalizeText(airport.country);
    const keywords = airport.keywords.map(normalizeText);
    const tokens = [
      ...new Set(
        [iata, icao, name, city, normalizeText(airport.region), country, ...keywords]
          .join(' ')
          .split(' ')
          .filter(Boolean),
      ),
    ];
    const boost =
      (airport.scheduled ? 120 : 0) +
      (airport.type === 'large'
        ? 150
        : airport.type === 'medium'
          ? 50
          : ['heliport', 'seaplane'].includes(airport.type)
            ? -220
            : 0) +
      (airport.iata ? 30 : 0) +
      (airport.iata && PRIMARY_AIRPORTS.has(airport.iata) ? PRIMARY_AIRPORT_BOOST : 0);
    const row = index.entries.length;
    index.entries.push({ airport, iata, icao, name, city, country, keywords, tokens, boost });
    const prefixes = new Set<string>();
    for (const token of tokens) for (let i = 1; i <= token.length; i++) prefixes.add(token.slice(0, i));
    for (const prefix of prefixes) {
      const list = index.prefixes.get(prefix);
      if (list) list.push(row);
      else index.prefixes.set(prefix, [row]);
    }
    if (airport.iata) index.iata.set(airport.iata.toUpperCase(), airport);
    if (airport.icao) index.icao.set(airport.icao.toUpperCase(), airport);
    index.ident.set(airport.ident.toUpperCase(), airport);
    index.ids.set(airport.id, airport);
  }
  return index;
}
/**
 * Ranking = how well the query matches (match quality) + how useful the airport usually is
 * (importance: scheduled service, size, primary-hub hint). Importance is large enough that a
 * major hub whose city starts with the query ("tok" → Tokyo) beats an obscure airfield whose
 * IATA code happens to equal it (TOK), while an exact code match on any airport with
 * scheduled service still comes first ("lhr", "cph", "dub").
 */
const MATCH = {
  exactIcao: 650,
  exactIata: 600,
  cityExact: 540,
  cityPrefix: 450,
  namePrefix: 450,
  keywordExact: 380,
  tokenPrefix: 330,
  keywordPrefix: 300,
  country: 120,
} as const;

function matchQuality(e: Entry, q: string, tokens: string[]): number {
  if (e.icao === q) return MATCH.exactIcao;
  if (e.iata === q) return MATCH.exactIata;
  if (e.city === q) return MATCH.cityExact;
  if (e.city.startsWith(q)) return MATCH.cityPrefix;
  if (e.name.startsWith(q)) return MATCH.namePrefix;
  if (e.keywords.includes(q)) return MATCH.keywordExact;
  // All tokens matched somewhere in the airport's own name/city/codes?
  const own = [e.iata, e.icao, ...e.name.split(' '), ...e.city.split(' ')];
  if (tokens.every((t) => own.some((w) => w.startsWith(t)))) return MATCH.tokenPrefix;
  if (e.keywords.some((k) => k.startsWith(q))) return MATCH.keywordPrefix;
  return MATCH.country;
}

export function searchAirports(index: SearchIndex, query: string, limit = 8): Airport[] {
  const q = normalizeText(query);
  if (!q || !Number.isFinite(limit) || limit <= 0) return [];
  const tokens = q.split(' ');
  // Use the shortest posting list among the query tokens as the candidate set.
  let candidates: number[] | undefined;
  for (const token of tokens) {
    const list = index.prefixes.get(token);
    if (!list) return [];
    if (!candidates || list.length < candidates.length) candidates = list;
  }
  const ranked: { entry: Entry; score: number }[] = [];
  for (const row of candidates!) {
    const e = index.entries[row];
    if (!tokens.every((t) => e.tokens.some((word) => word.startsWith(t)))) continue;
    ranked.push({ entry: e, score: matchQuality(e, q, tokens) + e.boost });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.airport.name.localeCompare(b.entry.airport.name, 'en') ||
      a.entry.airport.id - b.entry.airport.id,
  );
  return ranked.slice(0, Math.floor(limit)).map((r) => r.entry.airport);
}

export function findAirportByCode(index: SearchIndex, code: string): Airport | null {
  const c = code.trim().toUpperCase();
  if (/^\d+$/.test(c)) return index.ids.get(Number(c)) ?? null;
  if (/^[A-Z]{3}$/.test(c)) return index.iata.get(c) ?? null;
  if (/^[A-Z]{4}$/.test(c)) return index.icao.get(c) ?? index.ident.get(c) ?? null;
  return index.ident.get(c) ?? null;
}
