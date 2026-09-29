import type { LlmProvider, LlmRequest } from "../types.js";
import { validateResponse } from "../security/response-guard.js";
import { normalizeText } from "../policy/text-normalizer.js";
import { defaultSleep } from "../resilience/retry.js";

/**
 * Provider offline e determinístico. Simula um modelo que segue as instruções:
 * gera respostas formais, faz streaming palavra a palavra e responde à
 * autocrítica usando o mesmo guard determinístico.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock";

  constructor(private readonly streamDelayMs = 0) {}

  async complete(request: LlmRequest): Promise<string> {
    if (request.purpose === "critique") {
      return this.critique(request);
    }
    return this.answer(request);
  }

  async stream(
    request: LlmRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const text = this.answer(request);
    const tokens = text.match(/\S+\s*/g) ?? [text];

    for (const token of tokens) {
      signal?.throwIfAborted();
      if (this.streamDelayMs > 0) await defaultSleep(this.streamDelayMs);
      onDelta(token);
    }

    return text;
  }

  private answer(request: LlmRequest): string {
    const last = request.messages.at(-1)?.content ?? "";
    const message = normalizeText(last);

    if (request.purpose === "rewrite") {
      return "Posso fornecer informações gerais sobre os produtos e serviços da instituição. " +
        "Informe, por favor, qual serviço deseja consultar.";
    }

    if (/\b(taxas?|tarifas?)\b/.test(message)) {
      return "Posso fornecer informações sobre taxas e tarifas divulgadas pela instituição. " +
        "Os valores vigentes estão disponíveis na tabela de tarifas do aplicativo oficial. " +
        "Informe qual serviço deseja consultar.";
    }

    if (/\bsaldo\b/.test(message)) {
      return "Para consultar o saldo, utilize os canais autenticados da instituição, como o aplicativo oficial. " +
        "Por segurança, nunca informe sua senha neste atendimento.";
    }

    if (/\bsenha\b/.test(message)) {
      return "Para redefinir sua senha, utilize a opção de recuperação de acesso no aplicativo oficial. " +
        "A instituição nunca solicita sua senha por este canal.";
    }

    if (/\b(investimentos?|cdb|fundos?|tesouro)\b/.test(message)) {
      return "A instituição oferece produtos de renda fixa e fundos de investimento. " +
        "As características, prazos e riscos de cada produto estão descritos no aplicativo oficial.";
    }

    if (/\b(cadastro|documentos?)\b/.test(message)) {
      return "Para atualizar seu cadastro, acesse a seção de perfil no aplicativo oficial. " +
        "Normalmente são solicitados documento de identificação com foto e comprovante de residência recente.";
    }

    const isDomain = /\b(conta|cartao|pix|transferencia|pagamento|boleto|limite|fatura|extrato|app|aplicativo|atendimento|emprestimo)\b/.test(message);
    if (!isDomain) {
      return "Este atendimento está limitado a informações e serviços relacionados à instituição financeira. " +
        "Não posso auxiliar com esse assunto.";
    }

    return "Posso auxiliar com informações sobre produtos, serviços, processos e atendimento da instituição. " +
      "Informe, por favor, qual serviço deseja consultar.";
  }

  private critique(request: LlmRequest): string {
    const content = request.messages.at(-1)?.content ?? "";
    const draft = content.split("<draft_response>")[1]?.split("</draft_response>")[0] ?? "";
    const guard = validateResponse(draft);

    return JSON.stringify({
      approved: guard.safe,
      violations: guard.violations.map(v => ({ rule: v.ruleId, description: v.reason })),
      feedback: guard.safe ? "" : "Remova o conteúdo que viola as regras e responda de forma geral."
    });
  }
}
