import type { LlmProvider, LlmRequest } from "../types.js";
import {
  HttpError,
  StreamInterruptedError,
  parseRetryAfter,
  withRetry,
  type RetryOptions
} from "../resilience/retry.js";
import type { TokenBucket } from "../resilience/rate-limiter.js";

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  retry: RetryOptions;
  /** Limitador de chamadas à API (aguarda capacidade antes de cada tentativa). */
  limiter?: TokenBucket;
  maxOutputTokens?: number;
  /** Injetável para testes. */
  fetchImpl?: typeof fetch;
}

interface ResponsesApiOutput {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}

/**
 * Provider da OpenAI Responses API via `fetch` (sem SDK), com:
 * - streaming por Server-Sent Events;
 * - histórico enviado como mensagens (não concatenado no system prompt);
 * - timeout por requisição, retry com backoff e rate limit de chamadas.
 */
export class OpenAIProvider implements LlmProvider {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.name = `openai:${options.model}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async complete(request: LlmRequest, signal?: AbortSignal): Promise<string> {
    return withRetry(async () => {
      const response = await this.post(request, false, signal);
      const data = await response.json() as ResponsesApiOutput;
      const text = data.output_text ?? extractText(data);
      if (!text.trim()) throw new Error("O provider não retornou texto.");
      return text.trim();
    }, this.options.retry);
  }

  async stream(
    request: LlmRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    return withRetry(async () => {
      let text = "";
      try {
        const response = await this.post(request, true, signal);
        for await (const event of readServerSentEvents(response)) {
          switch (event.type) {
            case "response.output_text.delta": {
              const delta = String(event.delta ?? "");
              text += delta;
              onDelta(delta);
              break;
            }
            case "error":
            case "response.failed": {
              const detail = JSON.stringify(event.error ?? event.response ?? event);
              // Erros de servidor dentro do stream são tratados como 5xx (retentáveis).
              throw new HttpError(500, detail);
            }
          }
        }
      } catch (error) {
        // Se algo já foi exibido, repetir duplicaria texto na tela.
        if (text) throw new StreamInterruptedError(text, error);
        throw error;
      }

      if (!text.trim()) throw new Error("O provider não retornou texto.");
      return text;
    }, this.options.retry);
  }

  private async post(request: LlmRequest, stream: boolean, signal?: AbortSignal): Promise<Response> {
    await this.options.limiter?.acquire(signal);

    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const body: Record<string, unknown> = {
      model: this.options.model,
      instructions: request.system,
      input: request.messages.map(message => ({ role: message.role, content: message.content })),
      stream,
      store: false
    };

    if (this.options.maxOutputTokens) {
      body.max_output_tokens = this.options.maxOutputTokens;
    }

    if (request.jsonSchema) {
      body.text = {
        format: {
          type: "json_schema",
          name: request.jsonSchema.name,
          schema: request.jsonSchema.schema,
          strict: true
        }
      };
    }

    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });

    if (!response.ok) {
      throw new HttpError(response.status, await response.text(), parseRetryAfter(response.headers));
    }

    return response;
  }
}

function extractText(data: ResponsesApiOutput): string {
  return (data.output ?? [])
    .flatMap(item => item.content ?? [])
    .filter(part => part.type === undefined || part.type === "output_text")
    .map(part => part.text ?? "")
    .join("");
}

/** Faz o parse de um corpo `text/event-stream` em objetos JSON. */
export async function* readServerSentEvents(
  response: Response
): AsyncGenerator<Record<string, any>> {
  if (!response.body) throw new Error("Resposta de streaming sem corpo.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += value;

    let separator: number;
    while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, "");

      const data = rawEvent
        .split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart())
        .join("\n");

      if (!data || data === "[DONE]") continue;
      yield JSON.parse(data);
    }

    if (done) break;
  }
}
