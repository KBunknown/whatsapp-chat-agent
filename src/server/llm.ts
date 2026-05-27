import type { RuntimeStatus } from "../shared/types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string>;
}

type FetchLike = typeof fetch;

function parseGroqKeys(env = process.env): string[] {
  const keys = new Set<string>();
  if (env.GROQ_API_KEY) keys.add(env.GROQ_API_KEY.trim());
  if (env.GROQ_API_KEYS) {
    for (const key of env.GROQ_API_KEYS.split(",")) {
      if (key.trim()) keys.add(key.trim());
    }
  }
  for (let index = 1; index <= 25; index += 1) {
    const key = env[`GROQ_API_KEY_${index}`];
    if (key?.trim()) keys.add(key.trim());
  }
  return [...keys].filter(Boolean);
}

export class GroqProvider implements LlmProvider {
  readonly name = "groq";

  constructor(
    private readonly keys = parseGroqKeys(),
    private readonly model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    private readonly fetcher: FetchLike = fetch
  ) {}

  isConfigured(): boolean {
    return this.keys.length > 0;
  }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    if (!this.isConfigured()) throw new Error("No Groq API keys configured.");

    const errors: string[] = [];
    for (const key of this.keys) {
      try {
        const response = await this.fetcher("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature: options.temperature ?? 0.45,
            max_tokens: options.maxTokens ?? 500
          })
        });

        if (!response.ok) {
          const body = await response.text();
          errors.push(`Groq ${response.status}: ${body.slice(0, 180)}`);
          continue;
        }

        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.message?.content?.trim();
        if (content) return content;
        errors.push("Groq returned an empty completion.");
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(`All Groq keys failed. ${errors.join(" | ")}`);
  }
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";

  constructor(
    private readonly baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    private readonly model = process.env.OLLAMA_MODEL || "llama3.1",
    private readonly fetcher: FetchLike = fetch
  ) {}

  async complete(messages: ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.45,
          num_predict: options.maxTokens ?? 500
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama ${response.status}: ${body.slice(0, 180)}`);
    }

    const json = (await response.json()) as { message?: { content?: string }; response?: string };
    const content = json.message?.content?.trim() || json.response?.trim();
    if (!content) throw new Error("Ollama returned an empty completion.");
    return content;
  }
}

export class LlmRouter implements LlmProvider {
  readonly name = "router";

  constructor(private readonly providers: LlmProvider[]) {}

  async complete(messages: ChatMessage[], options?: CompletionOptions): Promise<string> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.complete(messages, options);
      } catch (error) {
        errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`No LLM provider succeeded. ${errors.join(" | ")}`);
  }
}

export function createLlmRouter(): LlmRouter {
  return new LlmRouter([new GroqProvider(), new OllamaProvider()]);
}

export function getLlmRuntimeStatus(env = process.env): RuntimeStatus["llm"] {
  const groqKeys = parseGroqKeys(env);
  return {
    groqConfigured: groqKeys.length > 0,
    groqKeyCount: groqKeys.length,
    groqModel: env.GROQ_MODEL || "llama-3.3-70b-versatile",
    ollamaConfigured: env.OLLAMA_ENABLED !== "false",
    ollamaBaseUrl: env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
    ollamaModel: env.OLLAMA_MODEL || "llama3.1"
  };
}

export const __testing = {
  parseGroqKeys
};
