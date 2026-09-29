import { evaluatePolicy } from "./policy/policy-engine.js";
import { POLICY_RESPONSES } from "./policy/rules.js";
import { StreamingGuard, validateResponse, type GuardResult, type GuardViolation } from "./security/response-guard.js";
import { redactSensitiveData } from "./security/redaction.js";
import { buildContext, toLlmRequest } from "./context/context-builder.js";
import { ConversationHistory } from "./context/conversation-history.js";
import { SelfCritic, type CritiqueResult } from "./critique/self-critic.js";
import { HandoffQueue, type HandoffTicket } from "./handoff/handoff-queue.js";
import { AuditLog } from "./audit/audit-log.js";
import type { TokenBucket } from "./resilience/rate-limiter.js";
import type { Context, LlmProvider, LlmRequest, PolicyResult, UserData } from "./types.js";

/**
 * - post: exibe o rascunho em streaming e audita depois; se reprovado, a
 *   resposta é substituída na tela (melhor experiência, padrão).
 * - blocking: audita antes de exibir (mais seguro, sem streaming visível).
 * - off: sem autocrítica (apenas o guard determinístico).
 */
export type CritiqueMode = "post" | "blocking" | "off";

export interface ChatbotOptions {
  userData: UserData;
  provider: LlmProvider;
  systemPrompt: string;
  critiqueMode?: CritiqueMode;
  /** Quantas reescritas tentar antes de cair na resposta segura padrão. */
  maxRevisions?: number;
  historyMaxTurns?: number;
  /** Limite de mensagens do usuário (rejeita quando excedido). */
  userLimiter?: TokenBucket;
  handoffQueue?: HandoffQueue;
  auditLog?: AuditLog;
}

export interface TurnHandlers {
  /** Trecho de texto pronto para exibir (streaming). */
  onDelta?: (text: string) => void;
  /** O texto já exibido neste turno será substituído por uma nova versão. */
  onRevision?: (reason: string) => void;
  /** Mensagens de progresso/diagnóstico (ex.: "verificando conformidade"). */
  onStatus?: (status: string) => void;
}

export type TurnSource =
  | "policy"
  | "llm"
  | "llm_revised"
  | "safe_fallback"
  | "provider_error"
  | "rate_limited";

export interface TurnResult {
  response: string;
  source: TurnSource;
  policy?: PolicyResult;
  critiques: CritiqueResult[];
  guardViolations: GuardViolation[];
  revisions: number;
  ticket?: HandoffTicket;
  error?: string;
}

interface TurnState {
  displayed: boolean;
  handlers: TurnHandlers;
}

export class FintechChatbot {
  readonly history: ConversationHistory;
  readonly handoffQueue: HandoffQueue;
  private systemPrompt: string;
  private readonly critic: SelfCritic;
  private readonly critiqueMode: CritiqueMode;
  private readonly maxRevisions: number;
  private readonly auditLog: AuditLog;

  constructor(private readonly options: ChatbotOptions) {
    this.systemPrompt = options.systemPrompt;
    this.history = new ConversationHistory(options.historyMaxTurns ?? 10);
    this.handoffQueue = options.handoffQueue ?? new HandoffQueue();
    this.critic = new SelfCritic(options.provider);
    this.critiqueMode = options.critiqueMode ?? "post";
    this.maxRevisions = options.maxRevisions ?? 1;
    this.auditLog = options.auditLog ?? new AuditLog();
  }

  get currentSystemPrompt(): string {
    return this.systemPrompt;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  async respond(message: string, handlers: TurnHandlers = {}): Promise<TurnResult> {
    const limiter = this.options.userLimiter;
    if (limiter && !limiter.tryAcquire()) {
      const seconds = Math.ceil(limiter.msUntilAvailable() / 1000);
      const response = POLICY_RESPONSES.RATE_LIMITED.replace("{seconds}", String(seconds));
      handlers.onDelta?.(response);
      return { response, source: "rate_limited", critiques: [], guardViolations: [], revisions: 0 };
    }

    const policy = evaluatePolicy(message);
    const redacted = redactSensitiveData(message);
    const state: TurnState = { displayed: false, handlers };

    let result: TurnResult;
    if (policy.decision === "ALLOWED") {
      result = await this.answerWithModel(policy, redacted, state);
    } else {
      result = this.answerFromPolicy(policy, redacted);
      this.emit(state, result.response);
    }

    this.history.addTurn(message, result.response);
    this.auditLog.write({
      userId: this.options.userData.id,
      message: redacted,
      intent: policy.intent,
      decision: policy.decision,
      matchedRules: policy.matchedRules,
      source: result.source,
      revisions: result.revisions,
      guardViolations: result.guardViolations,
      critiques: result.critiques,
      ticket: result.ticket?.id,
      error: result.error,
      response: result.response
    });

    return result;
  }

  private answerFromPolicy(policy: PolicyResult, redactedMessage: string): TurnResult {
    const base = { policy, source: "policy" as const, critiques: [], guardViolations: [], revisions: 0 };

    switch (policy.decision) {
      case "CRITICAL": {
        const ticket = this.handoffQueue.open({
          userId: this.options.userData.id,
          intent: policy.intent,
          reason: policy.reason,
          message: redactedMessage
        });
        const template = policy.intent === "CARD_LOST" || policy.intent === "CARD_STOLEN"
          ? POLICY_RESPONSES.CARD
          : POLICY_RESPONSES.CRITICAL;
        return { ...base, ticket, response: template.replace("{ticket}", ticket.id) };
      }
      case "OUT_OF_SCOPE":
        return { ...base, response: POLICY_RESPONSES.OUT_OF_SCOPE };
      default: {
        const specific = POLICY_RESPONSES[policy.intent as keyof typeof POLICY_RESPONSES];
        return { ...base, response: specific ?? POLICY_RESPONSES.PROHIBITED };
      }
    }
  }

  private async answerWithModel(
    policy: PolicyResult,
    redactedMessage: string,
    state: TurnState
  ): Promise<TurnResult> {
    const context = buildContext({
      systemPrompt: this.systemPrompt,
      userData: this.options.userData,
      policy,
      conversation: this.history.window(),
      currentMessage: redactedMessage
    });

    const critiques: CritiqueResult[] = [];
    const guardViolations: GuardViolation[] = [];
    const live = this.critiqueMode !== "blocking";
    let feedback: string | undefined;

    try {
      for (let attempt = 0; attempt <= this.maxRevisions; attempt++) {
        if (attempt > 0 && state.displayed) {
          state.handlers.onRevision?.(feedback ?? "revisão de conformidade");
          state.displayed = false;
        }

        const purpose: LlmRequest["purpose"] = attempt === 0 ? "draft" : "rewrite";
        const draft = await this.generate(context, purpose, feedback, live, state);

        if (!draft.guard.safe) {
          guardViolations.push(...draft.guard.violations);
          feedback = describeViolations(draft.guard.violations.map(v => `${v.ruleId}: ${v.reason}`));
          state.handlers.onStatus?.(`guard bloqueou a resposta (${feedback})`);
          continue;
        }

        if (this.critiqueMode !== "off") {
          state.handlers.onStatus?.("verificando conformidade (autocrítica)...");
          const critique = await this.critic.review(context, draft.text);
          critiques.push(critique);

          if (!critique.approved) {
            feedback = describeViolations(
              critique.violations.map(v => `${v.rule}: ${v.description}`),
              critique.feedback
            );
            state.handlers.onStatus?.(`autocrítica reprovou a resposta (${feedback})`);
            continue;
          }
        }

        if (!live) this.emit(state, draft.text);
        return {
          policy,
          response: draft.text.trim(),
          source: attempt === 0 ? "llm" : "llm_revised",
          critiques,
          guardViolations,
          revisions: attempt
        };
      }

      this.replaceDisplayed(state, "nenhuma versão aprovada");
      this.emit(state, POLICY_RESPONSES.SAFE_FALLBACK);
      return {
        policy,
        response: POLICY_RESPONSES.SAFE_FALLBACK,
        source: "safe_fallback",
        critiques,
        guardViolations,
        revisions: this.maxRevisions
      };
    } catch (error) {
      // Esgotadas as tentativas de retry (ou erro não recuperável): falha segura.
      const detail = error instanceof Error ? error.message : String(error);
      state.handlers.onStatus?.(`erro no provider: ${detail}`);
      this.replaceDisplayed(state, "instabilidade no provider");
      this.emit(state, POLICY_RESPONSES.PROVIDER_ERROR);
      return {
        policy,
        response: POLICY_RESPONSES.PROVIDER_ERROR,
        source: "provider_error",
        critiques,
        guardViolations,
        revisions: 0,
        error: detail
      };
    }
  }

  /** Gera uma resposta com streaming, filtrada pelo guard incremental. */
  private async generate(
    context: Context,
    purpose: LlmRequest["purpose"],
    feedback: string | undefined,
    live: boolean,
    state: TurnState
  ): Promise<{ text: string; guard: GuardResult }> {
    const request = toLlmRequest(context, purpose, feedback);
    const guard = new StreamingGuard();
    const controller = new AbortController();

    try {
      const text = await this.options.provider.stream(request, delta => {
        const safe = guard.push(delta);
        if (guard.violation) {
          controller.abort();
        } else if (live && safe) {
          this.emit(state, safe);
        }
      }, controller.signal);

      if (guard.violation) return { text, guard: guard.violation };

      const tail = guard.flush();
      if (live && tail) this.emit(state, tail);
      return { text, guard: validateResponse(text) };
    } catch (error) {
      if (guard.violation) return { text: "", guard: guard.violation };
      throw error;
    }
  }

  private emit(state: TurnState, text: string): void {
    if (!text) return;
    state.displayed = true;
    state.handlers.onDelta?.(text);
  }

  private replaceDisplayed(state: TurnState, reason: string): void {
    if (state.displayed) {
      state.handlers.onRevision?.(reason);
      state.displayed = false;
    }
  }
}

function describeViolations(items: string[], extra?: string): string {
  return [...items, extra].filter(Boolean).join("; ") || "violação de regra não especificada";
}
