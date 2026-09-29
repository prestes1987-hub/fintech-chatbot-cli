import type { Intent } from "../types.js";
import { normalizeText } from "./text-normalizer.js";

export type { Intent };

interface IntentRule {
  intent: Intent;
  patterns: RegExp[];
}

// Os padrões operam sobre texto normalizado (sem acento, minúsculo).
const FINANCIAL_PRODUCTS =
  "investimentos?|aplicac(?:ao|oes)|cdbs?|acoes|acao|fundos?|tesouro|cripto(?:moedas?)?|bitcoin|" +
  "emprestimos?|financiamentos?|consorcios?|previdencia|lcis?|lcas?|poupanca|dolar|renda fixa|renda variavel|" +
  "cartao|cartoes|seguros?|produtos?|planos?";

const RECOMMENDATION_SIGNALS =
  "melhor(?! (?:forma|maneira|jeito|canal|horario|modo|dia))|ideal|mais indicad[oa]s?|mais vantajos[oa]s?|mais rentave(?:l|is)|" +
  "recomenda|recomende|recomendaria|sugere|sugira|sugeriria|aconselha|aconselharia|indica";

const THIRD_PARTIES =
  "outro cliente|outra pessoa|outra conta|terceiros?|vizinh[oa]|espos[oa]|marido|mae|pai|filh[oa]|irma|irmao|" +
  "amig[oa]|namorad[oa]|chefe|colega|sogr[oa]|primo|prima|tio|tia";

const INTENT_RULES: IntentRule[] = [
  // --- Casos críticos: têm prioridade sobre qualquer outra intenção. ---
  {
    intent: "UNRECOGNIZED_TRANSACTION",
    patterns: [
      /\b(nao reconheco|nao fiz|nao autorizei|nao realizei)\b.*\b(pix|transferencias?|pagamentos?|transac(ao|oes)|compras?|investimentos?|aplicac(ao|oes)|lancamentos?|movimentac(ao|oes)|debitos?|cobrancas?|saques?)\b/,
      /\b(pix|transferencias?|pagamentos?|transac(ao|oes)|compras?|debitos?|cobrancas?|saques?)\b.*\b(nao reconheco|nao fiz|nao autorizei|nao realizei)\b/,
      /\b(fraude|golpe|golpista|estelionato|transacao suspeita|pix suspeito)\b/,
      /\b(cobrancas?|compras?|debitos?)\b (indevid[oa]s?|desconhecid[oa]s?)\b/
    ]
  },
  {
    intent: "ACCOUNT_COMPROMISED",
    patterns: [
      /\bconta\b.*\b(invadida|comprometida|hackeada|clonada)\b/,
      /\b(invadida|comprometida|hackeada)\b.*\bconta\b/,
      /\b(invadiu|invadiram|hackeou|hackearam|acessaram)\b.*\bminha conta\b/,
      /\b(roubaram|vazaram|vazou|descobriram)\b.*\b(minha senha|meus dados|meu token)\b/,
      /\b(minha senha|meus dados|meu token)\b.*\b(vazou|vazaram|foi roubad[oa]|foram roubados)\b/
    ]
  },
  {
    intent: "CARD_LOST",
    patterns: [
      /\b(perdi|perdeu|sumiu|desapareceu|extraviei)\b.*\bcart(ao|oes)\b/,
      /\bcart(ao|oes)\b.*\b(perdi|perdido|sumiu|sumido|desapareceu|extraviado)\b/,
      /\b(nao encontro|nao acho|nao estou mais com)\b.*\bcartao\b/
    ]
  },
  {
    intent: "CARD_STOLEN",
    patterns: [
      /\b(roubaram|roubado|roubada|furtaram|furtado|furtada|clonaram|clonado|clonagem)\b.*\bcart(ao|oes)\b/,
      /\bcart(ao|oes)\b.*\b(roubaram|roubado|furtaram|furtado|clonaram|clonado|clonagem)\b/
    ]
  },
  // --- Segurança do próprio assistente. ---
  {
    intent: "PROMPT_INJECTION",
    patterns: [
      /\b(ignore|ignora|ignorar|desconsidere|desconsiderar|esqueca|esquecer|burle)\b.*\b(regras|instrucoes|politicas|orientacoes|prompt|restricoes|anteriores)\b/,
      /\b(mostre|mostra|revele|exiba|repita|imprima|liste|qual e|quais sao)\b.*\b(prompt|instrucoes internas|regras internas|instrucoes do sistema|suas instrucoes|suas regras)\b/,
      /\b(system prompt|modo desenvolvedor|developer mode|jailbreak|modo dan)\b/,
      /\b(finja|finge|aja como|atue como|voce agora e|a partir de agora voce|faca de conta)\b/
    ]
  },
  {
    // O cliente enviou um segredo/dado sensível. A mensagem não segue para a IA.
    intent: "SENSITIVE_DATA_SHARED",
    patterns: [
      /\b(senha|pin|cvv|cvc|token|codigo( de verificacao| de seguranca| mfa| sms)?)\b[^0-9]{0,25}\d{3,}/,
      /\b(?:\d[ .-]?){13,19}\b/,
      /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/
    ]
  },
  {
    intent: "CREDENTIAL_REQUEST",
    patterns: [
      /\b(informe|informar|me passe|me passa|me diga|me diz|me mostre|forneca|enviar|envie|digite|qual e)\b.*\b(senha|password|pin|cvv|cvc|token|codigo mfa|codigo de verificacao|codigo de seguranca)\b/,
      /\b(senha|password|pin|cvv|cvc|token|codigo mfa|codigo de verificacao)\b.*\b(informe|me passe|me diga|forneca|enviar|envie|digite)\b/
    ]
  },
  {
    intent: "FINANCIAL_RECOMMENDATION",
    patterns: [
      new RegExp(`\\b(${RECOMMENDATION_SIGNALS})\\b.*\\b(${FINANCIAL_PRODUCTS})\\b`),
      new RegExp(`\\b(${FINANCIAL_PRODUCTS})\\b.*\\b(${RECOMMENDATION_SIGNALS})\\b`),
      new RegExp(`\\b(${FINANCIAL_PRODUCTS})\\b.*\\b(para mim|pro meu perfil|para o meu perfil|no meu caso)\\b`),
      /\b(devo|deveria|compensa|vale a pena|e bom|e uma boa)\b.*\b(investir|aplicar|comprar|vender|resgatar|contratar|pegar|financiar)\b/,
      /\b(investimento|aplicacao|emprestimo|financiamento)\b.*\b(devo|deveria|escolher)\b/,
      /\b(onde|no que|em que)\b.*\b(invisto|investir|aplico|aplicar)\b/,
      /\b(onde|no que|em que)\b.*\b(coloco|colocar|ponho|deixo|deixar)\b.*\b(dinheiro|reserva|economias|grana|salario)\b/,
      /\b(compro|vendo|aplico|invisto|resgato)\b.*\b(acoes|cdb|fundo|tesouro|cripto|bitcoin|dolar|lci|lca|poupanca)\b/,
      /\b(vai|vao) (subir|cair|valorizar|desvalorizar|render mais)\b/
    ]
  },
  {
    intent: "THIRD_PARTY_DATA",
    patterns: [
      // "conta"/"cartão" ficam de fora para não bloquear "abrir conta para meu filho".
      new RegExp(`\\b(dados|saldo|extrato|cpf|telefone|endereco|movimentac(ao|oes))\\b.*\\b(${THIRD_PARTIES})\\b`),
      new RegExp(`\\b(${THIRD_PARTIES})\\b.*\\b(dados|saldo|extrato|cpf|telefone|endereco|movimentac(ao|oes))\\b`)
    ]
  },
  {
    intent: "OUT_OF_SCOPE",
    patterns: [
      /\b(receita (de|para)|futebol|piada|previsao do tempo|clima (de|em|hoje)|programar|codigo em (python|java|javascript)|historia do brasil|qual (e )?a capital|filmes?|musicas?|horoscopo|signo|eleicao|partido politico|dever de casa|redacao|poema|traduza|traduzir)\b/
    ]
  },
  {
    intent: "OPERATIONAL_REQUEST",
    patterns: [
      /\b(saldo|extrato|taxas?|tarifas?|transferencias?|pix|ted|cartao|cartoes|cadastro|documentos?|limite|pagamentos?|boletos?|conta|senha|aplicativo|app|fatura|investimentos?|emprestimos?|atendimento|horario|rendimento|chave)\b/
    ]
  }
];

export interface IntentMatch {
  intent: Intent;
  /** Padrão que disparou a classificação (útil para auditoria). */
  pattern?: string;
}

export function classifyIntentDetailed(message: string): IntentMatch {
  const normalized = normalizeText(message);

  for (const rule of INTENT_RULES) {
    const pattern = rule.patterns.find(item => item.test(normalized));
    if (pattern) {
      return { intent: rule.intent, pattern: pattern.source };
    }
  }

  return { intent: "UNKNOWN" };
}

export function classifyIntent(message: string): Intent {
  return classifyIntentDetailed(message).intent;
}
