import { DateTime } from "luxon";
import { parseLooseDate } from "../engine/commands";
import type { ClosedReason, SlotOffer } from "../engine/types";
import { clinicNow, formatDay, formatWhen } from "../engine/time";
import { HttpError } from "../httpError";
import { Appointment, AppointmentDoc, Patient, PatientDoc } from "../models/booking";
import { AppointmentType, DoctorDoc } from "../models/clinic";
import { ConversationDoc, Draft, loadConversation, saveDraft } from "../models/system";
import {
  bookSlot,
  confirmHold,
  joinWaitlist,
  releaseHold,
  rescheduleAppointment,
  setAppointmentStatus,
} from "../services/booking";
import { activeTypes, availabilityFor, previewDates } from "../services/clinic";
import { findOrCreatePatient } from "../services/patients";
import { sendButtons, sendList, sendText } from "../services/whatsapp";
import { clip } from "../utils/phone";
import { booked, closed, consent, emergency, footer, menuBody, summary, askName } from "./copy";
import { detectPatientIntent, isEmergency } from "./intents";

export interface Inbound {
  kind: "text" | "button" | "list";
  id?: string;
  text?: string;
}

export async function handlePatient(doctor: DoctorDoc, phone: string, inbound: Inbound): Promise<void> {
  const convo = await loadConversation(String(doctor._id), phone, "patient");
  const text = (inbound.text || "").trim();
  const id = inbound.id || "";
  const lang = convo.language;

  if (inbound.kind === "text" && text && isEmergency(text)) {
    await releaseDraftHold(doctor, convo.draft);
    convo.state = "menu";
    convo.draft = {};
    await saveDraft(convo);
    await sendText(phone, emergency(lang, doctor.clinicPhone));
    return;
  }

  const intent = inbound.kind === "text" ? detectPatientIntent(text) : null;
  if (intent === "language_hi" || intent === "language_en" || id === "lang:hi" || id === "lang:en") {
    convo.language = intent === "language_hi" || id === "lang:hi" ? "hi" : "en";
    await releaseDraftHold(doctor, convo.draft);
    convo.state = "menu";
    convo.draft = {};
    await saveDraft(convo);
    await showMenu(doctor, phone, convo);
    return;
  }
  if (intent === "menu" || id === "menu") {
    await releaseDraftHold(doctor, convo.draft);
    convo.state = "menu";
    convo.draft = {};
    await saveDraft(convo);
    await showMenu(doctor, phone, convo);
    return;
  }

  try {
    if (convo.state === "consent") return await onConsent(doctor, phone, convo, id, intent);
    if (convo.state === "who") return await onWho(doctor, phone, convo, id);
    if (convo.state === "name") return await onName(doctor, phone, convo, text);
    if (convo.state === "type") return await onType(doctor, phone, convo, id);
    if (convo.state === "date") return await onDate(doctor, phone, convo, id, text);
    if (convo.state === "slot") return await onSlot(doctor, phone, convo, id, text);
    if (convo.state === "confirm") return await onConfirm(doctor, phone, convo, id, intent);
    if (convo.state === "appointments") return await onAppointments(doctor, phone, convo, id);
    if (convo.state === "appt") return await onAppt(doctor, phone, convo, id);
    if (convo.state === "cancel_appt") return await onCancelAppt(doctor, phone, convo, id, intent);
    return await onMenu(doctor, phone, convo, id, intent, text);
  } catch (err) {
    if (err instanceof HttpError) {
      await sendText(phone, `${err.message}\n${doctor.clinicPhone ? `\n${doctor.clinicPhone}` : ""}`);
      return;
    }
    throw err;
  }
}

async function onMenu(
  doctor: DoctorDoc,
  phone: string,
  convo: ConversationDoc,
  id: string,
  intent: ReturnType<typeof detectPatientIntent>,
  text: string
) {
  if (id === "book" || intent === "book") return beginBook(doctor, phone, convo);
  if (id === "mine" || intent === "appointments") return showAppointments(doctor, phone, convo);
  if (id === "info" || intent === "info") return showInfo(doctor, phone, convo);
  if (text) {
    await sendText(
      phone,
      convo.language === "hi"
        ? "मैं यह समझ नहीं पाया। बुक, मेरे अपॉइंटमेंट, या MENU लिखें।"
        : "I didn't catch that. Reply Book, My visits, or MENU."
    );
  }
  await showMenu(doctor, phone, convo);
}

async function showMenu(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  const self = await Patient.findOne({ doctorId: doctor._id, bookerPhone: phone, isSelf: true });
  const lang = convo.language;
  await sendButtons(
    phone,
    menuBody(lang, doctor.clinicName, doctor.greeting, self?.name),
    [
      { id: "book", title: lang === "hi" ? "बुक करें" : "Book" },
      { id: "mine", title: lang === "hi" ? "मेरे विज़िट" : "My visits" },
      { id: "info", title: lang === "hi" ? "क्लिनिक जानकारी" : "Clinic info" },
    ],
    { footer: footer[lang] }
  );
}

async function showInfo(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  const hours = convo.language === "hi" ? "समय और पता" : "Hours and address";
  const body = doctor.clinicInfo || `${doctor.clinicName}\n${doctor.address}\n${doctor.clinicPhone}`;
  await sendButtons(phone, `${hours}\n${body}`, [{ id: "book", title: convo.language === "hi" ? "बुक करें" : "Book" }, { id: "menu", title: "MENU" }], {
    footer: footer[convo.language],
  });
}

async function beginBook(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  if (!doctor.bookingsOpen) {
    await sendText(phone, closed(convo.language, "bookings_paused", doctor.clinicPhone));
    return showMenu(doctor, phone, convo);
  }
  const consented = convo.consentAt || (await Patient.exists({ doctorId: doctor._id, bookerPhone: phone, consentAt: { $ne: null } }));
  if (!consented) {
    convo.state = "consent";
    await saveDraft(convo);
    await sendButtons(
      phone,
      consent(convo.language, doctor.clinicName),
      [
        { id: "consent:yes", title: convo.language === "hi" ? "हाँ" : "Yes" },
        { id: "consent:no", title: convo.language === "hi" ? "नहीं" : "No" },
      ]
    );
    return;
  }
  if (!convo.consentAt) convo.consentAt = new Date();
  await enterWho(doctor, phone, convo);
}

async function onConsent(
  doctor: DoctorDoc,
  phone: string,
  convo: ConversationDoc,
  id: string,
  intent: ReturnType<typeof detectPatientIntent>
) {
  if (id === "consent:no" || intent === "no") {
    convo.state = "menu";
    await saveDraft(convo);
    await sendText(
      phone,
      convo.language === "hi" ? "ठीक है। बुकिंग नहीं की गई।" : "Okay. Nothing was booked."
    );
    return showMenu(doctor, phone, convo);
  }
  if (id === "consent:yes" || intent === "yes") {
    convo.consentAt = new Date();
    await enterWho(doctor, phone, convo);
    return;
  }
  await sendText(phone, convo.language === "hi" ? "आगे बढ़ने के लिए हाँ या नहीं लिखें।" : "Reply Yes or No.");
}

async function enterWho(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  const people = await Patient.find({ doctorId: doctor._id, bookerPhone: phone }).sort({ isSelf: -1, name: 1 });
  if (!people.length) {
    convo.state = "name";
    convo.draft = { ...convo.draft, isSelf: true, patientId: undefined };
    await saveDraft(convo);
    await sendText(phone, askName(convo.language, true));
    return;
  }
  convo.state = "who";
  await saveDraft(convo);
  const lang = convo.language;
  await sendList(
    phone,
    lang === "hi" ? "यह अपॉइंटमेंट किसके लिए है?" : "Who is this appointment for?",
    lang === "hi" ? "चुनें" : "Choose",
    [
      ...people.slice(0, 8).map((person) => ({
        id: `who:${person._id}`,
        title: clip(person.name, 24),
        description: person.isSelf ? (lang === "hi" ? "खुद" : "Me") : lang === "hi" ? "परिवार" : "Family",
      })),
      { id: "who:new", title: lang === "hi" ? "कोई और" : "Someone else", description: lang === "hi" ? "नया नाम" : "Add a name" },
    ],
    { footer: footer[lang] }
  );
}

async function onWho(doctor: DoctorDoc, phone: string, convo: ConversationDoc, id: string) {
  if (id === "who:new") {
    convo.state = "name";
    convo.draft = { ...convo.draft, isSelf: false, patientId: undefined, rescheduleFromId: undefined };
    await saveDraft(convo);
    await sendText(phone, askName(convo.language, false));
    return;
  }
  if (id.startsWith("who:")) {
    const patient = await Patient.findOne({ _id: id.slice(4), doctorId: doctor._id, bookerPhone: phone });
    if (!patient) return enterWho(doctor, phone, convo);
    convo.draft = { ...convo.draft, patientId: String(patient._id), patientName: patient.name, isSelf: patient.isSelf };
    await goType(doctor, phone, convo);
  }
}

async function onName(doctor: DoctorDoc, phone: string, convo: ConversationDoc, text: string) {
  const patient = await findOrCreatePatient({
    doctorId: String(doctor._id),
    bookerPhone: phone,
    name: text,
    isSelf: Boolean(convo.draft.isSelf),
    language: convo.language,
  });
  convo.draft = { ...convo.draft, patientId: String(patient._id), patientName: patient.name };
  await goType(doctor, phone, convo);
}

async function goType(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  const types = await activeTypes(String(doctor._id));
  if (!types.length) {
    await sendText(phone, closed(convo.language, undefined, doctor.clinicPhone));
    return showMenu(doctor, phone, convo);
  }
  if (types.length === 1) {
    convo.draft = { ...convo.draft, typeId: String(types[0]._id) };
    return goDates(doctor, phone, convo);
  }
  convo.state = "type";
  await saveDraft(convo);
  const lang = convo.language;
  await sendList(
    phone,
    lang === "hi" ? "विज़िट का प्रकार चुनें।" : "Choose the type of visit.",
    lang === "hi" ? "चुनें" : "Choose",
    types.slice(0, 10).map((type) => ({
      id: `type:${type._id}`,
      title: clip(type.name, 24),
      description: `${type.durationMinutes} min`,
    })),
    { footer: footer[lang] }
  );
}

async function onType(doctor: DoctorDoc, phone: string, convo: ConversationDoc, id: string) {
  if (!id.startsWith("type:")) return goType(doctor, phone, convo);
  const type = await AppointmentType.findOne({ _id: id.slice(5), doctorId: doctor._id, active: true });
  if (!type) return goType(doctor, phone, convo);
  convo.draft = { ...convo.draft, typeId: String(type._id) };
  await goDates(doctor, phone, convo);
}

async function goDates(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  const lang = convo.language;
  const from = convo.draft.dateCursor || clinicNow(doctor.timezone).toISODate()!;
  const preview = await previewDates(String(doctor._id), convo.draft.typeId || "", from, 8, 31);
  if (preview.paused) {
    await sendText(phone, closed(lang, "bookings_paused", doctor.clinicPhone));
    return showMenu(doctor, phone, convo);
  }
  if (!preview.dates.length) {
    convo.state = "date";
    await saveDraft(convo);
    await sendButtons(
      phone,
      lang === "hi" ? "अगले 30 दिनों में कोई खाली स्लॉट नहीं है।" : "No open slots in the next 30 days.",
      [{ id: "menu", title: "MENU" }],
      { footer: footer[lang] }
    );
    return;
  }
  convo.state = "date";
  convo.draft = { ...convo.draft, page: 0 };
  await saveDraft(convo);
  const rows = preview.dates.map((day) => ({
    id: `date:${day.date}`,
    title: clip(formatDay(day.date, doctor.timezone, lang), 24),
    description: lang === "hi" ? `${day.count} स्लॉट` : `${day.count} open`,
  }));
  if (preview.dates.length === 8) {
    rows.push({ id: "dates:more", title: lang === "hi" ? "और तारीखें" : "More dates", description: "" });
  }
  rows.push({ id: "back", title: lang === "hi" ? "वापस" : "Back", description: "" });
  await sendList(phone, lang === "hi" ? "तारीख चुनें।" : "Choose a date.", lang === "hi" ? "तारीख" : "Dates", rows.slice(0, 10), {
    footer: footer[lang],
  });
}

async function onDate(doctor: DoctorDoc, phone: string, convo: ConversationDoc, id: string, text: string) {
  if (id === "back") return enterWho(doctor, phone, convo);
  if (id === "dates:more") {
    const from = convo.draft.dateCursor || clinicNow(doctor.timezone).toISODate()!;
    const preview = await previewDates(String(doctor._id), convo.draft.typeId || "", from, 8, 31);
    const last = preview.dates.at(-1)?.date;
    if (last) {
      convo.draft.dateCursor = DateTime.fromISO(last, { zone: doctor.timezone }).plus({ days: 1 }).toISODate()!;
    }
    return goDates(doctor, phone, convo);
  }
  let date = id.startsWith("date:") ? id.slice(5) : "";
  if (!date && text) date = parseLooseDate(text, clinicNow(doctor.timezone)) || "";
  if (!date) {
    await sendText(phone, convo.language === "hi" ? "सूची से तारीख चुनें, या 20 Oct लिखें।" : "Pick a date from the list, or type 20 Oct.");
    return;
  }
  convo.draft = { ...convo.draft, date, page: 0 };
  await goSlots(doctor, phone, convo);
}

async function goSlots(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  const lang = convo.language;
  const date = convo.draft.date || "";
  const result = await availabilityFor(
    String(doctor._id),
    date,
    convo.draft.typeId || "",
    convo.draft.rescheduleFromId
  );
  if (!result.slots.length) {
    convo.state = "slot";
    await saveDraft(convo);
    const buttons = [{ id: "dates", title: lang === "hi" ? "दूसरी तारीख" : "Other date" }];
    if (result.closedReason === "full" && convo.draft.patientId) {
      buttons.unshift({ id: "wait", title: lang === "hi" ? "सूचित करें" : "Notify me" });
    }
    await sendButtons(phone, closed(lang, result.closedReason as ClosedReason, doctor.clinicPhone), buttons, {
      footer: footer[lang],
    });
    return;
  }
  convo.state = "slot";
  await saveDraft(convo);
  const page = convo.draft.page || 0;
  const pageSlots = result.slots.slice(page * 8, page * 8 + 8);
  const rows = pageSlots.map((slot) => ({
    id: slotId(slot),
    title: clip(slot.label, 24),
    description: clip(`${slot.sessionName} · ${minutes(convo)} min`, 72),
  }));
  if (result.slots.length > (page + 1) * 8) {
    rows.push({ id: "slots:more", title: lang === "hi" ? "और समय" : "More times", description: "" });
  }
  rows.push({ id: "dates", title: lang === "hi" ? "दूसरी तारीख" : "Other date", description: "" });
  await sendList(
    phone,
    `${formatDay(date, doctor.timezone, lang)}`,
    lang === "hi" ? "समय" : "Times",
    rows.slice(0, 10),
    { footer: footer[lang] }
  );
}

function minutes(convo: ConversationDoc): string {
  return convo.draft.typeId ? "" : "";
}

function slotId(slot: SlotOffer): string {
  if (slot.mode === "token") return `token:${slot.sessionId}`;
  return `slot:${DateTime.fromISO(slot.startAt).toMillis()}:${slot.sessionId}`;
}

async function onSlot(doctor: DoctorDoc, phone: string, convo: ConversationDoc, id: string, text: string) {
  if (id === "dates" || id === "back") {
    convo.draft.page = 0;
    return goDates(doctor, phone, convo);
  }
  if (id === "slots:more") {
    convo.draft.page = (convo.draft.page || 0) + 1;
    return goSlots(doctor, phone, convo);
  }
  if (id === "wait") return offerWait(doctor, phone, convo);
  const picked = await resolveSlot(doctor, convo, id, text);
  if (!picked) {
    await sendText(phone, convo.language === "hi" ? "सूची से समय चुनें।" : "Pick a time from the list.");
    return goSlots(doctor, phone, convo);
  }
  if (convo.draft.rescheduleFromId) {
    convo.draft = {
      ...convo.draft,
      sessionId: picked.sessionId,
      slotStart: picked.startAt,
      slotLabel: picked.label,
    } as Draft & { slotLabel?: string };
    convo.state = "confirm";
    await saveDraft(convo);
    return sendSummary(doctor, phone, convo, picked, true);
  }
  await releaseDraftHold(doctor, convo.draft);
  const held = await bookSlot({
    doctorId: String(doctor._id),
    patientId: convo.draft.patientId || "",
    typeId: convo.draft.typeId || "",
    date: convo.draft.date || "",
    sessionId: picked.sessionId,
    startAt: picked.mode === "fixed" ? picked.startAt : undefined,
    source: "whatsapp",
    outcome: "hold",
    actorRole: "patient",
  });
  convo.draft.holdId = String(held._id);
  convo.draft.sessionId = held.sessionId;
  convo.state = "confirm";
  await saveDraft(convo);
  await sendSummary(doctor, phone, convo, {
    ...picked,
    startAt: held.startAt.toISOString(),
    tokenPreview: held.tokenNumber,
    label: picked.label,
  }, false, held.bookingCode);
}

async function resolveSlot(doctor: DoctorDoc, convo: ConversationDoc, id: string, text: string): Promise<SlotOffer | null> {
  const result = await availabilityFor(
    String(doctor._id),
    convo.draft.date || "",
    convo.draft.typeId || "",
    convo.draft.rescheduleFromId
  );
  const token = /^token:(.+)$/.exec(id);
  if (token) return result.slots.find((slot) => slot.mode === "token" && slot.sessionId === token[1]) || null;
  const fixed = /^slot:(\d+):(.+)$/.exec(id);
  if (fixed) {
    const want = Number(fixed[1]);
    return (
      result.slots.find(
        (slot) => slot.sessionId === fixed[2] && Math.abs(DateTime.fromISO(slot.startAt).toMillis() - want) < 1000
      ) || null
    );
  }
  if (text) {
    const clock = text.toLowerCase().replace(/\s+/g, "");
    return (
      result.slots.find((slot) => slot.label.toLowerCase().replace(/\s+/g, "").includes(clock) || slot.label === text) ||
      null
    );
  }
  return null;
}

async function sendSummary(
  doctor: DoctorDoc,
  phone: string,
  convo: ConversationDoc,
  slot: SlotOffer,
  moving: boolean,
  _code?: string
) {
  const type = await AppointmentType.findById(convo.draft.typeId);
  const lang = convo.language;
  await sendButtons(
    phone,
    summary({
      lang,
      name: convo.draft.patientName || "",
      typeName: type?.name || "",
      when: formatWhen(slot.startAt, doctor.timezone, lang),
      feePaise: type?.feePaise || 0,
      holdMinutes: moving ? undefined : doctor.holdMinutes,
      moving,
      token: slot.tokenPreview,
    }),
    [
      { id: "confirm", title: lang === "hi" ? "कन्फर्म" : "Confirm" },
      { id: "change", title: lang === "hi" ? "बदलें" : "Change" },
      { id: "abort", title: lang === "hi" ? "रद्द करें" : "Cancel" },
    ],
    { footer: footer[lang] }
  );
}

async function onConfirm(
  doctor: DoctorDoc,
  phone: string,
  convo: ConversationDoc,
  id: string,
  intent: ReturnType<typeof detectPatientIntent>
) {
  if (id === "change" || intent === "change") {
    await releaseDraftHold(doctor, convo.draft);
    convo.draft.holdId = undefined;
    return goDates(doctor, phone, convo);
  }
  if (id === "abort" || intent === "no") {
    await releaseDraftHold(doctor, convo.draft);
    convo.state = "menu";
    convo.draft = {};
    await saveDraft(convo);
    await sendText(phone, convo.language === "hi" ? "बुकिंग रद्द की गई।" : "Booking cancelled.");
    return showMenu(doctor, phone, convo);
  }
  if (id !== "confirm" && intent !== "yes") {
    await sendText(phone, convo.language === "hi" ? "कन्फर्म, बदलें, या रद्द करें।" : "Reply Confirm, Change, or Cancel.");
    return;
  }
  let appointment: AppointmentDoc;
  if (convo.draft.rescheduleFromId) {
    appointment = await rescheduleAppointment(String(doctor._id), convo.draft.rescheduleFromId, {
      typeId: convo.draft.typeId || "",
      date: convo.draft.date || "",
      sessionId: convo.draft.sessionId || "",
      startAt: convo.draft.slotStart,
      source: "whatsapp",
      actorRole: "patient",
    });
  } else {
    appointment = await confirmHold(String(doctor._id), convo.draft.holdId || "");
  }
  convo.state = "menu";
  convo.draft = {};
  await saveDraft(convo);
  const lang = convo.language;
  await sendText(
    phone,
    booked({
      lang,
      clinic: doctor.clinicName,
      code: appointment.bookingCode,
      name: appointment.patientName,
      typeName: appointment.typeName,
      when: formatWhen(appointment.startAt.toISOString(), doctor.timezone, lang),
      address: doctor.address,
      mapsUrl: doctor.mapsUrl,
      instructions: doctor.instructions,
      pending: appointment.status === "pending_approval",
      token: appointment.tokenNumber,
    })
  );
}

async function offerWait(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  const lang = convo.language;
  if (!convo.draft.patientId || !convo.draft.date) return goDates(doctor, phone, convo);
  const { created } = await joinWaitlist(String(doctor._id), convo.draft.patientId, phone, convo.draft.date);
  await sendText(
    phone,
    created
      ? lang === "hi"
        ? "स्लॉट खाली होने पर हम संदेश भेजेंगे।"
        : "We'll message you if a slot opens."
      : lang === "hi"
        ? "आप पहले से सूची में हैं।"
        : "You're already on the list for that day."
  );
  return showMenu(doctor, phone, convo);
}

async function showAppointments(doctor: DoctorDoc, phone: string, convo: ConversationDoc) {
  const people = await Patient.find({ doctorId: doctor._id, bookerPhone: phone });
  const start = clinicNow(doctor.timezone).startOf("day").toJSDate();
  const rows = await Appointment.find({
    doctorId: doctor._id,
    patientId: { $in: people.map((person) => person._id) },
    status: { $in: ["pending_approval", "confirmed"] },
    startAt: { $gte: start },
  })
    .sort({ startAt: 1 })
    .limit(8);
  const lang = convo.language;
  if (!rows.length) {
    await sendButtons(
      phone,
      lang === "hi" ? "कोई आने वाला अपॉइंटमेंट नहीं है।" : "You have no upcoming appointments.",
      [
        { id: "book", title: lang === "hi" ? "बुक करें" : "Book" },
        { id: "menu", title: "MENU" },
      ]
    );
    return;
  }
  convo.state = "appointments";
  await saveDraft(convo);
  await sendList(
    phone,
    lang === "hi" ? "आपके अपॉइंटमेंट" : "Your appointments",
    lang === "hi" ? "खोलें" : "Open",
    rows.map((row) => ({
      id: `appt:${row._id}`,
      title: clip(formatDay(row.date, doctor.timezone, lang), 24),
      description: clip(`${formatWhen(row.startAt.toISOString(), doctor.timezone, "en").split(", ").pop()} · ${row.patientName} · ${row.bookingCode}`, 72),
    })),
    { footer: footer[lang] }
  );
}

async function ownedAppointment(doctor: DoctorDoc, phone: string, id: string): Promise<AppointmentDoc | null> {
  const people = await Patient.find({ doctorId: doctor._id, bookerPhone: phone }).select("_id");
  return Appointment.findOne({
    _id: id,
    doctorId: doctor._id,
    patientId: { $in: people.map((person) => person._id) },
  });
}

async function onAppointments(doctor: DoctorDoc, phone: string, convo: ConversationDoc, id: string) {
  if (!id.startsWith("appt:")) return showAppointments(doctor, phone, convo);
  const appointment = await ownedAppointment(doctor, phone, id.slice(5));
  if (!appointment) return showAppointments(doctor, phone, convo);
  convo.state = "appt";
  convo.draft = { ...convo.draft, appointmentId: String(appointment._id) };
  await saveDraft(convo);
  const lang = convo.language;
  await sendButtons(
    phone,
    `${appointment.bookingCode}\n${appointment.patientName}\n${appointment.typeName}\n${formatWhen(appointment.startAt.toISOString(), doctor.timezone, lang)}`,
    [
      { id: "reschedule", title: lang === "hi" ? "बदलें" : "Reschedule" },
      { id: "cancel_appt", title: lang === "hi" ? "रद्द करें" : "Cancel" },
      { id: "back_appts", title: lang === "hi" ? "वापस" : "Back" },
    ]
  );
}

async function onAppt(doctor: DoctorDoc, phone: string, convo: ConversationDoc, id: string) {
  if (id === "back_appts") return showAppointments(doctor, phone, convo);
  if (id === "cancel_appt") {
    convo.state = "cancel_appt";
    await saveDraft(convo);
    const lang = convo.language;
    await sendButtons(phone, lang === "hi" ? "यह अपॉइंटमेंट रद्द करें?" : "Cancel this appointment?", [
      { id: "yes_cancel", title: lang === "hi" ? "हाँ, रद्द करें" : "Yes, cancel" },
      { id: "back_appts", title: lang === "hi" ? "नहीं" : "No" },
    ]);
    return;
  }
  if (id === "reschedule") {
    const appointment = await ownedAppointment(doctor, phone, convo.draft.appointmentId || "");
    if (!appointment) return showAppointments(doctor, phone, convo);
    convo.draft = {
      patientId: String(appointment.patientId),
      patientName: appointment.patientName,
      typeId: String(appointment.typeId),
      rescheduleFromId: String(appointment._id),
      page: 0,
    };
    return goDates(doctor, phone, convo);
  }
}

async function onCancelAppt(
  doctor: DoctorDoc,
  phone: string,
  convo: ConversationDoc,
  id: string,
  intent: ReturnType<typeof detectPatientIntent>
) {
  if (id === "back_appts" || intent === "no") return showAppointments(doctor, phone, convo);
  if (id !== "yes_cancel" && intent !== "yes") return;
  const appointment = await ownedAppointment(doctor, phone, convo.draft.appointmentId || "");
  if (!appointment) return showAppointments(doctor, phone, convo);
  await setAppointmentStatus({
    doctorId: String(doctor._id),
    appointmentId: String(appointment._id),
    status: "cancelled",
    reason: "patient",
    actorRole: "patient",
  });
  convo.state = "menu";
  convo.draft = {};
  await saveDraft(convo);
  await sendText(
    phone,
    convo.language === "hi"
      ? `${appointment.bookingCode} रद्द हो गया।`
      : `${appointment.bookingCode} is cancelled.`
  );
}

async function releaseDraftHold(doctor: DoctorDoc, draft: Draft): Promise<void> {
  if (!draft.holdId) return;
  const holdId = draft.holdId;
  draft.holdId = undefined;
  await releaseHold(String(doctor._id), holdId, "changed");
}
