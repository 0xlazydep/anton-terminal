/**
 * DeepSeek chat client. DeepSeek's API is OpenAI-compatible, so we POST to
 * /chat/completions and use the function/tool-calling interface to get a
 * structured trade decision back (instead of parsing free-text).
 *
 * Base URL: https://api.deepseek.com
 * Endpoint: POST /v1/chat/completions
 * Models:   deepseek-v4-flash (fast tier) · deepseek-v4-pro (deep reasoning)
 */

export interface DeepSeekToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
}

export interface DeepSeekTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface DeepSeekChatRequest {
  model: string;
  messages: DeepSeekMessage[];
  tools?: DeepSeekTool[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
}

interface DeepSeekChatResponse {
  choices?: Array<{
    message?: DeepSeekMessage;
    finish_reason?: string;
  }>;
}

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class DeepSeekClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: DeepSeekClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.deepseek.com";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async chat(req: DeepSeekChatRequest): Promise<DeepSeekMessage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`deepseek ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as DeepSeekChatResponse;
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("deepseek: empty response");
      return msg;
    } finally {
      clearTimeout(timer);
    }
  }
}
