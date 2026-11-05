/**
 * Ranking hint: the primary airport of major multi-airport cities.
 *
 * OurAirports has no traffic figures, so several airports in the same city can otherwise tie
 * (all "large", all with scheduled service). Each entry here is the busiest airport of its city
 * by annual passenger numbers in widely published airport statistics. The hint only nudges the
 * order of suggestions — every other airport stays fully searchable. Keep this list short.
 */
export const PRIMARY_AIRPORTS: ReadonlySet<string> = new Set([
  'LHR', // London
  'CDG', // Paris
  'JFK', // New York
  'HND', // Tokyo
  'SVO', // Moscow
  'MXP', // Milan
  'FCO', // Rome
  'ARN', // Stockholm
  'ORD', // Chicago
  'IAH', // Houston
  'GRU', // São Paulo
  'GIG', // Rio de Janeiro
  'ICN', // Seoul
  'PVG', // Shanghai
  'PEK', // Beijing
  'BKK', // Bangkok
  'KIX', // Osaka
  'IST', // Istanbul
  'DXB', // Dubai
  'CGK', // Jakarta
  'YYZ', // Toronto
  'YUL', // Montréal
  'TPE', // Taipei
  'KUL', // Kuala Lumpur
  'SYD', // Sydney
  'MEL', // Melbourne
  'BRU', // Brussels
  'VCE', // Venice
]);

export const PRIMARY_AIRPORT_BOOST = 70;
