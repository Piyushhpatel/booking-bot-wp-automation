import { DoctorPhone } from "../models/clinic";
import { resolveClinic } from "../services/clinic";
import { phonesMatch } from "../utils/phone";
import { handleDoctor } from "./doctor";
import { handlePatient } from "./patient";

export type ParsedInbound = {
  kind: "text" | "button" | "list";
  id?: string;
  text?: string;
};

export async function handleIncoming(phone: string, message: ParsedInbound, phoneNumberId?: string): Promise<void> {
  const doctor = await resolveClinic(phoneNumberId);
  if (!doctor) return;
  const doctorPhones = await DoctorPhone.find({ doctorId: doctor._id }).lean();
  const isDoctor = doctorPhones.some((entry) => phonesMatch(entry.phone, phone));
  if (isDoctor && message.kind === "text") return handleDoctor(doctor, phone, message.text || "");
  return handlePatient(doctor, phone, message);
}