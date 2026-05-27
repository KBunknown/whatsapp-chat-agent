import crypto from "node:crypto";
import type {
  CampaignProgress,
  CampaignRun,
  CampaignSettings,
  Contact,
  BotMetrics,
  FunnelLabel,
  Message,
  MessageChannel,
  PendingReplyResult,
  ReplyDecision,
  WhatsAppContactState,
  WhatsAppSyncResult
} from "../shared/types.js";
import {
  activeRun,
  getContact,
  getContactByPhone,
  getConversationSummary,
  getInboundMessageByProviderId,
  getLatestDraftMessage,
  getMessage,
  getMessageByProviderId,
  getSettings,
  insertMessage,
  listAllMessages,
  listContacts,
  listMessages,
  listResources,
  mapRun,
  type Sqlite,
  updateContactState,
  updateRunStats,
  upsertConversationSummary
} from "./db.js";
import { classifyOutcome, isOptOut, mergeOutcome } from "./classifier.js";
import type { LlmProvider } from "./llm.js";
import { buildInitialMessagePrompt, buildReplyDecisionPrompt, buildSummaryPrompt, renderTemplate } from "./prompts.js";
import { findRelevantResourceSnippets } from "./resources.js";
import type { SyncedWhatsAppMessage, TransportRouter, WhatsAppFetchResult } from "./transports.js";
import { normalizeGhanaPhone } from "./phone.js";
import { nowIso, randomInt, sleep } from "./time.js";

export function hashMessage(body: string): string {
  return crypto.createHash("sha256").update(body.trim()).digest("hex");
}

export class CampaignService {
  private paused = false;
  private running = false;
  private campaignProgress: CampaignProgress = idleCampaignProgress();

  constructor(
    private readonly db: Sqlite,
    private readonly llm: LlmProvider,
    private readonly transports: TransportRouter
  ) {}

  getActiveRun(): CampaignRun | null {
    return activeRun(this.db);
  }

  getCampaignProgress(): CampaignProgress {
    return {
      ...this.campaignProgress,
      errors: [...this.campaignProgress.errors]
    };
  }

  getWhatsAppContactStates(): WhatsAppContactState[] {
    return listContacts(this.db).map((contact) => this.whatsAppStateForContact(contact));
  }

  getMetrics(): BotMetrics {
    const settings = getSettings(this.db);
    const contacts = listContacts(this.db);
    const messages = listAllMessages(this.db);
    const whatsappStates = contacts.map((contact) => this.whatsAppStateForContact(contact));
    const outbound = messages.filter((message) => message.direction === "outbound");
    const inboundReceived = messages.filter((message) => message.direction === "inbound" && message.status === "received").length;
    const outboundSent = outbound.filter((message) => message.status === "sent").length;
    const outboundFailed = outbound.filter((message) => message.status === "failed").length;
    const outboundDrafted = outbound.filter((message) => message.status === "drafted").length;
    const attemptedOutbound = outboundSent + outboundFailed;
    const autoRepliesSent = outbound.filter((message) => message.origin === "auto_reply" && message.status === "sent").length;
    const manualSends = outbound.filter((message) => message.origin === "manual_send" && message.status === "sent").length;
    const resources = listResources(this.db);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);

    return {
      contactsTotal: contacts.length,
      contactsWithPhone: contacts.filter((contact) => Boolean(contact.normalizedPhone)).length,
      noChat: whatsappStates.filter((state) => state.label === "no_chat").length,
      waitingForReply: whatsappStates.filter((state) => state.label === "waiting_for_reply").length,
      needsReply: whatsappStates.filter((state) => state.needsReply).length,
      repliedChats: whatsappStates.filter((state) => state.label === "replied").length,
      optedOutChats: whatsappStates.filter((state) => state.label === "opted_out").length,
      contacted: contacts.filter((contact) => contact.outcomeLabel === "contacted").length,
      replied: contacts.filter((contact) => contact.outcomeLabel === "replied").length,
      supportive: contacts.filter((contact) => contact.outcomeLabel === "supportive").length,
      undecided: contacts.filter((contact) => contact.outcomeLabel === "undecided").length,
      opposed: contacts.filter((contact) => contact.outcomeLabel === "opposed").length,
      optedOut: contacts.filter((contact) => contact.outcomeLabel === "opted_out" || contact.optedOut).length,
      failedSend: contacts.filter((contact) => contact.outcomeLabel === "failed_send" || contact.status === "failed").length,
      needsHuman: contacts.filter((contact) => contact.needsHuman).length,
      inboundReceived,
      outboundSent,
      outboundDrafted,
      outboundFailed,
      autoRepliesSent,
      autoDrafts: outbound.filter((message) => message.origin === "auto_draft" && message.status === "drafted").length,
      manualSends,
      needsHumanRate: percentage(contacts.filter((contact) => contact.needsHuman).length, Math.max(1, contacts.length)),
      autoReplyRate: percentage(autoRepliesSent, Math.max(1, inboundReceived)),
      sendSuccessRate: attemptedOutbound ? percentage(outboundSent, attemptedOutbound) : 100,
      averageReplyMinutes: averageReplyMinutes(messages),
      sentToday: countSentSince(messages, todayStart),
      sentThisHour: countSentSince(messages, hourStart),
      dailyCap: settings.maxPerDay,
      hourlyCap: settings.maxPerHour,
      replyDailyCap: settings.replyMaxPerDay,
      replyHourlyCap: settings.replyMaxPerHour,
      resourcesTotal: resources.length,
      resourcesActive: resources.filter((resource) => resource.active).length
    };
  }

  async startCampaign(input: { dryRun: boolean; limit?: number; name?: string; contactIds?: number[] }): Promise<CampaignRun> {
    if (this.running) throw new Error("A campaign is already running.");
    const current = activeRun(this.db);
    if (current?.status === "running") throw new Error("A campaign is already running.");

    const settings = getSettings(this.db);
    const contactIds = sanitizeContactIds(input.contactIds);
    if (!input.dryRun) {
      if (!settings.webEnabled) throw new Error("WhatsApp Web sending is disabled in settings.");
      if (!this.transports.getStatus().web.ready) throw new Error("WhatsApp Web is not connected. Scan the QR code before live sending.");
      if (contactIds.length === 0) throw new Error("Select at least one contact before starting a live WhatsApp Web batch.");
      if (contactIds.length > settings.maxLiveBatch) {
        throw new Error(`Live WhatsApp Web batches are limited to ${settings.maxLiveBatch} selected contacts at a time.`);
      }
      if (contactIds.length > settings.maxPerDay) {
        throw new Error(`This batch exceeds the daily cap of ${settings.maxPerDay} contacts.`);
      }
    }
    const startedAt = nowIso();
    const runName = input.name || `${input.dryRun ? "Dry run" : "Live run"} ${new Date().toLocaleString()}`;
    const result = this.db
      .prepare("INSERT INTO campaign_runs (name, status, dry_run, started_at) VALUES (?, 'running', ?, ?)")
      .run(runName, input.dryRun ? 1 : 0, startedAt);

    const run = mapRun(this.db.prepare("SELECT * FROM campaign_runs WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>);
    this.paused = false;
    this.running = true;
    this.campaignProgress = {
      ...idleCampaignProgress(),
      runId: run.id,
      runName: run.name,
      dryRun: input.dryRun,
      running: true,
      phase: "starting",
      startedAt: run.startedAt || startedAt
    };
    void this.processRun(run.id, settings, input.dryRun, input.limit, contactIds)
      .catch((error) => {
        const message = errorMessage(error);
        updateRunStats(this.db, run.id, this.campaignProgressToStats(), "failed");
        this.updateCampaignProgress({
          running: false,
          phase: "failed",
          finishedAt: nowIso(),
          lastError: message
        });
      })
      .finally(() => {
        this.running = false;
      });
    return run;
  }

  pauseCampaign(): CampaignRun | null {
    this.paused = true;
    const run = activeRun(this.db);
    if (!run) return null;
    this.db.prepare("UPDATE campaign_runs SET status = 'paused' WHERE id = ?").run(run.id);
    this.updateCampaignProgress({
      running: false,
      phase: "paused",
      finishedAt: nowIso(),
      lastError: "Campaign paused."
    });
    return this.getActiveRun();
  }

  async handleInbound(input: { from: string; body: string; providerMessageId?: string; channel: MessageChannel }): Promise<void> {
    const providerMessageId = input.providerMessageId?.trim() || "";
    if (providerMessageId && getInboundMessageByProviderId(this.db, providerMessageId)) return;

    const normalized = normalizeGhanaPhone(input.from);
    let contact = getContactByPhone(this.db, normalized);
    let createdFromInbound = false;
    if (!contact) {
      const now = nowIso();
      const result = this.db
        .prepare(
          `INSERT INTO contacts
            (full_name, selected_phone, normalized_phone, phone_source, import_notes, status, outcome_label,
             needs_human, created_at, updated_at)
           VALUES
            ('Potential voter', ?, ?, 'whatsapp', 'Created from inbound WhatsApp message. Ask qualifying questions before campaigning.', 'imported', 'not_contacted',
             0, ?, ?)`
        )
        .run(input.from, normalized, now, now);
      contact = getContact(this.db, Number(result.lastInsertRowid));
      if (!contact) return;
      createdFromInbound = true;
    }

    const unsupportedReason = unsupportedInboundReason(input.body);
    const incomingBody = input.body.trim() || "[Unsupported WhatsApp message]";
    const incomingHash = hashMessage(`${providerMessageId || normalized}:${incomingBody}`);
    insertMessage(this.db, {
      contactId: contact.id,
      runId: activeRun(this.db)?.id ?? null,
      direction: "inbound",
      channel: input.channel,
      body: incomingBody,
      messageHash: incomingHash,
      status: "received",
      providerMessageId,
      origin: input.channel === "system" ? "system" : ""
    });

    const incomingLabel = classifyOutcome(incomingBody);
    const optedOut = isOptOut(incomingBody);
    updateContactState(this.db, contact.id, {
      status: "replied",
      outcomeLabel: optedOut ? "opted_out" : mergeOutcome(contact.outcomeLabel, incomingLabel),
      optedOut,
      needsHuman: Boolean(unsupportedReason || contact.needsHuman),
      lastError: unsupportedReason || contact.lastError
    });

    if (optedOut) {
      await this.updateSummary(contact.id);
      return;
    }

    if (unsupportedReason) {
      await this.storeHumanDraft(contact.id, "I received your message, but I need to review it properly before replying.", unsupportedReason);
      await this.updateSummary(contact.id);
      return;
    }

    if (createdFromInbound && input.channel !== "system") {
      await this.replyToPotentialVoter(contact);
      return;
    }

    await this.autoReply(contact.id, incomingBody, input.channel);
  }

  async draftReply(contactId: number, incomingText?: string): Promise<Message> {
    const contact = getContact(this.db, contactId);
    if (!contact || contact.optedOut) throw new Error("Contact is not available for a draft reply.");
    const latestInbound = this.latestInboundWhatsAppMessage(contactId);
    const text = incomingText?.trim() || latestInbound?.body || "Please follow up with this voter.";

    const decision = await this.generateReplyDecision(contact, text);
    const draft = await this.storeHumanDraft(
      contact.id,
      decision.reply,
      decision.reason || "Draft generated for human approval.",
      "web",
      "manual_draft"
    );
    updateContactState(this.db, contact.id, {
      status: "needs_review",
      needsHuman: true,
      outcomeLabel: decision.outcomeLabel === "needs_human" ? "needs_human" : mergeOutcome(contact.outcomeLabel, decision.outcomeLabel),
      lastError: decision.reason || "Draft generated for human approval."
    });
    await this.updateSummary(contact.id);
    return draft;
  }

  async autoReply(contactId: number, incomingText: string, preferredChannel: MessageChannel = "web"): Promise<void> {
    const contact = getContact(this.db, contactId);
    if (!contact || contact.optedOut) return;
    const settings = getSettings(this.db);

    let decision: ReplyDecision;
    try {
      decision = await this.generateReplyDecision(contact, incomingText);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await this.storeHumanDraft(
        contact.id,
        "Thanks for your message. I want to give you the right answer, so Kwaku will follow up properly.",
        `LLM reply failed: ${messageText}`,
        "web",
        "auto_draft"
      );
      updateContactState(this.db, contact.id, {
        status: "needs_review",
        needsHuman: true,
        outcomeLabel: "needs_human",
        lastError: `LLM reply failed: ${messageText}`
      });
      await this.updateSummary(contact.id);
      return;
    }

    const humanReason = humanFollowUpReason(incomingText);
    if (humanReason) {
      decision = { ...decision, needsHuman: true, safeToAutoSend: false, reason: humanReason, outcomeLabel: "needs_human" };
    }

    const rateLimit = this.autoReplyRateLimit(settings);
    const shouldDraft =
      decision.needsHuman ||
      !decision.safeToAutoSend ||
      !settings.autoReplyEnabled ||
      !settings.safeAutoSend ||
      !rateLimit.ok;

    if (shouldDraft) {
      const reason =
        decision.reason ||
        (!settings.autoReplyEnabled ? "Auto-replies are disabled." : "") ||
        (!settings.safeAutoSend ? "Safe auto-send is disabled." : "") ||
        (!decision.safeToAutoSend ? "Reply needs human approval before sending." : "") ||
        rateLimit.reason ||
        "Needs human review before sending.";
      await this.storeHumanDraft(contact.id, decision.reply, reason, preferredChannel === "system" ? "system" : "web", "auto_draft");
      updateContactState(this.db, contact.id, {
        status: "needs_review",
        needsHuman: true,
        outcomeLabel: decision.outcomeLabel === "needs_human" ? "needs_human" : mergeOutcome(contact.outcomeLabel, decision.outcomeLabel),
        lastError: reason
      });
      await this.updateSummary(contact.id);
      return;
    }

    const reply = decision.reply.trim();
    if (preferredChannel === "system") {
      await this.storeHumanDraft(contact.id, reply, "Local simulation only; not sent to WhatsApp.", "system", "system");
      await this.updateSummary(contact.id);
      return;
    }

    const webStatus = this.transports.getStatus().web;
    if (!settings.webEnabled || !webStatus.ready) {
      const reason = "WhatsApp Web is not connected. Review or send this draft after Web is ready.";
      await this.storeHumanDraft(contact.id, reply, reason, "web", "auto_draft");
      updateContactState(this.db, contact.id, {
        status: "needs_review",
        needsHuman: true,
        outcomeLabel: "needs_human",
        lastError: reason
      });
      return;
    }

    const channel = preferredChannel === "cloud" || preferredChannel === "web" ? preferredChannel : "web";
    const message = insertMessage(this.db, {
      contactId: contact.id,
      runId: activeRun(this.db)?.id ?? null,
      direction: "outbound",
      channel,
      body: reply,
      messageHash: hashMessage(`${incomingText}:${reply}:${nowIso()}`),
      status: "queued",
      origin: "auto_reply"
    });

    try {
      const result = await this.transports.sendMessage(
        {
          to: contact.normalizedPhone,
          body: reply,
          kind: "reply",
          contact
        },
        { cloudEnabled: settings.cloudEnabled, webEnabled: settings.webEnabled }
      );
      this.db
        .prepare("UPDATE messages SET status = 'sent', channel = ?, provider_message_id = ? WHERE id = ?")
        .run(result.channel, result.providerMessageId, message.id);
      updateContactState(this.db, contact.id, {
        status: "replied",
        needsHuman: false,
        outcomeLabel: automatedOutcome(contact.outcomeLabel, decision.outcomeLabel),
        lastError: ""
      });
      await this.updateSummary(contact.id);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(messageText, message.id);
      updateContactState(this.db, contact.id, {
        status: "needs_review",
        needsHuman: true,
        outcomeLabel: "needs_human",
        lastError: `Auto-reply send failed: ${messageText}`
      });
      await this.updateSummary(contact.id);
    }
  }

  async sendDraft(contactId: number, messageId?: number): Promise<void> {
    const contact = getContact(this.db, contactId);
    if (!contact || contact.optedOut) throw new Error("Contact is not available for a draft reply.");

    const draft = messageId ? getMessage(this.db, messageId) : getLatestDraftMessage(this.db, contactId);
    if (!draft || draft.contactId !== contactId || draft.direction !== "outbound" || !["drafted", "failed"].includes(draft.status)) {
      throw new Error("No drafted reply is available for this contact.");
    }

    const settings = getSettings(this.db);
    try {
      const result = await this.transports.sendMessage(
        {
          to: contact.normalizedPhone,
          body: draft.body,
          kind: "reply",
          contact
        },
        { cloudEnabled: false, webEnabled: settings.webEnabled }
      );
      this.db
        .prepare("UPDATE messages SET status = 'sent', channel = ?, provider_message_id = ?, error = '', origin = 'manual_send' WHERE id = ?")
        .run(result.channel, result.providerMessageId, draft.id);
      updateContactState(this.db, contact.id, {
        status: "replied",
        needsHuman: false,
        outcomeLabel: contact.outcomeLabel === "needs_human" ? "replied" : contact.outcomeLabel,
        lastError: ""
      });
      await this.updateSummary(contact.id);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(messageText, draft.id);
      updateContactState(this.db, contact.id, {
        status: "needs_review",
        needsHuman: true,
        outcomeLabel: "needs_human",
        lastError: `Failed draft send: ${messageText}`
      });
      throw error;
    }
  }

  private async replyToPotentialVoter(contact: Contact): Promise<void> {
    const reply =
      "Hi, thanks for reaching out. Are you an AusIMM Tarkwa Student Chapter member or eligible voter? Please share your name, program, and level so I can make sure I'm speaking to the right person before sharing Kwaku's plan.";
    const settings = getSettings(this.db);

    if (!settings.webEnabled || !this.transports.getStatus().web.ready) {
      await this.storeHumanDraft(contact.id, reply, "Potential voter qualification reply drafted because WhatsApp Web is not ready.", "web", "auto_draft");
      updateContactState(this.db, contact.id, {
        status: "needs_review",
        needsHuman: true,
        outcomeLabel: "needs_human",
        lastError: "Potential voter qualification reply drafted because WhatsApp Web is not ready."
      });
      await this.updateSummary(contact.id);
      return;
    }

    const message = insertMessage(this.db, {
      contactId: contact.id,
      runId: activeRun(this.db)?.id ?? null,
      direction: "outbound",
      channel: "web",
      body: reply,
      messageHash: hashMessage(`potential-voter:${reply}:${nowIso()}`),
      status: "queued",
      origin: "auto_reply"
    });

    try {
      const result = await this.transports.sendMessage(
        {
          to: contact.normalizedPhone,
          body: reply,
          kind: "reply",
          contact
        },
        { cloudEnabled: false, webEnabled: settings.webEnabled }
      );
      this.db
        .prepare("UPDATE messages SET status = 'sent', channel = ?, provider_message_id = ? WHERE id = ?")
        .run(result.channel, result.providerMessageId, message.id);
      updateContactState(this.db, contact.id, {
        status: "replied",
        needsHuman: false,
        outcomeLabel: "replied",
        lastError: ""
      });
      await this.updateSummary(contact.id);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(messageText, message.id);
      updateContactState(this.db, contact.id, {
        status: "needs_review",
        needsHuman: true,
        outcomeLabel: "needs_human",
        lastError: `Failed potential voter qualification reply: ${messageText}`
      });
      await this.updateSummary(contact.id);
    }
  }

  syncWhatsAppHistory(fetchResult: WhatsAppFetchResult, clearFirst = true): WhatsAppSyncResult {
    const cleared = clearFirst ? this.clearNeedsReplyQueue() : { clearedContacts: 0, clearedDrafts: 0 };
    let importedMessages = 0;
    let duplicateMessages = 0;

    for (const message of fetchResult.messages) {
      const contact = this.contactForSyncedMessage(message);
      if (!contact) continue;

      if (message.providerMessageId && getMessageByProviderId(this.db, message.providerMessageId)) {
        duplicateMessages += 1;
        continue;
      }

      insertMessage(this.db, {
        contactId: contact.id,
        runId: null,
        direction: message.fromMe ? "outbound" : "inbound",
        channel: "web",
        body: message.body,
        messageHash: hashMessage(`${message.providerMessageId || message.createdAt}:${message.body}`),
        status: message.fromMe ? "sent" : "received",
        providerMessageId: message.providerMessageId,
        createdAt: message.createdAt
      });
      importedMessages += 1;
    }

    const needsReplyContacts = this.reconcileContactsWithActualWhatsApp();

    return {
      ok: true,
      requestedContacts: fetchResult.requestedContacts,
      scannedChats: fetchResult.scannedChats,
      importedMessages,
      duplicateMessages,
      skippedChats: fetchResult.skippedChats,
      clearedContacts: cleared.clearedContacts,
      clearedDrafts: cleared.clearedDrafts,
      needsReplyContacts,
      errors: fetchResult.errors
    };
  }

  async processPendingReplies(): Promise<PendingReplyResult> {
    const result: PendingReplyResult = { processed: 0, sent: 0, drafted: 0, skipped: 0, failed: 0 };
    const pendingIds = this.getWhatsAppContactStates()
      .filter((state) => state.needsReply)
      .map((state) => state.contactId);

    for (const contactId of pendingIds) {
      await this.processPendingReplyForContact(contactId, result);
    }

    return result;
  }

  async processSelectedReplies(contactIds: number[]): Promise<PendingReplyResult> {
    const result: PendingReplyResult = { processed: 0, sent: 0, drafted: 0, skipped: 0, failed: 0 };
    const pending = new Set(this.getWhatsAppContactStates().filter((state) => state.needsReply).map((state) => state.contactId));

    for (const contactId of contactIds) {
      if (!pending.has(contactId)) {
        result.skipped += 1;
        continue;
      }
      await this.processPendingReplyForContact(contactId, result);
    }

    return result;
  }

  private async processRun(
    runId: number,
    settings: CampaignSettings,
    dryRun: boolean,
    limit?: number,
    contactIds: number[] = []
  ): Promise<void> {
    const defaultLimit = dryRun ? settings.maxPerDay : settings.maxLiveBatch;
    const manuallySelected = contactIds.length > 0;
    const contacts = this.selectEligibleContacts(limit ?? defaultLimit, contactIds);
    const stats = { total: contacts.length, sent: 0, drafted: 0, skipped: 0, failed: 0 };
    updateRunStats(this.db, runId, stats);
    this.updateCampaignProgress({
      total: contacts.length,
      processed: 0,
      sent: 0,
      drafted: 0,
      skipped: 0,
      failed: 0,
      phase: contacts.length ? "personalizing" : "completed",
      running: contacts.length > 0
    });

    for (const contact of contacts) {
      if (this.paused) {
        updateRunStats(this.db, runId, stats, "paused");
        this.updateCampaignProgress({
          running: false,
          phase: "paused",
          finishedAt: nowIso(),
          ...campaignProgressFromStats(stats),
          lastError: "Campaign paused."
        });
        return;
      }

      this.updateCampaignProgress({
        phase: "personalizing",
        currentContactId: contact.id,
        currentContactName: contact.fullName || "Unnamed contact",
        currentPhone: contact.normalizedPhone || contact.selectedPhone
      });

      if (!contact.normalizedPhone || contact.optedOut) {
        stats.skipped += 1;
        updateRunStats(this.db, runId, stats);
        this.updateCampaignProgress(campaignProgressFromStats(stats));
        continue;
      }

      const alreadySent = this.hasPriorLiveCampaignSend(contact.id);
      if (alreadySent && !dryRun && !manuallySelected) {
        stats.skipped += 1;
        updateRunStats(this.db, runId, stats);
        this.updateCampaignProgress(campaignProgressFromStats(stats));
        continue;
      }

      const rendered = renderTemplate(settings.firstMessageTemplate, contact, settings);
      const personalized = await this.personalizeInitialMessage(contact, settings, rendered);
      if (personalized.error) {
        this.recordCampaignError(contact, "LLM personalization", personalized.error);
      }
      const body = personalized.body;
      const hash = hashMessage(body);
      let queued: Message | null = null;

      try {
        queued = insertMessage(this.db, {
          contactId: contact.id,
          runId,
          direction: "outbound",
          channel: dryRun ? "dry_run" : "web",
          body,
          messageHash: hash,
          status: dryRun ? "drafted" : "queued",
          origin: dryRun ? "dry_run" : "campaign"
        });

        if (dryRun) {
          stats.drafted += 1;
          updateRunStats(this.db, runId, stats);
          this.updateCampaignProgress(campaignProgressFromStats(stats));
          continue;
        }

        this.updateCampaignProgress({
          phase: "sending",
          currentContactId: contact.id,
          currentContactName: contact.fullName || "Unnamed contact",
          currentPhone: contact.normalizedPhone
        });
        const result = await this.transports.sendMessage(
          {
            to: contact.normalizedPhone,
            body,
            kind: "initial",
            contact
          },
          { cloudEnabled: settings.cloudEnabled, webEnabled: settings.webEnabled }
        );

        this.db
          .prepare("UPDATE messages SET status = 'sent', channel = ?, provider_message_id = ? WHERE id = ?")
          .run(result.channel, result.providerMessageId, queued.id);
        updateContactState(this.db, contact.id, { status: "contacted", outcomeLabel: "contacted", lastError: "" });
        stats.sent += 1;
      } catch (error) {
        const message = errorMessage(error);
        if (queued) {
          this.db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(message, queued.id);
        }
        updateContactState(this.db, contact.id, { status: "failed", outcomeLabel: "failed_send", lastError: message });
        this.recordCampaignError(contact, queued ? "WhatsApp send" : "message queue", message);
        stats.failed += 1;
        const webStatus = this.transports.getStatus().web;
        if (!dryRun && (!webStatus.ready || webStatus.needsReconnect || webStatus.needsSessionReset)) {
          const reason = webStatus.needsSessionReset
            ? "WhatsApp Web session needs reset. Live batch paused before sending remaining contacts."
            : "WhatsApp Web disconnected. Live batch paused before sending remaining contacts.";
          updateRunStats(this.db, runId, stats, "paused");
          this.updateCampaignProgress({
            ...campaignProgressFromStats(stats),
            running: false,
            phase: "paused",
            finishedAt: nowIso(),
            lastError: reason
          });
          return;
        }
      }

      updateRunStats(this.db, runId, stats);
      this.updateCampaignProgress(campaignProgressFromStats(stats));
      if (!dryRun) {
        const delaySeconds = randomInt(settings.minDelaySeconds, settings.maxDelaySeconds);
        this.updateCampaignProgress({
          phase: "waiting_delay",
          currentContactId: contact.id,
          currentContactName: contact.fullName || "Unnamed contact",
          currentPhone: contact.normalizedPhone
        });
        await sleep(delaySeconds * 1000);
      }
    }

    updateRunStats(this.db, runId, stats, "completed");
    this.updateCampaignProgress({
      ...campaignProgressFromStats(stats),
      running: false,
      phase: "completed",
      finishedAt: nowIso(),
      currentContactId: null,
      currentContactName: "",
      currentPhone: ""
    });
  }

  private selectEligibleContacts(limit: number, contactIds: number[] = []): Contact[] {
    const params: Array<number | string> = [];
    let idClause = "";
    if (contactIds.length > 0) {
      idClause = `AND id IN (${contactIds.map(() => "?").join(",")})`;
      params.push(...contactIds);
    }
    params.push(limit);

    const rows = this.db
      .prepare(
        `SELECT * FROM contacts
         WHERE opted_out = 0
           AND normalized_phone != ''
           ${contactIds.length > 0 ? "" : "AND status IN ('imported', 'failed', 'needs_review')"}
           ${idClause}
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(...params) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id),
      fullName: String(row.full_name ?? ""),
      whatsappNumber: String(row.whatsapp_number ?? ""),
      otherNumber: String(row.other_number ?? ""),
      activeEmail: String(row.active_email ?? ""),
      programOfStudy: String(row.program_of_study ?? ""),
      level: String(row.level ?? ""),
      institution: String(row.institution ?? ""),
      selectedPhone: String(row.selected_phone ?? ""),
      normalizedPhone: String(row.normalized_phone ?? ""),
      phoneSource: row.phone_source as Contact["phoneSource"],
      importNotes: String(row.import_notes ?? ""),
      status: row.status as Contact["status"],
      outcomeLabel: row.outcome_label as FunnelLabel,
      optedOut: Boolean(row.opted_out),
      needsHuman: Boolean(row.needs_human),
      lastError: String(row.last_error ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? "")
    }));
  }

  private hasPriorLiveCampaignSend(contactId: number): boolean {
    const row = this.db
      .prepare(
        `SELECT messages.id
         FROM messages
         JOIN campaign_runs ON campaign_runs.id = messages.run_id
         WHERE messages.contact_id = ?
           AND messages.direction = 'outbound'
           AND messages.channel IN ('web', 'cloud')
           AND messages.status = 'sent'
           AND campaign_runs.dry_run = 0
         LIMIT 1`
      )
      .get(contactId);
    return Boolean(row);
  }

  private async personalizeInitialMessage(
    contact: Contact,
    settings: CampaignSettings,
    rendered: string
  ): Promise<{ body: string; error: string }> {
    try {
      const prompt = buildInitialMessagePrompt(contact, settings, rendered);
      const body = await this.llm.complete(
        [
          {
            role: "system",
            content: "You write concise WhatsApp campaign messages. Return only the final message."
          },
          { role: "user", content: prompt }
        ],
        { maxTokens: 260, temperature: 0.35 }
      );
      return { body, error: "" };
    } catch (error) {
      return {
        body: rendered,
        error: `Could not personalize with the LLM, so the saved template was used. ${errorMessage(error)}`
      };
    }
  }

  private updateCampaignProgress(patch: Partial<CampaignProgress>): void {
    this.campaignProgress = {
      ...this.campaignProgress,
      ...patch,
      errors: patch.errors ? [...patch.errors] : this.campaignProgress.errors
    };
  }

  private recordCampaignError(contact: Contact, stage: string, error: string): void {
    const entry = {
      contactId: contact.id,
      contactName: contact.fullName || "Unnamed contact",
      phone: contact.normalizedPhone || contact.selectedPhone,
      stage,
      error,
      at: nowIso()
    };
    this.updateCampaignProgress({
      lastError: `${stage}: ${error}`,
      errors: [...this.campaignProgress.errors, entry].slice(-20)
    });
  }

  private campaignProgressToStats(): CampaignRun["stats"] {
    return {
      total: this.campaignProgress.total,
      sent: this.campaignProgress.sent,
      drafted: this.campaignProgress.drafted,
      skipped: this.campaignProgress.skipped,
      failed: this.campaignProgress.failed
    };
  }

  private async generateReplyDecision(contact: Contact, incomingText: string): Promise<ReplyDecision> {
    const settings = getSettings(this.db);
    const messages = listMessages(this.db, contact.id);
    const summary = getConversationSummary(this.db, contact.id);
    const resourceQuery = [
      incomingText,
      contact.fullName,
      contact.programOfStudy,
      contact.level,
      contact.institution,
      summary
    ].join("\n");
    const snippets = findRelevantResourceSnippets(this.db, resourceQuery, 4);
    const prompt = buildReplyDecisionPrompt(contact, settings, summary, messages, incomingText, snippets);
    const raw = await this.llm.complete(
      [
        {
          role: "system",
          content: "You are a careful WhatsApp campaign assistant. Return only valid JSON for the requested decision."
        },
        { role: "user", content: prompt }
      ],
      { maxTokens: 600, temperature: 0.2 }
    );
    return parseReplyDecision(raw, classifyOutcome(incomingText));
  }

  private autoReplyRateLimit(settings: CampaignSettings): { ok: boolean; reason: string } {
    const messages = listAllMessages(this.db);
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const repliesThisHour = countSentSince(messages, hourStart, "auto_reply");
    const repliesToday = countSentSince(messages, todayStart, "auto_reply");
    if (repliesThisHour >= settings.replyMaxPerHour) {
      return { ok: false, reason: `Auto-reply hourly cap reached (${settings.replyMaxPerHour}).` };
    }
    if (repliesToday >= settings.replyMaxPerDay) {
      return { ok: false, reason: `Auto-reply daily cap reached (${settings.replyMaxPerDay}).` };
    }
    return { ok: true, reason: "" };
  }

  private async processPendingReplyForContact(contactId: number, result: PendingReplyResult): Promise<void> {
    const latestInbound = this.latestInboundWhatsAppMessage(contactId);
    if (!latestInbound) {
      result.skipped += 1;
      return;
    }

    if (this.hasReviewMessageAfter(contactId, latestInbound.createdAt)) {
      result.skipped += 1;
      return;
    }

    result.processed += 1;
    try {
      await this.autoReply(contactId, latestInbound.body, "web");
      const latestOutbound = this.latestOutboundAfter(contactId, latestInbound.createdAt);
      if (latestOutbound?.status === "sent") result.sent += 1;
      else if (latestOutbound?.status === "drafted") result.drafted += 1;
      else if (latestOutbound?.status === "failed") result.failed += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }

  private async updateSummary(contactId: number): Promise<void> {
    const messages = listMessages(this.db, contactId);
    const existingSummary = getConversationSummary(this.db, contactId);
    try {
      const summary = await this.llm.complete(
        [
          {
            role: "system",
            content: "You summarize campaign chats for a local dashboard."
          },
          { role: "user", content: buildSummaryPrompt(existingSummary, messages) }
        ],
        { maxTokens: 220, temperature: 0.2 }
      );
      upsertConversationSummary(this.db, contactId, summary);
    } catch {
      upsertConversationSummary(this.db, contactId, existingSummary || "Summary unavailable; review the conversation manually.");
    }
  }

  private async storeHumanDraft(
    contactId: number,
    reply: string,
    reason: string,
    channel: MessageChannel = "web",
    origin: Message["origin"] = "auto_draft"
  ): Promise<Message> {
    const body = reply.trim() || "I want to give you the right answer, so Kwaku will follow up on this directly.";
    return insertMessage(this.db, {
      contactId,
      runId: activeRun(this.db)?.id ?? null,
      direction: "outbound",
      channel,
      body,
      messageHash: hashMessage(`${reason}:${body}:${nowIso()}`),
      status: "drafted",
      error: reason,
      origin
    });
  }

  private clearNeedsReplyQueue(): { clearedContacts: number; clearedDrafts: number } {
    const now = nowIso();
    const contacts = this.db
      .prepare(
        `UPDATE contacts
         SET needs_human = 0,
             last_error = '',
             status = CASE WHEN status = 'needs_review' THEN 'replied' ELSE status END,
             outcome_label = CASE WHEN outcome_label = 'needs_human' THEN 'replied' ELSE outcome_label END,
             updated_at = ?
         WHERE needs_human = 1
            OR last_error != ''
            OR status = 'needs_review'
            OR outcome_label = 'needs_human'`
      )
      .run(now);
    const drafts = this.db
      .prepare(
        `UPDATE messages
         SET status = 'skipped',
             error = 'Cleared by WhatsApp sync.'
         WHERE direction = 'outbound'
           AND channel = 'web'
           AND status IN ('drafted', 'failed')`
      )
      .run();
    return { clearedContacts: contacts.changes, clearedDrafts: drafts.changes };
  }

  private reconcileContactsWithActualWhatsApp(): number {
    let needsReplyContacts = 0;
    for (const contact of listContacts(this.db)) {
      if (this.reconcileContactWithLatestWhatsAppMessage(contact.id)) needsReplyContacts += 1;
    }
    return needsReplyContacts;
  }

  private contactForSyncedMessage(message: SyncedWhatsAppMessage): Contact | null {
    const normalized = normalizeGhanaPhone(message.phone);
    let contact = getContactByPhone(this.db, normalized);
    if (contact) return contact;

    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO contacts
          (full_name, selected_phone, normalized_phone, phone_source, import_notes, status, outcome_label,
           needs_human, created_at, updated_at)
         VALUES
          ('Unknown contact', ?, ?, 'whatsapp', 'Created from WhatsApp Web history sync.', 'replied', 'replied',
           0, ?, ?)`
      )
      .run(message.phone, normalized, now, now);
    contact = getContact(this.db, Number(result.lastInsertRowid));
    return contact;
  }

  private reconcileContactWithLatestWhatsAppMessage(contactId: number): boolean {
    const contact = getContact(this.db, contactId);
    if (!contact) return false;
    const state = this.whatsAppStateForContact(contact);
    if (!state.hasActualChat) {
      updateContactState(this.db, contactId, {
        status: "imported",
        optedOut: false,
        needsHuman: false,
        outcomeLabel: "not_contacted",
        lastError: ""
      });
      return false;
    }

    const latest = this.latestActualWhatsAppMessage(contactId);
    if (!latest) return false;

    if (latest.direction === "outbound") {
      const replied = state.label === "replied";
      updateContactState(this.db, contactId, {
        status: replied ? "replied" : "contacted",
        optedOut: false,
        needsHuman: false,
        outcomeLabel: replied ? "replied" : "contacted",
        lastError: ""
      });
      return false;
    }

    const optedOut = isOptOut(latest.body);
    const label = classifyOutcome(latest.body);
    updateContactState(this.db, contactId, {
      status: optedOut ? "replied" : "needs_review",
      optedOut,
      needsHuman: !optedOut,
      outcomeLabel: optedOut ? "opted_out" : label === "needs_human" ? "needs_human" : mergeOutcome(contact.outcomeLabel, label),
      lastError: optedOut ? "" : "Latest WhatsApp message needs a reply."
    });
    return !optedOut;
  }

  private whatsAppStateForContact(contact: Contact): WhatsAppContactState {
    const actualMessages = this.actualWhatsAppMessages(contact.id);
    const latest = actualMessages.at(-1);
    if (!latest) {
      return {
        contactId: contact.id,
        source: "whatsapp_web",
        label: "no_chat",
        hasActualChat: false,
        needsReply: false,
        lastDirection: null,
        lastMessageBody: "",
        lastMessageAt: "",
        lastProviderMessageId: "",
        reason: "No actual WhatsApp Web chat message has been synced for this contact."
      };
    }

    if (latest.direction === "outbound") {
      const hasInbound = actualMessages.some((message) => message.direction === "inbound");
      return {
        contactId: contact.id,
        source: "whatsapp_web",
        label: hasInbound ? "replied" : "waiting_for_reply",
        hasActualChat: true,
        needsReply: false,
        lastDirection: "outbound",
        lastMessageBody: latest.body,
        lastMessageAt: latest.createdAt,
        lastProviderMessageId: latest.providerMessageId,
        reason: hasInbound ? "Latest actual WhatsApp message is your reply." : "Latest actual WhatsApp message is outbound."
      };
    }

    if (isOptOut(latest.body)) {
      return {
        contactId: contact.id,
        source: "whatsapp_web",
        label: "opted_out",
        hasActualChat: true,
        needsReply: false,
        lastDirection: "inbound",
        lastMessageBody: latest.body,
        lastMessageAt: latest.createdAt,
        lastProviderMessageId: latest.providerMessageId,
        reason: "Latest actual WhatsApp message is an opt-out."
      };
    }

    return {
      contactId: contact.id,
      source: "whatsapp_web",
      label: "needs_reply",
      hasActualChat: true,
      needsReply: true,
      lastDirection: "inbound",
      lastMessageBody: latest.body,
      lastMessageAt: latest.createdAt,
      lastProviderMessageId: latest.providerMessageId,
      reason: "Latest actual WhatsApp message is inbound."
    };
  }

  private latestActualWhatsAppMessage(contactId: number): Message | null {
    return this.actualWhatsAppMessages(contactId).at(-1) || null;
  }

  private latestInboundWhatsAppMessage(contactId: number): Message | null {
    return this.actualWhatsAppMessages(contactId)
      .filter((message) => message.direction === "inbound")
      .at(-1) || null;
  }

  private latestOutboundAfter(contactId: number, createdAt: string): Message | null {
    return listMessages(this.db, contactId)
      .filter(
        (message) =>
          message.direction === "outbound" &&
          message.createdAt >= createdAt &&
          ["sent", "drafted", "failed"].includes(message.status)
      )
      .at(-1) || null;
  }

  private hasReviewMessageAfter(contactId: number, createdAt: string): boolean {
    return listMessages(this.db, contactId).some(
      (message) =>
        message.direction === "outbound" &&
        message.createdAt >= createdAt &&
        ((message.status === "drafted" && ["auto_draft", "manual_draft"].includes(message.origin)) ||
          (message.status === "failed" && message.origin === "auto_reply"))
    );
  }

  private actualWhatsAppMessages(contactId: number): Message[] {
    return listMessages(this.db, contactId).filter(isActualWhatsAppMessage);
  }
}

function isActualWhatsAppMessage(message: Message): boolean {
  return (
    message.channel === "web" &&
    Boolean(message.providerMessageId) &&
    !message.providerMessageId.startsWith("simulate-") &&
    !isIgnoredWhatsAppBody(message.body) &&
    ((message.direction === "inbound" && message.status === "received") ||
      (message.direction === "outbound" && message.status === "sent"))
  );
}

function idleCampaignProgress(): CampaignProgress {
  return {
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
  };
}

function campaignProgressFromStats(stats: CampaignRun["stats"]): Pick<
  CampaignProgress,
  "total" | "processed" | "sent" | "drafted" | "skipped" | "failed"
> {
  return {
    total: stats.total,
    processed: stats.sent + stats.drafted + stats.skipped + stats.failed,
    sent: stats.sent,
    drafted: stats.drafted,
    skipped: stats.skipped,
    failed: stats.failed
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isIgnoredWhatsAppBody(body: string): boolean {
  return /^\[(e2e_notification|notification_template|ciphertext|revoked|protocol|gp2|notification) WhatsApp message\]$/i.test(
    body.trim()
  );
}

const allowedReplyLabels = new Set<FunnelLabel>(["replied", "supportive", "undecided", "opposed", "opted_out", "needs_human"]);

function parseReplyDecision(raw: string, fallbackLabel: FunnelLabel): ReplyDecision {
  const fallback = clampReply(raw) || "Thanks for getting back to me. Kwaku will follow up with you properly on this.";
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || "";
  if (!jsonText) {
    return {
      reply: fallback,
      needsHuman: fallbackLabel === "needs_human",
      reason: fallbackLabel === "needs_human" ? "Model returned plain text for a message that may need review." : "",
      outcomeLabel: normalizeReplyLabel(fallbackLabel),
      safeToAutoSend: fallbackLabel !== "needs_human"
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<ReplyDecision>;
    const outcomeLabel = normalizeReplyLabel(parsed.outcomeLabel || fallbackLabel);
    return {
      reply: clampReply(String(parsed.reply || fallback)),
      needsHuman: Boolean(parsed.needsHuman),
      reason: String(parsed.reason || ""),
      outcomeLabel,
      safeToAutoSend: parsed.safeToAutoSend === undefined ? !parsed.needsHuman : Boolean(parsed.safeToAutoSend)
    };
  } catch {
    return {
      reply: fallback,
      needsHuman: fallbackLabel === "needs_human",
      reason: "Model returned invalid JSON.",
      outcomeLabel: normalizeReplyLabel(fallbackLabel),
      safeToAutoSend: false
    };
  }
}

function normalizeReplyLabel(label: FunnelLabel): FunnelLabel {
  return allowedReplyLabels.has(label) ? label : "replied";
}

function automatedOutcome(current: FunnelLabel, incoming: FunnelLabel): FunnelLabel {
  if (current === "needs_human") return normalizeReplyLabel(incoming);
  return mergeOutcome(current, incoming);
}

function clampReply(reply: string): string {
  return reply
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim()
    .slice(0, 1200);
}

function unsupportedInboundReason(body: string): string {
  return body.trim() ? "" : "Unsupported inbound WhatsApp content. Human review required.";
}

function percentage(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function countSentSince(messages: Message[], since: Date, origin?: Message["origin"]): number {
  return messages.filter((message) => {
    if (message.direction !== "outbound" || message.status !== "sent") return false;
    if (origin && message.origin !== origin) return false;
    const createdAt = Date.parse(message.createdAt);
    return Number.isFinite(createdAt) && createdAt >= since.getTime();
  }).length;
}

function averageReplyMinutes(messages: Message[]): number | null {
  const byContact = new Map<number, Message[]>();
  for (const message of messages.filter(isActualWhatsAppMessage)) {
    byContact.set(message.contactId, [...(byContact.get(message.contactId) || []), message]);
  }

  const durations: number[] = [];
  for (const contactMessages of byContact.values()) {
    const ordered = contactMessages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (let index = 0; index < ordered.length; index += 1) {
      const message = ordered[index];
      if (message.direction !== "inbound") continue;
      const reply = ordered.slice(index + 1).find((candidate) => candidate.direction === "outbound");
      if (!reply) continue;
      const inboundTime = Date.parse(message.createdAt);
      const replyTime = Date.parse(reply.createdAt);
      if (Number.isFinite(inboundTime) && Number.isFinite(replyTime) && replyTime >= inboundTime) {
        durations.push((replyTime - inboundTime) / 60000);
      }
    }
  }

  if (!durations.length) return null;
  const average = durations.reduce((total, value) => total + value, 0) / durations.length;
  return Math.round(average * 10) / 10;
}

function humanFollowUpReason(text: string): string {
  const normalized = text.toLowerCase();
  const asksForVotingLink = /\b(voting\s*)?(link|form)\b/.test(normalized);
  const asksHowToVote = /\bhow\s+(do|can|should)\s+i\s+vote\b/.test(normalized);
  const asksVotingLogistics = /\b(when|where|deadline|close|closes|closing)\b.*\b(vote|voting|election)\b/.test(normalized);
  if (asksForVotingLink || asksHowToVote || asksVotingLogistics) {
    return "Voting logistics or voting link requested; human follow-up required.";
  }
  return "";
}

function sanitizeContactIds(contactIds: unknown): number[] {
  if (!Array.isArray(contactIds)) return [];
  const seen = new Set<number>();
  for (const id of contactIds) {
    const numeric = Number(id);
    if (Number.isInteger(numeric) && numeric > 0) seen.add(numeric);
  }
  return [...seen];
}
