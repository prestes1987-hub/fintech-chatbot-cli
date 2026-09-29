import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../ai/openai-provider.js";
import type { LlmRequest } from "../types.js";

const request: LlmRequest = {
  purpose: "draft",
  system: "sistema",
  messages: [
    { role: "user", content: "oi" },
    { role: "assistant", content: "Olá." },
    { role: "user", content: "Como funciona o Pix?" }
  ]
};

function sse(events: object[]): Response {
  const body = events.map(event => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join("");
  // Divide em pedaços pequenos para exercitar o parser com eventos partidos.
  const chunks = body.match(/[\s\S]{1,7}/g)!;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function makeProvider(fetchImpl: typeof fetch) {
  return new OpenAIProvider({
    apiKey: "test-key",
    model: "modelo-teste",
    timeoutMs: 5000,
    fetchImpl,
    retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} }
  });
}

test("stream faz parse de SSE e envia histórico como mensagens", async () => {
  let sentBody: any;
  const provider = makeProvider(async (_url, init) => {
    sentBody = JSON.parse(String(init!.body));
    return sse([
      { type: "response.created" },
      { type: "response.output_text.delta", delta: "O Pix " },
      { type: "response.output_text.delta", delta: "é instantâneo." },
      { type: "response.completed" }
    ]);
  });

  const deltas: string[] = [];
  const text = await provider.stream(request, d => deltas.push(d));

  assert.equal(text, "O Pix é instantâneo.");
  assert.deepEqual(deltas, ["O Pix ", "é instantâneo."]);
  assert.equal(sentBody.stream, true);
  assert.equal(sentBody.instructions, "sistema");
  assert.equal(sentBody.input.length, 3);
  assert.equal(sentBody.input[1].role, "assistant");
});

test("stream repete após 429 antes do primeiro token", async () => {
  let calls = 0;
  const provider = makeProvider(async () => {
    calls++;
    if (calls === 1) return new Response("muitas requisições", { status: 429, headers: { "retry-after-ms": "1" } });
    return sse([{ type: "response.output_text.delta", delta: "ok" }]);
  });

  assert.equal(await provider.stream(request, () => {}), "ok");
  assert.equal(calls, 2);
});

test("stream não repete se a falha ocorre depois de exibir texto", async () => {
  let calls = 0;
  const provider = makeProvider(async () => {
    calls++;
    return sse([{ type: "response.output_text.delta", delta: "parcial" }, { type: "error", error: { message: "boom" } }]);
  });

  await assert.rejects(provider.stream(request, () => {}), { name: "StreamInterruptedError" });
  assert.equal(calls, 1);
});

test("401 não é repetido", async () => {
  let calls = 0;
  const provider = makeProvider(async () => { calls++; return new Response("chave inválida", { status: 401 }); });

  await assert.rejects(provider.complete(request), { name: "HttpError" });
  assert.equal(calls, 1);
});

test("complete envia json_schema e lê o texto de output", async () => {
  let sentBody: any;
  const provider = makeProvider(async (_url, init) => {
    sentBody = JSON.parse(String(init!.body));
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: '{"approved":true}' }] }] });
  });

  const text = await provider.complete({ ...request, purpose: "critique", jsonSchema: { name: "x", schema: { type: "object" } } });

  assert.equal(text, '{"approved":true}');
  assert.equal(sentBody.text.format.type, "json_schema");
  assert.equal(sentBody.text.format.strict, true);
});
