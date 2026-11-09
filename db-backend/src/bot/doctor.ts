import { DateTime } from "luxon";
import { parseDoctorCommand } from "../engine/commands";
import { clinicNow, formatWhen } from "../engine/time";
import { Appointment } from "../models/booking";
import { DoctorDoc } from "../models/clinic";
import { ConversationDoc, loadConversation, saveDraft } from "../models/system";
import { setAppointmentStatus } from "../services/booking";
import { saveException } from "../services/exceptions";
import { sendText } from "../services/whatsapp";

export async function handleDoctor(doctor: DoctorDoc, phone: string, text: string): Promise<void> {
  const convo = await loadConversation(String(doctor._id), phone, "doctor");
  const command = parseDoctorCommand(text, clinicNow(doctor.timezone));
  try {
    switch (command.type) {
      case "help":
        return sendText(phone, "today | tomorrow | bookings 15 Oct | next | done 5 | noshow 5 | cancel 5 | block today 2pm-4pm | leave 20 Oct-22 Oct | close bookings | open bookings | limit 20 | summary | patient 98xxxxxx");
      case "today":
        return sendDay(doctor, phone, clinicNow(doctor.timezone).toISODate()!);
      case "tomorrow":
        return sendDay(doctor, phone, clinicNow(doctor.timezone).plus({ days: 1 }).toISODate()!);
      case "day":
        return sendDay(doctor, phone, command.date);
      case "next":
        return sendNext(doctor, phone);
      case "done":
        return changePosition(doctor, phone, command.n, "completed");
      case "noshow":
        return changePosition(doctor, phone, command.n, "no_show");
      case "cancel":
        return changePosition(doctor, phone, command.n, "cancelled");
      case "close":
        doctor.bookingsOpen = false;
        await doctor.save();
        return sendText(phone, "New bookings are paused.");
      case "open":
        doctor.bookingsOpen = true;
        await doctor.save();
        return sendText(phone, "New bookings are open.");
      case "limit":
        return setTodayLimit(doctor, phone, command.n);
      case "summary":
        return sendSummary(doctor, phone);
      case "patient":
        return sendPatientHistory(doctor, phone, command.phone);
      case "block":
        await saveException(String(doctor._id), {
          type: "block",
          startDate: command.date,
          endDate: command.date,
          startTime: command.start,
          endTime: command.end,
          actorRole: "doctor",
        });
        return sendText(phone, `Blocked ${command.date} from ${command.start} to ${command.end}. Existing bookings were left for review.`);
      case "block_next":
        return blockNext(doctor, phone, command.hours);
      case "leave":
        await saveException(String(doctor._id), {
          type: "leave",
          startDate: command.startDate,
          endDate: command.endDate,
          actorRole: "doctor",
        });
        return sendText(phone, `Leave saved from ${command.startDate} to ${command.endDate}. Existing bookings were left for review.`);
      default:
        return sendText(phone, "I didn't understand that. Reply help for doctor commands.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command failed.";
    await sendText(phone, message);
  }
  await saveDraft(convo);
}

async function listForDate(doctor: DoctorDoc, date: string) {
  return Appointment.find({
    doctorId: doctor._id,
    date,
    status: { $in: ["pending_approval", "confirmed"] },
  }).sort({ startAt: 1 });
}

async function sendDay(doctor: DoctorDoc, phone: string, date: string): Promise<void> {
  const rows = await listForDate(doctor, date);
  if (!rows.length) return sendText(phone, `${date}: no upcoming appointments.`);
  const body = rows.map((row, index) => `${index + 1}. ${formatWhen(row.startAt.toISOString(), doctor.timezone, "en")} · ${row.patientName} · ${row.typeName} · ${row.bookingCode} · ${row.status}`).join("\n");
  await sendText(phone, `${date}\n${body}`);
}

async function sendNext(doctor: DoctorDoc, phone: string): Promise<void> {
  const row = await Appointment.findOne({
    doctorId: doctor._id,
    status: { $in: ["pending_approval", "confirmed"] },
    startAt: { $gte: new Date() },
  }).sort({ startAt: 1 });
  await sendText(phone, row ? `${row.patientName} · ${row.typeName} · ${formatWhen(row.startAt.toISOString(), doctor.timezone, "en")} · ${row.bookingCode}` : "There are no upcoming appointments.");
}

async function changePosition(doctor: DoctorDoc, phone: string, position: number, status: "completed" | "no_show" | "cancelled"): Promise<void> {
  const date = clinicNow(doctor.timezone).toISODate()!;
  const rows = await listForDate(doctor, date);
  const row = rows[position - 1];
  if (!row) return sendText(phone, `No appointment at position ${position} today.`);
  await setAppointmentStatus({ doctorId: String(doctor._id), appointmentId: String(row._id), status, actorRole: "doctor", reason: `doctor:${status}` });
  await sendText(phone, `${row.bookingCode} marked ${status}.`);
}

async function setTodayLimit(doctor: DoctorDoc, phone: string, limit: number): Promise<void> {
  if (!Number.isInteger(limit) || limit < 0 || limit > 200) return sendText(phone, "Limit must be a whole number from 0 to 200.");
  const date = clinicNow(doctor.timezone).toISODate()!;
  await saveException(String(doctor._id), { type: "daily_cap", startDate: date, endDate: date, dailyCap: limit, actorRole: "doctor" });
  await sendText(phone, `Today's booking limit is ${limit}.`);
}

async function blockNext(doctor: DoctorDoc, phone: string, hours: number): Promise<void> {
  const now = DateTime.now().setZone(doctor.timezone);
  const end = now.plus({ hours });
  await saveException(String(doctor._id), {
    type: "block",
    startDate: now.toISODate()!,
    endDate: end.toISODate()!,
    startAt: now.toUTC().toISO()!,
    endAt: end.toUTC().toISO()!,
    actorRole: "doctor",
  });
  await sendText(phone, `Blocked the next ${hours} hour${hours === 1 ? "" : "s"}.`);
}

async function sendSummary(doctor: DoctorDoc, phone: string): Promise<void> {
  const date = clinicNow(doctor.timezone).toISODate()!;
  const counts = await Appointment.aggregate([
    { $match: { doctorId: doctor._id, date } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  await sendText(phone, `${date} summary\n${counts.map((item) => `${item._id}: ${item.count}`).join("\n") || "No appointments."}`);
}

async function sendPatientHistory(doctor: DoctorDoc, phone: string, patientPhone: string): Promise<void> {
  const rows = await Appointment.find({ doctorId: doctor._id, bookerPhone: patientPhone }).sort({ startAt: -1 }).limit(10);
  await sendText(phone, rows.length ? rows.map((row) => `${row.bookingCode} · ${row.patientName} · ${row.date} · ${row.status}`).join("\n") : "No appointments found for that phone.");
}