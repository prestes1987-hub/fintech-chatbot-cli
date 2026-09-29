import { readFileSync } from "node:fs";

/** Usado apenas se o arquivo de system prompt não existir. */
export const DEFAULT_SYSTEM_PROMPT = `
Você é o assistente virtual de atendimento de uma fintech.
Preste informações operacionais e institucionais sobre os serviços da empresa
de forma formal, objetiva e segura, em português do Brasil.
`.trim();

export interface LoadedPrompt {
  text: string;
  source: string;
}

/**
 * Carrega o system prompt customizável (camada de instruções globais).
 * As regras de negócio NÃO fazem parte deste arquivo: são sempre anexadas
 * pelo context builder, então um prompt customizado não consegue removê-las.
 */
export function loadSystemPrompt(filePath: string | undefined): LoadedPrompt {
  if (!filePath) {
    return { text: DEFAULT_SYSTEM_PROMPT, source: "padrão embutido" };
  }

  try {
    const text = readFileSync(filePath, "utf8").trim();
    if (!text) throw new Error("arquivo vazio");
    return { text, source: filePath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[config] Não foi possível ler o system prompt em "${filePath}" (${reason}). Usando o padrão.`);
    return { text: DEFAULT_SYSTEM_PROMPT, source: "padrão embutido" };
  }
}
