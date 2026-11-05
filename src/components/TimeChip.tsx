import { useCallback, useSyncExternalStore } from 'react';
import type { SimulationClock } from '../state/clock.ts';
import { browserTimeZone, formatClock, zoneAbbreviation } from '../lib/timezone.ts';
import { IconClock } from './Icons.tsx';
export function TimeChip({ clock, onOpen }: { clock: SimulationClock; onOpen: () => void }) {
  const snapshot = useCallback(() => Math.floor(clock.getSnapshot().time / 60000) * 60000, [clock]);
  const time = useSyncExternalStore(clock.subscribe, snapshot);
  const zone = browserTimeZone();
  const label = formatClock(time, zone);
  return (
    <button
      type="button"
      className="time-chip"
      onClick={onOpen}
      aria-label={`Globe time: now, ${label} ${zoneAbbreviation(zone, time)}. Open timeline`}
    >
      <IconClock size={15} />
      Now {label}
    </button>
  );
}
