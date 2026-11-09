import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectPatientIntent } from "./intents";

describe("patient intents", () => {
  it("detects menu, booking, language, and emergencies", () => {
    assert.equal(detectPatientIntent("Hi"), "menu");
    assert.equal(detectPatientIntent("नमस्ते"), "menu");
    assert.equal(detectPatientIntent("I want to book"), "book");
    assert.equal(detectPatientIntent("my appointments"), "appointments");
    assert.equal(detectPatientIntent("हिंदी"), "language_hi");
    assert.equal(detectPatientIntent("chest pain since morning"), "emergency");
    assert.equal(detectPatientIntent("सीने में दर्द हो रहा है"), "emergency");
    assert.equal(detectPatientIntent("Priya Sharma"), null);
  });
});
