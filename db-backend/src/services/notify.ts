import { whatsappConfigured } from "../config";
import { Notification } from "../models/system";
import { sendText } from "./whatsapp";

export async function sendPatientMessage(input: {
  doctorId: string;
  phone: string;
  body: string;
  dedupeKey: string;
  kind: string;
  appointmentId?: unknown;
  patientId?: unknown;
}): Promise<void> {
  const existing = await Notification.findOne({ dedupeKey: input.dedupeKey });
  if (existing && (existing.status === "sent" || existing.status === "skipped" || existing.attempts >= 3)) {
    return;
  }
  const attempts = (existing?.attempts || 0) + 1;
  if (!whatsappConfigured) {
    console.log("[wa:skip]", input.phone, input.body.slice(0, 140));
    await Notification.updateOne(
      { dedupeKey: input.dedupeKey },
      {
        $set: {
          doctorId: input.doctorId,
          phone: input.phone,
          kind: input.kind,
          appointmentId: input.appointmentId,
          patientId: input.patientId,
          status: "skipped",
          attempts,
          detail: "WhatsApp is not configured",
        },
      },
      { upsert: true }
    );
    return;
  }
  try {
    await sendText(input.phone, input.body);
    await Notification.updateOne(
      { dedupeKey: input.dedupeKey },
      {
        $set: {
          doctorId: input.doctorId,
          phone: input.phone,
          kind: input.kind,
          appointmentId: input.appointmentId,
          patientId: input.patientId,
          status: "sent",
          attempts,
          sentAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "send failed";
    await Notification.updateOne(
      { dedupeKey: input.dedupeKey },
      {
        $set: {
          doctorId: input.doctorId,
          phone: input.phone,
          kind: input.kind,
          status: "failed",
          attempts,
          detail,
        },
      },
      { upsert: true }
    );
  }
}
