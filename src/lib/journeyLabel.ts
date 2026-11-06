export const MAX_LABEL_LENGTH = 40;

/** Reject controls before trimming, so a label cannot hide a tab or newline at its ends. */
export function normalizeJourneyLabel(value: string): string | null {
  if (/\p{Cc}/u.test(value)) return null;
  const label = value.trim();
  return label && Array.from(label).length <= MAX_LABEL_LENGTH ? label : null;
}
