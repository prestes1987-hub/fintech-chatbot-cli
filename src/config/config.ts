import { existsSync, readFileSync } from "node:fs";
import type { CritiqueMode } from "../chatbot.js";
import type { UserData } from "../types.js";

export interface AppConfig {
  openaiApiKey?: string;
  openaiModel: string;
  openaiBaseUrl?: string;
  forceMock: boolean;
  systemPromptFile: string;
  userDataFile: string;
  critiqueMode: CritiqueMode;
  maxRevisions: number;
  historyMaxTurns: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  userMessagesPerMinute: number;
  apiRequestsPerMinute: number;
  maxOutputTokens?: number;
  mockStreamDelayMs: number;
  auditLogFile?: string;
  debug: boolean;
}

/** Carrega `.env` (Node >= 20.12) sem sobrescrever variáveis já definidas. */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(path);
  }
}

function int(value: string | undefined, fallback: number, min = 0): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

/** Lê `--chave=valor` / `--flag` da linha de comando. */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};
  for (const item of argv) {
    const match = item.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) args[match[1]] = match[2] ?? true;
  }
  return args;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2)
): AppConfig {
  const args = parseArgs(argv);
  const critiqueMode = String(args["critique"] ?? env.SELF_CRITIQUE_MODE ?? "post");

  return {
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    openaiModel: env.OPENAI_MODEL || "gpt-5-mini",
    openaiBaseUrl: env.OPENAI_BASE_URL || undefined,
    forceMock: args["mock"] === true || env.AI_PROVIDER === "mock",
    systemPromptFile: String(args["system-prompt"] ?? env.SYSTEM_PROMPT_FILE ?? "prompts/system-prompt.md"),
    userDataFile: String(args["user"] ?? env.USER_DATA_FILE ?? "data/user.json"),
    critiqueMode: (["post", "blocking", "off"].includes(critiqueMode) ? critiqueMode : "post") as CritiqueMode,
    maxRevisions: int(env.SELF_CRITIQUE_MAX_REVISIONS, 1),
    historyMaxTurns: int(env.HISTORY_MAX_TURNS, 10, 1),
    requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 60_000, 1000),
    maxRetries: int(env.MAX_RETRIES, 3),
    retryBaseDelayMs: int(env.RETRY_BASE_DELAY_MS, 500),
    retryMaxDelayMs: int(env.RETRY_MAX_DELAY_MS, 8_000),
    userMessagesPerMinute: int(env.RATE_LIMIT_USER_PER_MINUTE, 10, 1),
    apiRequestsPerMinute: int(env.RATE_LIMIT_API_PER_MINUTE, 30, 1),
    maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS ? int(env.OPENAI_MAX_OUTPUT_TOKENS, 0) || undefined : undefined,
    mockStreamDelayMs: int(env.MOCK_STREAM_DELAY_MS, 25),
    auditLogFile: env.AUDIT_LOG_FILE === "" ? undefined : (env.AUDIT_LOG_FILE ?? "logs/audit.jsonl"),
    debug: args["debug"] === true || env.DEBUG === "true"
  };
}

const DEMO_USER: UserData = {
  id: "USR-001",
  name: "Cliente Demonstrativo",
  accountStatus: "ACTIVE",
  customerSince: "2024-01-15",
  preferredChannel: "CLI"
};

/** Carrega e valida os dados do usuário (camada de DADOS, separada das regras). */
export function loadUserData(filePath: string): UserData {
  if (!existsSync(filePath)) return DEMO_USER;

  const data = JSON.parse(readFileSync(filePath, "utf8")) as Partial<UserData>;
  const valid =
    typeof data.id === "string" &&
    typeof data.name === "string" &&
    (data.accountStatus === "ACTIVE" || data.accountStatus === "BLOCKED") &&
    typeof data.customerSince === "string" &&
    ["CLI", "EMAIL", "WHATSAPP"].includes(String(data.preferredChannel));

  if (!valid) {
    throw new Error(`Dados de usuário inválidos em "${filePath}".`);
  }

  return data as UserData;
}
