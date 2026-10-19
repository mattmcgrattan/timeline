export const JULIAN_DAY_END_SENTINEL = -9223372036854775808;

export interface RawTimelineEvent {
  EventId?: number | string;
  Title: string;
  Body?: string;
  Priority: number;
  Year?: string;
  StartDisplayYear?: string;
  StartDisplay?: string;
  EndDisplayYear?: string | null;
  EndDisplay?: string | null;
  JulianDayStart?: number;
  JulianDayEnd?: number;
  ThumbnailPath?: string | null;
  FeatureImagePath?: string | null;
  PromoImagePath?: string | null;
  LinkText?: string | null;
  LinkTarget?: string | null;
  ImageCredit?: string | null;
  UsedBy?: string[];
  FirstUsage?: string | null;
  isPresent?: boolean;
}

export interface RawBackgroundEvent {
  EventId: number | string;
  Title: string;
  JulianDayStart: number;
  StartDisplay: string;
  StartDisplayYear: string;
  JulianDayEnd: number;
  EndDisplay: string | null;
  EndDisplayYear: string | null;
}

export interface TimelineData {
  Title: string;
  FeatureImagePath: string;
  Body: string;
  InitialCaption: string;
  IsOpenEnded: boolean;
  EarliestJulianDay: number;
  StartDateDisplay: string;
  LastJulianDay: number;
  EndDateDisplay: string;
  BackgroundEvents?: RawBackgroundEvent[];
  Events: RawTimelineEvent[];
}

export interface TimelineConfig {
  Settings: {
    DataNotFoundMessage: string;
    EmbedEnabled: string;
  };
  HeaderPanelView: {
    ZoomIn: string;
    ZoomOut: string;
  };
  MainPanelView: {
    PresentDay: string;
  };
  DetailsPanelView: {
    Previous: string;
    Next: string;
  };
  EmbedView: {
    Title: string;
    EmbedInstructions: string;
  };
}

export interface TimelineProviderOptions {
  maxTicks: number;
  maxYearIntervalWidth: number;
  maxDecadeIntervalWidth: number;
  maxCenturyIntervalWidth: number;
  zoomAnimationDuration: number;
  eventFadeDuration: number;
  zoomFactor: number;
  eventStackSize: number;
  padding: number;
}

export interface ComputedTimelineEvent extends RawTimelineEvent {
  index: number;
  startDate: Date;
  endDate: Date;
  position: number;
  width: number;
  stackLevel: number;
  leftPos: number;
  top: number;
  lineHeight: number;
  isVisible: boolean;
  isPresent?: boolean;
}

export interface ComputedBackgroundEvent extends RawBackgroundEvent {
  index: number;
  startDate: Date;
  endDate: Date;
  startPosition: number;
  endPosition: number;
}

export interface Tick {
  startYear: number;
  endYear: number;
  events: ComputedTimelineEvent[];
}

export type TickBandType = 'centuries' | 'decades' | 'years';
