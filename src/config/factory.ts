import { FintechChatbot } from "../chatbot.js";
import { MockProvider } from "../ai/mock-provider.js";
import { OpenAIProvider } from "../ai/openai-provider.js";
import { AuditLog } from "../audit/audit-log.js";
import { perMinute } from "../resilience/rate-limiter.js";
import type { LlmProvider, UserData } from "../types.js";
import type { AppConfig } from "./config.js";

export function createProvider(
  config: AppConfig,
  onRetry?: (message: string) => void
): LlmProvider {
  if (config.forceMock || !config.openaiApiKey) {
    return new MockProvider(config.mockStreamDelayMs);
  }

  return new OpenAIProvider({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    baseUrl: config.openaiBaseUrl,
    timeoutMs: config.requestTimeoutMs,
    maxOutputTokens: config.maxOutputTokens,
    limiter: perMinute(config.apiRequestsPerMinute),
    retry: {
      maxRetries: config.maxRetries,
      baseDelayMs: config.retryBaseDelayMs,
      maxDelayMs: config.retryMaxDelayMs,
      onRetry: ({ attempt, delayMs, error }) => {
        const reason = error instanceof Error ? error.message : String(error);
        onRetry?.(`tentativa ${attempt}/${config.maxRetries} em ${delayMs} ms (${reason.slice(0, 120)})`);
      }
    }
  });
}

export function createChatbot(
  config: AppConfig,
  provider: LlmProvider,
  userData: UserData,
  systemPrompt: string,
  overrides: { userMessagesPerMinute?: number; auditLogFile?: string | null } = {}
): FintechChatbot {
  const auditFile = overrides.auditLogFile === null ? undefined : (overrides.auditLogFile ?? config.auditLogFile);

  return new FintechChatbot({
    userData,
    provider,
    systemPrompt,
    critiqueMode: config.critiqueMode,
    maxRevisions: config.maxRevisions,
    historyMaxTurns: config.historyMaxTurns,
    userLimiter: perMinute(overrides.userMessagesPerMinute ?? config.userMessagesPerMinute),
    auditLog: new AuditLog(auditFile)
  });
}
