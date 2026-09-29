export type PolicyDecision =
  | "ALLOWED"
  | "PROHIBITED"
  | "OUT_OF_SCOPE"
  | "CRITICAL";

export type Intent =
  | "UNRECOGNIZED_TRANSACTION"
  | "ACCOUNT_COMPROMISED"
  | "CARD_LOST"
  | "CARD_STOLEN"
  | "PROMPT_INJECTION"
  | "SENSITIVE_DATA_SHARED"
  | "CREDENTIAL_REQUEST"
  | "FINANCIAL_RECOMMENDATION"
  | "THIRD_PARTY_DATA"
  | "OUT_OF_SCOPE"
  | "OPERATIONAL_REQUEST"
  | "UNKNOWN";

export interface UserData {
  id: string;
  name: string;
  accountStatus: "ACTIVE" | "BLOCKED";
  customerSince: string;
  preferredChannel: "CLI" | "EMAIL" | "WHATSAPP";
}

export interface PolicyResult {
  intent: Intent;
  decision: PolicyDecision;
  reason: string;
  matchedRules: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Modelo de contexto em camadas. Cada camada tem uma origem e um nível de
 * confiança diferentes e é renderizada em uma seção delimitada do prompt.
 */
export interface Context {
  /** Camada 1 — instruções globais (system prompt customizável). */
  globalInstructions: string;
  /** Camada 2 — regras de negócio (código, não customizáveis em runtime). */
  rules: string[];
  /** Camada 3 — dados do usuário (dados, nunca instruções). */
  userData: UserData;
  /** Decisão da policy layer para a mensagem atual. */
  policy: PolicyResult;
  /** Histórico da sessão (já mascarado e limitado por janela). */
  conversation: ChatMessage[];
  /** Mensagem atual (já mascarada). */
  currentMessage: string;
}

export interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

/** Requisição neutra de fornecedor enviada a um LlmProvider. */
export interface LlmRequest {
  system: string;
  messages: ChatMessage[];
  /** Quando presente, o provider deve devolver JSON aderente ao schema. */
  jsonSchema?: JsonSchemaFormat;
  /** Rótulo usado em logs/mocks ("draft", "rewrite", "critique"). */
  purpose: "draft" | "rewrite" | "critique";
}

export interface LlmProvider {
  readonly name: string;
  /** Geração com streaming. Retorna o texto completo ao final. */
  stream(
    request: LlmRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<string>;
  /** Geração sem streaming (usada pela autocrítica). */
  complete(request: LlmRequest, signal?: AbortSignal): Promise<string>;
}
