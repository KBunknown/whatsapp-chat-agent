import { describe, expect, it, vi } from "vitest";
import { CampaignService } from "./campaign.js";
import { getContact, getSettings, insertMessage, listMessages, openDatabase, updateContactState, updateSettings } from "./db.js";
import { importParsedContacts } from "./importer.js";
import type { LlmProvider } from "./llm.js";
import { ingestResource } from "./resources.js";
import type { TransportRouter } from "./transports.js";

describe("campaign service", () => {
  it("creates drafted messages during dry runs without sending transports", async () => {
    const db = openDatabase(":memory:");
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Personalized campaign message")
    };
    const transports = {
      sendMessage: vi.fn()
    } as unknown as TransportRouter;
    const service = new CampaignService(db, llm, transports);
    await service.startCampaign({ dryRun: true, limit: 1 });

    await vi.waitFor(() => {
      expect(listMessages(db, 1)).toHaveLength(1);
    });

    const [message] = listMessages(db, 1);
    expect(message.status).toBe("drafted");
    expect(message.channel).toBe("dry_run");
    expect(transports.sendMessage).not.toHaveBeenCalled();
  });

  it("defaults Cloud API off for Web-first outreach", () => {
    const db = openDatabase(":memory:");
    expect(getSettings(db).cloudEnabled).toBe(false);
    expect(getSettings(db).webEnabled).toBe(true);
  });

  it("blocks live batches when WhatsApp Web is not ready", async () => {
    const db = openDatabase(":memory:");
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Personalized campaign message")
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({
        web: { ready: false },
        cloud: { ready: false }
      }),
      sendMessage: vi.fn()
    } as unknown as TransportRouter;
    const service = new CampaignService(db, llm, transports);

    await expect(service.startCampaign({ dryRun: false, contactIds: [1] })).rejects.toThrow("WhatsApp Web is not connected");
    expect(transports.sendMessage).not.toHaveBeenCalled();
  });

  it("sends selected live batches through WhatsApp Web", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { minDelaySeconds: 0, maxDelaySeconds: 0, maxLiveBatch: 50, cloudEnabled: false, webEnabled: true });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      },
      {
        fullName: "Mensah Kojo",
        whatsappNumber: "0551112222",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Business",
        level: "200",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Personalized campaign message")
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({
        web: { ready: true },
        cloud: { ready: false }
      }),
      sendMessage: vi.fn().mockResolvedValue({ channel: "web", providerMessageId: "web-1" })
    } as unknown as TransportRouter;
    const service = new CampaignService(db, llm, transports);
    await service.startCampaign({ dryRun: false, contactIds: [1], limit: 1 });

    await vi.waitFor(() => {
      expect(transports.sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(listMessages(db, 1)[0]).toMatchObject({ channel: "web", status: "sent" });
    expect(listMessages(db, 2)).toHaveLength(0);
  });

  it("surfaces LLM personalization failures while sending the saved template fallback", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { minDelaySeconds: 0, maxDelaySeconds: 0, maxLiveBatch: 50, cloudEnabled: false, webEnabled: true });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockRejectedValue(new Error("No LLM provider succeeded. groq: Groq 429: credits exhausted"))
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({
        web: { ready: true },
        cloud: { ready: false }
      }),
      sendMessage: vi.fn().mockResolvedValue({ channel: "web", providerMessageId: "web-fallback" })
    } as unknown as TransportRouter;
    const service = new CampaignService(db, llm, transports);
    await service.startCampaign({ dryRun: false, contactIds: [1], limit: 1 });

    await vi.waitFor(() => {
      expect(service.getCampaignProgress().running).toBe(false);
    });

    const progress = service.getCampaignProgress();
    expect(progress.sent).toBe(1);
    expect(progress.errors[0]).toMatchObject({
      contactName: "Wiredu Ama",
      stage: "LLM personalization",
      error: expect.stringContaining("credits exhausted")
    });
    expect(listMessages(db, 1)[0]).toMatchObject({
      status: "sent",
      body: expect.stringContaining("Kwaku Bonsu Wiredu")
    });
  });

  it("shows WhatsApp Web send failures in campaign progress and failed messages", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { minDelaySeconds: 0, maxDelaySeconds: 0, maxLiveBatch: 50, cloudEnabled: false, webEnabled: true });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Personalized campaign message")
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({
        web: { ready: true },
        cloud: { ready: false }
      }),
      sendMessage: vi.fn().mockRejectedValue(new Error("WhatsApp Web agent disconnected"))
    } as unknown as TransportRouter;
    const service = new CampaignService(db, llm, transports);
    await service.startCampaign({ dryRun: false, contactIds: [1], limit: 1 });

    await vi.waitFor(() => {
      expect(service.getCampaignProgress().running).toBe(false);
    });

    const progress = service.getCampaignProgress();
    expect(progress.failed).toBe(1);
    expect(progress.lastError).toContain("WhatsApp Web agent disconnected");
    expect(progress.errors[0]).toMatchObject({
      stage: "WhatsApp send",
      error: "WhatsApp Web agent disconnected"
    });
    expect(listMessages(db, 1)[0]).toMatchObject({
      status: "failed",
      error: "WhatsApp Web agent disconnected"
    });
    expect(getContact(db, 1)).toMatchObject({ status: "failed", lastError: "WhatsApp Web agent disconnected" });
  });

  it("pauses live batches after WhatsApp Web disconnects instead of failing remaining contacts", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { minDelaySeconds: 0, maxDelaySeconds: 0, maxLiveBatch: 50, cloudEnabled: false, webEnabled: true });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      },
      {
        fullName: "Mensah Kojo",
        whatsappNumber: "0551112222",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Business",
        level: "200",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Personalized campaign message")
    };
    const transports = {
      getStatus: vi
        .fn()
        .mockReturnValueOnce({ web: { ready: true, needsReconnect: false, needsSessionReset: false }, cloud: { ready: false } })
        .mockReturnValue({ web: { ready: false, needsReconnect: true, needsSessionReset: false }, cloud: { ready: false } }),
      sendMessage: vi.fn().mockRejectedValue(new Error("WhatsApp Web disconnected"))
    } as unknown as TransportRouter;
    const service = new CampaignService(db, llm, transports);
    await service.startCampaign({ dryRun: false, contactIds: [1, 2], limit: 2 });

    await vi.waitFor(() => {
      expect(service.getCampaignProgress().running).toBe(false);
    });

    expect(service.getActiveRun()).toMatchObject({ status: "paused" });
    expect(service.getCampaignProgress()).toMatchObject({ phase: "paused", failed: 1, processed: 1 });
    expect(listMessages(db, 1)).toHaveLength(1);
    expect(listMessages(db, 2)).toHaveLength(0);
  });

  it("sends explicitly selected live contacts even after a dry-run draft", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { minDelaySeconds: 0, maxDelaySeconds: 0, maxLiveBatch: 50, cloudEnabled: false, webEnabled: true });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);
    insertMessage(db, {
      contactId: 1,
      direction: "outbound",
      channel: "dry_run",
      body: "Dry-run preview",
      messageHash: "dry-run-preview",
      status: "drafted"
    });
    updateContactState(db, 1, { status: "contacted", outcomeLabel: "contacted" });

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Selected live message")
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({
        web: { ready: true },
        cloud: { ready: false }
      }),
      sendMessage: vi.fn().mockResolvedValue({ channel: "web", providerMessageId: "web-selected" })
    } as unknown as TransportRouter;
    const service = new CampaignService(db, llm, transports);
    await service.startCampaign({ dryRun: false, contactIds: [1], limit: 1 });

    await vi.waitFor(() => {
      expect(transports.sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(listMessages(db, 1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: "dry_run", status: "drafted" }),
        expect.objectContaining({ channel: "web", status: "sent", providerMessageId: "web-selected" })
      ])
    );
  });

  it("uses the configurable max live batch limit", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { maxLiveBatch: 1, cloudEnabled: false, webEnabled: true });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      },
      {
        fullName: "Mensah Kojo",
        whatsappNumber: "0551112222",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Business",
        level: "200",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Personalized campaign message")
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({
        web: { ready: true },
        cloud: { ready: false }
      }),
      sendMessage: vi.fn()
    } as unknown as TransportRouter;
    const service = new CampaignService(db, llm, transports);

    await expect(service.startCampaign({ dryRun: false, contactIds: [1, 2], limit: 2 })).rejects.toThrow(
      "limited to 1 selected contacts"
    );
    expect(transports.sendMessage).not.toHaveBeenCalled();
  });

  it("persists inbound messages and auto-replies with prior chat history", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { cloudEnabled: false, webEnabled: true });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);
    insertMessage(db, {
      contactId: 1,
      direction: "outbound",
      channel: "web",
      body: "Earlier we discussed Kwaku's Review System.",
      messageHash: "previous",
      status: "sent"
    });

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockImplementation(async (messages) => {
        const prompt = messages.at(-1)?.content || "";
        if (prompt.includes("Update this campaign chat summary")) return "Voter is interested in the Review System.";
        expect(prompt).toContain("Earlier we discussed Kwaku's Review System.");
        expect(prompt).toContain("Yes tell me more");
        return JSON.stringify({
          reply: "Absolutely. Kwaku's plan is built around review, briefing, and follow-up systems so the office runs with clarity.",
          needsHuman: false,
          reason: "",
          outcomeLabel: "supportive"
        });
      })
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({ web: { ready: true }, cloud: { ready: false } }),
      sendMessage: vi.fn().mockResolvedValue({ channel: "web", providerMessageId: "reply-1" })
    } as unknown as TransportRouter;

    const service = new CampaignService(db, llm, transports);
    await service.handleInbound({ from: "+233241234567", body: "Yes tell me more", providerMessageId: "in-1", channel: "web" });

    const messages = listMessages(db, 1);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "inbound", body: "Yes tell me more", status: "received" }),
        expect.objectContaining({ direction: "outbound", status: "sent", providerMessageId: "reply-1" })
      ])
    );
    expect(transports.sendMessage).toHaveBeenCalledTimes(1);
    expect(getContact(db, 1)).toMatchObject({ needsHuman: false, outcomeLabel: "supportive" });
  });

  it("treats unknown inbound numbers as potential voters and asks qualifying questions", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { cloudEnabled: false, webEnabled: true });
    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Potential voter summary")
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({ web: { ready: true }, cloud: { ready: false } }),
      sendMessage: vi.fn().mockResolvedValue({ channel: "web", providerMessageId: "qualify-1" })
    } as unknown as TransportRouter;

    const service = new CampaignService(db, llm, transports);
    await service.handleInbound({ from: "+233201112222", body: "Hello", providerMessageId: "new-voter-1", channel: "web" });

    const contact = getContact(db, 1);
    expect(contact).toMatchObject({ fullName: "Potential voter", normalizedPhone: "+233201112222" });
    expect(transports.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("eligible voter")
      }),
      expect.objectContaining({ webEnabled: true })
    );
    expect(listMessages(db, 1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "inbound", body: "Hello", status: "received" }),
        expect.objectContaining({ direction: "outbound", body: expect.stringContaining("name, program, and level"), status: "sent" })
      ])
    );
  });

  it("deduplicates inbound messages by provider id", async () => {
    const db = openDatabase(":memory:");
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          reply: "Thanks for replying.",
          needsHuman: true,
          reason: "Review first.",
          outcomeLabel: "needs_human"
        })
      )
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({ web: { ready: true }, cloud: { ready: false } }),
      sendMessage: vi.fn()
    } as unknown as TransportRouter;

    const service = new CampaignService(db, llm, transports);
    await service.handleInbound({ from: "+233241234567", body: "Hello", providerMessageId: "same-id", channel: "web" });
    await service.handleInbound({ from: "+233241234567", body: "Hello", providerMessageId: "same-id", channel: "web" });

    expect(listMessages(db, 1).filter((message) => message.direction === "inbound")).toHaveLength(1);
    expect(transports.sendMessage).not.toHaveBeenCalled();
  });

  it("stores a draft and does not send when the LLM marks a reply as needs human", async () => {
    const db = openDatabase(":memory:");
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          reply: "The voting link will be shared once it is officially released, and Kwaku can follow up with you directly.",
          needsHuman: true,
          reason: "Voting link requested.",
          outcomeLabel: "needs_human"
        })
      )
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({ web: { ready: true }, cloud: { ready: false } }),
      sendMessage: vi.fn()
    } as unknown as TransportRouter;

    const service = new CampaignService(db, llm, transports);
    await service.handleInbound({ from: "+233241234567", body: "Can you send the voting link?", providerMessageId: "link-1", channel: "web" });

    expect(listMessages(db, 1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "outbound", status: "drafted", error: expect.stringContaining("Voting") })
      ])
    );
    expect(getContact(db, 1)).toMatchObject({ needsHuman: true, outcomeLabel: "needs_human" });
    expect(transports.sendMessage).not.toHaveBeenCalled();
  });

  it("queues unsafe auto-replies as drafts even when the model can answer", async () => {
    const db = openDatabase(":memory:");
    updateSettings(db, { cloudEnabled: false, webEnabled: true, safeAutoSend: true, autoReplyEnabled: true });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          reply: "I can draft that for Kwaku to confirm first.",
          needsHuman: false,
          reason: "Requires confirmation before sending.",
          outcomeLabel: "undecided",
          safeToAutoSend: false
        })
      )
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({ web: { ready: true }, cloud: { ready: false } }),
      sendMessage: vi.fn()
    } as unknown as TransportRouter;

    const service = new CampaignService(db, llm, transports);
    await service.handleInbound({ from: "+233241234567", body: "Can you promise me a role?", providerMessageId: "unsafe-1", channel: "web" });

    expect(transports.sendMessage).not.toHaveBeenCalled();
    expect(getContact(db, 1)).toMatchObject({ needsHuman: true, status: "needs_review" });
    expect(listMessages(db, 1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "outbound", status: "drafted", origin: "auto_draft" })
      ])
    );
  });

  it("drafts on demand from the needs-reply queue using resource context", async () => {
    const db = openDatabase(":memory:");
    await ingestResource(db, {
      title: "Manifesto",
      resourceType: "manual",
      text: "The manifesto says Kwaku will use a Review System, Briefing System, and Follow-Up System."
    });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);
    insertMessage(db, {
      contactId: 1,
      direction: "inbound",
      channel: "web",
      body: "What does the manifesto say?",
      messageHash: "manifesto-question",
      status: "received",
      providerMessageId: "manifesto-in"
    });

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockImplementation(async (messages) => {
        const prompt = messages.at(-1)?.content || "";
        if (prompt.includes("Update this campaign chat summary")) return "Asked about the manifesto.";
        expect(prompt).toContain("Approved resource snippets");
        expect(prompt).toContain("Briefing System");
        return JSON.stringify({
          reply: "Kwaku's manifesto is built around review, briefing, and follow-up systems.",
          needsHuman: false,
          reason: "",
          outcomeLabel: "replied",
          safeToAutoSend: true
        });
      })
    };
    const service = new CampaignService(
      db,
      llm,
      { getStatus: vi.fn(), sendMessage: vi.fn() } as unknown as TransportRouter
    );

    await service.draftReply(1);
    expect(listMessages(db, 1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "outbound", status: "drafted", origin: "manual_draft" })
      ])
    );
  });

  it("marks failed LLM replies as needs human with a visible draft", async () => {
    const db = openDatabase(":memory:");
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockRejectedValue(new Error("provider down"))
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({ web: { ready: true }, cloud: { ready: false } }),
      sendMessage: vi.fn()
    } as unknown as TransportRouter;

    const service = new CampaignService(db, llm, transports);
    await service.handleInbound({ from: "+233241234567", body: "What is the plan?", providerMessageId: "fail-1", channel: "web" });

    expect(getContact(db, 1)).toMatchObject({ needsHuman: true, outcomeLabel: "needs_human" });
    expect(getContact(db, 1)?.lastError).toContain("LLM reply failed");
    expect(listMessages(db, 1)).toEqual(expect.arrayContaining([expect.objectContaining({ status: "drafted" })]));
    expect(transports.sendMessage).not.toHaveBeenCalled();
  });

  it("suppresses auto-replies for opt-out messages", async () => {
    const db = openDatabase(":memory:");
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);

    const llm: LlmProvider = {
      name: "fake",
      complete: vi.fn().mockResolvedValue("Opt-out summary")
    };
    const transports = {
      getStatus: vi.fn().mockReturnValue({ web: { ready: true }, cloud: { ready: false } }),
      sendMessage: vi.fn()
    } as unknown as TransportRouter;

    const service = new CampaignService(db, llm, transports);
    await service.handleInbound({ from: "+233241234567", body: "stop", providerMessageId: "stop-1", channel: "web" });

    expect(getContact(db, 1)).toMatchObject({ optedOut: true, outcomeLabel: "opted_out" });
    expect(listMessages(db, 1).filter((message) => message.direction === "outbound")).toHaveLength(0);
    expect(transports.sendMessage).not.toHaveBeenCalled();
  });

  it("syncs WhatsApp history, clears stale needs-reply drafts, and re-marks current inbound chats", () => {
    const db = openDatabase(":memory:");
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      },
      {
        fullName: "Mensah Kojo",
        whatsappNumber: "0551112222",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Business",
        level: "200",
        institution: "Test University"
      }
    ]);
    updateContactState(db, 1, { status: "needs_review", needsHuman: true, outcomeLabel: "needs_human", lastError: "Old draft" });
    updateContactState(db, 2, { status: "needs_review", needsHuman: true, outcomeLabel: "needs_human", lastError: "Old draft" });
    insertMessage(db, {
      contactId: 1,
      direction: "outbound",
      channel: "web",
      body: "Old draft",
      messageHash: "draft-1",
      status: "drafted",
      error: "Old draft"
    });
    insertMessage(db, {
      contactId: 2,
      direction: "outbound",
      channel: "web",
      body: "Old draft",
      messageHash: "draft-2",
      status: "drafted",
      error: "Old draft"
    });

    const service = new CampaignService(
      db,
      { name: "fake", complete: vi.fn() },
      { getStatus: vi.fn(), sendMessage: vi.fn() } as unknown as TransportRouter
    );
    const result = service.syncWhatsAppHistory(
      {
        requestedContacts: 2,
        scannedChats: 2,
        skippedChats: 0,
        errors: [],
        messages: [
          {
            phone: "+233241234567",
            body: "I replied manually on WhatsApp.",
            fromMe: true,
            providerMessageId: "manual-out",
            createdAt: "2026-05-25T10:00:00.000Z",
            type: "chat"
          },
          {
            phone: "+233551112222",
            body: "Why should I vote?",
            fromMe: false,
            providerMessageId: "current-in",
            createdAt: "2026-05-25T10:01:00.000Z",
            type: "chat"
          }
        ]
      },
      true
    );

    expect(result).toMatchObject({ importedMessages: 2, clearedContacts: 2, clearedDrafts: 2, needsReplyContacts: 1 });
    expect(getContact(db, 1)).toMatchObject({ needsHuman: false, status: "contacted", outcomeLabel: "contacted", lastError: "" });
    expect(getContact(db, 2)).toMatchObject({ needsHuman: true, status: "needs_review", lastError: "Latest WhatsApp message needs a reply." });
    expect(listMessages(db, 1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ body: "Old draft", status: "skipped" }),
        expect.objectContaining({ body: "I replied manually on WhatsApp.", status: "sent" })
      ])
    );
  });

  it("calculates bot metrics for sends, drafts, resources, and reply queues", async () => {
    const db = openDatabase(":memory:");
    await ingestResource(db, {
      title: "Manifesto",
      resourceType: "manual",
      text: "A practical manifesto resource for the campaign."
    });
    importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);
    insertMessage(db, {
      contactId: 1,
      direction: "inbound",
      channel: "web",
      body: "Tell me more",
      messageHash: "metric-in",
      status: "received",
      providerMessageId: "metric-in",
      createdAt: "2026-05-25T10:00:00.000Z"
    });
    insertMessage(db, {
      contactId: 1,
      direction: "outbound",
      channel: "web",
      body: "Here is more.",
      messageHash: "metric-out",
      status: "sent",
      providerMessageId: "metric-out",
      origin: "auto_reply",
      createdAt: "2026-05-25T10:05:00.000Z"
    });

    const service = new CampaignService(
      db,
      { name: "fake", complete: vi.fn() },
      { getStatus: vi.fn(), sendMessage: vi.fn() } as unknown as TransportRouter
    );
    const metrics = service.getMetrics();

    expect(metrics).toMatchObject({
      contactsTotal: 1,
      inboundReceived: 1,
      outboundSent: 1,
      autoRepliesSent: 1,
      resourcesActive: 1,
      averageReplyMinutes: 5
    });
  });
});
