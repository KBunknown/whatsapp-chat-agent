import QRCode from "qrcode";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import type { Contact, TransportState, WebTransportState } from "../shared/types.js";
import { phoneToWhatsAppId } from "./phone.js";

const require = createRequire(import.meta.url);

export interface SendRequest {
  to: string;
  body: string;
  kind: "initial" | "reply";
  contact: Contact;
}

export interface SendResult {
  channel: "cloud" | "web";
  providerMessageId: string;
}

export interface TransportProvider {
  readonly channel: "cloud" | "web";
  isReady(): boolean;
  sendMessage(request: SendRequest): Promise<SendResult>;
}

interface IncomingWhatsAppMessage {
  from: string;
  body: string;
  providerMessageId?: string;
  channel: "cloud" | "web";
}

export type IncomingMessageHandler = (message: IncomingWhatsAppMessage) => Promise<void>;

interface WhatsAppWebClient {
  on(event: string, callback: (...args: unknown[]) => void): void;
  initialize(): Promise<void>;
  getChats(): Promise<WhatsAppWebChat[]>;
  getChatById(chatId: string): Promise<WhatsAppWebChat>;
  sendMessage(to: string, body: string): Promise<{ id?: { id?: string }; fromMe?: boolean }>;
  destroy(): Promise<void>;
}

interface WhatsAppWebChat {
  id?: { _serialized?: string };
  isGroup?: boolean;
  fetchMessages(options: { limit?: number; fromMe?: boolean }): Promise<WhatsAppWebHistoryMessage[]>;
}

interface WhatsAppWebHistoryMessage {
  from?: string;
  to?: string;
  body?: string;
  fromMe?: boolean;
  timestamp?: number;
  type?: string;
  id?: { id?: string; _serialized?: string };
}

interface WhatsAppWebModule {
  Client: new (options: Record<string, unknown>) => WhatsAppWebClient;
  LocalAuth: new (options: Record<string, unknown>) => unknown;
}

export interface SyncedWhatsAppMessage {
  phone: string;
  body: string;
  fromMe: boolean;
  providerMessageId: string;
  createdAt: string;
  type: string;
}

export interface WhatsAppFetchResult {
  requestedContacts: number;
  scannedChats: number;
  skippedChats: number;
  messages: SyncedWhatsAppMessage[];
  errors: string[];
}

export interface WhatsAppFetchProgress {
  phase: "loading_chats" | "scanning_chats";
  requestedContacts: number;
  scannedChats: number;
  skippedChats: number;
  currentPhone: string;
  errors: string[];
}

export class CloudApiTransport implements TransportProvider {
  readonly channel = "cloud" as const;
  private lastError = "";

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  isConfigured(): boolean {
    return Boolean(process.env.WA_CLOUD_ACCESS_TOKEN && process.env.WA_CLOUD_PHONE_NUMBER_ID);
  }

  hasTemplate(): boolean {
    return Boolean(process.env.WA_CLOUD_TEMPLATE_NAME);
  }

  isReady(): boolean {
    return this.isConfigured();
  }

  getStatus(): TransportState["cloud"] {
    return {
      configured: this.isConfigured(),
      ready: this.isReady(),
      lastError: this.lastError,
      templateConfigured: this.hasTemplate()
    };
  }

  verifyWebhook(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
    if (mode === "subscribe" && token === (process.env.WA_CLOUD_VERIFY_TOKEN || "change-me")) {
      return challenge || "";
    }
    return null;
  }

  extractIncoming(payload: unknown): IncomingWhatsAppMessage[] {
    const messages: IncomingWhatsAppMessage[] = [];
    const entries = (payload as { entry?: unknown[] })?.entry || [];
    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] }).changes || [];
      for (const change of changes) {
        const value = (change as { value?: { messages?: unknown[] } }).value;
        for (const message of value?.messages || []) {
          const typed = message as {
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
            button?: { text?: string };
            interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
          };
          const body =
            typed.text?.body ||
            typed.button?.text ||
            typed.interactive?.button_reply?.title ||
            typed.interactive?.list_reply?.title ||
            "";
          if (typed.from && body) {
            messages.push({
              from: `+${typed.from.replace(/^\+/, "")}`,
              body,
              providerMessageId: typed.id || "",
              channel: "cloud"
            });
          }
        }
      }
    }
    return messages;
  }

  async sendMessage(request: SendRequest): Promise<SendResult> {
    if (!this.isConfigured()) throw new Error("WhatsApp Cloud API is not configured.");

    const apiVersion = process.env.WA_CLOUD_API_VERSION || "v20.0";
    const phoneNumberId = process.env.WA_CLOUD_PHONE_NUMBER_ID;
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const token = process.env.WA_CLOUD_ACCESS_TOKEN;
    const payload = this.buildPayload(request);

    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text();
      this.lastError = `Cloud API ${response.status}: ${body.slice(0, 200)}`;
      throw new Error(this.lastError);
    }

    const json = (await response.json()) as { messages?: Array<{ id?: string }> };
    this.lastError = "";
    return {
      channel: "cloud",
      providerMessageId: json.messages?.[0]?.id || ""
    };
  }

  private buildPayload(request: SendRequest): Record<string, unknown> {
    const to = phoneToWhatsAppId(request.to);
    if (request.kind === "initial" && this.hasTemplate()) {
      const templateName = process.env.WA_CLOUD_TEMPLATE_NAME || "";
      const language = process.env.WA_CLOUD_TEMPLATE_LANGUAGE || "en";
      const params = (process.env.WA_CLOUD_TEMPLATE_BODY_PARAMS || "fullName,programOfStudy")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((field) => ({
          type: "text",
          text: cloudTemplateValue(field, request.contact, request.body)
        }));

      return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          components: params.length
            ? [
                {
                  type: "body",
                  parameters: params
                }
              ]
            : []
        }
      };
    }

    if (request.kind === "initial" && process.env.WA_CLOUD_ALLOW_TEXT_INITIAL !== "true") {
      throw new Error("Cloud API initial text sends are disabled until a template is configured.");
    }

    return {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: request.body
      }
    };
  }
}

function cloudTemplateValue(field: string, contact: Contact, body: string): string {
  const values: Record<string, string> = {
    fullName: contact.fullName,
    firstName: contact.fullName.split(/\s+/).filter(Boolean).at(-1) || contact.fullName,
    programOfStudy: contact.programOfStudy,
    level: contact.level,
    institution: contact.institution,
    body
  };
  return values[field] || "";
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class WhatsAppWebTransport implements TransportProvider {
  readonly channel = "web" as const;
  private client: unknown = null;
  private initialized = false;
  private ready = false;
  private qrDataUrl = "";
  private lastError = "";
  private starting = false;
  private state: WebTransportState = "idle";
  private lastEventAt = "";
  private lastDisconnectReason = "";
  private needsReconnect = false;
  private needsSessionReset = false;
  private reconnectAttempts = 0;
  private statusWaiters = new Set<() => void>();

  constructor(
    private readonly onIncoming: IncomingMessageHandler,
    private readonly loadModule: () => WhatsAppWebModule = () => require("whatsapp-web.js") as WhatsAppWebModule
  ) {}

  isEnabled(): boolean {
    return process.env.WHATSAPP_WEB_ENABLED !== "false";
  }

  isReady(): boolean {
    return this.ready;
  }

  getStatus(): TransportState["web"] {
    return {
      enabled: this.isEnabled(),
      initialized: this.initialized,
      starting: this.starting,
      ready: this.ready,
      state: this.currentState(),
      qrDataUrl: this.qrDataUrl,
      lastError: this.lastError,
      lastEventAt: this.lastEventAt,
      lastDisconnectReason: this.lastDisconnectReason,
      needsReconnect: this.needsReconnect,
      needsSessionReset: this.needsSessionReset,
      reconnectAttempts: this.reconnectAttempts,
      sessionPath: this.getAuthPath(),
      chromePath: this.getChromePath()
    };
  }

  getAuthPath(): string {
    return process.env.WHATSAPP_WEB_AUTH_PATH || ".wwebjs_auth";
  }

  getChromePath(): string {
    return process.env.CHROME_EXECUTABLE_PATH?.trim() || "";
  }

  async initialize(options: { waitMs?: number; force?: boolean } = {}): Promise<TransportState["web"]> {
    if (!this.isEnabled()) {
      this.markState("disabled");
      this.lastError = "WhatsApp Web is disabled by WHATSAPP_WEB_ENABLED=false.";
      return this.getStatus();
    }

    if (this.needsSessionReset && !options.force) {
      this.lastError = this.lastError || "WhatsApp Web session needs reset. Reset the session and scan a fresh QR code.";
      return this.getStatus();
    }

    if (options.force || this.hasStaleInitializedClient()) {
      await this.resetClient();
    }

    if (this.ready || this.qrDataUrl) return this.getStatus();
    if (this.initialized || this.starting) return this.waitForConnectionSignal(options.waitMs ?? 20000);

    try {
      const module = this.loadModule();

      this.starting = true;
      this.ready = false;
      this.qrDataUrl = "";
      this.lastError = "";
      this.needsReconnect = false;
      this.needsSessionReset = false;
      this.lastDisconnectReason = "";
      this.markState("starting");
      const puppeteerOptions: Record<string, unknown> = {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      };
      const chromePath = this.getChromePath();
      if (chromePath) puppeteerOptions.executablePath = chromePath;
      const client = new module.Client({
        authStrategy: new module.LocalAuth({ dataPath: this.getAuthPath() }),
        puppeteer: puppeteerOptions
      });

      client.on("qr", async (qr: unknown) => {
        try {
          this.qrDataUrl = await QRCode.toDataURL(String(qr));
          this.lastError = "";
        } catch (error) {
          this.lastError = `Could not render QR code: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
          this.starting = false;
          this.ready = false;
          this.needsReconnect = false;
          this.needsSessionReset = false;
          this.markState("qr_ready");
        }
        this.notifyStatusWaiters();
      });
      client.on("ready", () => {
        this.starting = false;
        this.ready = true;
        this.qrDataUrl = "";
        this.lastError = "";
        this.needsReconnect = false;
        this.needsSessionReset = false;
        this.lastDisconnectReason = "";
        this.markState("ready");
        this.notifyStatusWaiters();
      });
      client.on("authenticated", () => {
        this.lastError = "";
        this.needsSessionReset = false;
        this.markEvent();
        this.notifyStatusWaiters();
      });
      client.on("auth_failure", (message: unknown) => {
        this.markAuthFailure(String(message));
        this.notifyStatusWaiters();
      });
      client.on("disconnected", (reason: unknown) => {
        this.markDisconnected(String(reason));
        this.notifyStatusWaiters();
      });
      client.on("message", (message: unknown) => {
        void this.handleIncoming(message);
      });

      this.client = client;
      this.initialized = true;
      void client.initialize().catch((error: unknown) => {
        this.client = null;
        this.initialized = false;
        this.starting = false;
        this.ready = false;
        this.qrDataUrl = "";
        this.lastError = error instanceof Error ? error.message : String(error);
        this.needsReconnect = true;
        this.markState("error");
        this.notifyStatusWaiters();
      });
    } catch (error) {
      this.client = null;
      this.initialized = false;
      this.starting = false;
      this.ready = false;
      this.qrDataUrl = "";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.needsReconnect = true;
      this.markState("error");
      this.notifyStatusWaiters();
    }

    return this.waitForConnectionSignal(options.waitMs ?? 20000);
  }

  async reconnect(options: { waitMs?: number } = {}): Promise<TransportState["web"]> {
    if (this.needsSessionReset) {
      this.lastError = this.lastError || "WhatsApp Web session needs reset. Reset the session and scan a fresh QR code.";
      return this.getStatus();
    }
    this.reconnectAttempts += 1;
    await this.resetClient({ keepRecoveryFlags: true });
    this.needsReconnect = false;
    this.markState("starting");
    return this.initialize({ waitMs: options.waitMs ?? 20000, force: false });
  }

  async disconnect(options: { clearSession?: boolean } = {}): Promise<TransportState["web"]> {
    await this.resetClient();
    if (options.clearSession) {
      await removeLocalAuthPath(this.getAuthPath());
      this.lastError = "WhatsApp Web session was reset. Click Connect Web to generate a fresh QR code.";
      this.needsSessionReset = false;
      this.needsReconnect = false;
      this.lastDisconnectReason = "";
      this.markState("idle");
    }
    return this.getStatus();
  }

  async sendMessage(request: SendRequest): Promise<SendResult> {
    if (!this.ready || !this.client) throw new Error(this.notReadyMessage());
    const client = this.client as {
      sendMessage(to: string, body: string): Promise<{ id?: { id?: string } }>;
    };
    const result = await client.sendMessage(`${phoneToWhatsAppId(request.to)}@c.us`, request.body);
    return {
      channel: "web",
      providerMessageId: result.id?.id || ""
    };
  }

  async fetchRecentContactMessages(
    phones: string[],
    messagesPerChat = 20,
    options: {
      lookupMissingChats?: boolean;
      onProgress?: (progress: WhatsAppFetchProgress) => void;
    } = {}
  ): Promise<WhatsAppFetchResult> {
    if (!this.ready || !this.client) throw new Error(this.notReadyMessage());
    const client = this.client as WhatsAppWebClient;
    const uniquePhones = [...new Set(phones.map((phone) => phone.trim()).filter(Boolean))];
    const availableChats = new Map<string, WhatsAppWebChat>();
    const notify = (progress: Partial<WhatsAppFetchProgress>) => {
      options.onProgress?.({
        phase: progress.phase || "scanning_chats",
        requestedContacts: uniquePhones.length,
        scannedChats: result.scannedChats,
        skippedChats: result.skippedChats,
        currentPhone: progress.currentPhone || "",
        errors: result.errors
      });
    };

    const result: WhatsAppFetchResult = {
      requestedContacts: uniquePhones.length,
      scannedChats: 0,
      skippedChats: 0,
      messages: [],
      errors: []
    };

    notify({ phase: "loading_chats" });
    for (const chat of await withTimeout(client.getChats(), 15000, "Timed out while loading WhatsApp chat list.")) {
      const chatId = chat.id?._serialized || "";
      if (!chat.isGroup && chatId.endsWith("@c.us")) availableChats.set(chatId, chat);
    }

    for (const phone of uniquePhones) {
      try {
        notify({ phase: "scanning_chats", currentPhone: phone });
        const chatId = `${phoneToWhatsAppId(phone)}@c.us`;
        const knownChat = availableChats.get(chatId);
        const chat =
          knownChat ||
          (options.lookupMissingChats
            ? await withTimeout(client.getChatById(chatId), 3000, `Timed out while opening chat for ${phone}.`)
            : null);
        if (!chat || chat.isGroup) {
          result.skippedChats += 1;
          notify({ phase: "scanning_chats", currentPhone: phone });
          continue;
        }
        const messages = await withTimeout(
          chat.fetchMessages({ limit: messagesPerChat }),
          8000,
          `Timed out while loading messages for ${phone}.`
        );
        result.scannedChats += 1;
        notify({ phase: "scanning_chats", currentPhone: phone });
        for (const message of messages) {
          if (isIgnorableHistoryMessage(message)) continue;
          const body = message.body?.trim() || `[${message.type || "unsupported"} WhatsApp message]`;
          const createdAt = message.timestamp ? new Date(message.timestamp * 1000).toISOString() : new Date().toISOString();
          result.messages.push({
            phone,
            body,
            fromMe: Boolean(message.fromMe),
            providerMessageId: message.id?._serialized || message.id?.id || "",
            createdAt,
            type: message.type || "text"
          });
        }
      } catch (error) {
        result.skippedChats += 1;
        result.errors.push(`${phone}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 220));
        notify({ phase: "scanning_chats", currentPhone: phone });
      }
    }

    result.messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return result;
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    try {
      const message = raw as { from?: string; body?: string; id?: { id?: string }; fromMe?: boolean };
      if (message.fromMe || !message.from?.endsWith("@c.us")) return;
      await this.onIncoming({
        from: `+${message.from.replace("@c.us", "")}`,
        body: message.body || "",
        providerMessageId: message.id?.id || "",
        channel: "web"
      });
      this.lastError = "";
      this.markEvent();
    } catch (error) {
      this.lastError = `Inbound message handling failed: ${error instanceof Error ? error.message : String(error)}`;
      this.markState("error");
      console.error(this.lastError);
    }
  }

  private hasStaleInitializedClient(): boolean {
    return this.initialized && !this.ready && !this.starting && !this.qrDataUrl;
  }

  simulateState(event: "disconnected" | "auth_failure" | "ready" | "qr"): TransportState["web"] {
    if (event === "disconnected") {
      this.markDisconnected("Simulated disconnect");
      return this.getStatus();
    }
    if (event === "auth_failure") {
      this.markAuthFailure("Simulated linked device removal");
      return this.getStatus();
    }
    if (event === "ready") {
      this.initialized = true;
      this.starting = false;
      this.ready = true;
      this.qrDataUrl = "";
      this.lastError = "";
      this.needsReconnect = false;
      this.needsSessionReset = false;
      this.lastDisconnectReason = "";
      this.markState("ready");
      return this.getStatus();
    }
    this.initialized = true;
    this.starting = false;
    this.ready = false;
    this.qrDataUrl = "data:image/png;base64,c2ltdWxhdGVkLXFy";
    this.lastError = "";
    this.needsReconnect = false;
    this.needsSessionReset = false;
    this.markState("qr_ready");
    return this.getStatus();
  }

  private async resetClient(options: { keepRecoveryFlags?: boolean } = {}): Promise<void> {
    if (this.client) {
      const client = this.client as { destroy(): Promise<void> };
      await client.destroy().catch(() => undefined);
    }
    this.client = null;
    this.initialized = false;
    this.starting = false;
    this.ready = false;
    this.qrDataUrl = "";
    if (!options.keepRecoveryFlags) {
      this.needsReconnect = false;
      this.needsSessionReset = false;
      this.lastDisconnectReason = "";
      this.markState(this.isEnabled() ? "idle" : "disabled");
    }
    this.notifyStatusWaiters();
  }

  private waitForConnectionSignal(waitMs: number): Promise<TransportState["web"]> {
    if (this.ready || this.qrDataUrl || this.lastError || !this.starting) return Promise.resolve(this.getStatus());

    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timeout) clearTimeout(timeout);
        this.statusWaiters.delete(done);
        resolve(this.getStatus());
      };
      timeout = setTimeout(done, waitMs);
      this.statusWaiters.add(done);
    });
  }

  private notifyStatusWaiters(): void {
    const waiters = [...this.statusWaiters];
    this.statusWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  private markDisconnected(reason: string): void {
    this.client = null;
    this.starting = false;
    this.ready = false;
    this.initialized = false;
    this.qrDataUrl = "";
    this.lastDisconnectReason = reason;
    this.lastError = `Disconnected: ${reason}. Click Reconnect Web. If WhatsApp says the device was removed, reset the session and scan a fresh QR.`;
    this.needsReconnect = true;
    this.needsSessionReset = isAuthFailureLike(reason);
    this.markState(this.needsSessionReset ? "auth_failed" : "disconnected");
  }

  private markAuthFailure(reason: string): void {
    this.client = null;
    this.initialized = false;
    this.starting = false;
    this.ready = false;
    this.qrDataUrl = "";
    this.lastDisconnectReason = reason;
    this.lastError = `Authentication failed: ${reason}. Reset the session, then scan a fresh QR code.`;
    this.needsReconnect = false;
    this.needsSessionReset = true;
    this.markState("auth_failed");
  }

  private notReadyMessage(): string {
    if (this.needsSessionReset) return "WhatsApp Web session needs reset. Reset the session and scan a fresh QR code before sending.";
    if (this.needsReconnect) return "WhatsApp Web is disconnected. Click Reconnect Web before sending.";
    return "WhatsApp Web is not ready.";
  }

  private currentState(): WebTransportState {
    if (!this.isEnabled()) return "disabled";
    if (this.state === "auth_failed" || this.state === "disconnected" || this.state === "error") return this.state;
    if (this.ready) return "ready";
    if (this.qrDataUrl) return "qr_ready";
    if (this.starting) return "starting";
    return "idle";
  }

  private markState(state: WebTransportState): void {
    this.state = state;
    this.markEvent();
  }

  private markEvent(): void {
    this.lastEventAt = new Date().toISOString();
  }
}

async function removeLocalAuthPath(authPath: string): Promise<void> {
  const resolved = path.resolve(process.cwd(), authPath);
  const cwd = process.cwd();
  const relative = path.relative(cwd, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to remove an unsafe WhatsApp Web auth path.");
  }
  await fs.rm(resolved, { recursive: true, force: true });
}

function isIgnorableHistoryMessage(message: WhatsAppWebHistoryMessage): boolean {
  const type = String(message.type || "").toLowerCase();
  if (["e2e_notification", "notification_template", "ciphertext", "revoked"].includes(type)) return true;
  return !message.body?.trim() && ["protocol", "gp2", "notification"].includes(type);
}

function isAuthFailureLike(reason: string): boolean {
  return /\b(auth|logged\s*out|removed|unpaired|invalid|session)\b/i.test(reason);
}

export class TransportRouter {
  constructor(
    private readonly cloud: CloudApiTransport,
    private readonly web: WhatsAppWebTransport
  ) {}

  getStatus(): TransportState {
    return {
      cloud: this.cloud.getStatus(),
      web: this.web.getStatus()
    };
  }

  async sendMessage(request: SendRequest, options: { cloudEnabled: boolean; webEnabled: boolean }): Promise<SendResult> {
    const errors: string[] = [];

    if (options.cloudEnabled && this.cloud.isReady()) {
      try {
        return await this.cloud.sendMessage(request);
      } catch (error) {
        errors.push(`cloud: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (options.webEnabled && this.web.isReady()) {
      try {
        return await this.web.sendMessage(request);
      } catch (error) {
        errors.push(`web: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(errors.length ? errors.join(" | ") : "WhatsApp Web is not connected. Scan the QR code before live sending.");
  }
}
