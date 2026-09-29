import test from "node:test";
import assert from "node:assert/strict";
import { StreamingGuard, validateResponse } from "../security/response-guard.js";
import { redactSensitiveData } from "../security/redaction.js";

test("guard detecta recomendação, pedido de credencial, informalidade e vazamento", () => {
  const cases: Array<[string, string]> = [
    ["Recomendo que você invista em ações.", "R03"],
    ["Você deveria investir no CDB.", "R03"],
    ["Este fundo tem rentabilidade garantida.", "R03"],
    ["Por favor, informe sua senha para continuar.", "R04"],
    ["Valeu, mano! Qualquer coisa chama.", "R01"],
    ["Segundo a regra R03: não posso...", "R11"]
  ];
  for (const [text, rule] of cases) {
    const result = validateResponse(text);
    assert.equal(result.safe, false, text);
    assert.ok(result.violations.some(v => v.ruleId === rule), `${text} -> ${rule}`);
  }
});

test("guard não gera falso positivo em orientações negativas", () => {
  for (const text of [
    "Nunca informe sua senha a terceiros.",
    "Não recomendamos compartilhar seus dados.",
    "A instituição jamais solicita que você digite sua senha por este canal.",
    "Para consultar o saldo, utilize o aplicativo oficial."
  ]) {
    assert.equal(validateResponse(text).safe, true, text);
  }
});

test("streaming guard retém o final e bloqueia padrão que atravessa chunks", () => {
  const guard = new StreamingGuard(20);
  let shown = "";
  for (const chunk of ["A instituição oferece vários produtos. Reco", "mendo que você ", "invista em ações."]) {
    shown += guard.push(chunk);
  }
  assert.ok(guard.violation);
  assert.doesNotMatch(shown, /Recomendo/);
  assert.equal(guard.flush(), "");
});

test("streaming guard libera todo o texto seguro", () => {
  const guard = new StreamingGuard(10);
  const text = "Consulte as tarifas vigentes no aplicativo oficial da instituição.";
  let shown = "";
  for (const token of text.match(/\S+\s*/g)!) shown += guard.push(token);
  shown += guard.flush();
  assert.equal(shown, text);
});

test("redação mascara senha, cartão e CPF", () => {
  const redacted = redactSensitiveData("Senha 1234, cartão 5500-0000-0000-0004, CPF 123.456.789-00");
  assert.doesNotMatch(redacted, /1234\b|5500|123\.456/);
  assert.match(redacted, /SEGREDO REMOVIDO/);
  assert.match(redacted, /CARTÃO REMOVIDO/);
  assert.match(redacted, /CPF REMOVIDO/);
});
