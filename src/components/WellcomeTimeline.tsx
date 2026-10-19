import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildTimelineModel,
  canZoom,
  computeEventLayoutAndVisibility,
  computeZoomUntilVisible,
  DEFAULT_PROVIDER_OPTIONS,
  DEFAULT_TIMELINE_CONFIG,
  getEventScrollPosition,
  isMaxZoom,
  isMinZoom,
  selectActiveTicks,
} from '../engine/timelineEngine';
import {
  ComputedTimelineEvent,
  TimelineConfig,
  TimelineData,
  TimelineProviderOptions,
} from '../types/timeline';
import { clamp, ellipsis, normalise, parseTimelineJson } from '../utils/julianDateConverter';
import styles from './WellcomeTimeline.module.css';

export interface WellcomeTimelineProps {
  data?: TimelineData;
  dataUri?: string;
  eventId?: number | string;
  config?: Partial<TimelineConfig>;
  options?: Partial<TimelineProviderOptions>;
  syncUrlHash?: boolean;
}

export const WellcomeTimeline: React.FC<WellcomeTimelineProps> = ({
  data: propData,
  dataUri = 'monet_letters.json',
  eventId: initialEventId,
  config: customConfig,
  options: customOptions,
  syncUrlHash = true,
}) => {
  const [loadedData, setLoadedData] = useState<TimelineData | null>(propData ?? null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const config: TimelineConfig = useMemo(
    () => ({
      ...DEFAULT_TIMELINE_CONFIG,
      ...customConfig,
    }),
    [customConfig],
  );

  const providerOptions: TimelineProviderOptions = useMemo(
    () => ({
      ...DEFAULT_PROVIDER_OPTIONS,
      ...customOptions,
    }),
    [customOptions],
  );

  // Fetch dataUri if propData is not directly passed
  useEffect(() => {
    if (propData) {
      setLoadedData(propData);
      return;
    }
    let cancelled = false;
    fetch(dataUri)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((rawText) => {
        if (!cancelled) {
          setLoadedData(parseTimelineJson(rawText));
          setErrorMsg(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMsg(config.Settings.DataNotFoundMessage);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [propData, dataUri, config.Settings.DataNotFoundMessage]);

  // Viewport measurement
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setViewportWidth(containerRef.current.clientWidth || window.innerWidth);
      } else {
        setViewportWidth(window.innerWidth);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const baseWidth = Math.max(320, viewportWidth);
  const scrollWidth = Math.max(280, baseWidth - 40);

  // Build mathematical model
  const model = useMemo(() => {
    if (!loadedData) return null;
    return buildTimelineModel(loadedData, providerOptions, config);
  }, [loadedData, providerOptions, config]);

  // Reactive viewport & selection state
  const [zoomLevel, setZoomLevel] = useState<number>(0);
  const [scrollX, setScrollX] = useState<number>(0);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(true);
  const [isEmbedOpen, setIsEmbedOpen] = useState<boolean>(false);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const contentWidth = useMemo(
    () => baseWidth * Math.pow(providerOptions.zoomFactor, zoomLevel),
    [baseWidth, providerOptions.zoomFactor, zoomLevel],
  );

  const layoutEvents = useMemo(() => {
    if (!model) return [];
    return computeEventLayoutAndVisibility(
      model,
      contentWidth,
      scrollWidth,
      providerOptions,
      currentIndex,
    );
  }, [model, contentWidth, scrollWidth, providerOptions, currentIndex]);

  const activeTickBand = useMemo(() => {
    if (!model) return { band: 'centuries' as const, ticks: [] };
    return selectActiveTicks(model, contentWidth, providerOptions);
  }, [model, contentWidth, providerOptions]);

  const atMinZoom = useMemo(
    () => (model ? isMinZoom(contentWidth, scrollWidth, model, providerOptions) : true),
    [model, contentWidth, scrollWidth, providerOptions],
  );

  const atMaxZoom = useMemo(
    () => (model ? isMaxZoom(contentWidth, scrollWidth, model, providerOptions) : true),
    [model, contentWidth, scrollWidth, providerOptions],
  );

  // Select event and run recursive _zoomUntilVisible if hidden by collision rules
  const selectEventByIndex = useCallback(
    (index: number, updateHash = true) => {
      if (!model) return;
      const nonPresentLength = model.events.filter((e) => !e.isPresent).length;
      if (index < -1 || index >= nonPresentLength) return;

      setCurrentIndex(index);
      setIsDetailsOpen(true);

      if (index === -1) {
        if (syncUrlHash && updateHash && typeof window !== 'undefined') {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#0`);
        }
        return;
      }

      const result = computeZoomUntilVisible(
        model,
        index,
        zoomLevel,
        baseWidth,
        scrollWidth,
        providerOptions,
      );

      setZoomLevel(result.zoomLevel);
      setScrollX(result.scrollX);

      const selectedEv = model.events[index];
      if (
        syncUrlHash &&
        updateHash &&
        selectedEv?.EventId != null &&
        typeof window !== 'undefined'
      ) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}#${selectedEv.EventId}`,
        );
      }
    },
    [model, zoomLevel, baseWidth, scrollWidth, providerOptions, syncUrlHash],
  );

  // Deep-linking: read initial eventId or URL hash on load and on hashchange
  const initialHashHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!model) return;

    const applyHashOrProp = () => {
      const hashRaw =
        typeof window !== 'undefined'
          ? window.location.hash.replace(/^#\/?/, '').trim()
          : '';
      const targetId = hashRaw || (initialEventId != null ? String(initialEventId) : '');
      if (!targetId || targetId === '0') return;

      const idx = model.events.findIndex(
        (ev) => !ev.isPresent && String(ev.EventId) === String(targetId),
      );
      if (idx !== -1) {
        selectEventByIndex(idx, false);
      }
    };

    const currentKey = `${loadedData?.Title ?? ''}-${
      typeof window !== 'undefined' ? window.location.hash : ''
    }-${initialEventId ?? ''}`;

    if (initialHashHandledRef.current !== currentKey) {
      initialHashHandledRef.current = currentKey;
      applyHashOrProp();
    }

    const onHashChange = () => {
      applyHashOrProp();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [model, loadedData, initialEventId, selectEventByIndex]);

  // Step zoom in (+1) or out (-1)
  const handleZoom = useCallback(
    (direction: 1 | -1) => {
      if (!model) return;
      if (!canZoom(direction, contentWidth, scrollWidth, model, providerOptions)) return;

      const nextZoom = zoomLevel + direction;
      const nextWidth = baseWidth * Math.pow(providerOptions.zoomFactor, nextZoom);
      const currentScrollRatio = normalise(scrollX, 0, contentWidth);

      let nextScrollX: number;
      if (currentIndex !== -1 && model.events[currentIndex]) {
        nextScrollX = getEventScrollPosition(model.events[currentIndex], nextWidth, scrollWidth);
      } else {
        const minScroll = Math.min(0, (nextWidth - scrollWidth) * -1);
        nextScrollX = clamp(Math.floor(nextWidth * currentScrollRatio), minScroll, 0);
      }

      setZoomLevel(nextZoom);
      setScrollX(nextScrollX);
    },
    [model, contentWidth, scrollWidth, providerOptions, zoomLevel, baseWidth, scrollX, currentIndex],
  );

  // Keyboard Escape handler
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEmbedOpen) {
          setIsEmbedOpen(false);
        } else if (isDetailsOpen) {
          setIsDetailsOpen(false);
          setCurrentIndex(-1);
        } else if (isFullScreen) {
          setIsFullScreen(false);
        }
      }
    };
    window.addEventListener('keyup', onKeyUp);
    return () => window.removeEventListener('keyup', onKeyUp);
  }, [isEmbedOpen, isDetailsOpen, isFullScreen]);

  // Native pointer drag + kinetic momentum scrolling (replaces iScroll v4)
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startScrollX: number;
    lastX: number;
    lastTime: number;
    velocityX: number;
    moved: boolean;
    rafId: number | null;
  }>({
    active: false,
    startX: 0,
    startScrollX: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
    moved: false,
    rafId: null,
  });

  const clampScroll = useCallback(
    (x: number) => {
      const min = Math.min(0, (contentWidth - scrollWidth) * -1);
      return clamp(x, min, 0);
    },
    [contentWidth, scrollWidth],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (dragStateRef.current.rafId) {
      cancelAnimationFrame(dragStateRef.current.rafId);
      dragStateRef.current.rafId = null;
    }
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startScrollX: scrollX,
      lastX: e.clientX,
      lastTime: performance.now(),
      velocityX: 0,
      moved: false,
      rafId: null,
    };
    setIsDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st.active) return;
    const now = performance.now();
    const dx = e.clientX - st.startX;
    if (Math.abs(dx) > 5) {
      st.moved = true;
    }
    const dt = Math.max(1, now - st.lastTime);
    st.velocityX = (e.clientX - st.lastX) / dt;
    st.lastX = e.clientX;
    st.lastTime = now;
    setScrollX(clampScroll(st.startScrollX + dx));
  };

  const onPointerUp = () => {
    const st = dragStateRef.current;
    if (!st.active) return;
    st.active = false;
    setIsDragging(false);

    // Kinetic inertia decay
    let v = st.velocityX * 16;
    if (Math.abs(v) > 1.5) {
      let currentPos = scrollX;
      const stepKinetic = () => {
        v *= 0.92;
        currentPos = clampScroll(currentPos + v);
        setScrollX(currentPos);
        if (Math.abs(v) > 0.5 && currentPos < 0 && currentPos > (contentWidth - scrollWidth) * -1) {
          st.rafId = requestAnimationFrame(stepKinetic);
        } else {
          st.rafId = null;
        }
      };
      st.rafId = requestAnimationFrame(stepKinetic);
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta !== 0) {
      setScrollX((prev) => clampScroll(prev - delta));
    }
  };

  // Embed dialog state
  const [embedSize, setEmbedSize] = useState<{ label: string; width: string; height: string }>({
    label: 'small',
    width: '600',
    height: '600',
  });

  if (errorMsg) {
    return (
      <div className={styles.timelineRoot} style={{ alignItems: 'center', justifyContent: 'center', color: '#1c1c1e' }}>
        <p>{errorMsg}</p>
      </div>
    );
  }

  if (!loadedData || !model) {
    return (
      <div className={styles.timelineRoot} style={{ alignItems: 'center', justifyContent: 'center', color: '#1c1c1e' }}>
        <p>Loading timeline...</p>
      </div>
    );
  }

  const nonPresentEvents = layoutEvents.filter((e) => !e.isPresent);
  const activeDetailItem =
    currentIndex === -1
      ? {
          Title: loadedData.Title,
          StartDisplay: undefined,
          EndDisplay: undefined,
          Body: loadedData.Body,
          FeatureImagePath: loadedData.FeatureImagePath,
          LinkText: undefined,
          LinkTarget: undefined,
          ImageCredit: undefined,
        }
      : layoutEvents[currentIndex];

  const isPrevEnabled = currentIndex > -1;
  const isNextEnabled = currentIndex < nonPresentEvents.length - 1;

  const visibilityByIndex = new Map<number, boolean>();
  for (const ev of layoutEvents) {
    visibilityByIndex.set(ev.index, ev.isVisible);
  }

  const tickIntervalWidth =
    activeTickBand.ticks.length > 0 ? contentWidth / activeTickBand.ticks.length : contentWidth;
  const tickWidth = Math.max(10, tickIntervalWidth - 2);

  const getCardZIndex = (ev: ComputedTimelineEvent) => {
    const baseZ = ev.stackLevel * 2 + 1;
    if (currentIndex === ev.index || highlightedIndex === ev.index) {
      return baseZ + 10;
    }
    return baseZ;
  };

  const currentEventId =
    currentIndex >= 0 && layoutEvents[currentIndex]?.EventId != null
      ? String(layoutEvents[currentIndex].EventId)
      : '';

  const embedCode = `<div class="timeline" data-uri="${dataUri}" data-eventid="${currentEventId}" style="width:${embedSize.width}px; height:${embedSize.height}px; background-color: #fefbf4"></div>\n<script type="text/javascript" src="${
    typeof window !== 'undefined' ? window.location.origin : ''
  }/wellcome-timeline.umd.cjs"></script>`;

  return (
    <div
      ref={containerRef}
      id="timeline"
      className={`${styles.timelineRoot} ${isFullScreen ? styles.fullScreen : ''}`}
    >
      {/* Header Panel */}
      <header className={styles.headerPanel}>
        <div
          className={styles.headerTitle}
          title={`${loadedData.Title}: ${loadedData.StartDateDisplay} - ${loadedData.EndDateDisplay}`}
        >
          {loadedData.Title}:{' '}
          <span className={styles.headerDateSpan}>
            {loadedData.StartDateDisplay} – {loadedData.EndDateDisplay}
          </span>
        </div>
        <div className={styles.headerControls}>
          <button
            type="button"
            className={`${styles.zoomBtn} zoomIn`}
            title={config.HeaderPanelView.ZoomIn}
            disabled={atMaxZoom}
            onClick={() => handleZoom(1)}
            aria-label={config.HeaderPanelView.ZoomIn}
          >
            <svg width="20" height="20" viewBox="0 0 26 26" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2.2" />
              <line x1="11" y1="7" x2="11" y2="15" stroke="currentColor" strokeWidth="2.2" />
              <line x1="7" y1="11" x2="15" y2="11" stroke="currentColor" strokeWidth="2.2" />
              <line x1="17" y1="17" x2="24" y2="24" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className={`${styles.zoomBtn} zoomOut`}
            title={config.HeaderPanelView.ZoomOut}
            disabled={atMinZoom}
            onClick={() => handleZoom(-1)}
            aria-label={config.HeaderPanelView.ZoomOut}
          >
            <svg width="20" height="20" viewBox="0 0 26 26" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2.2" />
              <line x1="7" y1="11" x2="15" y2="11" stroke="currentColor" strokeWidth="2.2" />
              <line x1="17" y1="17" x2="24" y2="24" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Panel */}
      <main className={styles.mainPanel}>
        <div
          id="scroll"
          className={`${styles.scrollViewport} ${isDragging ? styles.scrollViewportDragging : ''}`}
          style={{ width: `${scrollWidth}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <div
            className={`${styles.scrollContent} ${isDragging ? styles.scrollContentImmediate : ''}`}
            style={{
              width: `${contentWidth}px`,
              transform: `translate3d(${scrollX}px, 0, 0)`,
            }}
          >
            {/* Background Events */}
            <div className={styles.backgroundEvents}>
              {model.backgroundEvents.map((bg) => {
                const left = Math.ceil(bg.startPosition * contentWidth);
                const width = Math.max(0, Math.ceil(bg.endPosition * contentWidth) - left);
                return (
                  <div
                    key={`bg-${bg.EventId}-${bg.index}`}
                    className={styles.backgroundEvent}
                    style={{ left: `${left}px`, width: `${width}px` }}
                    title={bg.Title}
                  >
                    <div className={styles.backgroundEventTitle}>{bg.Title}</div>
                    <div className={styles.backgroundEventSpan} />
                  </div>
                );
              })}
            </div>

            {/* Event Cards (3-Level Vertical Stack) */}
            <div className={styles.eventsLayer}>
              {layoutEvents.map((ev) => {
                if (!ev.isVisible) return null;
                const isSelected = currentIndex === ev.index;
                const isHighlighted = highlightedIndex === ev.index;
                const hasThumb = Boolean(ev.ThumbnailPath);

                const cardClasses = [
                  styles.eventCard,
                  'event',
                  !hasThumb ? `${styles.eventCardMin} min` : '',
                  ev.isPresent ? `${styles.eventCardPresent} present` : '',
                  isSelected ? `${styles.eventCardSelected} selected` : '',
                  isHighlighted ? `${styles.eventCardHighlighted} highlighted` : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <div
                    key={`ev-${ev.EventId ?? 'present'}-${ev.index}`}
                    data-event-id={ev.EventId}
                    data-stack-level={ev.stackLevel}
                    className={cardClasses}
                    style={{
                      left: `${ev.leftPos}px`,
                      top: `${ev.top}px`,
                      zIndex: getCardZIndex(ev),
                    }}
                    title={ev.isPresent ? ev.Title : `${ev.StartDisplayYear}: ${ev.Title}`}
                    onClick={() => {
                      if (dragStateRef.current.moved || ev.isPresent) return;
                      selectEventByIndex(ev.index);
                    }}
                    onMouseEnter={() => {
                      if (!ev.isPresent) setHighlightedIndex(ev.index);
                    }}
                    onMouseLeave={() => {
                      if (!ev.isPresent) setHighlightedIndex(null);
                    }}
                  >
                    <div className={styles.eventWrap}>
                      {hasThumb && !ev.isPresent && (
                        <div className={styles.eventLeftCol}>
                          <img
                            src={ev.ThumbnailPath!}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.opacity = '0';
                            }}
                          />
                        </div>
                      )}
                      <div className={styles.eventRightCol}>
                        <div className={styles.eventDate}>
                          {ev.isPresent ? ev.startDate.getFullYear() : ev.StartDisplayYear}
                        </div>
                        <div className={styles.eventTitle}>{ellipsis(ev.Title, 45)}</div>
                      </div>
                      {!ev.isPresent && (
                        <svg
                          className={styles.eventCornerArrow}
                          viewBox="0 0 12 12"
                          fill="none"
                        >
                          <path
                            d="M3 3L9 9M9 9V4M9 9H4"
                            stroke={isSelected || isHighlighted ? '#fff' : '#19599a'}
                            strokeWidth="2"
                          />
                        </svg>
                      )}
                    </div>
                    <div className={styles.eventStemArrow}>
                      <svg width="11" height="11" viewBox="0 0 11 11">
                        <polygon
                          points="0,0 11,0 0,11"
                          fill={
                            ev.isPresent
                              ? '#124574'
                              : isSelected || isHighlighted
                              ? '#124574'
                              : '#19599a'
                          }
                        />
                      </svg>
                    </div>
                    <div
                      className={styles.eventStemLine}
                      style={{ height: `${Math.max(0, ev.lineHeight)}px` }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Dynamic Resolution Tick Ruler (Centuries / Decades / Years) */}
            <div className={styles.timeLayer} data-tick-band={activeTickBand.band}>
              <div className={styles.ticksRow}>
                {activeTickBand.ticks.map((tick) => (
                  <div
                    key={`tick-${activeTickBand.band}-${tick.startYear}`}
                    className={`${styles.tick} tick`}
                    style={{ width: `${tickWidth}px` }}
                  >
                    <div className={styles.tickDate}>{tick.startYear}</div>
                    <div className={styles.tickEvents}>
                      {tick.events.map((ev) => {
                        const isAvail = visibilityByIndex.get(ev.index) ?? false;
                        const isSelected = currentIndex === ev.index;
                        const isHighlighted = highlightedIndex === ev.index;
                        const sqClasses = [
                          styles.tickEvent,
                          'tickEvent',
                          isAvail
                            ? `${styles.tickEventAvailable} available`
                            : `${styles.tickEventHidden} hidden`,
                          isSelected ? `${styles.tickEventSelected} selected` : '',
                          isHighlighted ? `${styles.tickEventHighlighted} highlighted` : '',
                        ]
                          .filter(Boolean)
                          .join(' ');

                        return (
                          <button
                            key={`tick-ev-${ev.index}`}
                            type="button"
                            className={sqClasses}
                            title={`${ev.StartDisplayYear}: ${ev.Title}`}
                            onClick={() => {
                              if (dragStateRef.current.moved) return;
                              selectEventByIndex(ev.index);
                            }}
                            onMouseEnter={() => setHighlightedIndex(ev.index)}
                            onMouseLeave={() => setHighlightedIndex(null)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Details View Modal Overlay */}
        {isDetailsOpen && activeDetailItem && (
          <section className={`${styles.detailsOverlay} detailsView`} aria-label="Event Details">
            <div className={styles.dialogueTop}>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => {
                  setIsDetailsOpen(false);
                  setCurrentIndex(-1);
                }}
              >
                <span>CLOSE</span>
                <span className={styles.closeBtnIcon}>✕</span>
              </button>
            </div>
            <div className={styles.detailsMiddle}>
              <div className={styles.navCol}>
                <button
                  type="button"
                  className={`${styles.prevNextBtn} prev`}
                  title={config.DetailsPanelView.Previous}
                  disabled={!isPrevEnabled}
                  onClick={() => selectEventByIndex(currentIndex - 1)}
                  aria-label={config.DetailsPanelView.Previous}
                >
                  <svg width="18" height="28" viewBox="0 0 18 28" fill="none">
                    <path d="M14 4L4 14L14 24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className={styles.detailsCenterCol}>
                {(activeDetailItem.FeatureImagePath || loadedData.FeatureImagePath) && (
                  <div className={styles.detailsImageCol}>
                    <img
                      src={activeDetailItem.FeatureImagePath || loadedData.FeatureImagePath}
                      alt=""
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.opacity = '0';
                      }}
                    />
                  </div>
                )}
                <div className={styles.detailsTextCol}>
                  <header className={styles.detailsHeader}>
                    <h1>{activeDetailItem.Title}</h1>
                    {activeDetailItem.StartDisplay && (
                      <h2>
                        {activeDetailItem.StartDisplay}
                        {activeDetailItem.EndDisplay ? ` - ${activeDetailItem.EndDisplay}` : ''}
                      </h2>
                    )}
                  </header>
                  <div
                    className={styles.detailsBody}
                    dangerouslySetInnerHTML={{ __html: activeDetailItem.Body || '' }}
                  />
                  {activeDetailItem.LinkText && activeDetailItem.LinkTarget && (
                    <p className={styles.detailsBody}>
                      <a
                        href={activeDetailItem.LinkTarget}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {activeDetailItem.LinkText}
                      </a>
                    </p>
                  )}
                  {activeDetailItem.ImageCredit && (
                    <p>
                      <em>{activeDetailItem.ImageCredit}</em>
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.navCol}>
                <button
                  type="button"
                  className={`${styles.prevNextBtn} next`}
                  title={config.DetailsPanelView.Next}
                  disabled={!isNextEnabled}
                  onClick={() => selectEventByIndex(currentIndex + 1)}
                  aria-label={config.DetailsPanelView.Next}
                >
                  <svg width="18" height="28" viewBox="0 0 18 28" fill="none">
                    <path d="M4 4L14 14L4 24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Embed Modal Overlay */}
        {isEmbedOpen && (
          <div className={styles.overlayMask} onClick={() => setIsEmbedOpen(false)}>
            <div className={styles.embedModal} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1>{config.EmbedView.Title}</h1>
                <button
                  type="button"
                  onClick={() => setIsEmbedOpen(false)}
                  style={{ cursor: 'pointer', border: 'none', background: 'transparent', fontWeight: 'bold' }}
                >
                  ✕
                </button>
              </div>
              <p>{config.EmbedView.EmbedInstructions}</p>
              <textarea
                readOnly
                className={styles.embedTextarea}
                value={embedCode}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className={styles.embedSizes}>
                {[
                  { label: 'small', width: '600', height: '600' },
                  { label: 'medium', width: '800', height: '600' },
                  { label: 'large', width: '900', height: '900' },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={`${styles.embedSizeOption} ${
                      embedSize.label === preset.label ? styles.embedSizeSelected : ''
                    }`}
                    onClick={() => setEmbedSize(preset)}
                  >
                    {preset.width} x {preset.height}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer Panel */}
      <footer className={styles.footerPanel}>
        <div>
          {config.Settings.EmbedEnabled !== 'false' && (
            <button
              type="button"
              className={styles.footerBtn}
              onClick={() => setIsEmbedOpen((v) => !v)}
            >
              <span>&lt;/&gt;</span>
              <span>Embed</span>
            </button>
          )}
        </div>
        <div>
          <button
            type="button"
            className={styles.footerBtn}
            onClick={() => setIsFullScreen((fs) => !fs)}
          >
            <span>{isFullScreen ? 'Normal view' : 'Full screen version'}</span>
            <span>⛶</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
