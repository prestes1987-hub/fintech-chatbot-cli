import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Registro de auditoria em JSONL. Recebe apenas conteúdo já mascarado. */
export class AuditLog {
  constructor(private readonly filePath?: string) {
    if (filePath) mkdirSync(dirname(filePath), { recursive: true });
  }

  write(entry: Record<string, unknown>): void {
    if (!this.filePath) return;
    try {
      appendFileSync(this.filePath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
    } catch (error) {
      // Falha de auditoria não deve derrubar o atendimento.
      console.error("[auditoria] Falha ao gravar registro:", error);
    }
  }
}
