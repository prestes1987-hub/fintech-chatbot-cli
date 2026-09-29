/**
 * Mascaramento de dados sensíveis antes de guardar no histórico, enviar à IA
 * ou gravar no log de auditoria. Opera sobre o texto original (com acentos).
 */
const REDACTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // senha/PIN/CVV/token seguido de números: mantém a palavra, mascara o valor
  {
    pattern: /\b(senha|pin|cvv|cvc|token|c[oó]digo(?: de verifica[cç][aã]o| de seguran[cç]a| mfa| sms)?)(\D{0,25}?)\d{3,}/gi,
    replacement: "$1$2[SEGREDO REMOVIDO]"
  },
  // número de cartão (13 a 19 dígitos, com ou sem separadores)
  { pattern: /\b(?:\d[ .-]?){12,18}\d\b/g, replacement: "[CARTÃO REMOVIDO]" },
  // CPF
  { pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, replacement: "[CPF REMOVIDO]" }
];

export function redactSensitiveData(text: string): string {
  return REDACTIONS.reduce(
    (current, { pattern, replacement }) => current.replace(pattern, replacement),
    text
  );
}
