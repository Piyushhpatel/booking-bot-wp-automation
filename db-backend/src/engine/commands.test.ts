import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { parseClock, parseDoctorCommand } from "./commands";

const today = DateTime.fromISO("2026-10-12", { zone: "Asia/Kolkata" });

describe("doctor commands", () => {
  it("parses the day-to-day commands", () => {
    assert.equal(parseDoctorCommand("today", today).type, "today");
    assert.equal(parseDoctorCommand("kal", today).type, "tomorrow");
    assert.deepEqual(parseDoctorCommand("done 5", today), { type: "done", n: 5 });
    assert.deepEqual(parseDoctorCommand("no show 2", today), { type: "noshow", n: 2 });
    assert.deepEqual(parseDoctorCommand("cancel 3", today), { type: "cancel", n: 3 });
    assert.deepEqual(parseDoctorCommand("limit 0", today), { type: "limit", n: 0 });
    assert.deepEqual(parseDoctorCommand("patient +91 98765 43210", today), {
      type: "patient",
      phone: "919876543210",
    });
    assert.equal(parseDoctorCommand("close bookings", today).type, "close");
    assert.equal(parseDoctorCommand("open", today).type, "open");
  });

  it("parses dates, blocks, and leave ranges", () => {
    assert.deepEqual(parseDoctorCommand("bookings 15 Oct", today), { type: "day", date: "2026-10-15" });
    assert.deepEqual(parseDoctorCommand("booking 5 Jan", today), { type: "day", date: "2027-01-05" });
    assert.deepEqual(parseDoctorCommand("bookings 15/10/2025", today), { type: "day", date: "2025-10-15" });
    assert.deepEqual(parseDoctorCommand("block today 2pm-4pm", today), {
      type: "block",
      date: "2026-10-12",
      start: "14:00",
      end: "16:00",
    });
    assert.deepEqual(parseDoctorCommand("block 20 Oct 9:30am to 11:00am", today), {
      type: "block",
      date: "2026-10-20",
      start: "09:30",
      end: "11:00",
    });
    assert.equal(parseDoctorCommand("block today 4pm-2pm", today).type, "unknown");
    assert.equal(parseDoctorCommand("block today 2-4", today).type, "unknown");
    assert.deepEqual(parseDoctorCommand("block next 2 hours", today), { type: "block_next", hours: 2 });
    assert.deepEqual(parseDoctorCommand("leave 20 Oct-22 Oct", today), {
      type: "leave",
      startDate: "2026-10-20",
      endDate: "2026-10-22",
    });
    assert.deepEqual(parseDoctorCommand("leave 2026-10-20 to 2026-10-22", today), {
      type: "leave",
      startDate: "2026-10-20",
      endDate: "2026-10-22",
    });
    assert.deepEqual(parseDoctorCommand("leave tomorrow", today), {
      type: "leave",
      startDate: "2026-10-13",
      endDate: "2026-10-13",
    });
  });

  it("parses clocks", () => {
    assert.equal(parseClock("12am"), "00:00");
    assert.equal(parseClock("12:15 PM"), "12:15");
    assert.equal(parseClock("00:30"), "00:30");
    assert.equal(parseClock("2"), null);
  });
});
