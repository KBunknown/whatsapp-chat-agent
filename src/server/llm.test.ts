import { describe, expect, it, vi } from "vitest";
import { GroqProvider, LlmRouter, OllamaProvider, __testing } from "./llm.js";

describe("LLM providers", () => {
  it("parses comma-separated and numbered Groq keys", () => {
    expect(
      __testing.parseGroqKeys({
        GROQ_API_KEYS: "a,b",
        GROQ_API_KEY_1: "c",
        GROQ_API_KEY: "a"
      } as NodeJS.ProcessEnv)
    ).toEqual(["a", "b", "c"]);
  });

  it("rotates Groq keys until one succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad key", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const provider = new GroqProvider(["bad", "good"], "test-model", fetcher as typeof fetch);
    await expect(provider.complete([{ role: "user", content: "hi" }])).resolves.toBe("hello");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back from Groq to Ollama", async () => {
    const groq = { name: "groq", complete: vi.fn().mockRejectedValue(new Error("down")) };
    const ollama = { name: "ollama", complete: vi.fn().mockResolvedValue("local reply") };
    const router = new LlmRouter([groq, ollama]);
    await expect(router.complete([{ role: "user", content: "hi" }])).resolves.toBe("local reply");
  });

  it("reads Ollama chat responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "ollama reply" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const provider = new OllamaProvider("http://localhost:11434", "llama", fetcher as typeof fetch);
    await expect(provider.complete([{ role: "user", content: "hi" }])).resolves.toBe("ollama reply");
  });
});
