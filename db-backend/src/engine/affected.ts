import type { ExceptionRule } from "./types";
import { atTime, overlaps } from "./time";

const LIVE = new Set(["held", "pending_approval", "confirmed"]);

export interface AffectedAppointment {
  date: string;
  startAt: Date;
  endAt: Date;
  status: string;
}

export function isAffected(
  appointment: AffectedAppointment,
  exception: ExceptionRule,
  timezone: string
): boolean {
  if (!LIVE.has(appointment.status)) return false;
  if (appointment.date < exception.startDate || appointment.date > exception.endDate) {
    return false;
  }
  if (exception.type === "leave" || exception.type === "holiday") return true;
  if (exception.type === "daily_cap") return false;
  if (exception.type === "block") {
    const start = appointment.startAt.getTime();
    const end = appointment.endAt.getTime();
    if (exception.startAt && exception.endAt) {
      return overlaps(start, end, new Date(exception.startAt).getTime(), new Date(exception.endAt).getTime());
    }
    if (!exception.startTime || !exception.endTime) return false;
    return overlaps(
      start,
      end,
      atTime(appointment.date, exception.startTime, timezone).toMillis(),
      atTime(appointment.date, exception.endTime, timezone).toMillis()
    );
  }
  if (exception.type === "special_hours") {
    const sessions = exception.sessions || [];
    const inside = sessions.some((session) => {
      const open = atTime(appointment.date, session.start, timezone).toMillis();
      const close = atTime(appointment.date, session.end, timezone).toMillis();
      return appointment.startAt.getTime() >= open && appointment.endAt.getTime() <= close;
    });
    return !inside;
  }
  return false;
}
