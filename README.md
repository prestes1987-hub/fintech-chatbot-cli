# Fintech Chatbot CLI

Micro-capstone em TypeScript: assistente de atendimento de uma fintech que respeita
regras rígidas de negócio (sem recomendação financeira, linguagem formal, escopo
restrito e encaminhamento humano de casos críticos) por meio de **controle de contexto
em camadas** e **defesa em profundidade**.

## Funcionalidades

| Requisito | Onde |
|---|---|
| Policy layer determinística (intenção → regra → decisão) | `src/policy/` |
| Contexto em camadas: instruções globais / regras / dados do usuário | `src/context/context-builder.ts` |
| **System prompt customizável** (arquivo, env, flag e comando `/prompt`) | `prompts/system-prompt.md`, `src/context/system-prompt.ts` |
| **Streaming de resposta** (SSE da OpenAI Responses API) com guard incremental | `src/ai/openai-provider.ts`, `src/security/response-guard.ts` |
| **Histórico da conversa na sessão** (janela configurável, mascarado) | `src/context/conversation-history.ts` |
| **Error handling com retry** (backoff exponencial + jitter, `Retry-After`, timeout) | `src/resilience/retry.ts` |
| **Rate limit** (mensagens do usuário e chamadas à API — token bucket) | `src/resilience/rate-limiter.ts` |
| **Self-critique** (auditoria do rascunho por um 2º passe do modelo + reescrita) | `src/critique/self-critic.ts`, `src/chatbot.ts` |
| Encaminhamento humano com protocolo | `src/handoff/handoff-queue.ts` |
| Mascaramento de senha/cartão/CPF e log de auditoria JSONL | `src/security/redaction.ts`, `src/audit/audit-log.ts` |
| Avaliação de cenários críticos com N execuções (consistência) | `src/eval/` → `docs/outputs.md` |

## Arquitetura

```text
Mensagem do cliente
   │
   ├─ Rate limit do usuário ──────────────► "aguarde N segundos"
   │
   ▼
Policy Layer (determinística, sem IA)
   ├─ CRITICAL ────► resposta padrão + chamado ATD-xxxx para humano
   ├─ PROHIBITED ──► resposta padrão (recomendação, credencial, terceiros, injection, dado sensível)
   ├─ OUT_OF_SCOPE ► recusa formal
   └─ ALLOWED
        │
        ▼
   Context Builder  (global_instructions │ business_rules │ user_data │ policy_decision)
        │            + histórico da sessão como mensagens + mensagem atual (mascarados)
        ▼
   LLM (streaming) ── rate limit de API + retry/backoff + timeout
        │
        ▼
   Streaming Guard (regex; retém o final do texto e aborta se detectar violação)
        │
        ▼
   Self-critique (LLM auditor, saída JSON estrita) ── reprovado? ──► reescrita com feedback
        │                                                          (máx. N; senão resposta segura)
        ▼
   Resposta + histórico + log de auditoria
```

Modos de autocrítica (`SELF_CRITIQUE_MODE`):

- `post` (padrão): o rascunho aparece em streaming; se a autocrítica reprovar, ele é
  substituído na tela pela versão corrigida.
- `blocking`: a resposta só é exibida depois de aprovada (mais seguro, sem streaming visível).
- `off`: apenas o guard determinístico.

## Requisitos

- Node.js **20.12 ou superior** (usa `process.loadEnvFile` e `AbortSignal.any`).
- Opcional: chave da OpenAI. Sem chave, o sistema roda em **modo mock** (offline e determinístico).

## Passo a passo

```bash
npm install
npm test            # 59 testes (policy, guard, retry, rate limit, provider, chatbot)
npm run eval        # 24 cenários críticos x 3 execuções -> docs/outputs.md
npm run dev         # CLI interativo (mock se não houver OPENAI_API_KEY)
```

Com IA real:

```bash
cp .env.example .env    # preencha OPENAI_API_KEY (e OPENAI_MODEL, se quiser)
npm run dev
npm run eval -- --runs=3 --out=docs/outputs-openai.md
```

Flags do CLI: `--mock`, `--debug`, `--critique=post|blocking|off`,
`--system-prompt=arquivo.md`, `--user=arquivo.json`.
Exemplo: `npm run dev -- --debug --critique=blocking`.

Comandos dentro do CLI: `/ajuda`, `/historico`, `/limpar`, `/prompt`,
`/prompt recarregar`, `/prompt <arquivo>`, `/chamados`, `/debug`, `/sair`.

Build de produção:

```bash
npm run build
npm start
```

## Configuração (`.env`)

Veja `.env.example`. Principais variáveis: `OPENAI_API_KEY`, `OPENAI_MODEL`,
`SYSTEM_PROMPT_FILE`, `USER_DATA_FILE`, `HISTORY_MAX_TURNS`, `SELF_CRITIQUE_MODE`,
`SELF_CRITIQUE_MAX_REVISIONS`, `MAX_RETRIES`, `REQUEST_TIMEOUT_MS`,
`RATE_LIMIT_USER_PER_MINUTE`, `RATE_LIMIT_API_PER_MINUTE`, `AUDIT_LOG_FILE`.

## Documentação

- `docs/policies.md` — documento de políticas
- `docs/context-model.md` — estrutura de contexto (modelo reutilizável)
- `docs/test-results.md` — casos de teste
- `docs/outputs.md` — outputs gerados pela avaliação (`npm run eval`)
- `docs/behavior-analysis.md` — análise de comportamento
