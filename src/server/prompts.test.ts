import { describe, expect, it } from "vitest";
import type { CampaignSettings, Contact } from "../shared/types.js";
import { buildReplyDecisionPrompt, buildReplyPrompt, renderTemplate } from "./prompts.js";

const settings: CampaignSettings = {
  candidateName: "Kwaku Bonsu Wiredu",
  campaignFacts: "Confirmed facts only.",
  agentInstructions: "Warm factual tone.",
  firstMessageTemplate: "Hi {{firstName}} from {{programOfStudy}}",
  maxPerHour: 25,
  maxPerDay: 150,
  minDelaySeconds: 45,
  maxDelaySeconds: 120,
  maxLiveBatch: 50,
  dryRunDefault: true,
  cloudEnabled: true,
  webEnabled: true,
  autoSyncEnabled: true,
  autoReplyEnabled: true,
  safeAutoSend: true,
  autoSyncIntervalSeconds: 60,
  replyMaxPerHour: 120,
  replyMaxPerDay: 800
};

const contact: Contact = {
  id: 1,
  fullName: "Wiredu Ama",
  whatsappNumber: "0241234567",
  otherNumber: "",
  activeEmail: "ama@example.com",
  programOfStudy: "Computer Science",
  level: "300",
  institution: "Test University",
  selectedPhone: "0241234567",
  normalizedPhone: "+233241234567",
  phoneSource: "whatsapp",
  importNotes: "",
  status: "imported",
  outcomeLabel: "not_contacted",
  optedOut: false,
  needsHuman: false,
  lastError: "",
  createdAt: "",
  updatedAt: ""
};

describe("prompts", () => {
  it("renders first message variables without using email", () => {
    expect(renderTemplate(settings.firstMessageTemplate, contact, settings)).toBe("Hi Ama from Computer Science");
  });

  it("uses a safer preferred name for mixed-order imported names", () => {
    expect(renderTemplate("Hi {{firstName}}", { ...contact, fullName: "Vanessa Ashely Appiah-Kubi" }, settings)).toBe(
      "Hi Vanessa"
    );
    expect(renderTemplate("Hi {{firstName}}", { ...contact, fullName: "Prah Jonathan Kojo Takyi" }, settings)).toBe(
      "Hi Jonathan"
    );
  });

  it("includes unknown-detail guardrails in reply prompts", () => {
    const prompt = buildReplyPrompt(contact, settings, "", [], "When is voting?");
    expect(prompt).toContain("Never fabricate");
    expect(prompt).toContain("Latest voter message: When is voting?");
  });

  it("includes approved resource snippets and safe auto-send fields in reply decisions", () => {
    const prompt = buildReplyDecisionPrompt(contact, settings, "", [], "What is in the manifesto?", [
      {
        resourceId: 1,
        title: "Manifesto",
        chunkIndex: 0,
        content: "The manifesto explains the Review System and Follow-Up System.",
        score: 4
      }
    ]);
    expect(prompt).toContain("Approved resource snippets");
    expect(prompt).toContain("Review System");
    expect(prompt).toContain("safeToAutoSend");
  });
});
