import { Appointment, AppointmentDoc } from "../models/booking";
import { formatClock } from "../engine/time";

const HIDDEN = ["cancelled", "rescheduled", "held"];

export async function visibleDay(doctorId: string, date: string): Promise<AppointmentDoc[]> {
  return Appointment.find({
    doctorId,
    date,
    status: { $nin: HIDDEN },
  }).sort({ startAt: 1 });
}

export function statusLabel(status: string): string {
  if (status === "pending_approval") return "pending";
  if (status === "no_show") return "no-show";
  if (status === "completed") return "done";
  return status;
}

export function renderDay(timezone: string, heading: string, rows: AppointmentDoc[]): string {
  const lines = rows.map((row, index) => {
    const time = formatClock(row.startAt.toISOString(), timezone);
    const token = row.tokenNumber ? ` #${row.tokenNumber}` : "";
    return `${index + 1}. ${time}${token} · ${row.patientName} · ${row.typeName} · ${statusLabel(row.status)}`;
  });
  return `${heading}\n${lines.length ? lines.join("\n") : "No appointments."}\n\nNumbers match this list.\ndone 1 · noshow 1 · cancel 1`;
}
