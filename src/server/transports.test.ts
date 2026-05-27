import { describe, expect, it, vi } from "vitest";
import type { Contact } from "../shared/types.js";
import { TransportRouter, WhatsAppWebTransport } from "./transports.js";

const contact: Contact = {
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
};

describe("transport router", () => {
  it("skips Cloud and sends through Web when Cloud is disabled", async () => {
    const cloud = {
      getStatus: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      sendMessage: vi.fn().mockResolvedValue({ channel: "cloud", providerMessageId: "cloud-1" })
    };
    const web = {
      getStatus: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
      sendMessage: vi.fn().mockResolvedValue({ channel: "web", providerMessageId: "web-1" })
    };
    const router = new TransportRouter(cloud as never, web as never);

    await expect(
      router.sendMessage(
        {
          to: contact.normalizedPhone,
          body: "hello",
          kind: "initial",
          contact
        },
        { cloudEnabled: false, webEnabled: true }
      )
    ).resolves.toMatchObject({ channel: "web", providerMessageId: "web-1" });
    expect(cloud.sendMessage).not.toHaveBeenCalled();
    expect(web.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("returns a clear Web connection error when no transport is ready", async () => {
    const cloud = {
      getStatus: vi.fn(),
      isReady: vi.fn().mockReturnValue(false),
      sendMessage: vi.fn()
    };
    const web = {
      getStatus: vi.fn(),
      isReady: vi.fn().mockReturnValue(false),
      sendMessage: vi.fn()
    };
    const router = new TransportRouter(cloud as never, web as never);

    await expect(
      router.sendMessage(
        {
          to: contact.normalizedPhone,
          body: "hello",
          kind: "initial",
          contact
        },
        { cloudEnabled: false, webEnabled: true }
      )
    ).rejects.toThrow("WhatsApp Web is not connected");
  });
});

describe("whatsapp web transport initialization", () => {
  it("loads LocalAuth, starts the client, and stores a rendered QR", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    class FakeLocalAuth {
      constructor(public options: Record<string, unknown>) {}
    }
    class FakeClient {
      on(event: string, callback: (...args: unknown[]) => void): void {
        handlers.set(event, callback);
      }

      async initialize(): Promise<void> {
        await handlers.get("qr")?.("fake-qr-code");
      }

      async getChatById(): Promise<never> {
        throw new Error("not implemented");
      }

      async getChats(): Promise<[]> {
        return [];
      }

      async sendMessage(): Promise<{ id: { id: string } }> {
        return { id: { id: "fake" } };
      }

      async destroy(): Promise<void> {}
    }

    const transport = new WhatsAppWebTransport(async () => undefined, () => ({
      Client: FakeClient,
      LocalAuth: FakeLocalAuth
    }));

    const initial = await transport.initialize();
    expect(initial.initialized).toBe(true);

    await vi.waitFor(() => {
      expect(transport.getStatus().qrDataUrl).toMatch(/^data:image\/png;base64,/);
    });
    expect(transport.getStatus()).toMatchObject({ initialized: true, ready: false, state: "qr_ready", lastError: "" });
  });

  it("falls back to Puppeteer's browser when the configured Chrome path is stale", async () => {
    const previousChromePath = process.env.CHROME_EXECUTABLE_PATH;
    process.env.CHROME_EXECUTABLE_PATH = "/definitely/not/google-chrome-codex-test";
    const handlers = new Map<string, (...args: unknown[]) => void>();
    let clientOptions: Record<string, unknown> | undefined;
    class FakeLocalAuth {
      constructor(public options: Record<string, unknown>) {}
    }
    class FakeClient {
      constructor(options: Record<string, unknown>) {
        clientOptions = options;
      }

      on(event: string, callback: (...args: unknown[]) => void): void {
        handlers.set(event, callback);
      }

      async initialize(): Promise<void> {
        await handlers.get("ready")?.();
      }

      async getChatById(): Promise<never> {
        throw new Error("not implemented");
      }

      async getChats(): Promise<[]> {
        return [];
      }

      async sendMessage(): Promise<{ id: { id: string } }> {
        return { id: { id: "fake" } };
      }

      async destroy(): Promise<void> {}
    }

    try {
      const transport = new WhatsAppWebTransport(async () => undefined, () => ({
        Client: FakeClient,
        LocalAuth: FakeLocalAuth
      }));

      await transport.initialize({ waitMs: 10 });

      const puppeteer = clientOptions?.puppeteer as Record<string, unknown> | undefined;
      expect(puppeteer?.executablePath).toBeUndefined();
      expect(transport.getStatus().chromePath).toBe("");
    } finally {
      if (previousChromePath === undefined) delete process.env.CHROME_EXECUTABLE_PATH;
      else process.env.CHROME_EXECUTABLE_PATH = previousChromePath;
    }
  });

  it("marks disconnects as reconnectable and blocks sends with a clear error", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    class FakeLocalAuth {
      constructor(public options: Record<string, unknown>) {}
    }
    class FakeClient {
      on(event: string, callback: (...args: unknown[]) => void): void {
        handlers.set(event, callback);
      }

      async initialize(): Promise<void> {
        await handlers.get("ready")?.();
      }

      async getChatById(): Promise<never> {
        throw new Error("not implemented");
      }

      async getChats(): Promise<[]> {
        return [];
      }

      async sendMessage(): Promise<{ id: { id: string } }> {
        return { id: { id: "fake" } };
      }

      async destroy(): Promise<void> {}
    }

    const transport = new WhatsAppWebTransport(async () => undefined, () => ({
      Client: FakeClient,
      LocalAuth: FakeLocalAuth
    }));

    await transport.initialize({ waitMs: 10 });
    handlers.get("disconnected")?.("NAVIGATION");

    expect(transport.getStatus()).toMatchObject({
      ready: false,
      state: "disconnected",
      needsReconnect: true,
      needsSessionReset: false,
      lastDisconnectReason: "NAVIGATION"
    });
    await expect(
      transport.sendMessage({
        to: contact.normalizedPhone,
        body: "hello",
        kind: "reply",
        contact
      })
    ).rejects.toThrow("Reconnect Web");
  });

  it("marks auth failures as requiring explicit session reset", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    class FakeLocalAuth {
      constructor(public options: Record<string, unknown>) {}
    }
    class FakeClient {
      on(event: string, callback: (...args: unknown[]) => void): void {
        handlers.set(event, callback);
      }

      async initialize(): Promise<void> {
        await handlers.get("auth_failure")?.("device removed");
      }

      async getChatById(): Promise<never> {
        throw new Error("not implemented");
      }

      async getChats(): Promise<[]> {
        return [];
      }

      async sendMessage(): Promise<{ id: { id: string } }> {
        return { id: { id: "fake" } };
      }

      async destroy(): Promise<void> {}
    }

    const transport = new WhatsAppWebTransport(async () => undefined, () => ({
      Client: FakeClient,
      LocalAuth: FakeLocalAuth
    }));

    await transport.initialize({ waitMs: 10 });

    expect(transport.getStatus()).toMatchObject({
      ready: false,
      state: "auth_failed",
      needsReconnect: false,
      needsSessionReset: true,
      lastDisconnectReason: "device removed"
    });
    await expect(transport.reconnect({ waitMs: 10 })).resolves.toMatchObject({ needsSessionReset: true });
  });

  it("syncs known chats quickly without opening every missing number", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const getChatById = vi.fn();
    const fetchMessages = vi.fn().mockResolvedValue([
      {
        body: "Hello",
        fromMe: false,
        timestamp: 1779850000,
        type: "chat",
        id: { _serialized: "message-1" }
      }
    ]);
    class FakeLocalAuth {
      constructor(public options: Record<string, unknown>) {}
    }
    class FakeClient {
      on(event: string, callback: (...args: unknown[]) => void): void {
        handlers.set(event, callback);
      }

      async initialize(): Promise<void> {
        await handlers.get("ready")?.();
      }

      async getChatById(): Promise<never> {
        getChatById();
        throw new Error("should not lookup missing chats in fast mode");
      }

      async getChats(): Promise<Array<{ id: { _serialized: string }; isGroup: boolean; fetchMessages: typeof fetchMessages }>> {
        return [
          {
            id: { _serialized: "233241234567@c.us" },
            isGroup: false,
            fetchMessages
          }
        ];
      }

      async sendMessage(): Promise<{ id: { id: string } }> {
        return { id: { id: "fake" } };
      }

      async destroy(): Promise<void> {}
    }

    const progress = vi.fn();
    const transport = new WhatsAppWebTransport(async () => undefined, () => ({
      Client: FakeClient,
      LocalAuth: FakeLocalAuth
    }));

    await transport.initialize({ waitMs: 10 });
    const result = await transport.fetchRecentContactMessages(["+233241234567", "+233559999999"], 5, {
      lookupMissingChats: false,
      onProgress: progress
    });

    expect(getChatById).not.toHaveBeenCalled();
    expect(fetchMessages).toHaveBeenCalledWith({ limit: 5 });
    expect(result).toMatchObject({ requestedContacts: 2, scannedChats: 1, skippedChats: 1 });
    expect(result.messages[0]).toMatchObject({ phone: "+233241234567", body: "Hello", providerMessageId: "message-1" });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: "loading_chats", requestedContacts: 2 }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: "scanning_chats", skippedChats: 1 }));
  });
});
