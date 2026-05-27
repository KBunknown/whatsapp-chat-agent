// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { DashboardData } from "../shared/types";

const dashboard: DashboardData = {
  settings: {
    candidateName: "Kwaku Bonsu Wiredu",
    campaignFacts: "Facts",
    agentInstructions: "Instructions",
    firstMessageTemplate: "Hi {{firstName}}",
    maxPerHour: 80,
    maxPerDay: 500,
    minDelaySeconds: 15,
    maxDelaySeconds: 45,
    maxLiveBatch: 50,
    dryRunDefault: true,
    cloudEnabled: false,
    webEnabled: true,
    autoSyncEnabled: true,
    autoReplyEnabled: true,
    safeAutoSend: true,
    autoSyncIntervalSeconds: 60,
    replyMaxPerHour: 120,
    replyMaxPerDay: 800
  },
  contacts: [
    {
      id: 1,
      fullName: "Wiredu Ama",
      whatsappNumber: "0241234567",
      otherNumber: "",
      activeEmail: "",
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
    }
  ],
  messages: [],
  whatsappStates: [
    {
      contactId: 1,
      source: "whatsapp_web",
      label: "no_chat",
      hasActualChat: false,
      needsReply: false,
      lastDirection: null,
      lastMessageBody: "",
      lastMessageAt: "",
      lastProviderMessageId: "",
      reason: "No actual WhatsApp Web chat message has been synced for this contact."
    }
  ],
  activeRun: null,
  transports: {
    cloud: { configured: false, ready: false, lastError: "", templateConfigured: false },
    web: {
      enabled: true,
      initialized: false,
      starting: false,
      ready: true,
      state: "ready",
      qrDataUrl: "data:image/png;base64,test",
      lastError: "",
      lastEventAt: "2026-05-25T00:00:00.000Z",
      lastDisconnectReason: "",
      needsReconnect: false,
      needsSessionReset: false,
      reconnectAttempts: 0,
      sessionPath: ".wwebjs_auth",
      chromePath: ""
    }
  },
  runtime: {
    ok: true,
    time: "2026-05-25T00:00:00.000Z",
    environment: "development",
    devSimulationEnabled: true,
    llm: {
      groqConfigured: true,
      groqKeyCount: 2,
      groqModel: "llama-3.3-70b-versatile",
      ollamaConfigured: true,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "llama3.1"
    },
    transports: {
      cloud: { configured: false, ready: false, lastError: "", templateConfigured: false },
      web: {
        enabled: true,
        initialized: false,
        starting: false,
        ready: true,
        state: "ready",
        qrDataUrl: "data:image/png;base64,test",
        lastError: "",
        lastEventAt: "2026-05-25T00:00:00.000Z",
        lastDisconnectReason: "",
        needsReconnect: false,
        needsSessionReset: false,
        reconnectAttempts: 0,
        sessionPath: ".wwebjs_auth",
        chromePath: ""
      }
    }
  },
  metrics: {
    contactsTotal: 1,
    contactsWithPhone: 1,
    noChat: 1,
    waitingForReply: 0,
    needsReply: 0,
    repliedChats: 0,
    optedOutChats: 0,
    contacted: 0,
    replied: 0,
    supportive: 0,
    undecided: 0,
    opposed: 0,
    optedOut: 0,
    failedSend: 0,
    needsHuman: 0,
    inboundReceived: 0,
    outboundSent: 0,
    outboundDrafted: 0,
    outboundFailed: 0,
    autoRepliesSent: 0,
    autoDrafts: 0,
    manualSends: 0,
    needsHumanRate: 0,
    autoReplyRate: 0,
    sendSuccessRate: 100,
    averageReplyMinutes: null,
    sentToday: 0,
    sentThisHour: 0,
    dailyCap: 500,
    hourlyCap: 80,
    replyDailyCap: 800,
    replyHourlyCap: 120,
    resourcesTotal: 0,
    resourcesActive: 0
  },
  resources: [],
  autoSync: {
    enabled: true,
    autoReplyEnabled: true,
    safeAutoSend: true,
    running: false,
    intervalSeconds: 60,
    lastStartedAt: "",
    lastFinishedAt: "",
    lastError: "",
    nextRunAt: "2026-05-25T00:01:00.000Z",
    lastResult: null
  },
  syncProgress: {
    id: "",
    running: false,
    phase: "idle",
    startedAt: "",
    finishedAt: "",
    requestedContacts: 0,
    scannedChats: 0,
    skippedChats: 0,
    importedMessages: 0,
    duplicateMessages: 0,
    needsReplyContacts: 0,
    currentPhone: "",
    lastError: "",
    errors: [],
    result: null
  },
  campaignProgress: {
    runId: null,
    runName: "",
    dryRun: true,
    running: false,
    phase: "idle",
    startedAt: "",
    finishedAt: "",
    total: 0,
    processed: 0,
    sent: 0,
    drafted: 0,
    skipped: 0,
    failed: 0,
    currentContactId: null,
    currentContactName: "",
    currentPhone: "",
    lastError: "",
    errors: []
  }
};

describe("dashboard", () => {
  let currentDashboard: DashboardData;

  beforeEach(() => {
    currentDashboard = JSON.parse(JSON.stringify(dashboard)) as DashboardData;
    const run = {
      id: 1,
      name: "Live run",
      status: "running",
      dryRun: false,
      startedAt: "",
      completedAt: "",
      stats: { total: 1, sent: 0, drafted: 0, skipped: 0, failed: 0 }
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const savedSettings =
          url === "/api/settings" && init?.method === "PUT" && typeof init.body === "string"
            ? JSON.parse(init.body)
            : currentDashboard.settings;
        const conversation = {
          contact: currentDashboard.contacts[0],
          messages: currentDashboard.messages.filter((message) => message.contactId === currentDashboard.contacts[0]?.id).reverse(),
          summary: ""
        };
        const body = url.includes("/conversation")
          ? conversation
          : url.includes("/api/transports/web/initialize")
            ? {
                ...currentDashboard.transports.web,
                initialized: true,
                starting: false,
                ready: false,
                state: "qr_ready",
                qrDataUrl: "data:image/png;base64,newqr"
              }
          : url.includes("/api/transports/web/reconnect")
            ? {
                ...currentDashboard.transports.web,
                initialized: true,
                starting: false,
                ready: true,
                state: "ready",
                qrDataUrl: "",
                needsReconnect: false,
                needsSessionReset: false,
                reconnectAttempts: currentDashboard.transports.web.reconnectAttempts + 1
              }
          : url.includes("/api/transports/web/disconnect")
            ? {
                ...currentDashboard.transports.web,
                initialized: false,
                starting: false,
                ready: false,
                state: "idle",
                qrDataUrl: "",
                lastError: "WhatsApp Web session was reset.",
                needsReconnect: false,
                needsSessionReset: false
              }
          : url.includes("/api/dev/transports/web/simulate")
            ? {
                ...currentDashboard.transports.web,
                ready: false,
                state: "disconnected",
                needsReconnect: true,
                lastError: "Disconnected: Simulated disconnect."
              }
          : url.includes("/api/transports/web/sync/progress")
            ? currentDashboard.syncProgress
          : url.includes("/api/transports/web/sync")
            ? {
                ...currentDashboard.syncProgress,
                id: "sync-test",
                running: true,
                phase: "scanning_chats",
                requestedContacts: 1
              }
          : url.includes("/api/campaigns/progress")
            ? currentDashboard.campaignProgress
          : url.includes("/draft-reply")
            ? { ok: true, conversation }
          : url.includes("/send-draft")
            ? { ok: true, conversation }
            : url.includes("/api/auto-sync/run")
              ? { ok: true, autoSync: currentDashboard.autoSync, result: { ok: true, requestedContacts: 1, scannedChats: 1, importedMessages: 0, duplicateMessages: 0, skippedChats: 0, clearedContacts: 0, clearedDrafts: 0, needsReplyContacts: 0, errors: [] } }
              : url === "/api/resources" || url.includes("/api/resources/")
                ? currentDashboard.resources
            : url.includes("/api/inbound/simulate")
              ? { ok: true, contact: currentDashboard.contacts[0], conversation }
          : url.includes("/api/campaigns/start")
            ? run
            : url === "/api/settings"
              ? savedSettings
              : currentDashboard;
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the candidate dashboard", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Kwaku Bonsu Wiredu" })).toBeInTheDocument());
    expect(screen.getByText("Import Excel")).toBeInTheDocument();
    expect(screen.getByText("Dry Run")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp Web Setup")).toBeInTheDocument();
    expect(screen.getByText("Agent Resources")).toBeInTheDocument();
    expect(screen.getByText("Auto Sent")).toBeInTheDocument();
    expect(screen.getByText(".wwebjs_auth")).toBeInTheDocument();
    expect(screen.getByAltText("WhatsApp Web QR code")).toBeInTheDocument();
  });

  it("submits a selected live batch only after confirmation", async () => {
    const fetchMock = vi.mocked(fetch);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText("Select Wiredu Ama")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select Wiredu Ama"));
    fireEvent.click(screen.getByRole("button", { name: /Live Batch/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/campaigns/start",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ dryRun: false, contactIds: [1], limit: 1 })
        })
      );
    });
  });

  it("shows live batch progress and recent campaign errors", async () => {
    currentDashboard.campaignProgress = {
      runId: 4,
      runName: "Live run",
      dryRun: false,
      running: true,
      phase: "sending",
      startedAt: "2026-05-25T00:00:00.000Z",
      finishedAt: "",
      total: 2,
      processed: 1,
      sent: 1,
      drafted: 0,
      skipped: 0,
      failed: 1,
      currentContactId: 1,
      currentContactName: "Wiredu Ama",
      currentPhone: "+233241234567",
      lastError: "WhatsApp send: WhatsApp Web is not connected.",
      errors: [
        {
          contactId: 1,
          contactName: "Wiredu Ama",
          phone: "+233241234567",
          stage: "LLM personalization",
          error: "Groq 429: credits exhausted",
          at: "2026-05-25T00:00:30.000Z"
        }
      ]
    };

    render(<App />);

    await waitFor(() => expect(screen.getByText(/Live batch sending 1\/2/i)).toBeInTheDocument());
    expect(screen.getByText("Errors encountered")).toBeInTheDocument();
    expect(screen.getByText(/Groq 429: credits exhausted/i)).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp Web is not connected/i)).toBeInTheDocument();
  });

  it("connects WhatsApp Web and reports when the QR is ready", async () => {
    const fetchMock = vi.mocked(fetch);
    currentDashboard.transports.web = {
      ...currentDashboard.transports.web,
      ready: false,
      qrDataUrl: ""
    };
    currentDashboard.runtime.transports.web = currentDashboard.transports.web;
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /^Connect Web$/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Connect Web$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/transports/web/initialize", expect.objectContaining({ method: "POST" }));
      expect(screen.getByText("WhatsApp QR code is ready. Scan it with WhatsApp on your phone.")).toBeInTheDocument();
    });
  });

  it("resets the local WhatsApp Web session from the dashboard", async () => {
    const fetchMock = vi.mocked(fetch);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Reset Web/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Reset Web/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transports/web/disconnect",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ clearSession: true })
        })
      );
    });
  });

  it("shows recovery state and reconnects WhatsApp Web", async () => {
    const fetchMock = vi.mocked(fetch);
    currentDashboard.transports.web = {
      ...currentDashboard.transports.web,
      ready: false,
      state: "disconnected",
      needsReconnect: true,
      lastDisconnectReason: "NAVIGATION",
      lastError: "Disconnected: NAVIGATION. Click Reconnect Web."
    };
    currentDashboard.runtime.transports.web = currentDashboard.transports.web;
    render(<App />);

    await waitFor(() => expect(screen.getByText("Disconnected")).toBeInTheDocument());
    expect(screen.getByText("Reconnect required")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Reconnect Web/i })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/transports/web/reconnect", expect.objectContaining({ method: "POST" }));
    });
  });

  it("shows local WhatsApp Web simulation controls in dev", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Simulate Session Removed/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Simulate Session Removed/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/dev/transports/web/simulate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ event: "auth_failure" })
        })
      );
    });
  });

  it("keeps browser edits dirty until campaign settings are saved", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByLabelText("Campaign facts")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Campaign facts"), { target: { value: "Edited campaign facts" } });

    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save Campaign Texts & Limits/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining("Edited campaign facts")
        })
      );
    });
  });

  it("shows the needs reply queue and sends a reviewed draft", async () => {
    currentDashboard.contacts[0] = {
      ...currentDashboard.contacts[0],
      needsHuman: true,
      outcomeLabel: "needs_human",
      status: "needs_review",
      lastError: "Voting link requested."
    };
    currentDashboard.whatsappStates = [
      {
        contactId: 1,
        source: "whatsapp_web",
        label: "needs_reply",
        hasActualChat: true,
        needsReply: true,
        lastDirection: "inbound",
        lastMessageBody: "Can I get the voting link?",
        lastMessageAt: "2026-05-25T00:00:00.000Z",
        lastProviderMessageId: "in-1",
        reason: "Latest actual WhatsApp message is inbound."
      }
    ];
    currentDashboard.messages = [
      {
        id: 12,
        contactId: 1,
        runId: null,
        direction: "outbound",
        channel: "web",
        body: "The voting link will be shared once it is officially released, and Kwaku can follow up directly.",
        messageHash: "draft",
        status: "drafted",
        providerMessageId: "",
        error: "Voting link requested.",
        origin: "auto_draft",
        createdAt: "2026-05-25T00:01:00.000Z"
      },
      {
        id: 11,
        contactId: 1,
        runId: null,
        direction: "inbound",
        channel: "web",
        body: "Can I get the voting link?",
        messageHash: "inbound",
        status: "received",
        providerMessageId: "in-1",
        error: "",
        origin: "",
        createdAt: "2026-05-25T00:00:00.000Z"
      }
    ];
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Needs Reply" })).toBeInTheDocument());
    expect(screen.getAllByText("Latest actual WhatsApp message is inbound.")[0]).toBeInTheDocument();
    expect(screen.getByText("Can I get the voting link?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Draft With Agent/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/contacts/1/draft-reply",
        expect.objectContaining({
          method: "POST"
        })
      );
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Send Draft/i })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/contacts/1/send-draft",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ messageId: 12 })
        })
      );
    });
  });

  it("submits simulated inbound replies from the dashboard", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Simulate Reply/i })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Inbound message"), { target: { value: "Why should I vote for Kwaku?" } });
    fireEvent.click(screen.getByRole("button", { name: /Simulate Reply/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/inbound/simulate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ contactId: 1, body: "Why should I vote for Kwaku?" })
        })
      );
    });
  });

  it("runs sync and safe replies from the setup panel", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Run Sync & Safe Replies/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Run Sync & Safe Replies/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auto-sync/run", expect.objectContaining({ method: "POST" }));
    });
  });

  it("starts chat sync without waiting for completion and shows progress", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Sync Chats/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sync Chats/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transports/web/sync",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ messagesPerChat: 20, clearFirst: true, lookupMissingChats: false })
        })
      );
      expect(screen.getByText(/Scanning chats/i)).toBeInTheDocument();
    });
  });

  it("saves pasted agent resources from the dashboard", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await waitFor(() => expect(screen.getByPlaceholderText("Paste manifesto notes, FAQs, or approved facts")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Resource title"), { target: { value: "Manifesto note" } });
    fireEvent.change(screen.getByPlaceholderText("Paste manifesto notes, FAQs, or approved facts"), {
      target: { value: "Kwaku will use review, briefing, and follow-up systems." }
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Resource/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/resources/text",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Manifesto note")
        })
      );
    });
  });
});
