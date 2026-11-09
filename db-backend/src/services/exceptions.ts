import { DateTime } from "luxon";
import { isAffected } from "../engine/affected";
import type { ExceptionRule, SessionRule } from "../engine/types";
import { isHHmm } from "../engine/time";
import { validateSession } from "../engine/schedule";
import { HttpError } from "../httpError";
import { Appointment, AppointmentDoc } from "../models/booking";
import { DoctorDoc, ScheduleException, ScheduleExceptionDoc } from "../models/clinic";
import { recordAudit } from "./audit";
import { requireClinic } from "./clinic";
import { setAppointmentStatus } from "./booking";

export interface ExceptionInput {
  type: ExceptionRule["type"];
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  startAt?: string;
  endAt?: string;
  sessions?: SessionRule[];
  dailyCap?: number;
  reason?: string;
  cancelAffected?: boolean;
  actorId?: string;
  actorRole?: string;
}

export async function saveException(
  doctorId: string,
  input: ExceptionInput
): Promise<{ exception: ScheduleExceptionDoc; affected: AppointmentDoc[] }> {
  const doctor = await requireClinic(doctorId);
  const normalized = normalizeException(input, doctor);
  if (normalized.type === "daily_cap") {
    await ScheduleException.deleteMany({
      doctorId,
      type: "daily_cap",
      startDate: { $lte: normalized.endDate },
      endDate: { $gte: normalized.startDate },
    });
  }
  const exception = await ScheduleException.create({
    doctorId,
    ...normalized,
    createdBy: input.actorId,
  });
  const affected = await affectedBy(doctor, exception);
  if (input.cancelAffected) {
    for (const appointment of affected) {
      await setAppointmentStatus({
        doctorId,
        appointmentId: String(appointment._id),
        status: "cancelled",
        reason: exception.type,
        actorId: input.actorId,
        actorRole: input.actorRole,
        promote: false,
      });
    }
  }
  await recordAudit({
    doctorId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "schedule.exception",
    entity: "exception",
    entityId: String(exception._id),
    summary: `${exception.type} ${exception.startDate} to ${exception.endDate}${input.cancelAffected ? `, cancelled ${affected.length}` : ""}`,
  });
  return { exception, affected };
}

export async function cancelAffectedBookings(
  doctorId: string,
  exceptionId: string,
  actorId?: string,
  actorRole?: string
): Promise<AppointmentDoc[]> {
  const doctor = await requireClinic(doctorId);
  const exception = await ScheduleException.findOne({ _id: exceptionId, doctorId });
  if (!exception) throw new HttpError(404, "That exception was not found.");
  const affected = await affectedBy(doctor, exception);
  for (const appointment of affected) {
    await setAppointmentStatus({
      doctorId,
      appointmentId: String(appointment._id),
      status: "cancelled",
      reason: exception.type,
      actorId,
      actorRole,
      promote: false,
    });
  }
  await recordAudit({
    doctorId,
    actorId,
    actorRole,
    action: "schedule.cancel_affected",
    entity: "exception",
    entityId: String(exception._id),
    summary: `Cancelled ${affected.length} bookings`,
  });
  return affected;
}

export async function affectedBy(doctor: DoctorDoc, exception: ScheduleExceptionDoc): Promise<AppointmentDoc[]> {
  const rows = await Appointment.find({
    doctorId: doctor._id,
    date: { $gte: exception.startDate, $lte: exception.endDate },
    status: { $in: ["held", "pending_approval", "confirmed"] },
  });
  const rule = toRule(exception);
  return rows.filter((row) =>
    isAffected(
      { date: row.date, startAt: row.startAt, endAt: row.endAt, status: row.status },
      rule,
      doctor.timezone
    )
  );
}

function toRule(exception: ScheduleExceptionDoc): ExceptionRule {
  return {
    type: exception.type,
    startDate: exception.startDate,
    endDate: exception.endDate,
    startTime: exception.startTime,
    endTime: exception.endTime,
    startAt: exception.startAt ? exception.startAt.toISOString() : undefined,
    endAt: exception.endAt ? exception.endAt.toISOString() : undefined,
    sessions: exception.sessions,
    dailyCap: exception.dailyCap,
    reason: exception.reason,
  };
}

function normalizeException(input: ExceptionInput, doctor: DoctorDoc): Omit<ExceptionInput, "cancelAffected" | "actorId" | "actorRole"> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
    throw new HttpError(400, "Use dates as YYYY-MM-DD.");
  }
  if (input.startDate > input.endDate) throw new HttpError(400, "The end date is before the start date.");
  if (input.type === "block" && input.startAt && input.endAt) {
    const start = new Date(input.startAt);
    const end = new Date(input.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new HttpError(400, "That block range is not valid.");
    }
    const zone = doctor.timezone;
    return {
      type: "block",
      startDate: DateTime.fromJSDate(start, { zone }).toISODate()!,
      endDate: DateTime.fromJSDate(end, { zone }).toISODate()!,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      reason: input.reason,
    };
  }
  if (input.type === "block") {
    if (!input.startTime || !input.endTime || !isHHmm(input.startTime) || !isHHmm(input.endTime) || input.startTime >= input.endTime) {
      throw new HttpError(400, "A block needs a start and end time.");
    }
  }
  if (input.type === "daily_cap") {
    if (input.dailyCap == null || input.dailyCap < 0 || input.dailyCap > 200) {
      throw new HttpError(400, "The daily cap must be between 0 and 200.");
    }
  }
  if (input.type === "special_hours") {
    if (!input.sessions?.length) throw new HttpError(400, "Special hours need at least one session.");
    for (const session of input.sessions) {
      const problem = validateSession(session, doctor.gridMinutes);
      if (problem) throw new HttpError(400, problem);
    }
  }
  return {
    type: input.type,
    startDate: input.startDate,
    endDate: input.endDate,
    startTime: input.startTime,
    endTime: input.endTime,
    sessions: input.sessions,
    dailyCap: input.dailyCap,
    reason: (input.reason || "").slice(0, 200),
  };
}
