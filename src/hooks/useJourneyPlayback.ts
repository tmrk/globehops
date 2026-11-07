import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { SimulationClock, TRACKING_TICK_MS } from '../state/clock.ts';
import type { LinkState, LinkView } from '../state/link.ts';
import { PLAYBACK_LEAD_MS, playInRange } from '../state/playbackRange.ts';
import { DESKTOP_MEDIA_QUERY } from './appMedia.ts';

export function useJourneyPlayback(reducedMotion: boolean, setCollapsed: Dispatch<SetStateAction<boolean>>) {
  const [clock] = useState(() => new SimulationClock());
  const mountedClock = useRef(false);
  useEffect(() => {
    mountedClock.current = true;
    clock.goLive();
    return () => {
      mountedClock.current = false;
      // StrictMode immediately sets up again with the same clock after its cleanup probe.
      queueMicrotask(() => {
        if (!mountedClock.current) clock.dispose();
      });
    };
  }, [clock]);
  const [timeOpen, setTimeOpen] = useState(false);
  const [assumedStart, setAssumedStart] = useState<number | null>(null);
  const [linkedTime, setLinkedTime] = useState<number | null>(null);
  const [pausedTime, setPausedTime] = useState<number | null>(null);
  const [speed, setSpeed] = useState(clock.getSnapshot().speed);
  const pendingViewRef = useRef<LinkView | null>(null);
  const pendingExplicitPlayRef = useRef(false);
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);
  const applyView = useCallback(
    (link: LinkState) => {
      const open = !!(
        link.view.time !== null ||
        link.view.play ||
        link.view.live ||
        [...(link.stops ?? []), ...(link.compare ?? []).flatMap((entry) => entry.stops)].some(
          (s) => s.arrival || s.departure,
        )
      );
      setTimeOpen(open);
      if (
        (link.view.play || link.view.live) &&
        !reducedMotionRef.current &&
        !window.matchMedia(DESKTOP_MEDIA_QUERY).matches
      )
        setCollapsed(true);
      setAssumedStart(open ? (link.view.time ?? Date.now()) : null);
      setPausedTime(link.view.time);
      setLinkedTime(link.view.time);
      clock.pause();
      clock.setSpeed(link.view.speed);
      clock.setRange(null, null);
      pendingViewRef.current = open ? link.view : null;
      pendingExplicitPlayRef.current = false;
      if (!open) clock.goLive();
    },
    [clock, setCollapsed],
  );
  // Debounce paused scrubs. Playback frames never cause App state updates or URL writes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      const snapshot = clock.getSnapshot();
      if (snapshot.speed !== speed) setSpeed(snapshot.speed);
      if (snapshot.playing || snapshot.live || !timeOpen) return;
      timer = setTimeout(() => setPausedTime(clock.getSnapshot().time), 450);
    };
    update();
    const unsubscribe = clock.subscribe(update);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [clock, timeOpen, speed]);

  const openTime = () => {
    setAssumedStart(Date.now());
    setTimeOpen(true);
  };
  const closeTime = () => {
    setTimeOpen(false);
    setPausedTime(null);
    setLinkedTime(null);
    clock.setRange(null, null);
    clock.goLive();
  };
  /** Show the journey as it is now and keep following the wall clock, every second. */
  const goLive = () => {
    setPausedTime(null);
    clock.goLive(TRACKING_TICK_MS);
  };
  const requestPlayback = (view: LinkView) => {
    pendingExplicitPlayRef.current = true;
    pendingViewRef.current = view;
  };
  return {
    requestPlayback,
    clock,
    timeOpen,
    assumedStart,
    linkedTime,
    pausedTime,
    speed,
    pendingViewRef,
    pendingExplicitPlayRef,
    reducedMotionRef,
    setTimeOpen,
    setAssumedStart,
    setLinkedTime,
    setPausedTime,
    applyView,
    openTime,
    closeTime,
    goLive,
  };
}

export function usePlaybackRange(
  playback: ReturnType<typeof useJourneyPlayback>,
  playbackRange: { start: number; end: number } | null,
  zonesLoaded: boolean,
  scheduleErrors: boolean,
) {
  const { clock, timeOpen, linkedTime, pendingViewRef, pendingExplicitPlayRef, reducedMotionRef } = playback;
  // The ambient live globe gives way to the journey's start once, when the timeline opens; live time
  // chosen inside the timeline keeps following the wall clock through later edits.
  const settled = useRef(false);
  useEffect(() => {
    if (!timeOpen) settled.current = false;
    if (!timeOpen || !zonesLoaded) return;
    if (!playbackRange || scheduleErrors) clock.pause();
    clock.setRange(
      playbackRange ? Math.min(playbackRange.start - PLAYBACK_LEAD_MS, linkedTime ?? Infinity) : null,
      playbackRange ? Math.max(playbackRange.end, linkedTime ?? -Infinity) : null,
    );
    const view = pendingViewRef.current;
    if (view?.live) {
      pendingViewRef.current = null;
      clock.goLive(TRACKING_TICK_MS);
    } else if (view) {
      pendingViewRef.current = null;
      clock.seek(view.time ?? playbackRange?.start ?? Date.now());
      const shouldPlay = view.play && (pendingExplicitPlayRef.current || !reducedMotionRef.current);
      pendingExplicitPlayRef.current = false;
      if (shouldPlay && playbackRange && !scheduleErrors) {
        playInRange(clock, playbackRange, linkedTime);
      }
    } else if (!settled.current && clock.getSnapshot().live) clock.seek(playbackRange?.start ?? Date.now());
    settled.current = true;
  }, [
    clock,
    playbackRange,
    timeOpen,
    zonesLoaded,
    linkedTime,
    scheduleErrors,
    pendingViewRef,
    pendingExplicitPlayRef,
    reducedMotionRef,
  ]);
}
