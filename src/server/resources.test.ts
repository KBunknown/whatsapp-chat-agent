import { describe, expect, it } from "vitest";
import { listResources, openDatabase } from "./db.js";
import { findRelevantResourceSnippets, ingestResource } from "./resources.js";

describe("knowledge resources", () => {
  it("stores resources, chunks them, and finds relevant snippets", async () => {
    const db = openDatabase(":memory:");
    const resource = await ingestResource(db, {
      title: "Manifesto reading",
      resourceType: "manual",
      text: "Kwaku's manifesto focuses on review, briefing, and follow-up systems for trusted service."
    });

    expect(resource).toMatchObject({ title: "Manifesto reading", active: true, chunkCount: 1 });
    expect(listResources(db)[0]).toMatchObject({ characterCount: expect.any(Number), chunkCount: 1 });

    const snippets = findRelevantResourceSnippets(db, "What is Kwaku's follow-up system?", 2);
    expect(snippets[0]).toMatchObject({
      resourceId: resource.id,
      title: "Manifesto reading",
      content: expect.stringContaining("follow-up systems")
    });
  });
});
