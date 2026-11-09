import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { config } from "./config";
import { Doctor, DoctorPhone, AppointmentType, ScheduleRule, User } from "./models/clinic";

export async function seedDatabase(): Promise<void> {
  const doctor = await Doctor.findOneAndUpdate(
    { clinicName: config.clinic.name },
    {
      $set: {
        clinicName: config.clinic.name,
        doctorName: config.doctor.name,
        timezone: config.clinic.timezone,
        clinicPhone: config.clinic.phone,
        displayNumber: config.whatsapp.displayNumber,
        whatsappPhoneNumberId: config.whatsapp.phoneNumberId,
      },
      $setOnInsert: {
        address: "Clinic address",
        greeting: "Book your appointment here.",
        clinicInfo: `${config.clinic.name}\n${config.clinic.phone}`,
        breaks: [{ weekday: null, start: "13:00", end: "14:00", label: "Lunch" }],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await User.findOneAndUpdate(
    { email: config.doctor.email },
    {
      doctorId: doctor._id,
      email: config.doctor.email,
      passwordHash: await bcrypt.hash(config.doctor.password, 10),
      name: config.doctor.name,
      role: "admin",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await User.findOneAndUpdate(
    { email: config.staff.email },
    {
      doctorId: doctor._id,
      email: config.staff.email,
      passwordHash: await bcrypt.hash(config.staff.password, 10),
      name: config.staff.name,
      role: "staff",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (config.doctorWhatsapp) {
    await DoctorPhone.findOneAndUpdate(
      { doctorId: doctor._id, phone: config.doctorWhatsapp },
      { doctorId: doctor._id, phone: config.doctorWhatsapp, name: config.doctor.name },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  await AppointmentType.findOneAndUpdate(
    { doctorId: doctor._id, name: "Consultation" },
    { doctorId: doctor._id, name: "Consultation", durationMinutes: 15, feePaise: 0, active: true, sortOrder: 1 },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    await ScheduleRule.findOneAndUpdate(
      { doctorId: doctor._id, weekday },
      {
        doctorId: doctor._id,
        weekday,
        isWorking: weekday !== 0,
        sessions: weekday === 0 ? [] : [
          { id: "morning", name: "Morning", start: "10:00", end: "13:00", mode: "fixed", slotMinutes: 15, sessionCap: 15, bufferMinutes: 5 },
          { id: "evening", name: "Evening", start: "17:00", end: "20:00", mode: "fixed", slotMinutes: 15, sessionCap: 15, bufferMinutes: 5 },
        ],
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  console.log(`[seed] clinic ready: ${doctor.clinicName}`);
}

async function main(): Promise<void> {
  await mongoose.connect(config.mongoUri);
  await seedDatabase();
  await mongoose.disconnect();
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });