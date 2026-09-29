import test from "node:test";
import assert from "node:assert/strict";
import { HttpError, StreamInterruptedError, isRetryableError, parseRetryAfter, withRetry } from "../resilience/retry.js";
import { TokenBucket } from "../resilience/rate-limiter.js";

const noSleep = async () => {};

test("retry repete erros transitórios com backoff exponencial", async () => {
  const delays: number[] = [];
  let calls = 0;

  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new HttpError(503, "indisponível");
    return "ok";
  }, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000, sleep: async ms => { delays.push(ms); }, random: () => 1 });

  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
});

test("retry respeita Retry-After do servidor", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(async () => {
    if (calls++ === 0) throw new HttpError(429, "rate limit", 1500);
    return "ok";
  }, { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 10_000, sleep: async ms => { delays.push(ms); } });

  assert.deepEqual(delays, [1500]);
});

test("retry não repete erros definitivos e desiste após o limite", async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new HttpError(401, "chave inválida"); },
    { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep }));
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new HttpError(500, "erro"); },
    { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep }));
  assert.equal(calls, 3);
});

test("classificação de erros retentáveis", () => {
  assert.equal(isRetryableError(new HttpError(429, "slow down")), true);
  assert.equal(isRetryableError(new HttpError(429, '{"code":"insufficient_quota"}')), false);
  assert.equal(isRetryableError(new HttpError(400, "bad request")), false);
  assert.equal(isRetryableError(new TypeError("fetch failed")), true);
  assert.equal(isRetryableError(Object.assign(new Error("timeout"), { name: "TimeoutError" })), true);
  assert.equal(isRetryableError(new StreamInterruptedError("parcial", new Error("x"))), false);
});

test("parseRetryAfter entende segundos e milissegundos", () => {
  assert.equal(parseRetryAfter(new Headers({ "retry-after": "2" })), 2000);
  assert.equal(parseRetryAfter(new Headers({ "retry-after-ms": "250" })), 250);
  assert.equal(parseRetryAfter(new Headers()), undefined);
});

test("token bucket limita e recarrega com o tempo", () => {
  let now = 0;
  const bucket = new TokenBucket(2, 60, () => now);

  assert.equal(bucket.tryAcquire(), true);
  assert.equal(bucket.tryAcquire(), true);
  assert.equal(bucket.tryAcquire(), false);
  assert.equal(bucket.msUntilAvailable(), 1000);

  now += 1000;
  assert.equal(bucket.tryAcquire(), true);
});

test("token bucket acquire aguarda até haver capacidade", async () => {
  let now = 0;
  const waited: number[] = [];
  const bucket = new TokenBucket(1, 60, () => now, async ms => { waited.push(ms); now += ms; });

  await bucket.acquire();
  await bucket.acquire();

  assert.deepEqual(waited, [1000]);
});
