export type FunnelLabel =
  | "not_contacted"
  | "contacted"
  | "replied"
  | "supportive"
  | "undecided"
  | "opposed"
  | "opted_out"
  | "failed_send"
  | "needs_human";

export type ContactStatus =
  | "imported"
  | "contacted"
  | "replied"
  | "failed"
  | "needs_review";

export type MessageDirection = "inbound" | "outbound" | "system";
export type MessageChannel = "cloud" | "web" | "dry_run" | "system";
export type MessageStatus = "queued" | "sent" | "failed" | "received" | "drafted" | "skipped";
export type MessageOrigin =
  | ""
  | "campaign"
  | "dry_run"
  | "auto_reply"
  | "auto_draft"
  | "manual_draft"
  | "manual_send"
  | "system";
export type CampaignRunStatus = "running" | "paused" | "completed" | "failed";

export interface Contact {
  id: number;
  fullName: string;
  whatsappNumber: string;
  otherNumber: string;
  activeEmail: string;
  programOfStudy: string;
  level: string;
  institution: string;
  selectedPhone: string;
  normalizedPhone: string;
  phoneSource: "whatsapp" | "other" | "none";
  importNotes: string;
  status: ContactStatus;
  outcomeLabel: FunnelLabel;
  optedOut: boolean;
  needsHuman: boolean;
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  contactId: number;
  runId: number | null;
  direction: MessageDirection;
  channel: MessageChannel;
  body: string;
  messageHash: string;
  status: MessageStatus;
  providerMessageId: string;
  error: string;
  origin: MessageOrigin;
  createdAt: string;
}

export interface CampaignRun {
  id: number;
  name: string;
  status: CampaignRunStatus;
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  stats: CampaignStats;
}

export interface CampaignStats {
  total: number;
  sent: number;
  drafted: number;
  skipped: number;
  failed: number;
}

export interface CampaignSettings {
  candidateName: string;
  campaignFacts: string;
  agentInstructions: string;
  firstMessageTemplate: string;
  maxPerHour: number;
  maxPerDay: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  maxLiveBatch: number;
  dryRunDefault: boolean;
  cloudEnabled: boolean;
  webEnabled: boolean;
  autoSyncEnabled: boolean;
  autoReplyEnabled: boolean;
  safeAutoSend: boolean;
  autoSyncIntervalSeconds: number;
  replyMaxPerHour: number;
  replyMaxPerDay: number;
}

export interface ImportSummary {
  totalRows: number;
  created: number;
  updated: number;
  needsReview: number;
  skipped: number;
  errors: string[];
}

export interface TransportState {
  cloud: {
    configured: boolean;
    ready: boolean;
    lastError: string;
    templateConfigured: boolean;
  };
  web: {
    enabled: boolean;
    initialized: boolean;
    starting: boolean;
    ready: boolean;
    state: WebTransportState;
    qrDataUrl: string;
    lastError: string;
    lastEventAt: string;
    lastDisconnectReason: string;
    needsReconnect: boolean;
    needsSessionReset: boolean;
    reconnectAttempts: number;
    sessionPath: string;
    chromePath: string;
  };
}

export type WebTransportState =
  | "disabled"
  | "idle"
  | "starting"
  | "qr_ready"
  | "ready"
  | "disconnected"
  | "auth_failed"
  | "error";

export interface RuntimeStatus {
  ok: boolean;
  time: string;
  environment: string;
  devSimulationEnabled: boolean;
  llm: {
    groqConfigured: boolean;
    groqKeyCount: number;
    groqModel: string;
    ollamaConfigured: boolean;
    ollamaBaseUrl: string;
    ollamaModel: string;
  };
  transports: TransportState;
}

export interface DashboardData {
  settings: CampaignSettings;
  contacts: Contact[];
  messages: Message[];
  activeRun: CampaignRun | null;
  transports: TransportState;
  runtime: RuntimeStatus;
  whatsappStates: WhatsAppContactState[];
  metrics: BotMetrics;
  resources: KnowledgeResource[];
  autoSync: AutoSyncState;
  syncProgress: SyncProgress;
  campaignProgress: CampaignProgress;
}

export type CampaignProgressPhase =
  | "idle"
  | "starting"
  | "personalizing"
  | "sending"
  | "waiting_delay"
  | "paused"
  | "completed"
  | "failed";

export interface CampaignProgressError {
  contactId: number;
  contactName: string;
  phone: string;
  stage: string;
  error: string;
  at: string;
}

export interface CampaignProgress {
  runId: number | null;
  runName: string;
  dryRun: boolean;
  running: boolean;
  phase: CampaignProgressPhase;
  startedAt: string;
  finishedAt: string;
  total: number;
  processed: number;
  sent: number;
  drafted: number;
  skipped: number;
  failed: number;
  currentContactId: number | null;
  currentContactName: string;
  currentPhone: string;
  lastError: string;
  errors: CampaignProgressError[];
}

export type ResourceType = "pdf" | "text" | "markdown" | "manual";

export interface KnowledgeResource {
  id: number;
  title: string;
  resourceType: ResourceType;
  fileName: string;
  active: boolean;
  textPreview: string;
  characterCount: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceSnippet {
  resourceId: number;
  title: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export interface BotMetrics {
  contactsTotal: number;
  contactsWithPhone: number;
  noChat: number;
  waitingForReply: number;
  needsReply: number;
  repliedChats: number;
  optedOutChats: number;
  contacted: number;
  replied: number;
  supportive: number;
  undecided: number;
  opposed: number;
  optedOut: number;
  failedSend: number;
  needsHuman: number;
  inboundReceived: number;
  outboundSent: number;
  outboundDrafted: number;
  outboundFailed: number;
  autoRepliesSent: number;
  autoDrafts: number;
  manualSends: number;
  needsHumanRate: number;
  autoReplyRate: number;
  sendSuccessRate: number;
  averageReplyMinutes: number | null;
  sentToday: number;
  sentThisHour: number;
  dailyCap: number;
  hourlyCap: number;
  replyDailyCap: number;
  replyHourlyCap: number;
  resourcesTotal: number;
  resourcesActive: number;
}

export interface AutoSyncState {
  enabled: boolean;
  autoReplyEnabled: boolean;
  safeAutoSend: boolean;
  running: boolean;
  intervalSeconds: number;
  lastStartedAt: string;
  lastFinishedAt: string;
  lastError: string;
  nextRunAt: string;
  lastResult: WhatsAppSyncResult | null;
}

export type SyncPhase =
  | "idle"
  | "loading_chats"
  | "scanning_chats"
  | "saving_messages"
  | "processing_replies"
  | "completed"
  | "failed";

export interface SyncProgress {
  id: string;
  running: boolean;
  phase: SyncPhase;
  startedAt: string;
  finishedAt: string;
  requestedContacts: number;
  scannedChats: number;
  skippedChats: number;
  importedMessages: number;
  duplicateMessages: number;
  needsReplyContacts: number;
  currentPhone: string;
  lastError: string;
  errors: string[];
  result: WhatsAppSyncResult | null;
}

export type WhatsAppStateLabel = "no_chat" | "waiting_for_reply" | "needs_reply" | "replied" | "opted_out";

export interface WhatsAppContactState {
  contactId: number;
  source: "whatsapp_web";
  label: WhatsAppStateLabel;
  hasActualChat: boolean;
  needsReply: boolean;
  lastDirection: MessageDirection | null;
  lastMessageBody: string;
  lastMessageAt: string;
  lastProviderMessageId: string;
  reason: string;
}

export interface ContactConversation {
  contact: Contact;
  messages: Message[];
  summary: string;
}

export interface WebTestSendResult {
  ok: boolean;
  channel: "web";
  providerMessageId: string;
}

export interface ReplyDecision {
  reply: string;
  needsHuman: boolean;
  reason: string;
  outcomeLabel: FunnelLabel;
  safeToAutoSend: boolean;
}

export interface SimulateInboundResult {
  ok: boolean;
  contact: Contact | null;
  conversation: ContactConversation | null;
}

export interface WhatsAppSyncResult {
  ok: boolean;
  requestedContacts: number;
  scannedChats: number;
  importedMessages: number;
  duplicateMessages: number;
  skippedChats: number;
  clearedContacts: number;
  clearedDrafts: number;
  needsReplyContacts: number;
  pendingRepliesProcessed?: PendingReplyResult;
  errors: string[];
}

export interface PendingReplyResult {
  processed: number;
  sent: number;
  drafted: number;
  skipped: number;
  failed: number;
}
