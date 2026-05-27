import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  CampaignRun,
  CampaignSettings,
  Contact,
  ContactStatus,
  FunnelLabel,
  KnowledgeResource,
  Message,
  MessageChannel,
  MessageDirection,
  MessageOrigin,
  MessageStatus
} from "../shared/types.js";
import { nowIso } from "./time.js";

export type Sqlite = Database.Database;

export const defaultSettings: CampaignSettings = {
  candidateName: "Kwaku Bonsu Wiredu",
  campaignFacts:
    `CANDIDATE: Wiredu Kwaku Bonsu
POSITION: Technical Assistant to the Founder, AusIMM Tarkwa Student Chapter
ORGANISATION: Australasian Institute of Mining and Metallurgy (AusIMM) - Tarkwa Student Chapter
ELECTION: Student chapter executive elections
VOTING CLOSES: 5th June 2025
VOTING METHOD: Online (link/form)

WHAT THE ROLE DOES:
The Technical Assistant to the Founder supports the Founder's office by organising his schedule, reviewing documents before they go out, briefing him before meetings and decisions, and following up on assigned tasks until they are completed.

KWAKU'S PLAN - THREE WORKING SYSTEMS:
1. Review System - every document representing the Founder or chapter is checked for accuracy, tone, grammar, and branding before it moves forward
2. Briefing System - before every meeting, event, or major decision, the Founder receives a structured brief covering purpose, key people, expected contributions, and follow-up actions
3. Follow-Up System - every assigned task is tracked with the responsible person, deadline, progress, and outcome until it is fully completed

KWAKU'S FOUR PILLARS:
Time, Information, Communication, Trust

KWAKU'S COMMITMENTS:
- Confidentiality - information from the Founder's office stays in the Founder's office
- Integrity - verify before presenting, admit mistakes early
- Respect for authority - support the Founder, never overstep
- Reliability - plan ahead, communicate early, no last-minute work

SLOGAN: "Prepared Founder. Clear Communication. Trusted Service."

CORE MESSAGE: "I will not treat this as a title. I will treat it as a responsibility."

WHAT TO SAY IF ASKED WHY KWAKU:
He is the only candidate with a concrete plan - three working systems already designed for the office. He is technically competent, organised, and has demonstrated the kind of structured thinking this role demands.

WHAT TO SAY IF ASKED ABOUT OTHER CANDIDATES:
We are focused on Kwaku's plan and his commitment to the chapter. We do not comment on other candidates.

WHAT TO SAY IF ASKED HOW TO VOTE:
Voting is online and closes 5th June 2025. The voting link will be shared as soon as it is officially released. Mark this conversation for human follow-up to send the link directly when it drops.

WHAT NOT TO SAY:
Do not invent endorsements, grades, personal achievements, or any facts not listed here. If unsure, admit it and flag for human follow-up.`,
  agentInstructions:
    `You are a campaign outreach assistant for Kwaku Bonsu Wiredu, who is running for Technical Assistant to the Founder in the AusIMM Tarkwa Student Chapter elections.

Your goal is to have a warm, genuine one-on-one conversation that earns the contact's vote and support. You are not sending a broadcast - you are having a personal conversation on Kwaku's behalf.

TONE: Warm, respectful, confident, and concise. Never pushy or desperate. Never robotic or copy-paste sounding.

RULES:
- Only use facts confirmed in the campaign facts above. Never invent policies, endorsements, achievements, dates, or personal claims.
- If a contact asks something you cannot answer from the campaign facts, say honestly that you will get back to them and mark the conversation as Needs Human.
- If a contact expresses strong support, mark them as Supportive and thank them genuinely.
- If a contact is uninterested or asks to stop, respect it immediately, thank them for their time, and mark as Opted Out.
- Keep replies short - 2 to 4 sentences maximum unless the contact asks a detailed question.
- Never mention that this is an automated message. Represent Kwaku naturally.
- If the contact asks a question about voting logistics or the voting link, mark as Needs Human so Kwaku can follow up personally.
- Match the contact's energy - if they are brief, be brief. If they are chatty, engage warmly.
- Your job is not to overwhelm them with information. It is to open a conversation, answer questions honestly, and earn a soft commitment to vote.`,
  firstMessageTemplate:
    "Hi {{firstName}}, I hope you're doing well. Kwaku Bonsu Wiredu is running for Technical Assistant to the Founder in the AusIMM Tarkwa Student Chapter elections and would love your support. He has put together a concrete plan for the office - not just promises. Would you be open to hearing more?",
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
};

export function openDatabase(filePath = process.env.DB_PATH || path.resolve(process.cwd(), "data/campaign.sqlite")): Sqlite {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }

  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedSettings(db);
  applyRuntimeDefaults(db);
  return db;
}

function migrate(db: Sqlite): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL DEFAULT '',
      whatsapp_number TEXT NOT NULL DEFAULT '',
      other_number TEXT NOT NULL DEFAULT '',
      active_email TEXT NOT NULL DEFAULT '',
      program_of_study TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT '',
      institution TEXT NOT NULL DEFAULT '',
      selected_phone TEXT NOT NULL DEFAULT '',
      normalized_phone TEXT NOT NULL DEFAULT '',
      phone_source TEXT NOT NULL DEFAULT 'none',
      import_notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'imported',
      outcome_label TEXT NOT NULL DEFAULT 'not_contacted',
      opted_out INTEGER NOT NULL DEFAULT 0,
      needs_human INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_normalized_phone
      ON contacts(normalized_phone)
      WHERE normalized_phone != '';

    CREATE TABLE IF NOT EXISTS campaign_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      dry_run INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      stats_json TEXT NOT NULL DEFAULT '{"total":0,"sent":0,"drafted":0,"skipped":0,"failed":0}'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      run_id INTEGER REFERENCES campaign_runs(id) ON DELETE SET NULL,
      direction TEXT NOT NULL,
      channel TEXT NOT NULL,
      body TEXT NOT NULL,
      message_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_message_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_contact_created ON messages(contact_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_no_duplicate_outbound
      ON messages(contact_id, COALESCE(run_id, -1), channel, message_hash)
      WHERE direction = 'outbound';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_inbound_provider_id
      ON messages(provider_message_id)
      WHERE direction = 'inbound' AND provider_message_id != '';

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      contact_id INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
      summary TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_resources_active ON knowledge_resources(active);

    CREATE TABLE IF NOT EXISTS knowledge_resource_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL REFERENCES knowledge_resources(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_resource_chunks_resource
      ON knowledge_resource_chunks(resource_id, chunk_index);
  `);
  addColumnIfMissing(db, "messages", "origin", "TEXT NOT NULL DEFAULT ''");
}

function addColumnIfMissing(db: Sqlite, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((row) => row.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function seedSettings(db: Sqlite): void {
  const insert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaultSettings)) {
    insert.run(key, String(value));
  }
}

function applyRuntimeDefaults(db: Sqlite): void {
  const cloudConfigured = Boolean(process.env.WA_CLOUD_ACCESS_TOKEN && process.env.WA_CLOUD_PHONE_NUMBER_ID);
  if (!cloudConfigured) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('cloudEnabled', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'").run();
  }
}

export function getSettings(db: Sqlite): CampaignSettings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const bool = (key: keyof CampaignSettings) => values.get(key) === "true";
  const number = (key: keyof CampaignSettings) => Number(values.get(key) ?? defaultSettings[key]);

  return {
    candidateName: values.get("candidateName") || defaultSettings.candidateName,
    campaignFacts: values.get("campaignFacts") || defaultSettings.campaignFacts,
    agentInstructions: values.get("agentInstructions") || defaultSettings.agentInstructions,
    firstMessageTemplate: values.get("firstMessageTemplate") || defaultSettings.firstMessageTemplate,
    maxPerHour: number("maxPerHour"),
    maxPerDay: number("maxPerDay"),
    minDelaySeconds: number("minDelaySeconds"),
    maxDelaySeconds: number("maxDelaySeconds"),
    maxLiveBatch: number("maxLiveBatch"),
    dryRunDefault: bool("dryRunDefault"),
    cloudEnabled: bool("cloudEnabled"),
    webEnabled: bool("webEnabled"),
    autoSyncEnabled: bool("autoSyncEnabled"),
    autoReplyEnabled: bool("autoReplyEnabled"),
    safeAutoSend: bool("safeAutoSend"),
    autoSyncIntervalSeconds: number("autoSyncIntervalSeconds"),
    replyMaxPerHour: number("replyMaxPerHour"),
    replyMaxPerDay: number("replyMaxPerDay")
  };
}

export function updateSettings(db: Sqlite, patch: Partial<CampaignSettings>): CampaignSettings {
  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const tx = db.transaction((updates: Partial<CampaignSettings>) => {
    for (const [key, value] of Object.entries(updates)) {
      if (key in defaultSettings) stmt.run(key, String(value));
    }
  });
  tx(patch);
  return getSettings(db);
}

export function mapContact(row: Record<string, unknown>): Contact {
  return {
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
    status: row.status as ContactStatus,
    outcomeLabel: row.outcome_label as FunnelLabel,
    optedOut: Boolean(row.opted_out),
    needsHuman: Boolean(row.needs_human),
    lastError: String(row.last_error ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

export function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: Number(row.id),
    contactId: Number(row.contact_id),
    runId: row.run_id === null ? null : Number(row.run_id),
    direction: row.direction as MessageDirection,
    channel: row.channel as MessageChannel,
    body: String(row.body ?? ""),
    messageHash: String(row.message_hash ?? ""),
    status: row.status as MessageStatus,
    providerMessageId: String(row.provider_message_id ?? ""),
    error: String(row.error ?? ""),
    origin: (row.origin ?? "") as MessageOrigin,
    createdAt: String(row.created_at ?? "")
  };
}

export function mapResource(row: Record<string, unknown>): KnowledgeResource {
  const text = String(row.text ?? "");
  return {
    id: Number(row.id),
    title: String(row.title ?? ""),
    resourceType: row.resource_type as KnowledgeResource["resourceType"],
    fileName: String(row.file_name ?? ""),
    active: Boolean(row.active),
    textPreview: text.slice(0, 260),
    characterCount: text.length,
    chunkCount: Number(row.chunk_count ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

export function listContacts(db: Sqlite): Contact[] {
  const rows = db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC, id DESC").all() as Record<string, unknown>[];
  return rows.map(mapContact);
}

export function getContact(db: Sqlite, id: number): Contact | null {
  const row = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapContact(row) : null;
}

export function getContactByPhone(db: Sqlite, normalizedPhone: string): Contact | null {
  const row = db.prepare("SELECT * FROM contacts WHERE normalized_phone = ?").get(normalizedPhone) as
    | Record<string, unknown>
    | undefined;
  return row ? mapContact(row) : null;
}

export function getMessage(db: Sqlite, id: number): Message | null {
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapMessage(row) : null;
}

export function getInboundMessageByProviderId(db: Sqlite, providerMessageId: string): Message | null {
  if (!providerMessageId.trim()) return null;
  const row = db
    .prepare("SELECT * FROM messages WHERE direction = 'inbound' AND provider_message_id = ? LIMIT 1")
    .get(providerMessageId) as Record<string, unknown> | undefined;
  return row ? mapMessage(row) : null;
}

export function getMessageByProviderId(db: Sqlite, providerMessageId: string): Message | null {
  if (!providerMessageId.trim()) return null;
  const row = db
    .prepare("SELECT * FROM messages WHERE provider_message_id = ? LIMIT 1")
    .get(providerMessageId) as Record<string, unknown> | undefined;
  return row ? mapMessage(row) : null;
}

export function getLatestDraftMessage(db: Sqlite, contactId: number): Message | null {
  const row = db
    .prepare("SELECT * FROM messages WHERE contact_id = ? AND direction = 'outbound' AND status = 'drafted' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(contactId) as Record<string, unknown> | undefined;
  return row ? mapMessage(row) : null;
}

export function listMessages(db: Sqlite, contactId?: number): Message[] {
  const rows = contactId
    ? (db.prepare("SELECT * FROM messages WHERE contact_id = ? ORDER BY created_at ASC, id ASC").all(contactId) as Record<
        string,
        unknown
      >[])
    : (db.prepare("SELECT * FROM messages ORDER BY created_at DESC, id DESC LIMIT 250").all() as Record<string, unknown>[]);
  return rows.map(mapMessage);
}

export function listAllMessages(db: Sqlite): Message[] {
  const rows = db.prepare("SELECT * FROM messages ORDER BY created_at ASC, id ASC").all() as Record<string, unknown>[];
  return rows.map(mapMessage);
}

export function insertMessage(
  db: Sqlite,
  input: {
    contactId: number;
    runId?: number | null;
    direction: MessageDirection;
    channel: MessageChannel;
    body: string;
    messageHash: string;
    status: MessageStatus;
    providerMessageId?: string;
    error?: string;
    origin?: MessageOrigin;
    createdAt?: string;
  }
): Message {
  const createdAt = input.createdAt || nowIso();
  const result = db
    .prepare(
      `INSERT INTO messages
        (contact_id, run_id, direction, channel, body, message_hash, status, provider_message_id, error, origin, created_at)
       VALUES
        (@contactId, @runId, @direction, @channel, @body, @messageHash, @status, @providerMessageId, @error, @origin, @createdAt)`
    )
    .run({
      contactId: input.contactId,
      runId: input.runId ?? null,
      direction: input.direction,
      channel: input.channel,
      body: input.body,
      messageHash: input.messageHash,
      status: input.status,
      providerMessageId: input.providerMessageId ?? "",
      error: input.error ?? "",
      origin: input.origin ?? "",
      createdAt
    });
  return mapMessage(db.prepare("SELECT * FROM messages WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>);
}

export function listResources(db: Sqlite): KnowledgeResource[] {
  const rows = db
    .prepare(
      `SELECT r.*, COUNT(c.id) AS chunk_count
       FROM knowledge_resources r
       LEFT JOIN knowledge_resource_chunks c ON c.resource_id = r.id
       GROUP BY r.id
       ORDER BY r.updated_at DESC, r.id DESC`
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapResource);
}

export function getResource(db: Sqlite, id: number): KnowledgeResource | null {
  const row = db
    .prepare(
      `SELECT r.*, COUNT(c.id) AS chunk_count
       FROM knowledge_resources r
       LEFT JOIN knowledge_resource_chunks c ON c.resource_id = r.id
       WHERE r.id = ?
       GROUP BY r.id`
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapResource(row) : null;
}

export function getResourceText(db: Sqlite, id: number): string {
  const row = db.prepare("SELECT text FROM knowledge_resources WHERE id = ?").get(id) as { text: string } | undefined;
  return row?.text || "";
}

export function getResourceByFileName(db: Sqlite, fileName: string): KnowledgeResource | null {
  const row = db
    .prepare(
      `SELECT r.*, COUNT(c.id) AS chunk_count
       FROM knowledge_resources r
       LEFT JOIN knowledge_resource_chunks c ON c.resource_id = r.id
       WHERE r.file_name = ?
       GROUP BY r.id
       LIMIT 1`
    )
    .get(fileName) as Record<string, unknown> | undefined;
  return row ? mapResource(row) : null;
}

export function insertResource(
  db: Sqlite,
  input: {
    title: string;
    resourceType: KnowledgeResource["resourceType"];
    fileName?: string;
    text: string;
    active?: boolean;
  }
): KnowledgeResource {
  const timestamp = nowIso();
  const result = db
    .prepare(
      `INSERT INTO knowledge_resources (title, resource_type, file_name, text, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.title, input.resourceType, input.fileName || "", input.text, input.active === false ? 0 : 1, timestamp, timestamp);
  return getResource(db, Number(result.lastInsertRowid)) as KnowledgeResource;
}

export function updateResource(
  db: Sqlite,
  id: number,
  patch: Partial<Pick<KnowledgeResource, "title" | "active">> & { text?: string }
): KnowledgeResource | null {
  const existing = getResource(db, id);
  if (!existing) return null;
  db.prepare(
    `UPDATE knowledge_resources
     SET title = ?, active = ?, text = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.title ?? existing.title,
    (patch.active ?? existing.active) ? 1 : 0,
    patch.text ?? getResourceText(db, id),
    nowIso(),
    id
  );
  return getResource(db, id);
}

export function deleteResource(db: Sqlite, id: number): void {
  db.prepare("DELETE FROM knowledge_resources WHERE id = ?").run(id);
}

export function replaceResourceChunks(db: Sqlite, resourceId: number, chunks: string[]): void {
  const tx = db.transaction((items: string[]) => {
    db.prepare("DELETE FROM knowledge_resource_chunks WHERE resource_id = ?").run(resourceId);
    const insert = db.prepare(
      "INSERT INTO knowledge_resource_chunks (resource_id, chunk_index, content) VALUES (?, ?, ?)"
    );
    items.forEach((chunk, index) => insert.run(resourceId, index, chunk));
  });
  tx(chunks);
}

export function listActiveResourceChunks(db: Sqlite): Array<{
  resourceId: number;
  title: string;
  chunkIndex: number;
  content: string;
}> {
  return db
    .prepare(
      `SELECT r.id AS resourceId, r.title, c.chunk_index AS chunkIndex, c.content
       FROM knowledge_resource_chunks c
       JOIN knowledge_resources r ON r.id = c.resource_id
       WHERE r.active = 1
       ORDER BY r.id ASC, c.chunk_index ASC`
    )
    .all() as Array<{ resourceId: number; title: string; chunkIndex: number; content: string }>;
}

export function updateContactState(
  db: Sqlite,
  id: number,
  patch: Partial<Pick<Contact, "status" | "outcomeLabel" | "optedOut" | "needsHuman" | "lastError">>
): void {
  const contact = getContact(db, id);
  if (!contact) return;
  db.prepare(
    `UPDATE contacts SET
      status = @status,
      outcome_label = @outcomeLabel,
      opted_out = @optedOut,
      needs_human = @needsHuman,
      last_error = @lastError,
      updated_at = @updatedAt
    WHERE id = @id`
  ).run({
    id,
    status: patch.status ?? contact.status,
    outcomeLabel: patch.outcomeLabel ?? contact.outcomeLabel,
    optedOut: (patch.optedOut ?? contact.optedOut) ? 1 : 0,
    needsHuman: (patch.needsHuman ?? contact.needsHuman) ? 1 : 0,
    lastError: patch.lastError ?? contact.lastError,
    updatedAt: nowIso()
  });
}

export function getConversationSummary(db: Sqlite, contactId: number): string {
  const row = db.prepare("SELECT summary FROM conversation_summaries WHERE contact_id = ?").get(contactId) as
    | { summary: string }
    | undefined;
  return row?.summary || "";
}

export function upsertConversationSummary(db: Sqlite, contactId: number, summary: string): void {
  db.prepare(
    `INSERT INTO conversation_summaries (contact_id, summary, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(contact_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`
  ).run(contactId, summary, nowIso());
}

export function activeRun(db: Sqlite): CampaignRun | null {
  const row = db
    .prepare("SELECT * FROM campaign_runs WHERE status IN ('running', 'paused') ORDER BY id DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return row ? mapRun(row) : null;
}

export function mapRun(row: Record<string, unknown>): CampaignRun {
  return {
    id: Number(row.id),
    name: String(row.name),
    status: row.status as CampaignRun["status"],
    dryRun: Boolean(row.dry_run),
    startedAt: String(row.started_at),
    completedAt: String(row.completed_at ?? ""),
    stats: JSON.parse(String(row.stats_json || "{}")) as CampaignRun["stats"]
  };
}

export function updateRunStats(db: Sqlite, runId: number, stats: CampaignRun["stats"], status?: CampaignRun["status"]): void {
  db.prepare(
    `UPDATE campaign_runs
     SET stats_json = ?, status = COALESCE(?, status), completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END
     WHERE id = ?`
  ).run(JSON.stringify(stats), status ?? null, status ?? null, nowIso(), runId);
}
