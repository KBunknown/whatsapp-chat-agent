import type {
  CampaignRun,
  CampaignSettings,
  CampaignProgress,
  Contact,
  ContactConversation,
  DashboardData,
  ImportSummary,
  KnowledgeResource,
  RuntimeStatus,
  SimulateInboundResult,
  SyncProgress,
  TransportState,
  WebTestSendResult,
  WhatsAppSyncResult
} from "../shared/types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<RuntimeStatus>("/api/health"),
  dashboard: () => request<DashboardData>("/api/dashboard"),
  saveSettings: (settings: Partial<CampaignSettings>) =>
    request<CampaignSettings>("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    }),
  importContacts: (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return request<ImportSummary>("/api/import", { method: "POST", body: data });
  },
  contacts: () => request<Contact[]>("/api/contacts"),
  conversation: (id: number) => request<ContactConversation>(`/api/contacts/${id}/conversation`),
  draftReply: (contactId: number, incomingText?: string) =>
    request<{ ok: boolean; conversation: ContactConversation }>(`/api/contacts/${contactId}/draft-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incomingText })
    }),
  sendDraft: (contactId: number, messageId?: number) =>
    request<{ ok: boolean; conversation: ContactConversation }>(`/api/contacts/${contactId}/send-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId })
    }),
  simulateInbound: (input: { contactId?: number; phone?: string; body: string }) =>
    request<SimulateInboundResult>("/api/inbound/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  startCampaign: (input: { dryRun: boolean; limit?: number; contactIds?: number[] }) =>
    request<CampaignRun>("/api/campaigns/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  pauseCampaign: () => request<CampaignRun | null>("/api/campaigns/pause", { method: "POST" }),
  campaignProgress: () => request<CampaignProgress>("/api/campaigns/progress"),
  initializeWeb: () => request<TransportState["web"]>("/api/transports/web/initialize", { method: "POST" }),
  reconnectWeb: () => request<TransportState["web"]>("/api/transports/web/reconnect", { method: "POST" }),
  disconnectWeb: (input: { clearSession?: boolean } = {}) =>
    request<TransportState["web"]>("/api/transports/web/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  simulateWebState: (event: "disconnected" | "auth_failure" | "ready" | "qr") =>
    request<TransportState["web"]>("/api/dev/transports/web/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event })
    }),
  testWebSend: (input: { to: string; body: string }) =>
    request<WebTestSendResult>("/api/transports/web/test-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  syncWebChats: (input: { messagesPerChat?: number; clearFirst?: boolean; contactIds?: number[]; lookupMissingChats?: boolean } = {}) =>
    request<SyncProgress>("/api/transports/web/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  syncProgress: () => request<SyncProgress>("/api/transports/web/sync/progress"),
  processPendingReplies: () =>
    request<{ ok: boolean; result: { processed: number; sent: number; drafted: number; skipped: number; failed: number } }>("/api/pending-replies/process", {
      method: "POST"
    }),
  processSelectedReplies: (contactIds: number[]) =>
    request<{ ok: boolean; result: { processed: number; sent: number; drafted: number; skipped: number; failed: number } }>("/api/pending-replies/process-selected", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds })
    }),
  runAutoSync: () =>
    request<{ ok: boolean; autoSync: DashboardData["autoSync"]; result: WhatsAppSyncResult }>("/api/auto-sync/run", {
      method: "POST"
    }),
  resources: () => request<KnowledgeResource[]>("/api/resources"),
  uploadResource: (file: File, title?: string) => {
    const data = new FormData();
    data.append("file", file);
    if (title) data.append("title", title);
    return request<KnowledgeResource>("/api/resources/upload", { method: "POST", body: data });
  },
  addTextResource: (input: { title: string; text: string; active?: boolean }) =>
    request<KnowledgeResource>("/api/resources/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }),
  updateResource: (id: number, patch: Partial<Pick<KnowledgeResource, "title" | "active">>) =>
    request<KnowledgeResource>(`/api/resources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }),
  reindexResource: (id: number) => request<KnowledgeResource>(`/api/resources/${id}/reindex`, { method: "POST" }),
  deleteResource: (id: number) => request<{ ok: boolean }>(`/api/resources/${id}`, { method: "DELETE" })
};
