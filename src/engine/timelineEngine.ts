import { addYears, differenceInDays } from 'date-fns';
import {
  ComputedBackgroundEvent,
  ComputedTimelineEvent,
  RawTimelineEvent,
  Tick,
  TickBandType,
  TimelineConfig,
  TimelineData,
  TimelineProviderOptions,
} from '../types/timeline';
import { clamp, getEventDates, julianDayToDate, normalise } from '../utils/julianDateConverter';

export const DEFAULT_PROVIDER_OPTIONS: TimelineProviderOptions = {
  maxTicks: 100,
  maxYearIntervalWidth: 500,
  maxDecadeIntervalWidth: 2000,
  maxCenturyIntervalWidth: 500,
  zoomAnimationDuration: 1000,
  eventFadeDuration: 500,
  zoomFactor: 3,
  eventStackSize: 3,
  padding: 0,
};

export const DEFAULT_TIMELINE_CONFIG: TimelineConfig = {
  Settings: {
    DataNotFoundMessage: 'Unable to load item, please check the url and try again.',
    EmbedEnabled: 'true',
  },
  HeaderPanelView: {
    ZoomIn: 'Zoom In',
    ZoomOut: 'Zoom Out',
  },
  MainPanelView: {
    PresentDay: 'Present Day',
  },
  DetailsPanelView: {
    Previous: 'Previous',
    Next: 'Next',
  },
  EmbedView: {
    Title: 'Embed',
    EmbedInstructions:
      'To embed this timeline in your own website, copy and paste the code below:',
  },
};

export function getDecade(date: Date): number {
  return Math.floor(date.getFullYear() / 10) * 10;
}

export function getCentury(date: Date): number {
  return Math.floor(date.getFullYear() / 100) * 100;
}

function makeBoundaryDate(year: number, monthIndex = 0, day = 1): Date {
  const d = new Date(year, monthIndex, day, 0, 0, 0, 0);
  d.setFullYear(year, monthIndex, day);
  return d;
}

export interface TimelineModel {
  startDate: Date;
  endDate: Date;
  days: number;
  years: number;
  decades: number;
  centuries: number;
  events: ComputedTimelineEvent[];
  backgroundEvents: ComputedBackgroundEvent[];
  eventStack: ComputedTimelineEvent[][];
  yearTicks: Tick[];
  decadeTicks: Tick[];
  centuryTicks: Tick[];
}

/**
 * Builds the timeline date bounds, chronologically sorted events, 3-level stack, and tick bands.
 */
export function buildTimelineModel(
  data: TimelineData,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
  config: TimelineConfig = DEFAULT_TIMELINE_CONFIG,
  nowDate: Date = new Date(),
): TimelineModel {
  let startDate = addYears(julianDayToDate(data.EarliestJulianDay), options.padding * -1);
  let endDate = addYears(julianDayToDate(data.LastJulianDay), options.padding);

  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  if (endYear === startYear) {
    startDate = makeBoundaryDate(startYear, 0, 1);
    endDate = addYears(startDate, 1);
  } else if (endYear - startYear < 10) {
    startDate = makeBoundaryDate(startYear, 0, 1);
    endDate = addYears(makeBoundaryDate(endYear, 0, 1), 1);
  } else if (endYear - startYear < 100) {
    const startDecade = getDecade(startDate);
    startDate = makeBoundaryDate(startDecade, 0, 1);
    const endDecade = getDecade(endDate);
    endDate = addYears(makeBoundaryDate(endDecade, 0, 1), 10);
  } else {
    const startCentury = getCentury(startDate);
    startDate = makeBoundaryDate(startCentury, 0, 1);
    const endCentury = getCentury(endDate);
    endDate = addYears(makeBoundaryDate(endCentury, 0, 1), 100);
  }

  const days = Math.max(1, differenceInDays(endDate, startDate));
  const years = Math.max(1, Math.round(days / 365.2425));
  const decades = Math.floor(years / 10);
  const centuries = Math.floor(years / 100);

  // Background events
  const backgroundEvents: ComputedBackgroundEvent[] = (data.BackgroundEvents ?? []).map(
    (bg, index) => {
      const { startDate: bgStart, endDate: bgEnd } = getEventDates(bg);
      const startDayIndex = differenceInDays(bgStart, startDate);
      const endDayIndex = differenceInDays(bgEnd, startDate);
      return {
        ...bg,
        index,
        startDate: bgStart,
        endDate: bgEnd,
        startPosition: normalise(startDayIndex, 0, days),
        endPosition: normalise(endDayIndex, 0, days),
      };
    },
  );

  // Clone and sort events chronologically by JulianDayStart (tie-breaking by Priority, then original index)
  // so that out-of-order source JSON records never break left-to-right stack layout or Next/Prev navigation.
  const rawEvents: RawTimelineEvent[] = data.Events.map((e, originalIdx) => ({
    event: { ...e },
    originalIdx,
  }))
    .sort((a, b) => {
      const jdA = a.event.JulianDayStart ?? Number.MAX_SAFE_INTEGER;
      const jdB = b.event.JulianDayStart ?? Number.MAX_SAFE_INTEGER;
      if (jdA !== jdB) return jdA - jdB;
      if (a.event.Priority !== b.event.Priority) return a.event.Priority - b.event.Priority;
      return a.originalIdx - b.originalIdx;
    })
    .map((item) => item.event);

  if (endDate.getFullYear() >= nowDate.getFullYear()) {
    rawEvents.push({
      isPresent: true,
      Title: config.MainPanelView.PresentDay,
      Priority: 1,
    });
  }

  const eventStack: ComputedTimelineEvent[][] = Array.from(
    { length: options.eventStackSize },
    () => [],
  );

  let stackLevel = 0;
  const events: ComputedTimelineEvent[] = rawEvents.map((raw, i) => {
    const { startDate: evStart, endDate: evEnd } = raw.isPresent
      ? { startDate: nowDate, endDate: nowDate }
      : getEventDates(raw);

    const dayIndex = differenceInDays(evStart, startDate);
    const position = normalise(dayIndex, 0, days);
    // Legacy outerWidth(): 207px with thumbnail, 137px for .min (no thumbnail)
    const width = raw.ThumbnailPath ? 207 : 137;
    const assignedStack = stackLevel;

    if (stackLevel === options.eventStackSize - 1) {
      stackLevel = 0;
    } else {
      stackLevel++;
    }

    // Legacy outerHeight(true): 76px height + 25px margin-top = 101px per stack level
    const top = 101 * assignedStack;
    const cardHeight = raw.isPresent ? 35 : 76;
    const marginTop = raw.isPresent ? 65 : 25;
    const lineHeight = 350 - top - marginTop - cardHeight - (raw.isPresent ? 9 : 7);

    const computed: ComputedTimelineEvent = {
      ...raw,
      index: i,
      startDate: evStart,
      endDate: evEnd,
      position,
      width,
      stackLevel: assignedStack,
      leftPos: 0,
      top,
      lineHeight,
      isVisible: true,
    };

    eventStack[assignedStack].push(computed);
    return computed;
  });

  const associateEventsWithTick = (startY: number, endY: number): ComputedTimelineEvent[] => {
    const associated: ComputedTimelineEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.isPresent) break;
      const evYear = ev.startDate.getFullYear();
      if (evYear >= startY && evYear <= endY) {
        associated.push(ev);
      }
    }
    return associated;
  };

  const yearTicks: Tick[] = [];
  for (let y = startDate.getFullYear(); y < endDate.getFullYear(); y++) {
    yearTicks.push({
      startYear: y,
      endYear: y,
      events: associateEventsWithTick(y, y),
    });
  }

  const decadeTicks: Tick[] = [];
  if (decades > 0) {
    const startDecade = getDecade(startDate);
    const endDecade = getDecade(endDate);
    for (let d = startDecade; d < endDecade; d += 10) {
      decadeTicks.push({
        startYear: d,
        endYear: d + 9,
        events: associateEventsWithTick(d, d + 9),
      });
    }
  }

  const centuryTicks: Tick[] = [];
  if (centuries > 0) {
    const startCentury = getCentury(startDate);
    const endCentury = getCentury(endDate);
    for (let c = startCentury; c < endCentury; c += 100) {
      centuryTicks.push({
        startYear: c,
        endYear: c + 99,
        events: associateEventsWithTick(c, c + 99),
      });
    }
  }

  return {
    startDate,
    endDate,
    days,
    years,
    decades,
    centuries,
    events,
    backgroundEvents,
    eventStack,
    yearTicks,
    decadeTicks,
    centuryTicks,
  };
}

export function getMaxWidth(
  model: Pick<TimelineModel, 'years' | 'decades'>,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
): number {
  return Math.max(
    options.maxDecadeIntervalWidth * Math.max(1, model.decades),
    options.maxYearIntervalWidth * Math.max(1, model.years),
  );
}

export function getNextZoomWidth(
  currentContentWidth: number,
  direction: number,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
): number {
  const scaleFactor = Math.pow(options.zoomFactor, direction);
  return currentContentWidth * scaleFactor;
}

export function canZoom(
  direction: number,
  currentContentWidth: number,
  scrollWidth: number,
  model: Pick<TimelineModel, 'years' | 'decades'>,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
): boolean {
  const newWidth = getNextZoomWidth(currentContentWidth, direction, options);
  if (newWidth < scrollWidth) {
    return false;
  }
  if (newWidth > getMaxWidth(model, options)) {
    return false;
  }
  return true;
}

export function isMaxZoom(
  currentContentWidth: number,
  scrollWidth: number,
  model: Pick<TimelineModel, 'years' | 'decades'>,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
): boolean {
  return !canZoom(1, currentContentWidth, scrollWidth, model, options);
}

export function isMinZoom(
  currentContentWidth: number,
  scrollWidth: number,
  model: Pick<TimelineModel, 'years' | 'decades'>,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
): boolean {
  return !canZoom(-1, currentContentWidth, scrollWidth, model, options);
}

/**
 * Selects the active tick band (centuries, decades, or years) for a given content width.
 * Transitions to yearTicks whenever decade intervals exceed maxDecadeIntervalWidth (2000px),
 * even on multi-century timelines where total years >= maxTicks.
 */
export function selectActiveTicks(
  model: TimelineModel,
  availableWidth: number,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
): { band: TickBandType; ticks: Tick[] } {
  if (
    model.centuries > 0 &&
    availableWidth / model.centuries <= options.maxCenturyIntervalWidth
  ) {
    return { band: 'centuries', ticks: model.centuryTicks };
  }
  if (model.decades > 0 && availableWidth / model.decades <= options.maxDecadeIntervalWidth) {
    return { band: 'decades', ticks: model.decadeTicks };
  }
  if (model.yearTicks.length > 0) {
    return { band: 'years', ticks: model.yearTicks };
  }
  return { band: 'decades', ticks: model.decadeTicks };
}

/**
 * Updates leftPos and runs a priority-ordered, two-pass 3-level vertical stack collision
 * resolution algorithm:
 * - Eliminates "zombie suppression" (a lower-priority event that loses to a higher-priority
 *   event can never prematurely hide an earlier neighbor).
 * - Preserves each event's primary round-robin stack row (index % 3) in Pass 1 when free,
 *   and spills colliding events into any open vertical row in Pass 2 so dense decades
 *   utilize all 3 rows instead of leaving empty gaps.
 * - Keeps collision detection active at all zoom levels (including max zoom) so co-located
 *   same-year cards never pile on top of one another, while guaranteeing forcedVisibleIndex
 *   (the actively selected event) always wins its slot.
 */
export function computeEventLayoutAndVisibility(
  model: TimelineModel,
  contentWidth: number,
  _scrollWidth: number,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
  forcedVisibleIndex = -1,
): ComputedTimelineEvent[] {
  const events: ComputedTimelineEvent[] = model.events.map((ev) => ({
    ...ev,
    leftPos: Math.ceil(ev.position * contentWidth),
    isVisible: false,
  }));

  const stackCount = Math.max(1, options.eventStackSize);
  const placedInStack: ComputedTimelineEvent[][] = Array.from({ length: stackCount }, () => []);

  const canFitInStack = (ev: ComputedTimelineEvent, stackIdx: number): boolean => {
    const evStart = ev.leftPos;
    const evEnd = ev.leftPos + ev.width + 10; // 10px minimum horizontal gap
    for (const placed of placedInStack[stackIdx]) {
      const placedStart = placed.leftPos;
      const placedEnd = placed.leftPos + placed.width + 10;
      if (evStart < placedEnd && placedStart < evEnd) {
        return false;
      }
    }
    return true;
  };

  const assignToStack = (ev: ComputedTimelineEvent, stackIdx: number) => {
    ev.stackLevel = stackIdx;
    ev.top = 101 * stackIdx;
    const cardHeight = ev.isPresent ? 35 : 76;
    const marginTop = ev.isPresent ? 65 : 25;
    ev.lineHeight = 350 - ev.top - marginTop - cardHeight - (ev.isPresent ? 9 : 7);
    ev.isVisible = true;
    placedInStack[stackIdx].push(ev);
  };

  const candidates = [...events].sort((a, b) => {
    if (a.index === forcedVisibleIndex) return -1;
    if (b.index === forcedVisibleIndex) return 1;
    if (a.Priority !== b.Priority) return a.Priority - b.Priority;
    return a.index - b.index;
  });

  // Pass 1: Place non-colliding events on their primary round-robin stack row (ev.index % stackCount)
  const unplaced: ComputedTimelineEvent[] = [];
  for (const ev of candidates) {
    if (canFitInStack(ev, ev.stackLevel)) {
      assignToStack(ev, ev.stackLevel);
    } else {
      unplaced.push(ev);
    }
  }

  // Pass 2: Spillover — allow colliding events in dense clusters to occupy an open slot on another row
  for (const ev of unplaced) {
    for (let offset = 1; offset < stackCount; offset++) {
      const altStack = (ev.stackLevel + offset) % stackCount;
      if (canFitInStack(ev, altStack)) {
        assignToStack(ev, altStack);
        break;
      }
    }
  }

  return events;
}

/**
 * Calculates the horizontal scroll offset (negative px) to center a given event.
 * Strictly ports mainPanelView.js _getEventScrollPosition and _scrollToPosition.
 */
export function getEventScrollPosition(
  evnt: Pick<ComputedTimelineEvent, 'position'>,
  contentWidth: number,
  scrollWidth: number,
): number {
  const rawPos = Math.floor(evnt.position * contentWidth - scrollWidth / 2 + 100) * -1;
  const min = Math.min(0, (contentWidth - scrollWidth) * -1);
  return clamp(rawPos, min, 0);
}

/**
 * Recursive auto-zoom search (_zoomUntilVisible):
 * Steps through zoom-in levels (scaling contentWidth by zoomFactor = 3 each step)
 * until the target event is no longer hidden by collision rules (or max zoom is reached).
 */
export function computeZoomUntilVisible(
  model: TimelineModel,
  targetEventIndex: number,
  initialZoomLevel: number,
  baseWidth: number,
  scrollWidth: number,
  options: TimelineProviderOptions = DEFAULT_PROVIDER_OPTIONS,
): {
  zoomLevel: number;
  contentWidth: number;
  scrollX: number;
  events: ComputedTimelineEvent[];
} {
  let zoomLevel = initialZoomLevel;
  let contentWidth = baseWidth * Math.pow(options.zoomFactor, zoomLevel);
  let layoutEvents = computeEventLayoutAndVisibility(model, contentWidth, scrollWidth, options);

  while (
    targetEventIndex >= 0 &&
    targetEventIndex < layoutEvents.length &&
    !layoutEvents[targetEventIndex].isVisible &&
    canZoom(1, contentWidth, scrollWidth, model, options)
  ) {
    zoomLevel += 1;
    contentWidth = baseWidth * Math.pow(options.zoomFactor, zoomLevel);
    layoutEvents = computeEventLayoutAndVisibility(model, contentWidth, scrollWidth, options);
  }

  // If max zoom was reached and the target event still collided with 3 co-located events,
  // force it to take priority on its stack row so it is guaranteed visible.
  if (
    targetEventIndex >= 0 &&
    targetEventIndex < layoutEvents.length &&
    !layoutEvents[targetEventIndex].isVisible
  ) {
    layoutEvents = computeEventLayoutAndVisibility(
      model,
      contentWidth,
      scrollWidth,
      options,
      targetEventIndex,
    );
  }

  const targetEvent = layoutEvents[targetEventIndex];
  const scrollX = targetEvent
    ? getEventScrollPosition(targetEvent, contentWidth, scrollWidth)
    : 0;

  return {
    zoomLevel,
    contentWidth,
    scrollX,
    events: layoutEvents,
  };
}
