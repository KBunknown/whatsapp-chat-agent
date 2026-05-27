import { describe, expect, it } from "vitest";
import { chooseAndNormalizePhone, normalizeGhanaPhone } from "./phone.js";

describe("phone normalization", () => {
  it("normalizes Ghana local numbers to +233", () => {
    expect(normalizeGhanaPhone("024 123 4567")).toBe("+233241234567");
    expect(normalizeGhanaPhone("241234567")).toBe("+233241234567");
  });

  it("preserves already international numbers", () => {
    expect(normalizeGhanaPhone("+233 24 123 4567")).toBe("+233241234567");
    expect(normalizeGhanaPhone("00233241234567")).toBe("+233241234567");
  });

  it("uses Other Number only when WhatsApp Number is missing", () => {
    const result = chooseAndNormalizePhone("", "055 111 2222");
    expect(result.normalizedPhone).toBe("+233551112222");
    expect(result.phoneSource).toBe("other");
    expect(result.notes.join(" ")).toContain("review");
  });
});
