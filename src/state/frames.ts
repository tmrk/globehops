/** The parts of one animation frame, in the order they run. */
export type FramePhase = 'update' | 'render';
const PHASES: readonly FramePhase[] = ['update', 'render'];

export interface FrameScheduler {
  /**
   * Runs `callback` once, in `phase` of the next animation frame, with that frame's timestamp. Asked for while
   * an earlier phase of the current frame runs (a clock update asking the globe to draw), it runs in this
   * frame instead. Returns an id for `cancel`; ids are never zero.
   */
  request(phase: FramePhase, callback: (time: number) => void): number;
  cancel(id: number): void;
}

/**
 * One animation frame for everything that animates together: simulation time moves first, then the globe
 * draws once with it. Separate `requestAnimationFrame` loops would run in whichever order they were last
 * scheduled, drawing some frames twice (once stale) and sampling time at different moments.
 */
export function createFrameScheduler(
  requestFrame: (run: (time: number) => void) => unknown = (run) => globalThis.requestAnimationFrame(run),
): FrameScheduler {
  const queues = PHASES.map(() => new Map<number, (time: number) => void>());
  let nextId = 0;
  let pending = false;
  /** The phase running now, or -1 between frames. */
  let running = -1;
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestFrame(run);
  };
  const run = (time: number) => {
    pending = false;
    for (running = 0; running < queues.length; running++) {
      const queue = queues[running];
      // Callbacks this phase asks for again wait for the next frame; later phases still run in this one.
      for (const id of [...queue.keys()]) {
        const callback = queue.get(id);
        if (!callback) continue;
        queue.delete(id);
        try {
          callback(time);
        } catch (error) {
          // Like separate animation frames, one failing callback must not stop the others.
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    }
    running = -1;
    if (queues.some((queue) => queue.size > 0)) schedule();
  };
  return {
    request(phase, callback) {
      const id = ++nextId;
      queues[PHASES.indexOf(phase)].set(id, callback);
      // Inside a frame, whatever this frame cannot run is scheduled when it ends.
      if (running === -1) schedule();
      return id;
    },
    cancel(id) {
      for (const queue of queues) queue.delete(id);
    },
  };
}

let shared: FrameScheduler | null = null;
/** The app's frame loop, shared by the simulation clock and the globe. */
export function appFrames(): FrameScheduler {
  return (shared ??= createFrameScheduler());
}
