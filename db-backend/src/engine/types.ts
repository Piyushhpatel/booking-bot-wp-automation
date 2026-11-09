export type SessionMode = "fixed" | "token";

export type AppointmentStatus =
  | "held"
  | "pending_approval"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

export type ClosedReason =
  | "bookings_paused"
  | "outside_window"
  | "holiday"
  | "leave"
  | "not_working"
  | "notice"
  | "full";

export interface SessionRule {
  id: string;
  name: string;
  start: string;
  end: string;
  mode: SessionMode;
  slotMinutes: number;
  sessionCap: number;
  bufferMinutes: number;
}

export interface DayRule {
  weekday: number;
  isWorking: boolean;
  sessions: SessionRule[];
}

export interface BreakRule {
  weekday: number | null;
  start: string;
  end: string;
  label: string;
}

export type ExceptionKind =
  | "leave"
  | "holiday"
  | "block"
  | "special_hours"
  | "daily_cap";

export interface ExceptionRule {
  type: ExceptionKind;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  startAt?: string;
  endAt?: string;
  sessions?: SessionRule[];
  dailyCap?: number;
  reason?: string;
}

/** Occupied window. `endAt` is exclusive and already includes that visit's buffer. */
export interface BusyInterval {
  startAt: Date;
  endAt: Date;
  sessionId: string;
  countsTowardCap: boolean;
}

export interface AvailabilityInput {
  date: string;
  now: Date;
  timezone: string;
  weekdayRules: DayRule[];
  breaks: BreakRule[];
  exceptions: ExceptionRule[];
  busy: BusyInterval[];
  durationMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  dailyCap: number;
  bookingsOpen: boolean;
  gridMinutes: number;
}

export interface SlotOffer {
  sessionId: string;
  sessionName: string;
  mode: SessionMode;
  startAt: string;
  endAt: string;
  label: string;
  tokenPreview?: number;
  bufferMinutes: number;
}

export interface AvailabilityResult {
  slots: SlotOffer[];
  closedReason?: ClosedReason;
}
