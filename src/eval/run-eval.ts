/**
 * Executa os cenários críticos N vezes contra o pipeline completo
 * (policy -> contexto -> IA -> guard -> autocrítica) e gera um relatório
 * Markdown com os outputs, a conformidade e a consistência entre execuções.
 *
 * Uso: npm run eval -- --runs=3 --out=docs/outputs.md [--mock]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, loadDotEnv, loadUserData, parseArgs } from "../config/config.js";
import { createChatbot, createProvider } from "../config/factory.js";
import { loadSystemPrompt } from "../context/system-prompt.js";
import { validateResponse } from "../security/response-guard.js";
import type { TurnResult } from "../chatbot.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

loadDotEnv();
const args = parseArgs(process.argv.slice(2));
const config = { ...loadConfig(), mockStreamDelayMs: 0 };
const runs = Math.max(1, Number(args["runs"] ?? 3));
const outFile = String(args["out"] ?? "docs/outputs.md");

const provider = createProvider(config, message => console.error(`  [retry] ${message}`));
const userData = loadUserData(config.userDataFile);
const prompt = loadSystemPrompt(config.systemPromptFile);

interface RunOutcome {
  result: TurnResult;
  failures: string[];
}

function check(scenario: Scenario, result: TurnResult): string[] {
  const failures: string[] = [];
  const decision = result.policy?.decision;

  if (decision !== scenario.expectedDecision) {
    failures.push(`decisão ${decision} (esperado ${scenario.expectedDecision})`);
  }
  for (const pattern of scenario.mustMatch ?? []) {
    if (!pattern.test(result.response)) failures.push(`deveria conter ${pattern}`);
  }
  for (const pattern of scenario.mustNotMatch ?? []) {
    if (pattern.test(result.response)) failures.push(`não deveria conter ${pattern}`);
  }
  const guard = validateResponse(result.response);
  if (!guard.safe) failures.push(`guard: ${guard.violations.map(v => v.reason).join("; ")}`);
  if (result.source === "provider_error") failures.push(`erro do provider: ${result.error}`);

  return failures;
}

async function runScenario(scenario: Scenario): Promise<RunOutcome[]> {
  const outcomes: RunOutcome[] = [];

  for (let run = 0; run < runs; run++) {
    // Sessão nova por execução: o histórico só existe dentro do cenário.
    const chatbot = createChatbot(config, provider, userData, prompt.text, {
      userMessagesPerMinute: 1000,
      auditLogFile: null
    });

    let result!: TurnResult;
    for (const message of scenario.messages) {
      result = await chatbot.respond(message);
    }
    outcomes.push({ result, failures: check(scenario, result) });
  }

  return outcomes;
}

const escape = (text: string) => text.replace(/\|/g, "\\|").replace(/\n+/g, " ");

const lines: string[] = [
  "# Outputs gerados — avaliação dos cenários críticos",
  "",
  `- Data: ${new Date().toISOString()}`,
  `- Provider: \`${provider.name}\``,
  `- Autocrítica: \`${config.critiqueMode}\` (máx. ${config.maxRevisions} reescrita)`,
  `- System prompt: \`${prompt.source}\``,
  `- Execuções por cenário: ${runs}`,
  "",
  "## Resumo",
  "",
  "| ID | Cenário | Esperado | Obtido | Origem | Conformes | Consistente |",
  "|---|---|---|---|---|---|---|"
];
const details: string[] = ["", "## Outputs", ""];

let totalRuns = 0;
let passedRuns = 0;
let consistentScenarios = 0;

for (const scenario of SCENARIOS) {
  process.stdout.write(`${scenario.id} ${scenario.name}... `);
  const outcomes = await runScenario(scenario);

  const decisions = [...new Set(outcomes.map(o => o.result.policy?.decision ?? "-"))];
  const sources = [...new Set(outcomes.map(o => o.result.source))];
  const passed = outcomes.filter(o => o.failures.length === 0).length;
  const consistent = decisions.length === 1 && passed === outcomes.length;

  totalRuns += outcomes.length;
  passedRuns += passed;
  if (consistent) consistentScenarios++;
  console.log(consistent ? "OK" : "FALHA");

  lines.push(
    `| ${scenario.id} | ${scenario.name} | ${scenario.expectedDecision} | ${decisions.join(", ")} | ` +
    `${sources.join(", ")} | ${passed}/${outcomes.length} | ${consistent ? "sim" : "**não**"} |`
  );

  details.push(`### ${scenario.id} — ${scenario.name}`, "");
  scenario.messages.forEach((message, index) => {
    const label = scenario.messages.length > 1 ? `Cliente (turno ${index + 1})` : "Cliente";
    details.push(`**${label}:** ${message}`, "");
  });

  const distinct = [...new Set(outcomes.map(o => o.result.response))];
  details.push(
    `Intenção: \`${outcomes[0].result.policy?.intent}\` · Regras: ${outcomes[0].result.policy?.matchedRules.join(", ") || "—"} · ` +
    `Respostas distintas: ${distinct.length}/${outcomes.length}`,
    ""
  );
  outcomes.forEach((outcome, index) => {
    const critique = outcome.result.critiques.map(c => (c.approved ? "aprovada" : "reprovada")).join(" → ") || "—";
    details.push(
      `- Execução ${index + 1} (origem: ${outcome.result.source}, autocrítica: ${critique}):`,
      `  > ${escape(outcome.result.response)}`
    );
    for (const failure of outcome.failures) details.push(`  - ❌ ${failure}`);
  });
  details.push("");
}

lines.push(
  "",
  `**Conformidade:** ${passedRuns}/${totalRuns} execuções · ` +
  `**Consistência:** ${consistentScenarios}/${SCENARIOS.length} cenários`,
  ...details
);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
console.log(`\nConformidade: ${passedRuns}/${totalRuns} | Consistência: ${consistentScenarios}/${SCENARIOS.length}`);
console.log(`Relatório gravado em ${outFile}`);

if (passedRuns !== totalRuns) process.exitCode = 1;
