const EMERGENCY =
  /\b(emergency|chest pain|heart attack|can'?t breathe|cannot breathe|unconscious|suicidal)\b|इमरजेंसी|इमर्जेंसी|सीने में दर्द|सीने मे दर्द|दिल का दौरा|सांस नहीं|बेहोश/i;

export type PatientIntent =
  | "menu"
  | "book"
  | "appointments"
  | "info"
  | "emergency"
  | "yes"
  | "no"
  | "change"
  | "language_en"
  | "language_hi";

export function detectPatientIntent(text: string): PatientIntent | null {
  const raw = text.trim();
  if (!raw) return null;
  if (EMERGENCY.test(raw)) return "emergency";
  const lower = raw.toLowerCase();
  if (/^(menu|start|hi|hello|hey|namaste|नमस्ते|नमस्कार|मेनू)$/i.test(raw)) return "menu";
  if (/^(english|eng)$/i.test(lower)) return "language_en";
  if (/^(hindi|हिंदी|हिन्दी)$/i.test(raw)) return "language_hi";
  if (/^(yes|y|confirm|ok|okay|haan|ha|हाँ|हां|हा)$/i.test(lower) || raw === "हाँ" || raw === "हां") {
    return "yes";
  }
  if (/^(no|n|cancel|nahi|nahin|नहीं|नही)$/i.test(lower) || raw === "नहीं") return "no";
  if (/^(change|badlo|बदलें|बदलो)$/i.test(lower)) return "change";
  if (/^(book|appointment|appt|बुक|अपॉइंटमेंट)$/i.test(raw) || /\b(book an appointment|want to book)\b/i.test(lower)) {
    return "book";
  }
  if (/^(my appointments|my appointment|appointments|मेरे अपॉइंटमेंट)$/i.test(lower)) {
    return "appointments";
  }
  if (/^(info|clinic|address|hours|timings|क्लिनिक|पता)$/i.test(lower)) return "info";
  return null;
}

export function isEmergency(text: string): boolean {
  return EMERGENCY.test(text);
}
