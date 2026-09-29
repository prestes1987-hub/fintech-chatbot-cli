import type { ChatMessage } from "../types.js";
import { redactSensitiveData } from "../security/redaction.js";

/**
 * Histórico da sessão (em memória). Tudo é mascarado antes de ser guardado,
 * e apenas as últimas `maxTurns` trocas são enviadas ao modelo, para limitar
 * custo e tamanho de contexto.
 */
export class ConversationHistory {
  private readonly messages: ChatMessage[] = [];

  constructor(private readonly maxTurns: number) {}

  addTurn(userMessage: string, assistantMessage: string): void {
    this.messages.push(
      { role: "user", content: redactSensitiveData(userMessage) },
      { role: "assistant", content: assistantMessage }
    );
  }

  /** Janela enviada ao modelo (cópia — o chamador não altera o histórico). */
  window(): ChatMessage[] {
    return this.messages.slice(-this.maxTurns * 2);
  }

  all(): ChatMessage[] {
    return [...this.messages];
  }

  get turnCount(): number {
    return this.messages.length / 2;
  }

  clear(): void {
    this.messages.length = 0;
  }
}
