import { RawTimelineEvent, TimelineData } from '../types/timeline';

export type CalendarEra = 'BCE' | 'CE' | 'BC' | 'AD';

export interface GregorianDateResult {
  year: number;
  month: number;
  day: number;
  era: 'BC' | 'AD';
  hour: number;
  minute: number;
  second: number;
}

/**
 * Convert calendar date to Julian Day number.
 * Strict port of Press et al. algorithm from legacy julianDateConverter.js.
 */
export function cal_to_jd(
  era: CalendarEra,
  y: number,
  m: number,
  d: number,
  h = 12,
  mn = 0,
  s = 0,
): number | 'invalid' {
  let jy: number;
  let ja: number;
  let jm: number;

  if (y === 0) {
    return 'invalid';
  }
  if (y === 1582 && m === 10 && d > 4 && d < 15) {
    return 'invalid';
  }

  let adjustedYear = y;
  if (era === 'BCE' || era === 'BC') {
    adjustedYear = -y + 1;
  }

  if (m > 2) {
    jy = adjustedYear;
    jm = m + 1;
  } else {
    jy = adjustedYear - 1;
    jm = m + 13;
  }

  let intgr = Math.floor(Math.floor(365.25 * jy) + Math.floor(30.6001 * jm) + d + 1720995);

  // Check for switch to Gregorian calendar (15 October 1582)
  const gregcal = 15 + 31 * (10 + 12 * 1582);
  if (d + 31 * (m + 12 * adjustedYear) >= gregcal) {
    ja = Math.floor(0.01 * jy);
    intgr += 2 - ja + Math.floor(0.25 * ja);
  }

  // Correct for half-day offset
  let dayfrac = h / 24.0 - 0.5;
  if (dayfrac < 0.0) {
    dayfrac += 1.0;
    --intgr;
  }

  // Set the fraction of a day
  const frac = dayfrac + (mn + s / 60.0) / 60.0 / 24.0;

  // Round to nearest second
  const jd0 = (intgr + frac) * 100000;
  let jd = Math.floor(jd0);
  if (jd0 - jd > 0.5) {
    ++jd;
  }
  return jd / 100000;
}

/**
 * Convert Julian Day number to calendar date.
 * Strict port of Press et al. algorithm from legacy julianDateConverter.js.
 */
export function julianToGregorian(jd: number): GregorianDateResult {
  let j1: number;

  const intgr = Math.floor(jd);
  const frac = jd - intgr;
  const gregjd = 2299161;

  if (intgr >= gregjd) {
    // Gregorian calendar correction
    const tmp = Math.floor((intgr - 1867216 - 0.25) / 36524.25);
    j1 = intgr + 1 + tmp - Math.floor(0.25 * tmp);
  } else {
    j1 = intgr;
  }

  // Correction for half day offset
  let dayfrac = frac + 0.5;
  if (dayfrac >= 1.0) {
    dayfrac -= 1.0;
    ++j1;
  }

  const j2 = j1 + 1524;
  const j3 = Math.floor(6680.0 + (j2 - 2439870 - 122.1) / 365.25);
  const j4 = Math.floor(j3 * 365.25);
  const j5 = Math.floor((j2 - j4) / 30.6001);

  const d = Math.floor(j2 - j4 - Math.floor(j5 * 30.6001));
  let m = Math.floor(j5 - 1);
  if (m > 12) m -= 12;
  let y = Math.floor(j3 - 4715);
  if (m > 2) --y;
  if (y <= 0) --y;

  // Get time of day from day fraction
  const hr = Math.floor(dayfrac * 24.0);
  const mn = Math.floor((dayfrac * 24.0 - hr) * 60.0);
  let f = ((dayfrac * 24.0 - hr) * 60.0 - mn) * 60.0;
  let sc = Math.floor(f);
  f -= sc;
  if (f > 0.5) ++sc;

  let era: 'BC' | 'AD';
  if (y < 0) {
    y = -y;
    era = 'BC';
  } else {
    era = 'AD';
  }

  return {
    year: y,
    month: m,
    day: d,
    era,
    hour: hr,
    minute: mn,
    second: sc,
  };
}

/**
 * Converts a Julian Day number into a JavaScript Date object, preserving exact legacy
 * behavior while supporting years 0-99 AD and BCE via setFullYear.
 */
export function julianDayToDate(julianDay: number): Date {
  const dateObj = julianToGregorian(julianDay);
  const signedYear = dateObj.era === 'BC' ? -(dateObj.year - 1) : dateObj.year;
  const d = new Date(signedYear, dateObj.month - 1, dateObj.day, 0, 0, 0, 0);
  d.setFullYear(signedYear, dateObj.month - 1, dateObj.day);
  return d;
}

/**
 * Computes event start and end Date objects from JulianDayStart and JulianDayEnd,
 * honoring the negative sentinel (-9223372036854775808) for single-point events.
 */
export function getEventDates(evnt: Pick<RawTimelineEvent, 'JulianDayStart' | 'JulianDayEnd'>): {
  startDate: Date;
  endDate: Date;
} {
  const jdStart = evnt.JulianDayStart ?? 2400000;
  const startDate = julianDayToDate(jdStart);
  const jdEnd = evnt.JulianDayEnd ?? -1;
  const endDate = jdEnd < 0 ? julianDayToDate(jdStart) : julianDayToDate(jdEnd);
  return { startDate, endDate };
}

/**
 * Strips any leading UTF-8 Byte Order Mark (\uFEFF) and parses timeline JSON.
 */
export function parseTimelineJson(rawText: string): TimelineData {
  const cleaned = rawText.replace(/^\uFEFF/, '').trim();
  return JSON.parse(cleaned) as TimelineData;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalise(num: number, min: number, max: number): number {
  if (max === min) return 0;
  return (num - min) / (max - min);
}

export function ellipsis(text: string, chars: number): string {
  if (!text || text.length <= chars) return text;
  let trimmedText = text.substring(0, chars);
  const lastSpace = trimmedText.lastIndexOf(' ');
  if (lastSpace > 0) {
    trimmedText = trimmedText.substring(0, Math.min(trimmedText.length, lastSpace));
  }
  return `${trimmedText}\u2026`;
}
