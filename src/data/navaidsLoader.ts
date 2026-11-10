import type { NavaidDataset } from './navaids.ts';

// Load once, only when a flight plan names radio aids; a failure leaves them unresolved.
let navaids: Promise<NavaidDataset | null> | null = null;
export const loadNavaids = () =>
  (navaids ??= Promise.all([import('./navaids.ts'), import('./generated/navaids.json?url')])
    .then(([{ loadNavaids: load }, { default: url }]) => load(url))
    .catch(() => null));
