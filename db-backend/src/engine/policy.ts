import type { AppointmentStatus } from "./types";

const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  held: ["pending_approval", "confirmed", "cancelled"],
  pending_approval: ["confirmed", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled", "rescheduled"],
  completed: [],
  no_show: [],
  cancelled: [],
  rescheduled: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return transitions[from].includes(to);
}

export interface BookingPolicyInput {
  sameDayCount: number;
  futureCount: number;
  phoneDayCount: number;
  flagged: boolean;
  allowFlagged: boolean;
  dailyLimit: number;
  futureLimit: number;
  phoneDailyLimit: number;
}

/** Returns a patient-safe refusal, or null when the booking may proceed. */
export function bookingRefusal(input: BookingPolicyInput): string | null {
  if (input.flagged && !input.allowFlagged) {
    return "Online booking isn't available for this patient. Please call the clinic.";
  }
  if (input.sameDayCount >= input.dailyLimit) {
    return "This patient already has a booking that day.";
  }
  if (input.futureCount >= input.futureLimit) {
    return "This patient already has the maximum number of upcoming bookings.";
  }
  if (input.phoneDayCount >= input.phoneDailyLimit) {
    return "This phone number already has the maximum bookings for that day.";
  }
  return null;
}
