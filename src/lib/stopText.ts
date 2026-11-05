/** Wording for stop positions in the itinerary. */
export function stopCaption(index: number, count: number): string {
  if (index === 0) return 'From';
  if (index === count - 1) return 'To';
  return 'Via';
}

export function stopPlaceholder(index: number, count: number): string {
  if (index === 0) return 'Where from?';
  if (index === count - 1) return 'Where to?';
  return 'Add a stop';
}

export function stopLabel(index: number, count: number): string {
  if (index === 0) return 'Departure airport';
  if (index === count - 1) return 'Destination airport';
  return `Stop ${index}`;
}
