import { HttpError } from "../httpError";
import { Patient, PatientDoc } from "../models/booking";
import { normalizePhone } from "../utils/phone";

export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanName(name: string): string {
  const value = name.trim().replace(/\s+/g, " ");
  if (value.length < 2 || value.length > 60) {
    throw new HttpError(400, "Enter a name between 2 and 60 characters.");
  }
  return value;
}

export async function findOrCreatePatient(input: {
  doctorId: string;
  bookerPhone: string;
  name: string;
  isSelf: boolean;
  language?: "en" | "hi";
}): Promise<PatientDoc> {
  const name = cleanName(input.name);
  const key = nameKey(name);
  const existing = await Patient.findOne({
    doctorId: input.doctorId,
    bookerPhone: input.bookerPhone,
    nameKey: key,
  });
  if (existing) {
    if (input.language) existing.language = input.language;
    if (!existing.consentAt) existing.consentAt = new Date();
    await existing.save();
    return existing;
  }
  if (input.isSelf) {
    const self = await Patient.findOne({
      doctorId: input.doctorId,
      bookerPhone: input.bookerPhone,
      isSelf: true,
    });
    if (self) return self;
  }
  return Patient.create({
    doctorId: input.doctorId,
    bookerPhone: input.bookerPhone,
    name,
    nameKey: key,
    isSelf: input.isSelf,
    language: input.language || "en",
    consentAt: new Date(),
  });
}

export async function patientsForPhone(doctorId: string, phone: string): Promise<PatientDoc[]> {
  const digits = normalizePhone(phone);
  const suffix = digits.length > 10 ? digits.slice(-10) : digits;
  if (suffix.length < 8) return [];
  return Patient.find({
    doctorId,
    bookerPhone: new RegExp(`${suffix}$`),
  }).sort({ isSelf: -1, name: 1 });
}
