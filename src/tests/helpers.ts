import type { LlmProvider, LlmRequest, UserData } from "../types.js";
import { FintechChatbot, type ChatbotOptions } from "../chatbot.js";

export const testUser: UserData = {
  id: "USR-TEST",
  name: "Teste",
  accountStatus: "ACTIVE",
  customerSince: "2025-01-01",
  preferredChannel: "CLI"
};

type Reply = string | Error | ((request: LlmRequest) => string);

/**
 * Provider roteirizado: devolve respostas de geração e de autocrítica em fila
 * e registra todas as requisições para inspeção.
 */
export class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly requests: LlmRequest[] = [];

  constructor(
    private readonly generations: Reply[] = ["Resposta institucional."],
    private readonly critiques: Reply[] = [JSON.stringify({ approved: true, violations: [], feedback: "" })]
  ) {}

  private next(queue: Reply[], request: LlmRequest): string {
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(request) : reply;
  }

  async complete(request: LlmRequest): Promise<string> {
    this.requests.push(request);
    return this.next(request.purpose === "critique" ? this.critiques : this.generations, request);
  }

  async stream(request: LlmRequest, onDelta: (delta: string) => void, signal?: AbortSignal): Promise<string> {
    this.requests.push(request);
    const text = this.next(this.generations, request);
    for (const token of text.match(/\S+\s*/g) ?? []) {
      signal?.throwIfAborted();
      onDelta(token);
    }
    return text;
  }

  get generationCalls(): number {
    return this.requests.filter(r => r.purpose !== "critique").length;
  }

  get critiqueCalls(): number {
    return this.requests.filter(r => r.purpose === "critique").length;
  }
}

export function makeBot(provider: LlmProvider, options: Partial<ChatbotOptions> = {}) {
  return new FintechChatbot({
    userData: testUser,
    provider,
    systemPrompt: "Você é um assistente formal de testes.",
    ...options
  });
}

export const REJECT = (feedback = "Remova a recomendação.") =>
  JSON.stringify({ approved: false, violations: [{ rule: "R03", description: "recomendação" }], feedback });
