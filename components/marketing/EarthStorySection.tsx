/* Earth story: Visibility Field section. HTML owns all copy and controls; the canvas is decorative.
 * One activeChapter state (plus optional selectedHub focus) drives both the panel and the lazily loaded Canvas2D scene.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  DISCOVERY_CHANNELS,
  EARTH_BUSINESS,
  EARTH_CHAPTERS,
  EARTH_COPY,
  EARTH_HUBS,
  EVIDENCE_EXAMPLES,
  EXAMPLE_ACTION,
  chapterForKey,
  chapterIndex,
  formatLatLon,
  greatCircleKm,
  type ChapterId,
  type EarthHubId,
  type EarthViewMode,
  type EvidenceState,
} from './earth/earthStory';
import type { EarthScene } from './earth/earthScene';
import { isLowMemoryDevice, isSaveDataEnabled, prefersReducedMotion } from './constellationCapability';

interface EarthStorySectionProps {
  headingClassName: string;
  /** Existing Instant Audit handler. */
  onOpenAudit: () => void;
  /** Guests only: existing sign-up handler. */
  onSignUp?: () => void;
}

type SceneStatus = 'loading' | 'ready' | 'failed';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]';

const STATE_GLYPH: Record<EvidenceState, string> = {
  Measured: 'bg-[var(--color-accent)] border-[var(--color-accent)]',
  Estimated: 'border-[var(--color-accent)] bg-[linear-gradient(90deg,var(--color-accent)_50%,transparent_50%)]',
  'Not measured': 'border-dashed border-[var(--color-ink-2)]',
};

function isLowPower(): boolean {
  return (
    window.innerWidth < 640 ||
    isSaveDataEnabled() ||
    isLowMemoryDevice() ||
    (navigator.hardwareConcurrency || 8) <= 4
  );
}

const ChapterDetail: React.FC<{ id: ChapterId }> = ({ id }) => {
  switch (id) {
    case 'business':
      return (
        <p className="text-[13px] text-[var(--color-ink-2)]">
          Gold marker: {EARTH_BUSINESS.name}. Not a real customer.
        </p>
      );
    case 'discovery':
      return (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--color-ink-2)] mb-2">
            Discovery channels
          </p>
          <ul className="flex flex-wrap gap-2 list-none">
            {DISCOVERY_CHANNELS.map((name) => (
              <li key={name} className="text-[13px] px-3 py-1.5 border border-[var(--color-rule)] text-[var(--color-ink)]">
                {name}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'gaps':
      return (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--color-ink-2)] mb-2">
            Illustrative example
          </p>
          <ul className="list-none divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
            {EVIDENCE_EXAMPLES.map((row) => (
              <li key={row.state} className="flex gap-3 py-2.5">
                <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border ${STATE_GLYPH[row.state]}`} />
                <p className="text-[14px] leading-snug text-[var(--color-ink-2)] min-w-0">
                  <span className="text-[var(--color-ink)] font-medium">{row.state}</span>
                  {' · '}
                  {row.channels.join(', ')}
                  <span className="block text-[13px]">{row.definition}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'action':
      return (
        <div className="border border-[var(--color-accent)] bg-black/40 p-4">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-[var(--color-accent)] mb-1.5">
            {EXAMPLE_ACTION.label}
          </p>
          <p className="text-[15px] text-[var(--color-ink)] leading-snug mb-1">{EXAMPLE_ACTION.title}</p>
          <p className="text-[13px] text-[var(--color-ink-2)]">{EXAMPLE_ACTION.detail}</p>
          <p className="text-[12px] text-[var(--color-ink-2)] mt-2">{EXAMPLE_ACTION.caveat}</p>
        </div>
      );
  }
};

export const EarthStorySection: React.FC<EarthStorySectionProps> = ({ headingClassName, onOpenAudit, onSignUp }) => {
  const [chapterId, setChapterId] = useState<ChapterId>(EARTH_CHAPTERS[0].id);
  const [selectedHub, setSelectedHub] = useState<EarthHubId | null>(null);
  const [viewMode, setViewMode] = useState<EarthViewMode>('3d');
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<SceneStatus>('loading');
  const [reduced] = useState(prefersReducedMotion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<EarthScene | null>(null);
  const chapterRef = useRef(chapterId);
  const hubRef = useRef(selectedHub);
  const viewModeRef = useRef(viewMode);
  const pausedRef = useRef(paused);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chapter = EARTH_CHAPTERS[chapterIndex(chapterId)];
  const activeHub = selectedHub ? EARTH_HUBS.find((h) => h.id === selectedHub) ?? null : null;

  useEffect(() => {
    chapterRef.current = chapterId;
    sceneRef.current?.setChapter(chapterId);
  }, [chapterId]);

  useEffect(() => {
    hubRef.current = selectedHub;
    sceneRef.current?.setHub(selectedHub);
  }, [selectedHub]);

  useEffect(() => {
    viewModeRef.current = viewMode;
    sceneRef.current?.setViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    pausedRef.current = paused;
    sceneRef.current?.setPaused(paused);
  }, [paused]);

  // Load the renderer chunk only when the stage nears the viewport.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const load = () => {
      io.disconnect();
      import('./earth/earthScene')
        .then(({ createEarthScene }) => {
          if (cancelled) return;
          sceneRef.current = createEarthScene(canvas, {
            chapter: chapterRef.current,
            selectedHub: hubRef.current,
            viewMode: viewModeRef.current,
            paused: pausedRef.current,
            reducedMotion: reduced,
            lowPower: isLowPower(),
            onSelectHub: (id) => setSelectedHub(id),
          });
          setStatus('ready');
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.warn('[EarthStory] static fallback:', err);
          setStatus('failed');
        });
    };
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(), {
      rootMargin: '400px 0px',
    });
    io.observe(canvas);
    return () => {
      cancelled = true;
      io.disconnect();
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [reduced]);

  const selectChapter = (id: ChapterId) => {
    setSelectedHub(null);
    setChapterId(id);
  };

  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = chapterForKey(e.key, chapterId);
    if (!next) return;
    e.preventDefault();
    selectChapter(next);
    tabRefs.current[chapterIndex(next)]?.focus();
  };

  const resetGlobeView = () => {
    if (selectedHub !== null) {
      setSelectedHub(null);
    } else {
      sceneRef.current?.resetView();
    }
  };

  const focusCoords = activeHub
    ? formatLatLon(activeHub.lat, activeHub.lon)
    : formatLatLon(chapter.focus.lat, chapter.focus.lon);

  const hubDistanceKm =
    activeHub && !activeHub.isBusiness
      ? greatCircleKm(EARTH_BUSINESS, activeHub)
      : null;

  return (
    <section
      id="visibility-map"
      aria-labelledby="earth-story-heading"
      className="mkt-section mkt-section-alt scroll-mt-28 overflow-x-clip"
    >
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-x-16 gap-y-10 items-center">
        <div className="lg:col-span-5 lg:col-start-1 lg:row-start-1 min-w-0 self-end">
          <p className="mkt-eyebrow mb-4">{EARTH_COPY.eyebrow}</p>
          <h2 id="earth-story-heading" className={`${headingClassName} mb-5`}>
            {EARTH_COPY.heading}
          </h2>
          <p className="mkt-body max-w-md">{EARTH_COPY.support}</p>
        </div>

        <figure className="lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:row-span-2 min-w-0 m-0">
          <div className="mx-auto w-full max-w-[min(640px,88vw)]">
            <div className="min-h-[34px] flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2 border-b border-[var(--color-rule)] text-[11px] font-mono text-[var(--color-ink-2)]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                <span className="text-[var(--color-accent)] uppercase tracking-[0.12em]">
                  {activeHub ? `${activeHub.label} (${activeHub.country})` : chapter.label}
                </span>
                <span aria-hidden="true">·</span>
                <span>{focusCoords}</span>
                {hubDistanceKm !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{hubDistanceKm.toLocaleString('en-US')} km arc</span>
                  </>
                )}
                {activeHub && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[var(--color-ink)]">{activeHub.role}</span>
                  </>
                )}
              </div>
              <div
                aria-hidden={status !== 'ready'}
                className={`flex flex-wrap items-center gap-1.5 ${status === 'ready' ? '' : 'invisible'}`}
              >
                <div role="group" aria-label="Projection mode" className="inline-flex border border-[var(--color-rule)] bg-black/60">
                  {(['3d', '2d'] as const).map((mode) => {
                    const active = viewMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={status !== 'ready'}
                        aria-pressed={active}
                        onClick={() => setViewMode(mode)}
                        className={`min-h-[28px] px-2.5 text-[11px] font-mono tracking-wide transition-colors motion-reduce:transition-none ${FOCUS_RING} ${
                          active
                            ? 'bg-[var(--color-accent)] text-black font-medium'
                            : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                        }`}
                      >
                        {mode === '3d' ? '3D globe' : '2D map'}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={status !== 'ready'}
                  onClick={resetGlobeView}
                  className={`min-h-[30px] px-2.5 text-[11px] font-mono tracking-wide border border-[var(--color-rule)] bg-black/60 text-[var(--color-ink-2)] hover:text-[var(--color-ink)] ${FOCUS_RING}`}
                >
                  Reset view
                </button>
                {!reduced && (
                  <button
                    type="button"
                    disabled={status !== 'ready'}
                    onClick={() => setPaused((p) => !p)}
                    className={`min-h-[30px] px-2.5 text-[11px] font-mono tracking-wide border border-[var(--color-rule)] bg-black/60 text-[var(--color-ink-2)] hover:text-[var(--color-ink)] ${FOCUS_RING}`}
                  >
                    {paused ? 'Play motion' : 'Pause motion'}
                  </button>
                )}
              </div>
            </div>

            <div className="relative mx-auto w-full aspect-square">
              <div role="img" aria-label={`Illustrative ${viewMode === '2d' ? 'world map' : 'globe'}. ${chapter.scene}`} className="absolute inset-0">
                {status === 'loading' && (
                  <div className="absolute inset-[10%] rounded-full border border-[var(--color-rule)] bg-[radial-gradient(circle_at_38%_32%,rgb(26_21_12),rgb(0_0_0)_75%)]" />
                )}
                {status === 'failed' && (
                  <img
                    src="/brand/earth-fallback.webp"
                    alt=""
                    width={720}
                    height={720}
                    decoding="async"
                    className="absolute inset-0 h-full w-full"
                  />
                )}
                <canvas
                  ref={canvasRef}
                  aria-hidden="true"
                  className={`absolute inset-0 h-full w-full transition-opacity duration-700 motion-reduce:transition-none ${
                    status === 'ready' ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </div>
            </div>

            <div
              role="group"
              aria-label="Illustrative market locations"
              className="mt-2 flex flex-wrap items-center justify-center gap-1.5"
            >
              {EARTH_HUBS.map((h) => {
                const active = selectedHub === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedHub(active ? null : h.id)}
                    className={`min-h-[32px] px-2.5 py-1 text-[11px] font-mono tracking-wide border transition-colors motion-reduce:transition-none ${FOCUS_RING} ${
                      active
                        ? 'border-[var(--color-accent)] bg-black/60 text-[var(--color-ink)]'
                        : 'border-[var(--color-rule)] bg-black/30 text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>
          </div>
          <figcaption className="mt-2.5 text-center text-[13px] text-[var(--color-ink-2)]">{EARTH_COPY.notice}</figcaption>
        </figure>

        <div className="lg:col-span-5 lg:col-start-1 lg:row-start-2 min-w-0 self-start">
          <div role="tablist" aria-label="Story chapters" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-2 mb-6">
            {EARTH_CHAPTERS.map((c, i) => {
              const selected = c.id === chapterId;
              return (
                <button
                  key={c.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`earth-tab-${c.id}`}
                  aria-selected={selected}
                  aria-controls="earth-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectChapter(c.id)}
                  onKeyDown={onTabKey}
                  className={`min-h-[44px] px-3 py-2 text-left border transition-colors motion-reduce:transition-none ${FOCUS_RING} ${
                    selected
                      ? 'border-[var(--color-accent)] bg-black/40 text-[var(--color-ink)]'
                      : 'border-[var(--color-rule)] text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <span aria-hidden="true" className="block text-[11px] font-mono text-[var(--color-accent)]">0{i + 1}</span>
                  <span className="block text-[13px] leading-snug">{c.label}</span>
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id="earth-panel"
            aria-labelledby={`earth-tab-${chapter.id}`}
            tabIndex={0}
            className={`lg:min-h-[19rem] ${FOCUS_RING}`}
          >
            <div key={chapter.id} className="animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
              <h3 className="text-xl text-[var(--color-ink)] font-medium mb-2">{chapter.label}</h3>
              <p className="mkt-body mb-5">{chapter.body}</p>
              <ChapterDetail id={chapter.id} />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-6">
            <button type="button" onClick={() => onOpenAudit()} className="mkt-cta-primary">
              {EARTH_COPY.cta}
            </button>
            {onSignUp && (
              <button type="button" onClick={() => onSignUp()} className="mkt-cta-secondary">
                Create free account
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
