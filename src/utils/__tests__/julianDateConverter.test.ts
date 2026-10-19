import { describe, expect, it } from 'vitest';
import {
  buildTimelineModel,
  computeEventLayoutAndVisibility,
  computeZoomUntilVisible,
  selectActiveTicks,
} from '../../engine/timelineEngine';
import rawSampleText from '../../sample_data_2.js?raw';
import { JULIAN_DAY_END_SENTINEL, TimelineData } from '../../types/timeline';
import {
  cal_to_jd,
  getEventDates,
  julianDayToDate,
  julianToGregorian,
  parseTimelineJson,
} from '../julianDateConverter';

describe('Julian Day Calendar Math (Press et al.)', () => {
  it('rejects Year 0 as invalid in the Julian system', () => {
    expect(cal_to_jd('CE', 0, 1, 1)).toBe('invalid');
    expect(cal_to_jd('BCE', 0, 6, 15)).toBe('invalid');
  });

  it('rejects dates 5 through 14 October 1582 during the Gregorian transition', () => {
    for (let day = 5; day <= 14; day++) {
      expect(cal_to_jd('CE', 1582, 10, day)).toBe('invalid');
    }
  });

  it('handles consecutive Julian Days across the 4 Oct -> 15 Oct 1582 Gregorian transition', () => {
    const jdOct4 = cal_to_jd('CE', 1582, 10, 4, 12, 0, 0);
    const jdOct15 = cal_to_jd('CE', 1582, 10, 15, 12, 0, 0);
    expect(jdOct4).toBe(2299160);
    expect(jdOct15).toBe(2299161);

    expect(julianToGregorian(2299160)).toMatchObject({
      year: 1582,
      month: 10,
      day: 4,
      era: 'AD',
    });
    expect(julianToGregorian(2299161)).toMatchObject({
      year: 1582,
      month: 10,
      day: 15,
      era: 'AD',
    });
  });

  it('correctly converts ancient BCE dates to Julian Day and back', () => {
    // 44 BCE March 15 (Ides of March)
    const jd = cal_to_jd('BCE', 44, 3, 15, 12, 0, 0);
    expect(typeof jd).toBe('number');
    const greg = julianToGregorian(jd as number);
    expect(greg.era).toBe('BC');
    expect(greg.year).toBe(44);
    expect(greg.month).toBe(3);
    expect(greg.day).toBe(15);
  });

  it('converts Darwin 1859 JulianDayStart (2400046) accurately', () => {
    const greg = julianToGregorian(2400046);
    expect(greg.year).toBe(1859);
    expect(greg.era).toBe('AD');
    const date = julianDayToDate(2400046);
    expect(date.getFullYear()).toBe(1859);
  });

  it('handles the 64-bit minimum integer sentinel (-9223372036854775808) for point-in-time events', () => {
    const { startDate, endDate } = getEventDates({
      JulianDayStart: 2402603,
      JulianDayEnd: JULIAN_DAY_END_SENTINEL,
    });
    expect(startDate.getTime()).toBe(endDate.getTime());
    expect(startDate.getFullYear()).toBe(1866);
  });
});

describe('Legacy Data Parsing & Engine Verification (sample_data_2.js)', () => {
  it('strips UTF-8 BOM and parses all 141 events from sample_data_2.js', () => {
    expect(rawSampleText.charCodeAt(0)).toBe(0xfeff);
    const data = parseTimelineJson(rawSampleText);
    expect(data.Title).toBe('The history of genetics: from Darwin to the 21st century');
    expect(data.Events).toHaveLength(141);
  });

  it('aligns startDate to January 1 (monthIndex 0) and synthesizes Present Day event', () => {
    const data = parseTimelineJson(rawSampleText);
    const model = buildTimelineModel(data);
    expect(model.startDate.getFullYear()).toBe(1800);
    expect(model.startDate.getMonth()).toBe(0);
    expect(model.startDate.getDate()).toBe(1);
    expect(model.events).toHaveLength(142);
    const lastEvent = model.events[model.events.length - 1];
    expect(lastEvent.isPresent).toBe(true);
    expect(lastEvent.Title).toBe('Present Day');
  });

  it('sorts out-of-order source JSON events chronologically so positions never decrease', () => {
    const data = parseTimelineJson(rawSampleText);
    // Inject an out-of-order event pair (year 2000 before year 1999) to verify chronological sorting
    const reversedData: TimelineData = {
      ...data,
      Events: [
        ...data.Events,
        {
          EventId: 99002,
          Title: 'Later Event (2000)',
          Priority: 2,
          JulianDayStart: 2451722,
        },
        {
          EventId: 99001,
          Title: 'Earlier Event (1999)',
          Priority: 2,
          JulianDayStart: 2451515,
        },
      ],
    };
    const model = buildTimelineModel(reversedData);
    const nonPresent = model.events.filter((e) => !e.isPresent);
    for (let i = 1; i < nonPresent.length; i++) {
      expect(nonPresent[i].position).toBeGreaterThanOrEqual(nonPresent[i - 1].position);
    }
    const idx1999 = model.events.findIndex((e) => Number(e.EventId) === 99001);
    const idx2000 = model.events.findIndex((e) => Number(e.EventId) === 99002);
    expect(idx1999).toBeGreaterThan(-1);
    expect(idx1999).toBeLessThan(idx2000);
  });

  it('distributes events round-robin across 3 vertical stack levels and zooms to reveal #15452', () => {
    const data = parseTimelineJson(rawSampleText);
    const model = buildTimelineModel(data);

    expect(model.events[0].stackLevel).toBe(0);
    expect(model.events[1].stackLevel).toBe(1);
    expect(model.events[2].stackLevel).toBe(2);
    expect(model.events[3].stackLevel).toBe(0);

    // Find Friedrich Miescher (EventId 15452, index 3)
    const miescherIndex = model.events.findIndex((e) => Number(e.EventId) === 15452);
    expect(miescherIndex).toBe(3);

    // At initial zoom (level 0, width 1240px), Miescher (1871, stackLevel 0) collides with Darwin (1859, stackLevel 0)
    const initialEvents = computeEventLayoutAndVisibility(model, 1240, 1200);
    expect(initialEvents[0].isVisible).toBe(true); // Darwin (1859)
    expect(initialEvents[miescherIndex].isVisible).toBe(false); // Miescher (1871) hidden at zoom 0

    // Recursive _zoomUntilVisible must step zoomLevel > 0 until Miescher is visible
    const zoomed = computeZoomUntilVisible(model, miescherIndex, 0, 1240, 1200);
    expect(zoomed.zoomLevel).toBeGreaterThan(0);
    expect(zoomed.events[miescherIndex].isVisible).toBe(true);
  });

  it('transitions multi-century timelines from centuries -> decades -> years ticks as zoom increases', () => {
    const data = parseTimelineJson(rawSampleText);
    const model = buildTimelineModel(data);

    expect(selectActiveTicks(model, 1280).band).toBe('centuries');
    expect(selectActiveTicks(model, 3840).band).toBe('decades');
    expect(selectActiveTicks(model, 34560).band).toBe('decades');
    expect(selectActiveTicks(model, 103680).band).toBe('years');
  });

  it('prevents zombie suppression and never allows overlapping visible cards on the same stack row even at max zoom', () => {
    const syntheticData: TimelineData = {
      Title: 'Dense Decade Test',
      FeatureImagePath: '',
      Body: '',
      InitialCaption: '',
      IsOpenEnded: false,
      EarliestJulianDay: 2447893, // 1990-01-01
      StartDateDisplay: '1990',
      LastJulianDay: 2451179, // 1998-12-31
      EndDateDisplay: '1998',
      Events: [
        // B (index 0, stack 0), A (index 3, stack 0), C (index 6, stack 0)
        // where middle event A (Priority 2) has higher priority than B (Priority 3),
        // and C (Priority 1) has higher priority than A, while B and C do not overlap each other:
        { EventId: 1, Title: 'B (early)', Priority: 3, JulianDayStart: 2447900 },
        { EventId: 2, Title: 'Row1 filler', Priority: 1, JulianDayStart: 2447901 },
        { EventId: 3, Title: 'Row2 filler', Priority: 1, JulianDayStart: 2447902 },
        { EventId: 4, Title: 'A (middle)', Priority: 2, JulianDayStart: 2448200 },
        { EventId: 5, Title: 'Row1 filler 2', Priority: 1, JulianDayStart: 2448201 },
        { EventId: 6, Title: 'Row2 filler 2', Priority: 1, JulianDayStart: 2448202 },
        { EventId: 7, Title: 'C (late winner)', Priority: 1, JulianDayStart: 2448500 },
      ],
    };

    const model = buildTimelineModel(syntheticData);
    // Choose a width where 300 days is ~110px (< 147px min card width + 10px gap),
    // so B (day 7) overlaps A (day 307), and A (day 307) overlaps C (day 607),
    // but B (day 7) does NOT overlap C (day 607, ~220px away >= 147px)!
    const layout = computeEventLayoutAndVisibility(model, 1200, 1000);
    const evB = layout.find((e) => e.EventId === 1)!;
    const evA = layout.find((e) => e.EventId === 4)!;
    const evC = layout.find((e) => e.EventId === 7)!;

    expect(evC.isVisible).toBe(true);
    expect(evA.isVisible).toBe(false);
    // B must survive because A was defeated by C (no zombie suppression)
    expect(evB.isVisible).toBe(true);

    // Also verify across sample_data_2 at max zoom (150,000px) that no two visible cards on the same row ever overlap
    const sampleModel = buildTimelineModel(parseTimelineJson(rawSampleText));
    const maxZoomLayout = computeEventLayoutAndVisibility(sampleModel, 150000, 1200);
    for (let s = 0; s < 3; s++) {
      const rowEvents = maxZoomLayout
        .filter((e) => e.isVisible && e.stackLevel === s)
        .sort((a, b) => a.leftPos - b.leftPos);
      for (let i = 1; i < rowEvents.length; i++) {
        expect(rowEvents[i].leftPos).toBeGreaterThanOrEqual(
          rowEvents[i - 1].leftPos + rowEvents[i - 1].width + 10,
        );
      }
    }
  });
});
