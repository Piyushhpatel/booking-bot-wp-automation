import type { ClosedReason } from "../engine/types";
import { formatInr } from "../engine/time";

export type Lang = "en" | "hi";

export const footer: Record<Lang, string> = {
  en: "Reply MENU anytime",
  hi: "कभी भी MENU लिखें",
};

export function menuBody(lang: Lang, clinic: string, greeting: string, name?: string): string {
  const hello =
    lang === "hi"
      ? name
        ? `नमस्ते ${name}।`
        : "नमस्ते।"
      : name
        ? `Hello ${name}.`
        : "Hello.";
  const prompt = greeting || (lang === "hi" ? `${clinic} में अपॉइंटमेंट बुक करें।` : `Book at ${clinic}.`);
  return `${hello}\n${prompt}`;
}

export function emergency(lang: Lang, phone: string): string {
  const line =
    lang === "hi"
      ? "यह इमरजेंसी लग रही है। कृपया अभी 112 पर कॉल करें या नज़दीकी अस्पताल जाएँ। अपॉइंटमेंट का इंतज़ार न करें।"
      : "This sounds like an emergency. Please call 112 or go to the nearest hospital now. Do not wait for an appointment.";
  return phone ? `${line}\n${lang === "hi" ? "क्लिनिक" : "Clinic"}: ${phone}` : line;
}

export function consent(lang: Lang, clinic: string): string {
  return lang === "hi"
    ? `${clinic} अपॉइंटमेंट के लिए आपका नाम और मोबाइल नंबर सेव करेगा। इस चैट में रिपोर्ट या बीमारी का विवरण न भेजें। आगे बढ़ें?`
    : `${clinic} will save your name and mobile number to manage appointments. Don't send reports or a diagnosis in this chat. Continue?`;
}

export function askName(lang: Lang, isSelf: boolean): string {
  if (lang === "hi") return isSelf ? "आपका नाम लिखें।" : "मरीज़ का नाम लिखें।";
  return isSelf ? "What is your name?" : "What is the patient's name?";
}

export function closed(lang: Lang, reason: ClosedReason | undefined, phone: string): string {
  const en: Record<string, string> = {
    bookings_paused: "New bookings are paused.",
    outside_window: "That date is outside the booking window.",
    holiday: "The clinic is closed that day.",
    leave: "The doctor is on leave that day.",
    not_working: "The clinic is not open that day.",
    notice: "Those times are too soon, or they have already passed.",
    full: "That day is fully booked.",
  };
  const hi: Record<string, string> = {
    bookings_paused: "अभी नई बुकिंग बंद है।",
    outside_window: "यह तारीख बुकिंग की सीमा से बाहर है।",
    holiday: "उस दिन क्लिनिक बंद है।",
    leave: "उस दिन डॉक्टर छुट्टी पर हैं।",
    not_working: "उस दिन क्लिनिक नहीं खुलता।",
    notice: "ये समय या तो बहुत जल्दी हैं, या निकल चुके हैं।",
    full: "उस दिन सभी स्लॉट भर चुके हैं।",
  };
  const table = lang === "hi" ? hi : en;
  const line = table[reason || ""] || (lang === "hi" ? "यह समय उपलब्ध नहीं है।" : "That time is not available.");
  return phone ? `${line}\n${lang === "hi" ? "क्लिनिक" : "Clinic"}: ${phone}` : line;
}

export function summary(input: {
  lang: Lang;
  name: string;
  typeName: string;
  when: string;
  feePaise: number;
  holdMinutes?: number;
  moving?: boolean;
  token?: number;
}): string {
  const fee = input.feePaise > 0 ? `\n${formatInr(input.feePaise)}` : "";
  const token = input.token ? (input.lang === "hi" ? `\nटोकन #${input.token}` : `\nToken #${input.token}`) : "";
  if (input.lang === "hi") {
    const hold = input.holdMinutes ? `\nयह स्लॉट ${input.holdMinutes} मिनट के लिए रोका गया है।` : "";
    const title = input.moving ? "अपॉइंटमेंट बदलें" : "बुकिंग जाँच लें";
    return `${title}\n${input.name}\n${input.typeName}${token}\n${input.when}${fee}${hold}`;
  }
  const hold = input.holdMinutes ? `\nThis time is held for ${input.holdMinutes} minutes.` : "";
  const title = input.moving ? "Move this appointment" : "Check this booking";
  return `${title}\n${input.name}\n${input.typeName}${token}\n${input.when}${fee}${hold}`;
}

export function booked(input: {
  lang: Lang;
  clinic: string;
  code: string;
  name: string;
  typeName: string;
  when: string;
  address: string;
  mapsUrl: string;
  instructions: string;
  pending: boolean;
  token?: number;
}): string {
  const token = input.token ? (input.lang === "hi" ? `टोकन #${input.token}\n` : `Token #${input.token}\n`) : "";
  const place = [input.address, input.mapsUrl].filter(Boolean).join("\n");
  if (input.pending) {
    return input.lang === "hi"
      ? `अनुरोध भेज दिया गया है। नंबर ${input.code}\n${input.name}\n${token}${input.typeName}\n${input.when}\nक्लिनिक कन्फर्म करके यहीं संदेश भेजेगा।`
      : `Request sent. ${input.code}\n${input.name}\n${token}${input.typeName}\n${input.when}\nThe clinic will confirm it here.`;
  }
  return input.lang === "hi"
    ? `बुक हो गया। ${input.code}\n${input.name}\n${token}${input.typeName}\n${input.when}\n${input.clinic}\n${place}\n${input.instructions}`.trim()
    : `Booked. ${input.code}\n${input.name}\n${token}${input.typeName}\n${input.when}\n${input.clinic}\n${place}\n${input.instructions}`.trim();
}

export function clinicCancelled(lang: Lang, clinic: string, code: string, when: string): string {
  return lang === "hi"
    ? `${clinic} ने आपका अपॉइंटमेंट ${code} रद्द किया है (${when})। दोबारा बुक करने के लिए MENU लिखें।`
    : `${clinic} cancelled appointment ${code} (${when}). Reply MENU to book again.`;
}

export function waitOpened(lang: Lang, clinic: string, when: string): string {
  return lang === "hi"
    ? `${clinic} में ${when} को एक स्लॉट खाली हुआ है। MENU लिखकर जल्दी बुक करें।`
    : `A slot opened at ${clinic} on ${when}. Reply MENU and book it soon.`;
}
