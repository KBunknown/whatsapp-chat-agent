import type { Contact } from "../shared/types.js";

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function contactsToCsv(contacts: Contact[]): string {
  const headers = [
    "Full Name",
    "WhatsApp Number",
    "Other Number",
    "Active Email Address",
    "Program of study",
    "Level",
    "Institution",
    "Selected Phone",
    "Normalized Phone",
    "Phone Source",
    "Status",
    "Outcome",
    "Opted Out",
    "Needs Human",
    "Last Error"
  ];
  const rows = contacts.map((contact) => [
    contact.fullName,
    contact.whatsappNumber,
    contact.otherNumber,
    contact.activeEmail,
    contact.programOfStudy,
    contact.level,
    contact.institution,
    contact.selectedPhone,
    contact.normalizedPhone,
    contact.phoneSource,
    contact.status,
    contact.outcomeLabel,
    contact.optedOut ? "yes" : "no",
    contact.needsHuman ? "yes" : "no",
    contact.lastError
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}
