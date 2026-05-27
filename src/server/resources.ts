import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { KnowledgeResource, ResourceSnippet, ResourceType } from "../shared/types.js";
import {
  getResource,
  getResourceByFileName,
  getResourceText,
  insertResource,
  listActiveResourceChunks,
  replaceResourceChunks,
  type Sqlite
} from "./db.js";

const require = createRequire(import.meta.url);

interface PDFParser {
  getText(): Promise<{ text?: string }>;
  destroy(): Promise<void>;
}

interface PDFParseModule {
  PDFParse: new (options: { data: Buffer | Uint8Array }) => PDFParser;
}

export async function extractResourceText(input: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}): Promise<{ text: string; resourceType: ResourceType }> {
  const resourceType = inferResourceType(input.fileName, input.mimeType);
  if (resourceType === "pdf") {
    const { PDFParse } = require("pdf-parse") as PDFParseModule;
    const parser = new PDFParse({ data: input.buffer });
    try {
      const result = await parser.getText();
      return { text: normalizeResourceText(result.text || ""), resourceType };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  return { text: normalizeResourceText(input.buffer.toString("utf8")), resourceType };
}

export async function ingestResource(
  db: Sqlite,
  input: {
    title: string;
    text: string;
    resourceType: ResourceType;
    fileName?: string;
    active?: boolean;
  }
): Promise<KnowledgeResource> {
  const text = normalizeResourceText(input.text);
  if (!text) throw new Error("The resource did not contain readable text.");

  const resource = insertResource(db, {
    title: input.title.trim() || input.fileName || "Campaign resource",
    text,
    resourceType: input.resourceType,
    fileName: input.fileName || "",
    active: input.active
  });
  replaceResourceChunks(db, resource.id, chunkResourceText(text));
  return getResource(db, resource.id) as KnowledgeResource;
}

export async function reindexResource(db: Sqlite, resourceId: number): Promise<KnowledgeResource> {
  const resource = getResource(db, resourceId);
  if (!resource) throw new Error("Resource not found.");
  replaceResourceChunks(db, resourceId, chunkResourceText(getResourceText(db, resourceId)));
  return getResource(db, resourceId) as KnowledgeResource;
}

export async function seedManifestoResource(db: Sqlite, cwd = process.cwd()): Promise<KnowledgeResource | null> {
  const fileName = "Kwaku Bonsu Wiredu - Technical Assistant to the Founder.pdf";
  if (getResourceByFileName(db, fileName)) return null;

  const filePath = path.resolve(cwd, fileName);
  try {
    const buffer = await fs.readFile(filePath);
    const extracted = await extractResourceText({ buffer, fileName, mimeType: "application/pdf" });
    return await ingestResource(db, {
      title: "Kwaku Bonsu Wiredu Manifesto",
      fileName,
      text: extracted.text,
      resourceType: extracted.resourceType,
      active: true
    });
  } catch (error) {
    console.warn(`Could not ingest manifesto resource: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function findRelevantResourceSnippets(db: Sqlite, query: string, limit = 4): ResourceSnippet[] {
  const chunks = listActiveResourceChunks(db);
  if (!chunks.length) return [];

  const tokens = tokenize(query);
  const scored = chunks
    .map((chunk) => {
      const content = chunk.content.toLowerCase();
      const title = chunk.title.toLowerCase();
      const score = tokens.reduce((total, token) => {
        const contentHits = countToken(content, token);
        const titleHits = title.includes(token) ? 2 : 0;
        return total + contentHits + titleHits;
      }, 0);
      return {
        resourceId: chunk.resourceId,
        title: chunk.title,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        score
      };
    })
    .sort((left, right) => right.score - left.score || left.resourceId - right.resourceId || left.chunkIndex - right.chunkIndex);

  const useful = scored.filter((snippet) => snippet.score > 0).slice(0, limit);
  return useful.length ? useful : scored.slice(0, Math.min(2, limit));
}

export function chunkResourceText(text: string, maxChars = 1400, overlapChars = 180): string[] {
  const paragraphs = normalizeResourceText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }
    for (let index = 0; index < paragraph.length; index += maxChars - overlapChars) {
      chunks.push(paragraph.slice(index, index + maxChars).trim());
    }
    current = "";
  }

  if (current) chunks.push(current);
  return chunks.slice(0, 200);
}

export function normalizeResourceText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function inferResourceType(fileName: string, mimeType = ""): ResourceType {
  const extension = path.extname(fileName).toLowerCase();
  if (mimeType.includes("pdf") || extension === ".pdf") return "pdf";
  if (extension === ".md" || extension === ".markdown") return "markdown";
  return "text";
}

function tokenize(text: string): string[] {
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "but",
    "can",
    "for",
    "from",
    "have",
    "how",
    "into",
    "not",
    "the",
    "this",
    "what",
    "when",
    "where",
    "why",
    "with",
    "you",
    "your"
  ]);
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !stopWords.has(token))
    )
  ].slice(0, 40);
}

function countToken(content: string, token: string): number {
  let count = 0;
  let index = content.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(token, index + token.length);
  }
  return count;
}
