import { describe, expect, it, vi } from 'vitest';
import { createFrameScheduler } from './frames.ts';

function manualFrames() {
  const pending: ((time: number) => void)[] = [];
  const requestFrame = vi.fn((run: (time: number) => void) => pending.push(run));
  const step = (time: number) => pending.splice(0).forEach((run) => run(time));
  return { scheduler: createFrameScheduler(requestFrame), requestFrame, step };
}

describe('frame scheduler', () => {
  it('runs updates before rendering, in one browser frame with one timestamp', () => {
    const { scheduler, requestFrame, step } = manualFrames();
    const calls: string[] = [];
    scheduler.request('render', (time) => calls.push(`render ${time}`));
    scheduler.request('update', (time) => calls.push(`update ${time}`));
    expect(requestFrame).toHaveBeenCalledOnce();
    step(16);
    expect(calls).toEqual(['update 16', 'render 16']);
  });

  it('draws in the same frame when an update asks for it, and only once', () => {
    const { scheduler, requestFrame, step } = manualFrames();
    const render = vi.fn();
    let renderId = 0;
    const requestRender = () => {
      if (!renderId) renderId = scheduler.request('render', () => ((renderId = 0), render()));
    };
    // The globe kept itself animating last frame, then the clock moves time and asks again.
    requestRender();
    scheduler.request('update', requestRender);
    step(16);
    expect(render).toHaveBeenCalledOnce();
    scheduler.request('update', requestRender);
    step(32);
    expect(render).toHaveBeenCalledTimes(2);
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it('defers a phase that asks for itself, and earlier phases, to the next frame', () => {
    const { scheduler, requestFrame, step } = manualFrames();
    const times: number[] = [];
    const loop = (time: number) => {
      times.push(time);
      if (times.length < 3) scheduler.request('render', loop);
    };
    scheduler.request('render', loop);
    step(1);
    step(2);
    step(3);
    expect(times).toEqual([1, 2, 3]);
    const update = vi.fn();
    scheduler.request('render', () => scheduler.request('update', update));
    step(4);
    expect(update).not.toHaveBeenCalled();
    step(5);
    expect(update).toHaveBeenCalledWith(5);
    expect(requestFrame).toHaveBeenCalledTimes(5);
  });

  it('cancels callbacks, including later ones in the frame that is running', () => {
    const { scheduler, step } = manualFrames();
    const render = vi.fn();
    const id = scheduler.request('render', render);
    scheduler.request('update', () => scheduler.cancel(id));
    step(1);
    expect(render).not.toHaveBeenCalled();
    expect(id).toBeGreaterThan(0);
  });

  it('keeps running the frame when one callback throws, then reports the error', async () => {
    const { scheduler, step } = manualFrames();
    const render = vi.fn();
    const failure = new Error('boom');
    const reported = new Promise((resolve) => {
      const original = globalThis.queueMicrotask;
      vi.stubGlobal('queueMicrotask', (callback: () => void) =>
        original(() => {
          try {
            callback();
          } catch (error) {
            resolve(error);
          }
        }),
      );
    });
    scheduler.request('update', () => {
      throw failure;
    });
    scheduler.request('render', render);
    step(1);
    expect(render).toHaveBeenCalledOnce();
    await expect(reported).resolves.toBe(failure);
    vi.unstubAllGlobals();
  });
});
