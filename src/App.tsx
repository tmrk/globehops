import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AboutDialog, type AboutDialogHandle } from './components/AboutDialog.tsx';
import { AirportPicker, type AirportPickerHandle } from './components/AirportPicker.tsx';
import { Brand } from './components/Brand.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { GlobeHud } from './components/GlobeHud.tsx';
import { IconChevronUp, IconInfo, IconShare, IconSwap } from './components/Icons.tsx';
import { StopList } from './components/StopList.tsx';
import { Summary } from './components/Summary.tsx';
import { Toast } from './components/Toast.tsx';
import { useToast } from './hooks/useToast.ts';
import { stopCaption, stopLabel, stopPlaceholder } from './lib/stopText.ts';
import airportsUrl from './data/generated/airports.json?url';
import {
  airportCode,
  displayCity,
  displayCode,
  loadAirports,
  shortName,
  type AirportDataset,
} from './data/airports.ts';
import { buildSearchIndex, type SearchIndex } from './data/search.ts';
import type { GlobeRoute, Insets } from './globe/GlobeRenderer.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useVisualViewportVars } from './hooks/useVisualViewport.ts';
import { formatDuration, sumDurations } from './lib/flightTime.ts';
import { legColor } from './lib/legColors.ts';
import { formatDistance } from './lib/units.ts';
import { computeLegs, createRouteState, routeReducer } from './state/route.ts';
import { loadLastRoute, loadUnit, saveLastRoute, saveUnit } from './state/storage.ts';
import { buildShareUrl, parseRouteParam, resolveRouteCodes } from './state/url.ts';
import type { Airport, DistanceUnit, Leg } from './types.ts';

const GlobeView = lazy(() => import('./globe/GlobeView.tsx'));

const EXAMPLE_ROUTE = ['CPH', 'LHR', 'JFK'];
const SUGGESTED_ROUTES: { label: string; codes: string[] }[] = [
  { label: 'Copenhagen → Toronto', codes: ['CPH', 'YYZ'] },
  { label: 'Sydney → Los Angeles', codes: ['SYD', 'LAX'] },
  { label: 'London → Dubai → Singapore → Sydney', codes: ['LHR', 'DXB', 'SIN', 'SYD'] },
  { label: 'Malmö → Stockholm → Helsinki → Tokyo', codes: ['MMX', 'ARN', 'HEL', 'NRT'] },
];
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

function defaultUnit(): DistanceUnit {
  const lang = navigator.language || '';
  return /-(US|LR|MM)$/i.test(lang) ? 'mi' : 'km';
}

function describeRoute(legs: Leg[], unit: DistanceUnit): string {
  if (!legs.length) return 'No route yet.';
  const names = [legs[0].from, ...legs.map((l) => l.to)].map(displayCity);
  const total = legs.reduce((s, l) => s + l.distanceKm, 0);
  const minutes = sumDurations(legs.map((l) => l.durationMin));
  return `Route ${names.join(' to ')}. ${legs.length} flight${legs.length > 1 ? 's' : ''}, ${formatDistance(total, unit)}${
    minutes ? `, estimated flight time ${formatDuration(minutes)}` : ''
  }.`;
}

export default function App() {
  // Side panel on wide screens and landscape tablets; bottom sheet on phones and portrait tablets.
  const isDesktop = useMediaQuery('(min-width: 1000px), (min-width: 760px) and (orientation: landscape)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  useVisualViewportVars();

  const [dataset, setDataset] = useState<AirportDataset | null>(null);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [dataError, setDataError] = useState(false);
  const [route, dispatch] = useReducer(routeReducer, undefined, () => createRouteState());
  const [unit, setUnit] = useState<DistanceUnit>(() => loadUnit() ?? defaultUnit());
  const [isExample, setIsExample] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [fits, setFits] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const [globeReady, setGlobeReady] = useState(false);
  const [globeFailed, setGlobeFailed] = useState(false);
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  const { toast, showToast } = useToast();

  const panelRef = useRef<HTMLElement>(null);
  const takeoverRef = useRef<AirportPickerHandle>(null);
  const aboutRef = useRef<AboutDialogHandle>(null);
  const indexRef = useRef<SearchIndex | null>(null);

  const lookup = useCallback((id: number) => dataset?.byId.get(id), [dataset]);

  /** Loads codes into the route, reporting unknown codes. */
  const loadCodes = useCallback(
    (codes: string[], idx: SearchIndex, opts: { example?: boolean } = {}) => {
      const { airports, missing } = resolveRouteCodes(codes, idx);
      dispatch({ type: 'load', airportIds: airports.map((a) => a.id) });
      setIsExample(!!opts.example);
      if (missing.length) {
        showToast(
          missing.length === 1
            ? `Couldn’t find an airport with code “${missing[0]}”`
            : `Couldn’t find airports: ${missing.join(', ')}`,
        );
      }
    },
    [showToast],
  );

  // ---- Load the airport dataset, then initialise the route (URL > remembered > example) ----
  useEffect(() => {
    const ctrl = new AbortController();
    loadAirports(airportsUrl, ctrl.signal)
      .then((data) => {
        const idx = buildSearchIndex(data.airports);
        indexRef.current = idx;
        setDataset(data);
        setIndex(idx);
        const fromUrl = parseRouteParam(window.location.search);
        if (fromUrl !== null) loadCodes(fromUrl, idx);
        else {
          const saved = loadLastRoute();
          if (saved)
            loadCodes(saved, idx); // includes an explicitly cleared (empty) route
          else loadCodes(EXAMPLE_ROUTE, idx, { example: true });
        }
        setInitialized(true);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        console.error(err);
        setDataError(true);
      });
    return () => ctrl.abort();
  }, [loadCodes]);

  // The mobile search takeover gets its own history entry so the Android/browser back
  // button closes it instead of leaving the site.
  const pickerEntry = useRef(false);
  const ignoreNextPop = useRef(false);
  const shareUrlRef = useRef('');
  const closeEditorRef = useRef<() => void>(() => {});

  // Back/forward navigation between shared links.
  useEffect(() => {
    const onPop = () => {
      if (ignoreNextPop.current) {
        // We stepped back over the picker entry ourselves; keep the current route in the URL.
        ignoreNextPop.current = false;
        window.history.replaceState(null, '', shareUrlRef.current);
        return;
      }
      if (pickerEntry.current) {
        pickerEntry.current = false;
        closeEditorRef.current();
        window.history.replaceState(null, '', shareUrlRef.current);
        return;
      }
      const idx = indexRef.current;
      const codes = parseRouteParam(window.location.search);
      if (idx && codes) loadCodes(codes, idx);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [loadCodes]);

  const legs = useMemo(() => (dataset ? computeLegs(route.stops, lookup) : []), [route.stops, dataset, lookup]);
  const filledAirports = useMemo(
    () =>
      route.stops.map((s) => (s.airportId !== null ? lookup(s.airportId) : undefined)).filter((a): a is Airport => !!a),
    [route.stops, lookup],
  );

  // ---- Persist route to URL + local storage ----
  const shareUrl = useMemo(
    () => buildShareUrl(window.location.origin + window.location.pathname, filledAirports),
    [filledAirports],
  );
  useEffect(() => {
    shareUrlRef.current = shareUrl;
    if (!initialized) return;
    if (shareUrl !== window.location.href) window.history.replaceState(window.history.state, '', shareUrl);
    saveLastRoute(filledAirports.map(airportCode));
    document.title = filledAirports.length
      ? `${filledAirports.map(airportCode).join(' → ')} · GlobeHops`
      : 'GlobeHops — your journey on a 3D globe';
  }, [shareUrl, filledAirports, initialized]);

  // ---- Globe data ----
  const globeRoute = useMemo<GlobeRoute>(() => {
    const markers: GlobeRoute['markers'] = [];
    const seen = new Map<number, number>();
    filledAirports.forEach((a, i) => {
      const role =
        filledAirports.length === 1
          ? 'single'
          : i === 0
            ? 'origin'
            : i === filledAirports.length - 1
              ? 'destination'
              : 'transfer';
      const existing = seen.get(a.id);
      if (existing !== undefined) {
        // Round trips: keep one marker; origin wins over destination.
        if (markers[existing].role === 'transfer') markers[existing].role = role;
        return;
      }
      seen.set(a.id, markers.length);
      markers.push({ key: String(a.id), code: displayCode(a) ?? shortName(a), lat: a.lat, lng: a.lng, role });
    });
    const counts = new Map<string, number>();
    const globeLegs = legs.map((l, i) => {
      const base = `${l.from.id}>${l.to.id}`;
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      return { key: `${base}#${n}`, from: l.from, to: l.to, color: legColor(i) };
    });
    return { markers, legs: globeLegs };
  }, [filledAirports, legs]);

  // ---- Layout insets: tell the globe which parts of the screen are covered by UI ----
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      const r = panel.getBoundingClientRect();
      const next: Insets = isDesktop
        ? { top: 0, right: 0, bottom: 0, left: Math.round(r.right) }
        : { top: 56, right: 0, bottom: Math.max(0, Math.round(window.innerHeight - r.top)), left: 0 };
      setInsets((prev) =>
        Math.abs(prev.left - next.left) < 2 && Math.abs(prev.bottom - next.bottom) < 2 && prev.top === next.top
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isDesktop]);

  // ---- Editing ----
  const focusTakeover = () => {
    if (isDesktop) return;
    if (!pickerEntry.current) {
      pickerEntry.current = true;
      window.history.pushState({ globehopsPicker: true }, '', window.location.href);
    }
    takeoverRef.current?.reset();
    // Focus synchronously inside the user gesture so iOS raises the keyboard.
    takeoverRef.current?.focus();
  };

  const openEditor = (i: number) => {
    flushSync(() => setEditing(i));
    focusTakeover();
  };

  const addStop = (at?: number) => {
    const target = at ?? route.stops.length;
    flushSync(() => {
      dispatch(at === undefined ? { type: 'addStop' } : { type: 'insertStop', index: at });
      setEditing(target);
    });
    focusTakeover();
  };

  const focusStopButton = (i: number) => {
    requestAnimationFrame(() => {
      const btn = panelRef.current?.querySelectorAll<HTMLButtonElement>('.stop__main')[i];
      btn?.focus({ preventScroll: false });
    });
  };

  const releasePickerEntry = () => {
    if (!pickerEntry.current) return;
    pickerEntry.current = false;
    ignoreNextPop.current = true;
    window.history.back();
  };

  const closeEditor = (opts: { cancelled: boolean }) => {
    const i = editing;
    setEditing(null);
    releasePickerEntry();
    if (i === null) return;
    // Cancelling a freshly added, still-empty intermediate stop removes it again.
    if (opts.cancelled && route.stops[i]?.airportId === null && route.stops.length > 2) {
      dispatch({ type: 'removeStop', index: i });
      return;
    }
    if (isDesktop) focusStopButton(i);
  };

  const onSelectAirport = (a: Airport) => {
    if (editing === null) return;
    const i = editing;
    dispatch({ type: 'setAirport', index: i, airportId: a.id });
    setIsExample(false);
    // Continue to the next empty stop (e.g. From → To) without closing the keyboard.
    const stops = route.stops.map((s, k) => (k === i ? { ...s, airportId: a.id } : s));
    let next = stops.findIndex((s, k) => k > i && s.airportId === null);
    if (next === -1) next = stops.findIndex((s) => s.airportId === null);
    if (next !== -1) {
      setEditing(next);
      takeoverRef.current?.reset();
    } else {
      setEditing(null);
      releasePickerEntry();
      if (isDesktop) focusStopButton(i);
    }
  };

  const changeUnit = (u: DistanceUnit) => {
    setUnit(u);
    saveUnit(u);
  };

  const share = async () => {
    const url = shareUrl;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const title = filledAirports.map(airportCode).join(' → ');
    if (coarse && navigator.share) {
      try {
        await navigator.share({ title: `${title} · GlobeHops`, url });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied');
    } catch {
      showToast('Copy this link', url);
    }
  };

  const selectLeg = (leg: number | null) => dispatch({ type: 'selectLeg', leg });
  const clear = () => {
    dispatch({ type: 'clear' });
    setIsExample(false);
    if (isDesktop) setEditing(0);
  };

  const editingCount = route.stops.length;
  /** Plain-text props for the picker of stop i (handlers are passed inline). */
  const pickerText = (i: number) => {
    const current = route.stops[i]?.airportId;
    const airport = current !== null && current !== undefined ? lookup(current) : undefined;
    return {
      label: stopLabel(i, editingCount),
      caption: stopCaption(i, editingCount),
      placeholder: airport ? `Replace ${airportCode(airport)}` : stopPlaceholder(i, editingCount),
    };
  };
  const cancelEditor = () => closeEditor({ cancelled: true });
  useEffect(() => {
    closeEditorRef.current = () => setEditing(null);
  });

  const totalKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  const totalMin = sumDurations(legs.map((l) => l.durationMin));
  const sheetCollapsed = !isDesktop && collapsed && editing === null;

  return (
    <div className={`app ${isDesktop ? 'layout-desktop' : 'layout-mobile'}`}>
      <div className={`stage${globeReady ? ' is-ready' : ''}`}>
        {globeFailed ? (
          <div className="globe-fallback" role="note">
            <p className="globe-fallback__title">The 3D globe couldn’t start</p>
            <p>
              Your browser or device doesn’t have WebGL available. You can still plan routes — distances and estimated
              flight times appear in the journey panel.
            </p>
          </div>
        ) : (
          <ErrorBoundary
            onError={(e) => {
              console.error(e);
              setGlobeFailed(true);
            }}
          >
            <Suspense fallback={null}>
              <GlobeView
                route={globeRoute}
                selectedLeg={route.selectedLeg}
                insets={insets}
                reducedMotion={reducedMotion}
                fitNonce={fitNonce}
                onLegClick={(leg) => selectLeg(route.selectedLeg === leg ? null : leg)}
                onFitChange={setFits}
                onReady={() => setGlobeReady(true)}
                onError={(e) => {
                  console.error(e);
                  setGlobeFailed(true);
                }}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>

      <header className="topbar">
        <h1 className="sr-only">GlobeHops</h1>
        <Brand />
        <button
          type="button"
          className="icon-btn icon-btn--floating"
          aria-label="About GlobeHops"
          onClick={() => aboutRef.current?.open()}
        >
          <IconInfo />
        </button>
      </header>

      {!globeFailed && (
        <div
          className="hud-wrap"
          style={{ '--inset-left': `${insets.left}px`, '--inset-bottom': `${insets.bottom}px` } as React.CSSProperties}
        >
          <GlobeHud
            legs={legs}
            selectedLeg={route.selectedLeg}
            fits={fits}
            onSelectLeg={selectLeg}
            onFit={() => setFitNonce((n) => n + 1)}
          />
        </div>
      )}

      <main ref={panelRef} className={`panel${sheetCollapsed ? ' is-collapsed' : ''}`} aria-label="Journey planner">
        {!isDesktop && (
          <button
            type="button"
            className="sheet-handle"
            aria-expanded={!sheetCollapsed}
            aria-label={sheetCollapsed ? 'Show journey details' : 'Hide journey details'}
            onClick={() => setCollapsed((c) => !c)}
          >
            <span />
          </button>
        )}

        {sheetCollapsed ? (
          <button type="button" className="peek" onClick={() => setCollapsed(false)} aria-label="Show journey details">
            <span className="peek__route">
              {filledAirports.length ? filledAirports.map(airportCode).join(' → ') : 'Plan a journey'}
            </span>
            {legs.length > 0 && (
              <span className="peek__totals">
                {formatDistance(totalKm, unit)}
                {totalMin ? ` · ≈ ${formatDuration(totalMin)}` : ''}
              </span>
            )}
            <IconChevronUp className="peek__chev" />
          </button>
        ) : (
          <>
            <div className="panel__head">
              <h2 className="panel__title">
                {isExample ? (
                  <>
                    Example journey<span className="panel__hint">Choose any airport to change it</span>
                  </>
                ) : (
                  'Your journey'
                )}
              </h2>
              <div className="panel__actions">
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => dispatch({ type: 'reverse' })}
                  disabled={filledAirports.length < 2}
                >
                  <IconSwap size={17} />
                  <span>Reverse</span>
                </button>
                <button type="button" className="chip-btn" onClick={share} disabled={filledAirports.length < 1}>
                  <IconShare size={17} />
                  <span>Share</span>
                </button>
              </div>
            </div>

            <div className="panel__scroll">
              {dataError ? (
                <p className="panel__error" role="alert">
                  Airport data couldn’t be loaded. Check your connection and reload the page.
                </p>
              ) : (
                <StopList
                  stops={route.stops}
                  legs={legs}
                  lookup={lookup}
                  unit={unit}
                  selectedLeg={route.selectedLeg}
                  editing={isDesktop ? editing : null}
                  renderPicker={(i) => (
                    <AirportPicker
                      key={route.stops[i].key}
                      variant="inline"
                      index={index}
                      {...pickerText(i)}
                      onSelect={onSelectAirport}
                      onCancel={cancelEditor}
                    />
                  )}
                  onEdit={openEditor}
                  onRemove={(i) => dispatch({ type: 'removeStop', index: i })}
                  onInsert={(i) => addStop(i)}
                  onAdd={() => addStop()}
                  onMove={(from, to) => dispatch({ type: 'moveStop', from, to })}
                  onSelectLeg={selectLeg}
                />
              )}
              {initialized && legs.length === 0 && filledAirports.length === 0 && (
                <div className="suggestions">
                  <p className="suggestions__title">Or try one of these</p>
                  <ul>
                    {SUGGESTED_ROUTES.map((s) => (
                      <li key={s.label}>
                        <button type="button" className="suggestion" onClick={() => index && loadCodes(s.codes, index)}>
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <footer className="panel__foot">
                <button
                  type="button"
                  className="text-btn"
                  onClick={clear}
                  disabled={filledAirports.length === 0 && route.stops.length === 2}
                >
                  Clear route
                </button>
                <button type="button" className="credits" onClick={() => aboutRef.current?.open()}>
                  Imagery NASA · Airports OurAirports
                </button>
              </footer>
            </div>

            {legs.length > 0 && <Summary legs={legs} unit={unit} onUnitChange={changeUnit} />}
          </>
        )}
      </main>

      {!isDesktop && editing !== null && (
        <div className="takeover" role="dialog" aria-modal="true" aria-label={stopLabel(editing, editingCount)}>
          <AirportPicker
            ref={takeoverRef}
            variant="takeover"
            index={index}
            {...pickerText(editing)}
            onSelect={onSelectAirport}
            onCancel={cancelEditor}
          />
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {initialized ? describeRoute(legs, unit) : ''}
      </p>
      <Toast toast={toast} />
      <AboutDialog ref={aboutRef} meta={dataset?.meta ?? null} />
    </div>
  );
}
