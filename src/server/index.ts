import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CampaignService } from "./campaign.js";
import {
  deleteResource,
  getContact,
  getContactByPhone,
  getConversationSummary,
  getResource,
  getSettings,
  listContacts,
  listMessages,
  listResources,
  openDatabase,
  updateResource,
  updateSettings
} from "./db.js";
import { importWorkbookBuffer } from "./importer.js";
import { createLlmRouter, getLlmRuntimeStatus } from "./llm.js";
import { CloudApiTransport, TransportRouter, WhatsAppWebTransport } from "./transports.js";
import { normalizeGhanaPhone } from "./phone.js";
import { contactsToCsv } from "./csv.js";
import { extractResourceText, ingestResource, reindexResource, seedManifestoResource } from "./resources.js";
import type { AutoSyncState, SyncProgress, WhatsAppSyncResult } from "../shared/types.js";
import { createBasicAuthMiddleware } from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const db = openDatabase();
const llm = createLlmRouter();
const cloud = new CloudApiTransport();
let campaignService: CampaignService;
const web = new WhatsAppWebTransport(async (message) => {
  await campaignService.handleInbound(message);
});
const transports = new TransportRouter(cloud, web);
campaignService = new CampaignService(db, llm, transports);
void seedManifestoResource(db);

const autoSyncRuntime: Omit<AutoSyncState, "enabled" | "autoReplyEnabled" | "safeAutoSend" | "intervalSeconds"> = {
  running: false,
  lastStartedAt: "",
  lastFinishedAt: "",
  lastError: "",
  nextRunAt: new Date(Date.now() + getSettings(db).autoSyncIntervalSeconds * 1000).toISOString(),
  lastResult: null
};

let syncProgress: SyncProgress = idleSyncProgress();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json(runtimeStatus());
});

app.use(createBasicAuthMiddleware());

app.get("/api/dashboard", (_req, res) => {
  res.json({
    settings: getSettings(db),
    contacts: listContacts(db),
    messages: listMessages(db),
    activeRun: campaignService.getActiveRun(),
    transports: transports.getStatus(),
    runtime: runtimeStatus(),
    whatsappStates: campaignService.getWhatsAppContactStates(),
    metrics: campaignService.getMetrics(),
    resources: listResources(db),
    autoSync: autoSyncStatus(),
    syncProgress,
    campaignProgress: campaignService.getCampaignProgress()
  });
});

app.get("/api/settings", (_req, res) => {
  res.json(getSettings(db));
});

app.put("/api/settings", (req, res) => {
  res.json(updateSettings(db, req.body || {}));
});

app.post("/api/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Upload an Excel file in the file field." });
    return;
  }
  try {
    res.json(await importWorkbookBuffer(db, req.file.buffer));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/contacts", (_req, res) => {
  res.json(listContacts(db));
});

app.get("/api/contacts/:id/conversation", (req, res) => {
  const id = Number(req.params.id);
  const contact = getContact(db, id);
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  res.json({
    contact,
    messages: listMessages(db, id),
    summary: getConversationSummary(db, id)
  });
});

app.post("/api/contacts/:id/reply", async (req, res) => {
  const id = Number(req.params.id);
  const contact = getContact(db, id);
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  try {
    await campaignService.autoReply(id, String(req.body?.incomingText || "Please follow up with this voter."), "web");
    res.json({ ok: true, conversation: { contact: getContact(db, id), messages: listMessages(db, id) } });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/contacts/:id/draft-reply", async (req, res) => {
  const id = Number(req.params.id);
  const contact = getContact(db, id);
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  try {
    await campaignService.draftReply(id, req.body?.incomingText ? String(req.body.incomingText) : undefined);
    res.json({ ok: true, conversation: conversationPayload(id) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/contacts/:id/send-draft", async (req, res) => {
  const id = Number(req.params.id);
  const contact = getContact(db, id);
  if (!contact) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }
  try {
    const messageId = req.body?.messageId ? Number(req.body.messageId) : undefined;
    await campaignService.sendDraft(id, messageId);
    res.json({ ok: true, conversation: conversationPayload(id) });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/inbound/simulate", async (req, res) => {
  const body = String(req.body?.body || "").trim();
  const contactId = req.body?.contactId ? Number(req.body.contactId) : 0;
  const contact = contactId ? getContact(db, contactId) : null;
  const rawPhone = String(req.body?.phone || contact?.normalizedPhone || contact?.selectedPhone || "");
  const from = normalizeGhanaPhone(rawPhone);

  if (!body) {
    res.status(400).json({ error: "Enter an inbound message to simulate." });
    return;
  }
  if (!from) {
    res.status(400).json({ error: "Choose a contact or enter a WhatsApp phone number." });
    return;
  }

  try {
    await campaignService.handleInbound({
      from,
      body,
      providerMessageId: `simulate-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      channel: "system"
    });
    const refreshed = getContactByPhone(db, from);
    res.json({
      ok: true,
      contact: refreshed,
      conversation: refreshed ? conversationPayload(refreshed.id) : null
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/campaigns/start", async (req, res) => {
  try {
    const run = await campaignService.startCampaign({
      dryRun: Boolean(req.body?.dryRun),
      limit: req.body?.limit ? Number(req.body.limit) : undefined,
      name: req.body?.name ? String(req.body.name) : undefined,
      contactIds: Array.isArray(req.body?.contactIds) ? req.body.contactIds.map(Number) : undefined
    });
    res.json(run);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/campaigns/pause", (_req, res) => {
  res.json(campaignService.pauseCampaign());
});

app.get("/api/campaigns/current", (_req, res) => {
  res.json(campaignService.getActiveRun());
});

app.get("/api/campaigns/progress", (_req, res) => {
  res.json(campaignService.getCampaignProgress());
});

app.get("/api/transports/status", (_req, res) => {
  res.json(transports.getStatus());
});

app.post("/api/transports/web/initialize", async (_req, res) => {
  res.json(await web.initialize({ waitMs: 25000 }));
});

app.post("/api/transports/web/reconnect", async (_req, res) => {
  res.json(await web.reconnect({ waitMs: 25000 }));
});

app.post("/api/transports/web/disconnect", async (req, res) => {
  res.json(await web.disconnect({ clearSession: Boolean(req.body?.clearSession) }));
});

app.post("/api/dev/transports/web/simulate", (req, res) => {
  if (!isWebSimulationEnabled()) {
    res.status(404).json({ error: "WhatsApp Web simulation is available only in local/dev mode." });
    return;
  }
  const event = String(req.body?.event || "");
  if (!["disconnected", "auth_failure", "ready", "qr"].includes(event)) {
    res.status(400).json({ error: "Simulation event must be disconnected, auth_failure, ready, or qr." });
    return;
  }
  res.json(web.simulateState(event as "disconnected" | "auth_failure" | "ready" | "qr"));
});

app.post("/api/transports/web/test-send", async (req, res) => {
  const to = normalizeGhanaPhone(String(req.body?.to || ""));
  const body = String(req.body?.body || "").trim();
  if (!to || to.length < 8) {
    res.status(400).json({ error: "Enter a valid WhatsApp phone number for the test send." });
    return;
  }
  if (!body) {
    res.status(400).json({ error: "Enter a short test message." });
    return;
  }
  if (!web.isReady()) {
    res.status(409).json({ error: "WhatsApp Web is not connected. Scan the QR code before sending a test message." });
    return;
  }

  try {
    const result = await web.sendMessage({
      to,
      body,
      kind: "reply",
      contact: {
        id: 0,
        fullName: "Test recipient",
        whatsappNumber: to,
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "",
        level: "",
        institution: "",
        selectedPhone: to,
        normalizedPhone: to,
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
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/transports/web/sync", async (req, res) => {
  try {
    res.json(startManualWebSync(req.body || {}));
  } catch (error) {
    res.status(web.isReady() ? 500 : 409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/transports/web/sync/progress", (_req, res) => {
  res.json(syncProgress);
});

app.post("/api/auto-sync/run", async (_req, res) => {
  try {
    const result = await runAutoSyncNow();
    res.json({ ok: true, autoSync: autoSyncStatus(), result });
  } catch (error) {
    res.status(web.isReady() ? 500 : 409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/pending-replies/process", async (_req, res) => {
  try {
    const result = await campaignService.processPendingReplies();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/resources", (_req, res) => {
  res.json(listResources(db));
});

app.post("/api/resources/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Upload a PDF, text, or markdown file in the file field." });
    return;
  }
  try {
    const extracted = await extractResourceText({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype
    });
    const resource = await ingestResource(db, {
      title: String(req.body?.title || path.parse(req.file.originalname).name || "Campaign resource"),
      fileName: req.file.originalname,
      text: extracted.text,
      resourceType: extracted.resourceType,
      active: req.body?.active !== "false"
    });
    res.json(resource);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/resources/text", async (req, res) => {
  const title = String(req.body?.title || "Campaign note").trim();
  const text = String(req.body?.text || "").trim();
  if (!text) {
    res.status(400).json({ error: "Enter resource text before saving." });
    return;
  }
  try {
    res.json(await ingestResource(db, { title, text, resourceType: "manual", active: req.body?.active !== false }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch("/api/resources/:id", (req, res) => {
  const id = Number(req.params.id);
  const resource = getResource(db, id);
  if (!resource) {
    res.status(404).json({ error: "Resource not found." });
    return;
  }
  const updated = updateResource(db, id, {
    title: req.body?.title === undefined ? undefined : String(req.body.title),
    active: req.body?.active === undefined ? undefined : Boolean(req.body.active)
  });
  res.json(updated);
});

app.post("/api/resources/:id/reindex", async (req, res) => {
  try {
    res.json(await reindexResource(db, Number(req.params.id)));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/api/resources/:id", (req, res) => {
  deleteResource(db, Number(req.params.id));
  res.json({ ok: true });
});

app.post("/api/pending-replies/process-selected", async (req, res) => {
  try {
    const contactIds = Array.isArray(req.body?.contactIds) ? req.body.contactIds.map(Number).filter((id: number) => !isNaN(id)) : [];
    if (contactIds.length === 0) {
      res.status(400).json({ error: "No contact IDs provided" });
      return;
    }
    const result = await campaignService.processSelectedReplies(contactIds);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/export.csv", (_req, res) => {
  res.header("Content-Type", "text/csv");
  res.attachment("whatsapp-campaign-contacts.csv");
  res.send(contactsToCsv(listContacts(db)));
});

app.get("/webhooks/whatsapp", (req, res) => {
  const challenge = cloud.verifyWebhook(
    String(req.query["hub.mode"] || ""),
    String(req.query["hub.verify_token"] || ""),
    String(req.query["hub.challenge"] || "")
  );
  if (challenge === null) {
    res.sendStatus(403);
    return;
  }
  res.status(200).send(challenge);
});

app.post("/webhooks/whatsapp", async (req, res) => {
  const incoming = cloud.extractIncoming(req.body);
  for (const message of incoming) {
    await campaignService.handleInbound(message);
  }
  res.sendStatus(200);
});

async function attachFrontend(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    const clientDist = path.resolve(__dirname, "../client");
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
    return;
  }

  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 8787);
const autoSyncTimer = setInterval(() => {
  const settings = getSettings(db);
  if (!settings.autoSyncEnabled || autoSyncRuntime.running || syncProgress.running || !web.isReady()) return;
  if (Date.now() < Date.parse(autoSyncRuntime.nextRunAt || "0")) return;
  void runAutoSyncNow().catch(() => undefined);
}, 5000);
autoSyncTimer.unref?.();

await attachFrontend();
app.listen(port, () => {
  console.log(`WhatsApp campaign dashboard running at http://localhost:${port}`);
});

function runtimeStatus() {
  return {
    ok: true,
    time: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    devSimulationEnabled: isWebSimulationEnabled(),
    llm: getLlmRuntimeStatus(),
    transports: transports.getStatus()
  };
}

function isWebSimulationEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_WEB_SIMULATION === "true";
}

function autoSyncStatus(): AutoSyncState {
  const settings = getSettings(db);
  return {
    enabled: settings.autoSyncEnabled,
    autoReplyEnabled: settings.autoReplyEnabled,
    safeAutoSend: settings.safeAutoSend,
    intervalSeconds: normalizedSyncInterval(settings.autoSyncIntervalSeconds),
    running: autoSyncRuntime.running,
    lastStartedAt: autoSyncRuntime.lastStartedAt,
    lastFinishedAt: autoSyncRuntime.lastFinishedAt,
    lastError: autoSyncRuntime.lastError,
    nextRunAt: autoSyncRuntime.nextRunAt,
    lastResult: autoSyncRuntime.lastResult
  };
}

async function runWebSyncFromRequest(body: unknown): Promise<WhatsAppSyncResult> {
  const input = body as { contactIds?: unknown[]; messagesPerChat?: number; clearFirst?: boolean };
  const requestedIds = Array.isArray(input.contactIds) ? new Set(input.contactIds.map(Number)) : null;
  return runWebSync({
    contactIds: requestedIds,
    messagesPerChat: Math.max(1, Math.min(50, Number(input.messagesPerChat || 20))),
    clearFirst: input.clearFirst !== false,
    processReplies: getSettings(db).autoReplyEnabled
  });
}

function startManualWebSync(body: unknown): SyncProgress {
  if (syncProgress.running) return syncProgress;
  if (autoSyncRuntime.running) throw new Error("Auto-sync is already running. Wait for it to finish before starting a manual sync.");
  if (!web.isReady()) throw new Error("WhatsApp Web is not connected. Connect Web before syncing chat history.");
  const input = body as { contactIds?: unknown[]; messagesPerChat?: number; clearFirst?: boolean; lookupMissingChats?: boolean };
  const requestedIds = Array.isArray(input.contactIds) ? new Set(input.contactIds.map(Number)) : null;
  syncProgress = {
    ...idleSyncProgress(),
    id: `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    running: true,
    phase: "loading_chats",
    startedAt: new Date().toISOString(),
    requestedContacts: listContacts(db).filter(
      (contact) => contact.normalizedPhone && (!requestedIds || requestedIds.has(contact.id))
    ).length
  };

  void runWebSync({
    contactIds: requestedIds,
    messagesPerChat: Math.max(1, Math.min(50, Number(input.messagesPerChat || 20))),
    clearFirst: input.clearFirst !== false,
    processReplies: getSettings(db).autoReplyEnabled,
    lookupMissingChats: Boolean(input.lookupMissingChats),
    progressId: syncProgress.id
  }).catch((error) => {
    syncProgress = {
      ...syncProgress,
      running: false,
      phase: "failed",
      finishedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error)
    };
  });

  return syncProgress;
}

async function runAutoSyncNow(): Promise<WhatsAppSyncResult> {
  if (autoSyncRuntime.running) throw new Error("Auto-sync is already running.");
  autoSyncRuntime.running = true;
  autoSyncRuntime.lastStartedAt = new Date().toISOString();
  autoSyncRuntime.lastError = "";
  try {
    const result = await runWebSync({
      messagesPerChat: 20,
      clearFirst: true,
      processReplies: getSettings(db).autoReplyEnabled,
      lookupMissingChats: false
    });
    autoSyncRuntime.lastResult = result;
    return result;
  } catch (error) {
    autoSyncRuntime.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    autoSyncRuntime.running = false;
    autoSyncRuntime.lastFinishedAt = new Date().toISOString();
    autoSyncRuntime.nextRunAt = new Date(Date.now() + normalizedSyncInterval(getSettings(db).autoSyncIntervalSeconds) * 1000).toISOString();
  }
}

async function runWebSync(input: {
  contactIds?: Set<number> | null;
  messagesPerChat: number;
  clearFirst: boolean;
  processReplies: boolean;
  lookupMissingChats?: boolean;
  progressId?: string;
}): Promise<WhatsAppSyncResult> {
  if (!web.isReady()) {
    throw new Error("WhatsApp Web is not connected. Connect Web before syncing chat history.");
  }

  const contacts = listContacts(db).filter(
    (contact) => contact.normalizedPhone && (!input.contactIds || input.contactIds.has(contact.id))
  );
  updateSyncProgress(input.progressId, {
    running: true,
    phase: "loading_chats",
    requestedContacts: contacts.length
  });
  const fetched = await web.fetchRecentContactMessages(
    contacts.map((contact) => contact.normalizedPhone),
    input.messagesPerChat,
    {
      lookupMissingChats: Boolean(input.lookupMissingChats),
      onProgress: (progress) => {
        updateSyncProgress(input.progressId, {
          running: true,
          phase: progress.phase,
          requestedContacts: progress.requestedContacts,
          scannedChats: progress.scannedChats,
          skippedChats: progress.skippedChats,
          currentPhone: progress.currentPhone,
          errors: progress.errors.slice(-8)
        });
      }
    }
  );
  updateSyncProgress(input.progressId, {
    running: true,
    phase: "saving_messages",
    requestedContacts: fetched.requestedContacts,
    scannedChats: fetched.scannedChats,
    skippedChats: fetched.skippedChats,
    currentPhone: "",
    errors: fetched.errors.slice(-8)
  });
  const syncResult = campaignService.syncWhatsAppHistory(fetched, input.clearFirst);
  updateSyncProgress(input.progressId, {
    running: true,
    phase: input.processReplies ? "processing_replies" : "completed",
    importedMessages: syncResult.importedMessages,
    duplicateMessages: syncResult.duplicateMessages,
    needsReplyContacts: syncResult.needsReplyContacts
  });
  const pendingRepliesProcessed = input.processReplies ? await campaignService.processPendingReplies() : undefined;
  const result = { ...syncResult, pendingRepliesProcessed };
  autoSyncRuntime.lastResult = result;
  autoSyncRuntime.lastFinishedAt = new Date().toISOString();
  updateSyncProgress(input.progressId, {
    running: false,
    phase: "completed",
    finishedAt: new Date().toISOString(),
    importedMessages: result.importedMessages,
    duplicateMessages: result.duplicateMessages,
    needsReplyContacts: result.needsReplyContacts,
    result
  });
  return result;
}

function idleSyncProgress(): SyncProgress {
  return {
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
  };
}

function updateSyncProgress(progressId: string | undefined, patch: Partial<SyncProgress>): void {
  if (!progressId || syncProgress.id !== progressId) return;
  syncProgress = { ...syncProgress, ...patch };
}

function normalizedSyncInterval(value: number): number {
  return Math.max(30, Math.min(600, Number(value) || 60));
}

function conversationPayload(contactId: number) {
  const contact = getContact(db, contactId);
  return {
    contact,
    messages: listMessages(db, contactId),
    summary: getConversationSummary(db, contactId)
  };
}
