import type { Sqlite } from "./db.js";
import { chooseAndNormalizePhone } from "./phone.js";
import { nowIso } from "./time.js";
import type { ImportSummary } from "../shared/types.js";
import { readSheet } from "read-excel-file/node";

export interface ParsedContactRow {
  fullName: string;
  whatsappNumber: string;
  otherNumber: string;
  activeEmail: string;
  programOfStudy: string;
  level: string;
  institution: string;
}

const headerAliases: Record<keyof ParsedContactRow, string[]> = {
  fullName: ["full name surname first", "full name", "name", "student name"],
  whatsappNumber: ["whatsapp number", "whatsapp", "wa number", "phone number"],
  otherNumber: ["other number", "alternate number", "alternative number", "other phone"],
  activeEmail: ["active email address", "email", "email address"],
  programOfStudy: ["program of study", "programme of study", "program", "programme", "course"],
  level: ["level", "year"],
  institution: ["institution", "school", "university"]
};

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function parseWorkbookBufferAsync(buffer: Buffer): Promise<ParsedContactRow[]> {
  const rows = await readSheet(buffer);
  return worksheetRowsToContacts(rows);
}

export function worksheetRowsToContacts(rawRows: unknown): ParsedContactRow[] {
  const rows = coerceWorksheetRows(rawRows);
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return [];

  const headerByColumn = new Map<number, string>();
  headerRow.forEach((cell, index) => {
    headerByColumn.set(index, normalizeHeader(valueToString(cell)));
  });

  return dataRows.flatMap((row) => {
    const normalizedEntries = new Map<string, unknown>();
    row.forEach((cell, index) => {
      const header = headerByColumn.get(index);
      if (header) normalizedEntries.set(header, cell);
    });
    const pick = (field: keyof ParsedContactRow): string => {
      for (const alias of headerAliases[field]) {
        const value = normalizedEntries.get(normalizeHeader(alias));
        if (value !== undefined) return valueToString(value);
      }
      return "";
    };

    const parsed = {
      fullName: pick("fullName"),
      whatsappNumber: pick("whatsappNumber"),
      otherNumber: pick("otherNumber"),
      activeEmail: pick("activeEmail"),
      programOfStudy: pick("programOfStudy"),
      level: pick("level"),
      institution: pick("institution")
    };
    return Object.values(parsed).some(Boolean) ? [parsed] : [];
  });
}

function coerceWorksheetRows(rawRows: unknown): unknown[][] {
  if (!Array.isArray(rawRows)) return [];
  const first = rawRows[0] as { data?: unknown } | undefined;
  if (first && typeof first === "object" && Array.isArray(first.data)) {
    return coerceWorksheetRows(first.data);
  }
  return rawRows.map((row) => (Array.isArray(row) ? row : Object.values((row || {}) as Record<string, unknown>)));
}

export function importParsedContacts(db: Sqlite, rows: ParsedContactRow[]): ImportSummary {
  const summary: ImportSummary = {
    totalRows: rows.length,
    created: 0,
    updated: 0,
    needsReview: 0,
    skipped: 0,
    errors: []
  };

  const insert = db.prepare(
    `INSERT INTO contacts
      (full_name, whatsapp_number, other_number, active_email, program_of_study, level, institution,
       selected_phone, normalized_phone, phone_source, import_notes, status, outcome_label, created_at, updated_at)
     VALUES
      (@fullName, @whatsappNumber, @otherNumber, @activeEmail, @programOfStudy, @level, @institution,
       @selectedPhone, @normalizedPhone, @phoneSource, @importNotes, @status, @outcomeLabel, @createdAt, @updatedAt)`
  );

  const update = db.prepare(
    `UPDATE contacts SET
      full_name = @fullName,
      whatsapp_number = @whatsappNumber,
      other_number = @otherNumber,
      active_email = @activeEmail,
      program_of_study = @programOfStudy,
      level = @level,
      institution = @institution,
      selected_phone = @selectedPhone,
      phone_source = @phoneSource,
      import_notes = @importNotes,
      status = CASE WHEN status = 'needs_review' AND @status = 'imported' THEN 'imported' ELSE status END,
      updated_at = @updatedAt
     WHERE normalized_phone = @normalizedPhone`
  );

  const tx = db.transaction((items: ParsedContactRow[]) => {
    for (const [index, row] of items.entries()) {
      const phone = chooseAndNormalizePhone(row.whatsappNumber, row.otherNumber);
      const now = nowIso();
      const status = phone.normalizedPhone && phone.phoneSource !== "none" ? "imported" : "needs_review";
      const outcomeLabel = status === "needs_review" ? "needs_human" : "not_contacted";
      const payload = {
        ...row,
        selectedPhone: phone.selectedPhone,
        normalizedPhone: phone.normalizedPhone,
        phoneSource: phone.phoneSource,
        importNotes: phone.notes.join(" "),
        status,
        outcomeLabel,
        createdAt: now,
        updatedAt: now
      };

      if (!row.fullName && !phone.normalizedPhone) {
        summary.skipped += 1;
        summary.errors.push(`Row ${index + 2} skipped: missing both name and phone number.`);
        continue;
      }

      if (!phone.normalizedPhone) {
        summary.needsReview += 1;
        insert.run(payload);
        summary.created += 1;
        continue;
      }

      const existing = db.prepare("SELECT id FROM contacts WHERE normalized_phone = ?").get(phone.normalizedPhone);
      if (existing) {
        update.run(payload);
        summary.updated += 1;
      } else {
        insert.run(payload);
        summary.created += 1;
      }

      if (phone.phoneSource === "other") summary.needsReview += 1;
    }
  });

  tx(rows);
  return summary;
}

export async function importWorkbookBuffer(db: Sqlite, buffer: Buffer): Promise<ImportSummary> {
  return importParsedContacts(db, await parseWorkbookBufferAsync(buffer));
}
