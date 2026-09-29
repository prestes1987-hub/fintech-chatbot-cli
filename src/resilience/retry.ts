/** Erro HTTP do provider, com informação suficiente para decidir o retry. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfterMs?: number
  ) {
    super(`Falha no provider de IA (HTTP ${status}): ${body.slice(0, 300)}`);
    this.name = "HttpError";
  }

  get retryable(): boolean {
    // 429 por falta de créditos não se resolve com retry.
    if (this.status === 429 && /insufficient_quota/.test(this.body)) return false;
    return [408, 409, 429, 500, 502, 503, 504].includes(this.status);
  }
}

/**
 * O stream falhou depois que parte do texto já havia sido exibida.
 * Não é repetido automaticamente para não duplicar conteúdo na tela.
 */
export class StreamInterruptedError extends Error {
  constructor(readonly partialText: string, override readonly cause: unknown) {
    super("O streaming foi interrompido após o início da resposta.");
    this.name = "StreamInterruptedError";
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) return error.retryable;
  if (error instanceof StreamInterruptedError) return false;
  if (error instanceof Error) {
    // Timeout da requisição e falhas de rede do fetch (undici lança TypeError).
    if (error.name === "TimeoutError") return true;
    if (error.name === "AbortError") return false; // cancelado pelo chamador
    if (error instanceof TypeError) return true;
  }
  return false;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Executa `fn` com backoff exponencial + jitter. Respeita `Retry-After`
 * quando o servidor informa quanto tempo esperar.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const shouldRetry = options.shouldRetry ?? isRetryableError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= options.maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
      const jittered = Math.round(exponential * (0.5 + random() * 0.5));
      const serverHint = error instanceof HttpError ? error.retryAfterMs : undefined;
      const delayMs = serverHint !== undefined
        ? Math.min(serverHint, options.maxDelayMs * 4)
        : jittered;

      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
}

/** Converte os cabeçalhos `retry-after-ms` / `retry-after` em milissegundos. */
export function parseRetryAfter(headers: Headers): number | undefined {
  const ms = headers.get("retry-after-ms");
  if (ms && !Number.isNaN(Number(ms))) return Number(ms);

  const value = headers.get("retry-after");
  if (!value) return undefined;
  if (!Number.isNaN(Number(value))) return Number(value) * 1000;

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
