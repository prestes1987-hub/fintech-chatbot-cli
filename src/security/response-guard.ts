import { normalizeText } from "../policy/text-normalizer.js";

export interface GuardViolation {
  ruleId: string;
  reason: string;
}

export interface GuardResult {
  safe: boolean;
  violations: GuardViolation[];
}

// Negação logo antes do verbo ("nunca informe sua senha", "não recomendamos")
// não é violação — é justamente a orientação correta.
const NOT_NEGATED = "(?<!\\b(?:nao|nunca|jamais)\\s(?:\\S+\\s){0,4})";

// Os padrões operam sobre texto normalizado (sem acento, minúsculo).
const UNSAFE_PATTERNS: Array<{ pattern: RegExp; ruleId: string; reason: string }> = [
  {
    ruleId: "R03",
    pattern: new RegExp(`${NOT_NEGATED}\\b(recomendo|recomendamos|sugiro|sugerimos|aconselho|aconselhamos)\\b`),
    reason: "A resposta contém possível recomendação financeira."
  },
  {
    ruleId: "R03",
    pattern: new RegExp(`${NOT_NEGATED}\\b(invista|compre|aplique|resgate|contrate) (em|no|na|nos|nas|o|a|os|as|agora|ja|seu|sua)\\b`),
    reason: "A resposta contém ordem de investimento ou contratação."
  },
  {
    ruleId: "R03",
    pattern: new RegExp(`${NOT_NEGATED}\\b(voce )?(deveria|deve) (investir|aplicar|comprar|vender|contratar|resgatar)\\b`),
    reason: "A resposta orienta o cliente a uma decisão financeira."
  },
  {
    ruleId: "R03",
    pattern: /\b(melhor opcao|mais indicad[oa]) (para voce|para o senhor|para a senhora|para seu perfil|no seu caso)\b|\b(retorno|rentabilidade) garantid[oa]\b|\bsem (nenhum )?risco\b/,
    reason: "A resposta personaliza a escolha de produto ou promete retorno."
  },
  {
    ruleId: "R04",
    pattern: /\b(sua senha e|seu pin e|seu cvv e|seu token e|seu codigo e)\b/,
    reason: "A resposta parece revelar uma credencial."
  },
  {
    ruleId: "R04",
    pattern: new RegExp(`${NOT_NEGATED}\\b(informe|envie|digite|me passe|compartilhe|forneca|confirme|responda com)\\b.{0,30}\\b(senha|pin|cvv|cvc|token|codigo (de verificacao|mfa|sms|de seguranca))\\b`),
    reason: "A resposta solicita uma credencial."
  },
  {
    ruleId: "R01",
    pattern: /\b(mano|valeu|vlw|blz|vc|tmj|kkk+|rsrs|parca|brother)\b/,
    reason: "A resposta usa linguagem informal."
  },
  {
    ruleId: "R11",
    pattern: /\b(global_instructions|business_rules|user_data|policy_decision|system prompt|prompt do sistema|minhas instrucoes internas|classificador de intencao)\b|\br(0[1-9]|1[0-2])\b:/,
    reason: "A resposta expõe detalhes internos do sistema."
  }
];

export function validateResponse(response: string): GuardResult {
  const normalized = normalizeText(response);
  const violations = UNSAFE_PATTERNS
    .filter(rule => rule.pattern.test(normalized))
    .map(({ ruleId, reason }) => ({ ruleId, reason }));

  return { safe: violations.length === 0, violations };
}

/**
 * Guard incremental para streaming. Retém os últimos `holdback` caracteres
 * antes de liberá-los ao usuário, de modo que um padrão proibido que atravesse
 * dois chunks ainda seja detectado antes de ser exibido.
 */
export class StreamingGuard {
  private buffer = "";
  private released = 0;
  private blocked: GuardResult | null = null;

  constructor(private readonly holdback = 80) {}

  /** Recebe um delta e devolve o trecho seguro para exibir (pode ser ""). */
  push(delta: string): string {
    if (this.blocked) return "";

    this.buffer += delta;
    const check = validateResponse(this.buffer);
    if (!check.safe) {
      this.blocked = check;
      return "";
    }

    const safeUntil = Math.max(this.released, this.buffer.length - this.holdback);
    const chunk = this.buffer.slice(this.released, safeUntil);
    this.released = safeUntil;
    return chunk;
  }

  /** Libera o restante retido quando o stream termina sem violação. */
  flush(): string {
    if (this.blocked) return "";
    const chunk = this.buffer.slice(this.released);
    this.released = this.buffer.length;
    return chunk;
  }

  get violation(): GuardResult | null {
    return this.blocked;
  }
}
