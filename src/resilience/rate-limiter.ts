import { defaultSleep } from "./retry.js";

/**
 * Token bucket. Usado em dois pontos:
 * - mensagens do usuário (rejeita quando excede: proteção contra abuso/custo);
 * - chamadas à API (aguarda até haver capacidade: evita HTTP 429).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    refillPerMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
    this.refillPerMs = refillPerMinute / 60_000;
  }

  private refill(): void {
    const current = this.now();
    const elapsed = current - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = current;
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milissegundos até haver pelo menos um token disponível. */
  msUntilAvailable(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillPerMs);
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    while (!this.tryAcquire()) {
      signal?.throwIfAborted();
      await this.sleep(this.msUntilAvailable());
    }
  }
}

/** Cria um limitador por minuto (capacidade = limite, recarga contínua). */
export function perMinute(limit: number, now?: () => number, sleep?: (ms: number) => Promise<void>) {
  return new TokenBucket(limit, limit, now, sleep);
}
