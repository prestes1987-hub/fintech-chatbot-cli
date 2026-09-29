import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, loadDotEnv, loadUserData } from "./config/config.js";
import { createChatbot, createProvider } from "./config/factory.js";
import { loadSystemPrompt } from "./context/system-prompt.js";

loadDotEnv();
const config = loadConfig();
let debug = config.debug;

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

const provider = createProvider(config, message => console.error(yellow(`\n[retry] ${message}`)));
const userData = loadUserData(config.userDataFile);
let prompt = loadSystemPrompt(config.systemPromptFile);
const chatbot = createChatbot(config, provider, userData, prompt.text);

const HELP = `
Comandos:
  /ajuda            mostra esta ajuda
  /historico        mostra o histórico da sessão (mascarado)
  /limpar           limpa o histórico da sessão
  /prompt           mostra o system prompt atual
  /prompt recarregar  relê o arquivo de system prompt
  /prompt <arquivo> carrega outro arquivo de system prompt
  /chamados         lista os encaminhamentos para atendimento humano
  /debug            liga/desliga detalhes de política, guard e autocrítica
  /sair             encerra
`;

console.log("\nFintech Chatbot CLI");
console.log(dim(`provider: ${provider.name} | autocrítica: ${config.critiqueMode} | system prompt: ${prompt.source}`));
if (provider.name === "mock") {
  console.log(dim("[modo mock] OPENAI_API_KEY não configurada (ou --mock). Respostas simuladas."));
}
console.log("Digite /ajuda para ver os comandos ou /sair para encerrar.\n");

const rl = createInterface({ input, output });

function handleCommand(line: string): boolean {
  const [command, ...rest] = line.split(/\s+/);
  const argument = rest.join(" ");

  switch (command.toLowerCase()) {
    case "/ajuda":
      console.log(HELP);
      return true;
    case "/historico": {
      const messages = chatbot.history.all();
      if (!messages.length) console.log(dim("(histórico vazio)\n"));
      for (const message of messages) {
        console.log(`${message.role === "user" ? "Você" : "Assistente"}: ${message.content}`);
      }
      console.log();
      return true;
    }
    case "/limpar":
      chatbot.history.clear();
      console.log(dim("Histórico da sessão apagado.\n"));
      return true;
    case "/prompt":
      if (argument) {
        prompt = loadSystemPrompt(argument === "recarregar" ? config.systemPromptFile : argument);
        chatbot.setSystemPrompt(prompt.text);
        console.log(dim(`System prompt carregado de: ${prompt.source}\n`));
      } else {
        console.log(`${dim(`[${prompt.source}]`)}\n${chatbot.currentSystemPrompt}\n`);
      }
      return true;
    case "/chamados": {
      const tickets = chatbot.handoffQueue.list();
      if (!tickets.length) console.log(dim("(nenhum encaminhamento)\n"));
      for (const ticket of tickets) {
        console.log(`${ticket.id} | ${ticket.intent} | ${ticket.createdAt} | ${ticket.message}`);
      }
      console.log();
      return true;
    }
    case "/debug":
      debug = !debug;
      console.log(dim(`debug ${debug ? "ligado" : "desligado"}\n`));
      return true;
    default:
      return false;
  }
}

rl.setPrompt("Você: ");
rl.prompt();

// O iterador enfileira as linhas: funciona no terminal e com entrada via pipe.
for await (const line of rl) {
  const message = line.trim();
  if (["/sair", "sair"].includes(message.toLowerCase())) break;
  if (!message || (message.startsWith("/") && handleCommand(message))) {
    rl.prompt();
    continue;
  }

  output.write("\nAssistente: ");

  try {
    const result = await chatbot.respond(message, {
      onDelta: text => output.write(text),
      onRevision: reason => {
        output.write(yellow(`\n\n[Resposta substituída pela verificação de conformidade${debug ? `: ${reason}` : ""}]`));
        output.write("\nAssistente: ");
      },
      onStatus: status => {
        if (debug) console.error(dim(`\n  · ${status}`));
      }
    });

    output.write("\n");
    if (debug) {
      const policy = result.policy;
      console.error(dim(
        `  · intenção=${policy?.intent ?? "-"} decisão=${policy?.decision ?? "-"} regras=${policy?.matchedRules.join(",") || "-"} ` +
        `origem=${result.source} revisões=${result.revisions}` +
        (result.critiques.length ? ` autocrítica=${result.critiques.map(c => (c.approved ? "aprovada" : "reprovada")).join("→")}` : "") +
        (result.ticket ? ` chamado=${result.ticket.id}` : "") +
        (result.error ? ` erro=${result.error}` : "")
      ));
    }
    output.write("\n");
  } catch (error) {
    console.error("\nNão foi possível processar a solicitação neste momento.\n");
    if (debug) console.error(error);
  }
  rl.prompt();
}

rl.close();
console.log("Atendimento encerrado.");
