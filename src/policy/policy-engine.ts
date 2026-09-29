import type { Intent, PolicyResult } from "../types.js";
import { classifyIntent } from "./intent-classifier.js";

interface PolicyRule {
  intent: Intent;
  decision: PolicyResult["decision"];
  reason: string;
  ruleId: string;
}

const POLICY_RULES: PolicyRule[] = [
  { ruleId: "R06", intent: "UNRECOGNIZED_TRANSACTION", decision: "CRITICAL", reason: "A mensagem indica uma transação possivelmente não reconhecida ou fraudulenta." },
  { ruleId: "R06", intent: "ACCOUNT_COMPROMISED", decision: "CRITICAL", reason: "A mensagem indica possível comprometimento da conta ou das credenciais." },
  { ruleId: "R06", intent: "CARD_LOST", decision: "CRITICAL", reason: "A mensagem indica perda do cartão e requer atendimento de segurança." },
  { ruleId: "R06", intent: "CARD_STOLEN", decision: "CRITICAL", reason: "A mensagem indica roubo, furto ou clonagem do cartão e requer atendimento de segurança." },
  { ruleId: "R11", intent: "PROMPT_INJECTION", decision: "PROHIBITED", reason: "A mensagem tenta alterar o comportamento do assistente ou obter instruções internas." },
  { ruleId: "R12", intent: "SENSITIVE_DATA_SHARED", decision: "PROHIBITED", reason: "A mensagem contém dados sensíveis que não podem ser processados neste canal." },
  { ruleId: "R04", intent: "CREDENTIAL_REQUEST", decision: "PROHIBITED", reason: "A mensagem solicita credenciais ou segredos de autenticação." },
  { ruleId: "R03", intent: "FINANCIAL_RECOMMENDATION", decision: "PROHIBITED", reason: "A mensagem solicita recomendação financeira individualizada." },
  { ruleId: "R05", intent: "THIRD_PARTY_DATA", decision: "PROHIBITED", reason: "A mensagem solicita dados de terceiros." },
  { ruleId: "R07", intent: "OUT_OF_SCOPE", decision: "OUT_OF_SCOPE", reason: "A mensagem não está relacionada ao atendimento da fintech." }
];

export function evaluatePolicy(message: string): PolicyResult {
  const intent = classifyIntent(message);
  const rule = POLICY_RULES.find(item => item.intent === intent);

  if (!rule) {
    return {
      intent,
      decision: "ALLOWED",
      reason: intent === "UNKNOWN"
        ? "A intenção não acionou regra determinística; a IA e a autocrítica avaliarão o escopo."
        : "A solicitação é compatível com o atendimento.",
      matchedRules: []
    };
  }

  return {
    intent,
    decision: rule.decision,
    reason: rule.reason,
    matchedRules: [rule.ruleId]
  };
}

export function getIntent(message: string): Intent {
  return classifyIntent(message);
}
