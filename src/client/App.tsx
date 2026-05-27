import {
  AlertCircle,
  BookOpen,
  Bot,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  MessageSquareText,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type {
  CampaignSettings,
  Contact,
  ContactConversation,
  DashboardData,
  ImportSummary,
  KnowledgeResource,
  Message,
  WhatsAppContactState
} from "../shared/types";

const emptyDashboard: DashboardData = {
  settings: {
    candidateName: "Kwaku Bonsu Wiredu",
    campaignFacts: "",
    agentInstructions: "You are Kwaku's Technical Assistant to the Founder — representing him on WhatsApp with professionalism, integrity, and genuine care for each voter relationship. Your mission: Ensure Kwaku is represented well, build voter trust, and follow up until the conversation naturally concludes. Four pillars guide you: (1) TIME: Be efficient and respect voters' time with thoughtful responses. (2) COMMUNICATION: Every message reflects Kwaku's values — be clear, honest, warm. (3) INFORMATION: Use voter history to personalize responses and show you remember them. (4) TRUST: Be confidential about voter conversations, honest about what you know/don't know, and genuine in building relationships. Principles: Always respond warmly to voters. Reference prior messages to show continuity. Ask follow-up questions to understand their concerns. If you don't have complete info, say so honestly and offer to follow up — never go silent. Share relevant initiatives and how Kwaku's platform addresses their interests. Keep conversations flowing naturally. Only consider human escalation for truly sensitive matters (legal issues, safety concerns, requests for personal contact info). For most situations, you have the context and wisdom to respond authentically. Treat each voter as an individual relationship, not a transaction. 'I will not treat this as a title. I will treat it as a responsibility.'",
    firstMessageTemplate: "",
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
  contacts: [],
  messages: [],
  activeRun: null,
  transports: {
    cloud: { configured: false, ready: false, lastError: "", templateConfigured: false },
    web: {
      enabled: true,
      initialized: false,
      starting: false,
      ready: false,
      state: "idle",
      qrDataUrl: "",
      lastError: "",
      lastEventAt: "",
      lastDisconnectReason: "",
      needsReconnect: false,
      needsSessionReset: false,
      reconnectAttempts: 0,
      sessionPath: "",
      chromePath: ""
    }
  },
  whatsappStates: [],
  runtime: {
    ok: true,
    time: "",
    environment: "development",
    devSimulationEnabled: false,
    llm: {
      groqConfigured: false,
      groqKeyCount: 0,
      groqModel: "",
      ollamaConfigured: false,
      ollamaBaseUrl: "",
      ollamaModel: ""
    },
    transports: {
      cloud: { configured: false, ready: false, lastError: "", templateConfigured: false },
      web: {
        enabled: true,
        initialized: false,
        starting: false,
        ready: false,
        state: "idle",
        qrDataUrl: "",
        lastError: "",
        lastEventAt: "",
        lastDisconnectReason: "",
        needsReconnect: false,
        needsSessionReset: false,
        reconnectAttempts: 0,
        sessionPath: "",
        chromePath: ""
      }
    }
  },
  metrics: {
    contactsTotal: 0,
    contactsWithPhone: 0,
    noChat: 0,
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
    dailyCap: 0,
    hourlyCap: 0,
    replyDailyCap: 0,
    replyHourlyCap: 0,
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
    nextRunAt: "",
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

export function App() {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [settingsDraft, setSettingsDraft] = useState<CampaignSettings>(emptyDashboard.settings);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [conversation, setConversation] = useState<ContactConversation | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
  const [selectedNeedsReplyIds, setSelectedNeedsReplyIds] = useState<number[]>([]);
  const [batchLimit, setBatchLimit] = useState(50);
  const [settingsDirty, setSettingsDirtyState] = useState(false);
  const settingsDirtyRef = useRef(false);

  function setSettingsDirty(value: boolean) {
    settingsDirtyRef.current = value;
    setSettingsDirtyState(value);
  }

  async function refresh() {
    const dashboard = await api.dashboard();
    setData(dashboard);
    if (!settingsDirtyRef.current) {
      setSettingsDraft(dashboard.settings);
      setBatchLimit((current) => Math.min(Math.max(1, current), Math.max(1, dashboard.settings.maxLiveBatch)));
    }
    if (!selectedContactId && dashboard.contacts[0]) setSelectedContactId(dashboard.contacts[0].id);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 3500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!data.syncProgress.running) return;
    const timer = window.setInterval(() => {
      void api
        .syncProgress()
        .then((progress) => {
          setData((current) => ({ ...current, syncProgress: progress }));
          if (!progress.running) void refresh().catch(() => undefined);
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [data.syncProgress.running]);

  useEffect(() => {
    if (!data.campaignProgress.running) return;
    const timer = window.setInterval(() => {
      void api
        .campaignProgress()
        .then((progress) => {
          setData((current) => ({ ...current, campaignProgress: progress }));
          if (!progress.running) void refresh().catch(() => undefined);
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [data.campaignProgress.running]);

  useEffect(() => {
    if (!selectedContactId) return;
    void api.conversation(selectedContactId).then(setConversation).catch(() => setConversation(null));
  }, [selectedContactId, data.messages.length]);

  useEffect(() => {
    const available = new Set(data.contacts.map((contact) => contact.id));
    setSelectedContactIds((ids) => ids.filter((id) => available.has(id)));
  }, [data.contacts]);

  const whatsappStateByContact = useMemo(
    () => new Map(data.whatsappStates.map((state) => [state.contactId, state])),
    [data.whatsappStates]
  );

  const needsReplyItems = useMemo(
    () => buildNeedsReplyItems(data.contacts, data.messages, data.whatsappStates),
    [data.contacts, data.messages, data.whatsappStates]
  );

  async function runAction<T>(action: () => Promise<T>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File | null) {
    if (!file) return;
    await runAction(async () => {
      const result: ImportSummary = await api.importContacts(file);
      setNotice(`Imported ${result.created} new, updated ${result.updated}, review ${result.needsReview}.`);
    }, "Import complete.");
  }

  const selectedSet = useMemo(() => new Set(selectedContactIds), [selectedContactIds]);
  const selectedContacts = useMemo(
    () => data.contacts.filter((contact) => selectedSet.has(contact.id)),
    [data.contacts, selectedSet]
  );
  const maxLiveBatch = Math.max(1, settingsDraft.maxLiveBatch || 50);

  function toggleContact(id: number) {
    setSelectedContactIds((ids) => (ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id]));
  }

  function selectBatch() {
    const batch = data.contacts
      .filter((contact) => contact.normalizedPhone && !contact.optedOut)
      .slice(0, Math.max(1, Math.min(maxLiveBatch, batchLimit)))
      .map((contact) => contact.id);
    setSelectedContactIds(batch);
  }

  function updateSettingsDraft(settings: CampaignSettings) {
    setSettingsDirty(true);
    setSettingsDraft(settings);
  }

  async function saveCampaignSettings() {
    setBusy(true);
    setNotice("");
    try {
      const saved = await api.saveSettings(settingsDraft);
      setSettingsDraft(saved);
      setSettingsDirty(false);
      setData((current) => ({ ...current, settings: saved }));
      setBatchLimit((current) => Math.min(Math.max(1, current), Math.max(1, saved.maxLiveBatch)));
      setNotice("Campaign texts and sending limits saved.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function startDryRun() {
    await runAction(
      () =>
        api.startCampaign({
          dryRun: true,
          contactIds: selectedContactIds.length ? selectedContactIds : undefined,
          limit: selectedContactIds.length || undefined
        }),
      selectedContactIds.length ? "Dry run started for selected contacts." : "Dry run started for all eligible contacts."
    );
  }

  async function startLiveBatch() {
    setBusy(true);
    setNotice("");
    let latest = data;
    try {
      latest = await api.dashboard();
      setData(latest);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setBusy(false);
      return;
    }
    setBusy(false);

    const latestMaxLiveBatch = Math.max(1, latest.settings.maxLiveBatch || maxLiveBatch);
    if (selectedContactIds.length === 0) {
      setNotice(`Select up to ${latestMaxLiveBatch} contacts before starting a live WhatsApp Web batch.`);
      return;
    }
    if (selectedContactIds.length > latestMaxLiveBatch) {
      setNotice(`Live WhatsApp Web batches are limited to ${latestMaxLiveBatch} contacts. Reduce the selection first.`);
      return;
    }
    if (!latest.transports.web.ready) {
      setNotice("WhatsApp Web is not connected. Scan the QR code before live sending.");
      return;
    }
    const confirmed = window.confirm(`Send live WhatsApp messages to ${selectedContactIds.length} selected contact(s)?`);
    if (!confirmed) return;
    await runAction(
      () => api.startCampaign({ dryRun: false, contactIds: selectedContactIds, limit: selectedContactIds.length }),
      "Live WhatsApp Web batch started."
    );
  }

  async function connectWeb() {
    setBusy(true);
    setNotice("");
    try {
      const status = await api.initializeWeb();
      if (status.ready) {
        setNotice("WhatsApp Web is connected and ready.");
      } else if (status.qrDataUrl) {
        setNotice("WhatsApp QR code is ready. Scan it with WhatsApp on your phone.");
      } else if (status.starting) {
        setNotice("WhatsApp Web is still starting. Keep this page open; the QR code will appear shortly.");
      } else if (status.lastError) {
        setNotice(status.lastError);
      } else {
        setNotice("WhatsApp Web initialization started. Keep this page open for the QR code.");
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reconnectWeb() {
    setBusy(true);
    setNotice("");
    try {
      const status = await api.reconnectWeb();
      if (status.ready) setNotice("WhatsApp Web reconnected.");
      else if (status.qrDataUrl) setNotice("WhatsApp returned a QR code. Scan it to reconnect.");
      else if (status.needsSessionReset) setNotice("WhatsApp requires a session reset before reconnecting.");
      else setNotice(status.lastError || "Reconnect started. Watch the WhatsApp Web status panel.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetWebSession() {
    const confirmed = window.confirm("Reset the local WhatsApp Web session? You will need to scan a fresh QR code.");
    if (!confirmed) return;
    await runAction(() => api.disconnectWeb({ clearSession: true }), "WhatsApp Web session reset. Click Connect Web for a fresh QR code.");
  }

  async function simulateWebState(event: "disconnected" | "auth_failure" | "ready" | "qr") {
    await runAction(() => api.simulateWebState(event), "WhatsApp Web simulation applied.");
  }

  async function sendDraft(contactId: number, messageId?: number) {
    await runAction(async () => {
      const result = await api.sendDraft(contactId, messageId);
      setConversation(result.conversation);
    }, "Draft reply sent.");
  }

  async function draftReply(contactId: number) {
    await runAction(async () => {
      const result = await api.draftReply(contactId);
      setConversation(result.conversation);
    }, "Agent draft prepared for review.");
  }

  async function processSafeReplies() {
    await runAction(async () => {
      const response = await api.processPendingReplies();
      setNotice(
        `Processed ${response.result.processed}, sent ${response.result.sent}, drafted ${response.result.drafted}, skipped ${response.result.skipped}, failed ${response.result.failed}.`
      );
    }, "Safe reply processing complete.");
  }

  async function simulateInbound(input: { contactId?: number; phone?: string; body: string }) {
    await runAction(async () => {
      const result = await api.simulateInbound(input);
      if (result.contact) setSelectedContactId(result.contact.id);
      if (result.conversation) setConversation(result.conversation);
    }, "Inbound reply simulated.");
  }

  async function syncWebChats() {
    setBusy(true);
    setNotice("");
    try {
      const progress = await api.syncWebChats({ messagesPerChat: 20, clearFirst: true, lookupMissingChats: false });
      setData((current) => ({ ...current, syncProgress: progress }));
      setNotice("WhatsApp chat sync started. Progress will update below.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runAutoSyncNow() {
    await runAction(async () => {
      const response = await api.runAutoSync();
      setNotice(
        `Auto-sync complete: ${response.result.importedMessages} imported, ${response.result.needsReplyContacts} needs reply, ${response.result.pendingRepliesProcessed?.sent || 0} auto-sent.`
      );
    }, "Auto-sync complete.");
  }

  async function uploadResource(file: File | null) {
    if (!file) return;
    await runAction(() => api.uploadResource(file), "Resource uploaded and indexed.");
  }

  async function addTextResource(input: { title: string; text: string }) {
    await runAction(() => api.addTextResource({ ...input, active: true }), "Resource saved and indexed.");
  }

  async function toggleResource(resource: KnowledgeResource) {
    await runAction(() => api.updateResource(resource.id, { active: !resource.active }), "Resource updated.");
  }

  async function deleteResource(resource: KnowledgeResource) {
    const confirmed = window.confirm(`Remove "${resource.title}" from the agent's resource library?`);
    if (!confirmed) return;
    await runAction(() => api.deleteResource(resource.id), "Resource removed.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">WhatsApp campaign outreach</p>
          <h1>{data.settings.candidateName}</h1>
        </div>
        <div className="topbar-actions">
          <StatusPill ready={data.transports.cloud.ready} label={data.transports.cloud.templateConfigured ? "Cloud template" : "Cloud"} />
          <StatusPill ready={data.transports.web.ready} label="WhatsApp Web" />
          <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh dashboard" title="Refresh dashboard">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {notice ? <div className="notice">{notice}</div> : null}

      <MetricsPanel data={data} />

      <section className="control-band">
        <div className="control-group">
          <label className="upload-button">
            <FileSpreadsheet size={18} />
            <span>Import Excel</span>
            <input type="file" accept=".xlsx" onChange={(event) => void importFile(event.target.files?.[0] || null)} />
          </label>
          <a className="button secondary" href="/api/export.csv">
            <Download size={18} />
            Export
          </a>
        </div>
        <div className="control-group">
          <button
            className="button secondary"
            disabled={busy || data.transports.web.starting}
            onClick={() => void connectWeb()}
          >
            <QrCode size={18} />
            {data.transports.web.ready ? "Web Ready" : data.transports.web.starting ? "Connecting" : data.transports.web.qrDataUrl ? "QR Ready" : "Connect Web"}
          </button>
          <button
            className="button secondary"
            disabled={busy || data.transports.web.starting || data.transports.web.needsSessionReset}
            onClick={() => void reconnectWeb()}
          >
            <RefreshCw size={18} />
            Reconnect Web
          </button>
          <button
            className="button muted"
            disabled={busy || data.transports.web.starting}
            onClick={() => void resetWebSession()}
          >
            <WifiOff size={18} />
            Reset Web
          </button>
          <button
            className="button secondary"
            disabled={busy || data.syncProgress.running || !data.transports.web.ready}
            onClick={() => void syncWebChats()}
          >
            <RefreshCw size={18} />
            {data.syncProgress.running ? "Syncing" : "Sync Chats"}
          </button>
          <button
            className="button"
            disabled={busy || data.campaignProgress.running}
            onClick={() => void startDryRun()}
          >
            <ShieldCheck size={18} />
            Dry Run
          </button>
          <button
            className="button danger"
            disabled={busy || data.campaignProgress.running}
            onClick={() => void startLiveBatch()}
          >
            <Play size={18} />
            Live Batch
          </button>
          <button className="icon-button" disabled={busy} onClick={() => void runAction(() => api.pauseCampaign(), "Campaign paused.")} title="Pause campaign">
            <Pause size={18} />
          </button>
        </div>
      </section>

      <CampaignProgressPanel progress={data.campaignProgress} />
      <SyncProgressPanel progress={data.syncProgress} />

      <section className="workspace-grid">
        <SettingsPanel
          draft={settingsDraft}
          dirty={settingsDirty}
          setDraft={updateSettingsDraft}
          onSave={saveCampaignSettings}
        />
        <TransportPanel
          data={data}
          contacts={data.contacts}
          onTestSend={(input) => runAction(() => api.testWebSend(input), "WhatsApp Web test message sent.")}
          onSimulateInbound={simulateInbound}
          onRunAutoSync={runAutoSyncNow}
          onReconnectWeb={reconnectWeb}
          onResetWeb={resetWebSession}
          onSimulateWebState={simulateWebState}
        />
      </section>

      <ResourcePanel
        resources={data.resources}
        onUpload={uploadResource}
        onAddText={addTextResource}
        onToggle={toggleResource}
        onDelete={deleteResource}
      />

      <NeedsReplyPanel
        items={needsReplyItems}
        selectedId={selectedContactId}
        onSelect={setSelectedContactId}
        onDraftReply={draftReply}
        onSendDraft={sendDraft}
        onProcessSafeReplies={processSafeReplies}
      />

      <section className="conversation-grid">
        <ContactsTable
          contacts={data.contacts}
          whatsappStateByContact={whatsappStateByContact}
          selectedId={selectedContactId}
          selectedContactIds={selectedSet}
          selectedCount={selectedContactIds.length}
          batchLimit={batchLimit}
          maxLiveBatch={maxLiveBatch}
          onBatchLimitChange={setBatchLimit}
          onSelect={setSelectedContactId}
          onToggle={toggleContact}
          onSelectBatch={selectBatch}
          onClearSelection={() => setSelectedContactIds([])}
        />
        <ConversationPanel conversation={conversation} onSendDraft={sendDraft} />
      </section>
    </main>
  );
}

function StatusPill({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span className={`status-pill ${ready ? "ready" : "offline"}`}>
      {ready ? <Wifi size={14} /> : <WifiOff size={14} />}
      {label}
    </span>
  );
}

function MetricsPanel({ data }: { data: DashboardData }) {
  const metrics = data.metrics;
  return (
    <section className="metrics-grid">
      <Metric label="Contacts" value={metrics.contactsTotal} detail={`${metrics.contactsWithPhone} with phone`} />
      <Metric label="Needs Reply" value={metrics.needsReply} detail={`${metrics.needsHumanRate}% human queue`} />
      <Metric label="Auto Sent" value={metrics.autoRepliesSent} detail={`${metrics.autoReplyRate}% of inbound`} />
      <Metric label="Send Success" value={`${metrics.sendSuccessRate}%`} detail={`${metrics.outboundFailed} failed`} />
      <Metric label="Avg Reply" value={metrics.averageReplyMinutes === null ? "-" : `${metrics.averageReplyMinutes}m`} detail="WhatsApp chats" />
      <Metric label="Supportive" value={metrics.supportive} detail={`${metrics.undecided} undecided`} />
      <Metric label="Opposed" value={metrics.opposed} detail={`${metrics.optedOut} opted out`} />
      <Metric label="Drafts" value={metrics.outboundDrafted} detail={`${metrics.autoDrafts} auto drafts`} />
      <Metric label="Sent Today" value={metrics.sentToday} detail={`${metrics.sentThisHour}/${metrics.hourlyCap} this hour`} />
      <Metric label="Resources" value={metrics.resourcesActive} detail={`${metrics.resourcesTotal} total`} />
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function CampaignProgressPanel({ progress }: { progress: DashboardData["campaignProgress"] }) {
  if (!progress.running && progress.phase === "idle" && !progress.lastError && !progress.errors.length && !progress.finishedAt) return null;

  const percent = progress.total ? Math.round((progress.processed / progress.total) * 100) : progress.running ? 0 : 100;
  const title = progress.running
    ? `${progress.dryRun ? "Dry run" : "Live batch"} ${formatCampaignPhase(progress.phase)} ${progress.processed}/${progress.total || "?"}`
    : progress.phase === "failed"
      ? `${progress.dryRun ? "Dry run" : "Live batch"} failed`
      : `${progress.dryRun ? "Dry run" : "Live batch"} complete`;
  const recentErrors = progress.errors.slice(-5).reverse();

  return (
    <section className={`sync-progress campaign-progress ${progress.phase === "failed" || progress.failed ? "failed" : ""}`}>
      <div className="sync-progress-head">
        <strong>{title}</strong>
        <span>{progress.running ? `${percent}%` : progress.finishedAt ? formatShortTime(progress.finishedAt) : ""}</span>
      </div>
      <div className="sync-bar" aria-label="Live batch progress">
        <span style={{ width: `${progress.running ? percent : 100}%` }} />
      </div>
      <div className="sync-details">
        <span>{progress.sent} sent</span>
        <span>{progress.drafted} drafted</span>
        <span>{progress.skipped} skipped</span>
        <span>{progress.failed} failed</span>
      </div>
      {progress.currentContactName || progress.currentPhone ? (
        <p>
          Current: {[progress.currentContactName, progress.currentPhone].filter(Boolean).join(" - ")}
        </p>
      ) : null}
      {progress.lastError ? (
        <p className="error-text">
          <AlertCircle size={16} />
          {progress.lastError}
        </p>
      ) : null}
      {recentErrors.length ? (
        <div className="campaign-errors">
          <strong>Errors encountered</strong>
          {recentErrors.map((item) => (
            <p key={`${item.at}-${item.contactId}-${item.stage}`}>
              <span>{formatShortTime(item.at)}</span>
              <b>{item.contactName || item.phone}</b>
              {item.stage}: {item.error}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SyncProgressPanel({ progress }: { progress: DashboardData["syncProgress"] }) {
  if (!progress.running && progress.phase === "idle" && !progress.result && !progress.lastError) return null;

  const done = Math.min(progress.requestedContacts, progress.scannedChats + progress.skippedChats);
  const percent = progress.requestedContacts ? Math.round((done / progress.requestedContacts) * 100) : 0;
  const label = progress.running
    ? `${formatSyncPhase(progress.phase)} ${done}/${progress.requestedContacts || "?"}`
    : progress.phase === "failed"
      ? "Sync failed"
      : "Sync complete";

  return (
    <section className={`sync-progress ${progress.phase === "failed" ? "failed" : ""}`}>
      <div className="sync-progress-head">
        <strong>{label}</strong>
        <span>{progress.running ? `${percent}%` : progress.finishedAt ? formatShortTime(progress.finishedAt) : ""}</span>
      </div>
      <div className="sync-bar" aria-label="WhatsApp sync progress">
        <span style={{ width: `${progress.running ? percent : 100}%` }} />
      </div>
      <div className="sync-details">
        <span>{progress.scannedChats} chats scanned</span>
        <span>{progress.skippedChats} without chats</span>
        <span>{progress.importedMessages} imported</span>
        <span>{progress.duplicateMessages} duplicates</span>
        <span>{progress.needsReplyContacts} need reply</span>
      </div>
      {progress.currentPhone ? <p>Checking {progress.currentPhone}</p> : null}
      {progress.lastError ? <p className="error-text">{progress.lastError}</p> : null}
      {progress.errors.length ? <p className="muted-text">{progress.errors.at(-1)}</p> : null}
    </section>
  );
}

function formatCampaignPhase(phase: DashboardData["campaignProgress"]["phase"]): string {
  if (phase === "starting") return "starting";
  if (phase === "personalizing") return "personalizing";
  if (phase === "sending") return "sending";
  if (phase === "waiting_delay") return "waiting";
  if (phase === "paused") return "paused";
  if (phase === "completed") return "completed";
  if (phase === "failed") return "failed";
  return "idle";
}

function formatWebState(state: DashboardData["transports"]["web"]["state"]): string {
  if (state === "qr_ready") return "QR ready";
  if (state === "auth_failed") return "Session reset required";
  if (state === "disconnected") return "Disconnected";
  if (state === "starting") return "Starting";
  if (state === "ready") return "Ready";
  if (state === "disabled") return "Disabled";
  if (state === "error") return "Error";
  return "Idle";
}

function formatSyncPhase(phase: DashboardData["syncProgress"]["phase"]): string {
  if (phase === "loading_chats") return "Loading WhatsApp chats";
  if (phase === "scanning_chats") return "Scanning chats";
  if (phase === "saving_messages") return "Saving messages";
  if (phase === "processing_replies") return "Processing safe replies";
  if (phase === "completed") return "Completed";
  if (phase === "failed") return "Failed";
  return "Idle";
}

interface NeedsReplyItem {
  contact: Contact;
  reason: string;
  lastInbound?: Message;
  draft?: Message;
  failed?: Message;
  whatsappState: WhatsAppContactState;
}

function buildNeedsReplyItems(contacts: Contact[], messages: Message[], whatsappStates: WhatsAppContactState[]): NeedsReplyItem[] {
  const stateByContact = new Map(whatsappStates.map((state) => [state.contactId, state]));
  return contacts
    .map((contact) => {
      const whatsappState = stateByContact.get(contact.id);
      if (!whatsappState?.needsReply) return null;
      const contactMessages = messages.filter((message) => message.contactId === contact.id);
      const draft = contactMessages.find(
        (message) => message.direction === "outbound" && message.channel === "web" && message.status === "drafted"
      );
      const failed = contactMessages.find(
        (message) => message.direction === "outbound" && message.channel === "web" && message.status === "failed"
      );
      const lastInbound = contactMessages
        .filter((message) => message.direction === "inbound" && isActualWhatsAppMessage(message))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      return {
        contact,
        reason: whatsappState.reason,
        lastInbound,
        draft,
        failed,
        whatsappState
      };
    })
    .filter(Boolean) as NeedsReplyItem[];
}

function isActualWhatsAppMessage(message: Message): boolean {
  return (
    message.channel === "web" &&
    Boolean(message.providerMessageId) &&
    !message.providerMessageId.startsWith("simulate-") &&
    !/^\[(e2e_notification|notification_template|ciphertext|revoked|protocol|gp2|notification) WhatsApp message\]$/i.test(message.body.trim()) &&
    ((message.direction === "inbound" && message.status === "received") ||
      (message.direction === "outbound" && message.status === "sent"))
  );
}

function SettingsPanel({
  draft,
  dirty,
  setDraft,
  onSave
}: {
  draft: CampaignSettings;
  dirty: boolean;
  setDraft: (settings: CampaignSettings) => void;
  onSave: () => Promise<unknown>;
}) {
  const update = <K extends keyof CampaignSettings>(key: K, value: CampaignSettings[K]) => {
    setDraft({ ...draft, [key]: value });
  };

  return (
    <section className="panel settings-panel">
      <div className="panel-title">
        <Bot size={18} />
        <h2>Campaign Brain</h2>
        {dirty ? <span className="dirty-pill">Unsaved</span> : <span className="saved-pill">Saved</span>}
      </div>
      <label>
        Candidate name
        <input value={draft.candidateName} onChange={(event) => update("candidateName", event.target.value)} />
      </label>
      <label>
        Campaign facts
        <textarea value={draft.campaignFacts} onChange={(event) => update("campaignFacts", event.target.value)} rows={7} />
      </label>
      <label>
        Agent instructions
        <textarea value={draft.agentInstructions} onChange={(event) => update("agentInstructions", event.target.value)} rows={4} />
      </label>
      <label>
        First message template
        <textarea value={draft.firstMessageTemplate} onChange={(event) => update("firstMessageTemplate", event.target.value)} rows={5} />
      </label>
      <div className="settings-row">
        <label>
          Per hour
          <input type="number" min={1} value={draft.maxPerHour} onChange={(event) => update("maxPerHour", Number(event.target.value))} />
        </label>
        <label>
          Per day
          <input type="number" min={1} value={draft.maxPerDay} onChange={(event) => update("maxPerDay", Number(event.target.value))} />
        </label>
        <label>
          Min delay
          <input type="number" min={0} value={draft.minDelaySeconds} onChange={(event) => update("minDelaySeconds", Number(event.target.value))} />
        </label>
        <label>
          Max delay
          <input type="number" min={0} value={draft.maxDelaySeconds} onChange={(event) => update("maxDelaySeconds", Number(event.target.value))} />
        </label>
        <label>
          Live batch
          <input type="number" min={1} max={200} value={draft.maxLiveBatch} onChange={(event) => update("maxLiveBatch", Number(event.target.value))} />
        </label>
        <label>
          Sync seconds
          <input type="number" min={30} max={600} value={draft.autoSyncIntervalSeconds} onChange={(event) => update("autoSyncIntervalSeconds", Number(event.target.value))} />
        </label>
        <label>
          Reply/hour
          <input type="number" min={1} value={draft.replyMaxPerHour} onChange={(event) => update("replyMaxPerHour", Number(event.target.value))} />
        </label>
        <label>
          Reply/day
          <input type="number" min={1} value={draft.replyMaxPerDay} onChange={(event) => update("replyMaxPerDay", Number(event.target.value))} />
        </label>
      </div>
      <div className="toggle-row">
        <label>
          <input type="checkbox" checked={draft.cloudEnabled} onChange={(event) => update("cloudEnabled", event.target.checked)} />
          Cloud API later
        </label>
        <label>
          <input type="checkbox" checked={draft.webEnabled} onChange={(event) => update("webEnabled", event.target.checked)} />
          WhatsApp Web
        </label>
        <label>
          <input type="checkbox" checked={draft.dryRunDefault} onChange={(event) => update("dryRunDefault", event.target.checked)} />
          Dry-run default
        </label>
        <label>
          <input type="checkbox" checked={draft.autoSyncEnabled} onChange={(event) => update("autoSyncEnabled", event.target.checked)} />
          Auto-sync
        </label>
        <label>
          <input type="checkbox" checked={draft.autoReplyEnabled} onChange={(event) => update("autoReplyEnabled", event.target.checked)} />
          Auto-reply
        </label>
        <label>
          <input type="checkbox" checked={draft.safeAutoSend} onChange={(event) => update("safeAutoSend", event.target.checked)} />
          Safe auto-send
        </label>
      </div>
      <button className="button save" onClick={() => void onSave()}>
        <Save size={18} />
        Save Campaign Texts & Limits
      </button>
    </section>
  );
}

function TransportPanel({
  data,
  contacts,
  onTestSend,
  onSimulateInbound,
  onRunAutoSync,
  onReconnectWeb,
  onResetWeb,
  onSimulateWebState
}: {
  data: DashboardData;
  contacts: Contact[];
  onTestSend: (input: { to: string; body: string }) => Promise<unknown>;
  onSimulateInbound: (input: { contactId?: number; phone?: string; body: string }) => Promise<unknown>;
  onRunAutoSync: () => Promise<unknown>;
  onReconnectWeb: () => Promise<unknown>;
  onResetWeb: () => Promise<unknown>;
  onSimulateWebState: (event: "disconnected" | "auth_failure" | "ready" | "qr") => Promise<unknown>;
}) {
  const run = data.activeRun;
  const [testPhone, setTestPhone] = useState("");
  const [testBody, setTestBody] = useState("Hi, this is a WhatsApp Web connection test.");
  const [simulateContactId, setSimulateContactId] = useState<number>(contacts[0]?.id || 0);
  const [simulateUsesPhone, setSimulateUsesPhone] = useState(false);
  const [simulatePhone, setSimulatePhone] = useState("");
  const [simulateBody, setSimulateBody] = useState("Why should I vote for Kwaku?");

  useEffect(() => {
    if (!simulateUsesPhone && !simulateContactId && contacts[0]) setSimulateContactId(contacts[0].id);
  }, [contacts, simulateContactId, simulateUsesPhone]);

  const selectedSimulateContactId = simulateUsesPhone ? 0 : simulateContactId || contacts[0]?.id || 0;

  return (
    <section className="panel transport-panel">
      <div className="panel-title">
        <Send size={18} />
        <h2>WhatsApp Web Setup</h2>
      </div>
      <div className="health-grid">
        <div>
          <span>Server</span>
          <strong>{data.runtime.ok ? "Online" : "Offline"}</strong>
        </div>
        <div>
          <span>LLM</span>
          <strong>{data.runtime.llm.groqConfigured ? `${data.runtime.llm.groqKeyCount} Groq key(s)` : "Ollama fallback"}</strong>
        </div>
        <div>
          <span>Auto-sync</span>
          <strong>{data.autoSync.enabled ? (data.autoSync.running ? "Running" : `${data.autoSync.intervalSeconds}s`) : "Off"}</strong>
        </div>
        <div>
          <span>Auto-reply</span>
          <strong>{data.autoSync.autoReplyEnabled && data.autoSync.safeAutoSend ? "Safe mode" : "Draft only"}</strong>
        </div>
      </div>
      <div className="transport-line">
        <span>Active channel</span>
        <strong>WhatsApp Web</strong>
      </div>
      <div className="transport-line">
        <span>Cloud API</span>
        <strong>{data.settings.cloudEnabled ? "Enabled later" : "Disabled"}</strong>
      </div>
      <div className="transport-line">
        <span>WhatsApp Web</span>
        <strong>{formatWebState(data.transports.web.state)}</strong>
      </div>
      <div className="transport-line">
        <span>Recovery</span>
        <strong>
          {data.transports.web.needsSessionReset
            ? "Reset session required"
            : data.transports.web.needsReconnect
              ? "Reconnect required"
              : data.transports.web.ready
                ? "Healthy"
                : "Waiting"}
        </strong>
      </div>
      <div className="transport-line">
        <span>Last Web event</span>
        <strong>{data.transports.web.lastEventAt ? formatShortTime(data.transports.web.lastEventAt) : "Never"}</strong>
      </div>
      {data.transports.web.lastDisconnectReason ? (
        <div className="transport-line">
          <span>Disconnect reason</span>
          <strong>{data.transports.web.lastDisconnectReason}</strong>
        </div>
      ) : null}
      <div className="transport-line">
        <span>Reconnect attempts</span>
        <strong>{data.transports.web.reconnectAttempts}</strong>
      </div>
      <div className="transport-line">
        <span>Last sync</span>
        <strong>{data.autoSync.lastFinishedAt ? formatShortTime(data.autoSync.lastFinishedAt) : "Never"}</strong>
      </div>
      <div className="transport-line">
        <span>Next sync</span>
        <strong>{data.autoSync.enabled && data.transports.web.ready ? formatShortTime(data.autoSync.nextRunAt) : "Paused"}</strong>
      </div>
      <div className="transport-line">
        <span>Session</span>
        <strong>{data.transports.web.sessionPath || ".wwebjs_auth"}</strong>
      </div>
      <div className="transport-line">
        <span>Chrome</span>
        <strong>{data.transports.web.chromePath || "Default"}</strong>
      </div>
      {data.transports.web.qrDataUrl ? (
        <div className="qr-box">
          <img src={data.transports.web.qrDataUrl} alt="WhatsApp Web QR code" />
          <p>Scan this QR in WhatsApp: Linked devices, then Link a device.</p>
        </div>
      ) : null}
      {!data.transports.web.ready && !data.transports.web.qrDataUrl && data.transports.web.starting ? (
        <p className="helper-text">Starting Chrome and waiting for WhatsApp to return a QR code.</p>
      ) : null}
      {data.transports.cloud.lastError || data.transports.web.lastError ? (
        <p className="error-text">{data.transports.cloud.lastError || data.transports.web.lastError}</p>
      ) : null}
      {data.autoSync.lastError ? <p className="error-text">{data.autoSync.lastError}</p> : null}
      {data.transports.web.needsSessionReset ? (
        <p className="helper-text">WhatsApp says this session can no longer authenticate. Reset the session, then scan a fresh QR code.</p>
      ) : data.transports.web.needsReconnect ? (
        <p className="helper-text">WhatsApp Web disconnected. Reconnect first; if reconnect fails, reset the session and scan again.</p>
      ) : null}
      <div className="web-action-row">
        <button className="button secondary" disabled={data.transports.web.starting || data.transports.web.needsSessionReset} onClick={() => void onReconnectWeb()}>
          <RefreshCw size={18} />
          Reconnect Web
        </button>
        <button className="button muted" disabled={data.transports.web.starting} onClick={() => void onResetWeb()}>
          <WifiOff size={18} />
          Reset Session
        </button>
      </div>
      {data.runtime.devSimulationEnabled ? (
        <div className="web-action-row">
          <button className="button muted" onClick={() => void onSimulateWebState("disconnected")}>
            Simulate Disconnect
          </button>
          <button className="button muted" onClick={() => void onSimulateWebState("auth_failure")}>
            Simulate Session Removed
          </button>
        </div>
      ) : null}
      <button className="button secondary full-width" disabled={!data.transports.web.ready || data.autoSync.running} onClick={() => void onRunAutoSync()}>
        <RefreshCw size={18} />
        Run Sync & Safe Replies
      </button>
      <div className="run-card">
        <span>Current run</span>
        <strong>{run ? `${run.status}${run.dryRun ? " dry" : " live"}` : "None"}</strong>
        {run ? <p>{run.stats.sent} sent, {run.stats.drafted} drafted, {run.stats.failed} failed</p> : null}
      </div>
      <form
        className="test-send-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onTestSend({ to: testPhone, body: testBody });
        }}
      >
        <div className="panel-title compact">
          <MessageSquareText size={18} />
          <h2>Test Send</h2>
        </div>
        <label>
          Test phone
          <input value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="+233..." />
        </label>
        <label>
          Test message
          <textarea value={testBody} onChange={(event) => setTestBody(event.target.value)} rows={3} />
        </label>
        <button className="button secondary" type="submit" disabled={!data.transports.web.ready}>
          <Send size={18} />
          Send Test
        </button>
      </form>
      <form
        className="test-send-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSimulateInbound({
            contactId: selectedSimulateContactId || undefined,
            phone: selectedSimulateContactId ? undefined : simulatePhone,
            body: simulateBody
          });
        }}
      >
        <div className="panel-title compact">
          <MessageSquareText size={18} />
          <h2>Simulate Inbound</h2>
        </div>
        <label>
          Contact
          <select
            value={selectedSimulateContactId}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSimulateUsesPhone(next === 0);
              setSimulateContactId(next);
            }}
          >
            <option value={0}>Use phone number</option>
            {contacts.slice(0, 250).map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.fullName || contact.normalizedPhone || `Contact ${contact.id}`}
              </option>
            ))}
          </select>
        </label>
        {!selectedSimulateContactId ? (
          <label>
            Phone
            <input value={simulatePhone} onChange={(event) => setSimulatePhone(event.target.value)} placeholder="+233..." />
          </label>
        ) : null}
        <label>
          Inbound message
          <textarea value={simulateBody} onChange={(event) => setSimulateBody(event.target.value)} rows={3} />
        </label>
        <button className="button secondary" type="submit">
          <MessageSquareText size={18} />
          Simulate Reply
        </button>
      </form>
    </section>
  );
}

function ResourcePanel({
  resources,
  onUpload,
  onAddText,
  onToggle,
  onDelete
}: {
  resources: KnowledgeResource[];
  onUpload: (file: File | null) => Promise<unknown>;
  onAddText: (input: { title: string; text: string }) => Promise<unknown>;
  onToggle: (resource: KnowledgeResource) => Promise<unknown>;
  onDelete: (resource: KnowledgeResource) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("Campaign note");
  const [text, setText] = useState("");

  return (
    <section className="panel resources-panel">
      <div className="panel-title">
        <BookOpen size={18} />
        <h2>Agent Resources</h2>
        <span className="count-pill">{resources.filter((resource) => resource.active).length}</span>
      </div>
      <div className="resource-actions">
        <label className="upload-button">
          <FileText size={18} />
          <span>Add File</span>
          <input type="file" accept=".pdf,.txt,.md,.markdown" onChange={(event) => void onUpload(event.target.files?.[0] || null)} />
        </label>
        <form
          className="resource-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onAddText({ title, text }).then(() => setText(""));
          }}
        >
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Resource title" />
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} placeholder="Paste manifesto notes, FAQs, or approved facts" />
          <button className="button secondary" type="submit" disabled={!text.trim()}>
            <Save size={18} />
            Save Resource
          </button>
        </form>
      </div>
      <div className="resource-list">
        {resources.length ? (
          resources.map((resource) => (
            <article key={resource.id} className="resource-item">
              <div>
                <strong>{resource.title}</strong>
                <span>
                  {resource.resourceType} · {resource.chunkCount} chunk(s) · {resource.characterCount.toLocaleString()} chars
                </span>
                <p>{resource.textPreview || "No preview available."}</p>
              </div>
              <div className="resource-buttons">
                <label className="inline-check">
                  <input type="checkbox" checked={resource.active} onChange={() => void onToggle(resource)} />
                  Active
                </label>
                <button className="icon-button" onClick={() => void onDelete(resource)} aria-label={`Delete ${resource.title}`} title="Delete resource">
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="empty-state">No resources have been added yet.</p>
        )}
      </div>
    </section>
  );
}

function NeedsReplyPanel({
  items,
  selectedId,
  onSelect,
  onDraftReply,
  onSendDraft,
  onProcessSafeReplies
}: {
  items: NeedsReplyItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDraftReply: (contactId: number) => Promise<unknown>;
  onSendDraft: (contactId: number, messageId?: number) => Promise<unknown>;
  onProcessSafeReplies: () => Promise<unknown>;
}) {
  return (
    <section className="panel needs-reply-panel">
      <div className="panel-title">
        <AlertCircle size={18} />
        <h2>Needs Reply</h2>
        <span className="count-pill">{items.length}</span>
        <button className="button secondary compact-button" disabled={!items.length} onClick={() => void onProcessSafeReplies()}>
          <Bot size={18} />
          Process Safe Replies
        </button>
      </div>
      {items.length ? (
        <div className="needs-list">
          {items.map((item) => (
            <article key={item.contact.id} className={selectedId === item.contact.id ? "needs-item selected" : "needs-item"}>
              <button className="needs-main" onClick={() => onSelect(item.contact.id)}>
                <strong>{item.contact.fullName || item.contact.normalizedPhone || "Unknown contact"}</strong>
                <span>{item.reason}</span>
                {item.lastInbound ? <p>{item.lastInbound.body}</p> : null}
              </button>
              <div className="needs-actions">
                <button className="button secondary" onClick={() => void onDraftReply(item.contact.id)}>
                  <Bot size={18} />
                  Draft With Agent
                </button>
              </div>
              {item.draft ? (
                <div className="draft-preview">
                  <span>Draft</span>
                  <p>{item.draft.body}</p>
                  <button className="button secondary" onClick={() => void onSendDraft(item.contact.id, item.draft?.id)}>
                    <Send size={18} />
                    Send Draft
                  </button>
                </div>
              ) : item.failed ? (
                <div className="draft-preview">
                  <span>Failed Reply</span>
                  <p>{item.failed.body}</p>
                  <button className="button secondary" onClick={() => void onSendDraft(item.contact.id, item.failed?.id)}>
                    <Send size={18} />
                    Retry
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">No conversations need human follow-up right now.</p>
      )}
    </section>
  );
}

function ContactsTable({
  contacts,
  whatsappStateByContact,
  selectedId,
  selectedContactIds,
  selectedCount,
  batchLimit,
  maxLiveBatch,
  onBatchLimitChange,
  onSelect,
  onToggle,
  onSelectBatch,
  onClearSelection
}: {
  contacts: Contact[];
  whatsappStateByContact: Map<number, WhatsAppContactState>;
  selectedId: number | null;
  selectedContactIds: Set<number>;
  selectedCount: number;
  batchLimit: number;
  maxLiveBatch: number;
  onBatchLimitChange: (limit: number) => void;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onSelectBatch: () => void;
  onClearSelection: () => void;
}) {
  return (
    <section className="panel contacts-panel">
      <div className="panel-title">
        <CheckCircle2 size={18} />
        <h2>Contacts</h2>
      </div>
      <div className="batch-toolbar">
        <label>
          Batch limit
          <input
            type="number"
            min={1}
            max={maxLiveBatch}
            value={batchLimit}
            onChange={(event) => onBatchLimitChange(Number(event.target.value))}
          />
        </label>
        <button className="button secondary" onClick={onSelectBatch}>
          Select Batch
        </button>
        <button className="button muted" onClick={onClearSelection}>
          Clear
        </button>
        <strong>{selectedCount} selected</strong>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Select</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Program</th>
              <th>WhatsApp</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => {
              const whatsappState = whatsappStateByContact.get(contact.id);
              return (
                <tr
                  key={contact.id}
                  className={selectedId === contact.id ? "selected" : ""}
                  onClick={() => onSelect(contact.id)}
                >
                  <td>
                    <input
                      aria-label={`Select ${contact.fullName || contact.normalizedPhone || "contact"}`}
                      type="checkbox"
                      checked={selectedContactIds.has(contact.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => onToggle(contact.id)}
                    />
                  </td>
                  <td>{contact.fullName || "Unknown"}</td>
                  <td>{contact.normalizedPhone || "Needs review"}</td>
                  <td>{contact.programOfStudy || "-"}</td>
                  <td>
                    <StatusBadge
                      label={formatWhatsAppState(whatsappState)}
                      tone={whatsAppStateTone(whatsappState)}
                    />
                  </td>
                  <td>
                    <div className="badge-row">
                      {contactBadges(contact, whatsappState).map((badge) => (
                        <StatusBadge key={badge.label} label={badge.label} tone={badge.tone} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function contactBadges(
  contact: Contact,
  whatsappState?: WhatsAppContactState
): Array<{ label: string; tone: "good" | "warn" | "bad" | "neutral" }> {
  const badges: Array<{ label: string; tone: "good" | "warn" | "bad" | "neutral" }> = [];
  if (whatsappState?.needsReply) badges.push({ label: "Needs Reply", tone: "warn" });
  if (whatsappState?.label === "waiting_for_reply") badges.push({ label: "Waiting", tone: "neutral" });
  if (whatsappState?.label === "opted_out") badges.push({ label: "Opted Out", tone: "neutral" });
  if (contact.outcomeLabel === "supportive") badges.push({ label: "Supportive", tone: "good" });
  if (!badges.length) badges.push({ label: whatsappState?.label || "no_chat", tone: whatsAppStateTone(whatsappState) });
  return badges;
}

function StatusBadge({ label, tone }: { label: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  return <span className={`status-badge ${tone}`}>{label.replace(/_/g, " ")}</span>;
}

function formatWhatsAppState(state?: WhatsAppContactState): string {
  if (!state) return "No Chat";
  if (state.label === "needs_reply") return "Needs Reply";
  if (state.label === "waiting_for_reply") return "Waiting";
  if (state.label === "opted_out") return "Opted Out";
  if (state.label === "replied") return "Replied";
  return "No Chat";
}

function formatShortTime(value: string): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function whatsAppStateTone(state?: WhatsAppContactState): "good" | "warn" | "bad" | "neutral" {
  if (!state || state.label === "no_chat") return "neutral";
  if (state.needsReply) return "warn";
  if (state.label === "opted_out") return "neutral";
  if (state.lastDirection === "outbound") return "good";
  return "neutral";
}

function ConversationPanel({
  conversation,
  onSendDraft
}: {
  conversation: ContactConversation | null;
  onSendDraft: (contactId: number, messageId?: number) => Promise<unknown>;
}) {
  return (
    <section className="panel conversation-panel">
      <div className="panel-title">
        <Send size={18} />
        <h2>{conversation?.contact.fullName || "Conversation"}</h2>
      </div>
      {conversation?.summary ? <p className="summary">{conversation.summary}</p> : null}
      <div className="messages">
        {conversation?.messages.length ? (
          conversation.messages.map((message) => (
            <div key={message.id} className={`message ${message.direction}`}>
              <span>{message.channel} · {message.status}</span>
              <p>{message.body}</p>
              {message.error ? <small>{message.error}</small> : null}
              {message.direction === "outbound" && message.channel === "web" && (message.status === "drafted" || message.status === "failed") ? (
                <button className="button secondary draft-send" onClick={() => void onSendDraft(conversation.contact.id, message.id)}>
                  <Send size={18} />
                  {message.status === "failed" ? "Retry" : "Send Draft"}
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <p className="empty-state">No messages yet.</p>
        )}
      </div>
    </section>
  );
}
