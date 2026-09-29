import { randomUUID } from "node:crypto";
import type { Intent } from "../types.js";

export interface HandoffTicket {
  id: string;
  createdAt: string;
  userId: string;
  intent: Intent;
  reason: string;
  /** Mensagem já mascarada. */
  message: string;
}

/**
 * Fila de encaminhamento para atendimento humano. Em produção seria uma
 * integração com a ferramenta de CRM/ticket; aqui mantém os casos em memória
 * para demonstração e auditoria.
 */
export class HandoffQueue {
  private readonly tickets: HandoffTicket[] = [];

  open(data: Omit<HandoffTicket, "id" | "createdAt">): HandoffTicket {
    const ticket: HandoffTicket = {
      id: `ATD-${randomUUID().slice(0, 8).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      ...data
    };
    this.tickets.push(ticket);
    return ticket;
  }

  list(): HandoffTicket[] {
    return [...this.tickets];
  }
}
