/**
 * Normaliza o texto para classificação: remove acentos, converte para
 * minúsculas e colapsa espaços. Assim os padrões podem ser escritos em ASCII
 * ("nao reconheco") e cobrem "Não reconheço", "NAO RECONHECO" etc.
 *
 * Também evita o problema de `\b` em regex JS, que não trata letras
 * acentuadas como caracteres de palavra.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
