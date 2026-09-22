// Testes da resposta de /rd-token. Rodar: deno test fop-functions/rd-token_test.ts
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MIN_VALIDADE_MS, montarRespostaToken, precisaRenovar } from "./rd-token.ts";

const AGORA = Date.parse("2026-09-21T15:00:00Z");

Deno.test("devolve o mesmo formato da Ponte (access_token + expiry em ms)", () => {
  const exp = AGORA + 60 * 60 * 1000;
  const r = montarRespostaToken("abc", exp, AGORA);
  assertEquals(r, { access_token: "abc", expiry: exp, validade_min: 60 });
});

Deno.test("recusa token com menos de 15 min de validade", () => {
  assertThrows(() => montarRespostaToken("abc", AGORA + MIN_VALIDADE_MS - 1, AGORA), Error, "token_invalido");
});

Deno.test("aceita exatamente 15 min", () => {
  const r = montarRespostaToken("abc", AGORA + MIN_VALIDADE_MS, AGORA);
  assertEquals(r.validade_min, 15);
});

Deno.test("recusa token vazio", () => {
  assertThrows(() => montarRespostaToken("", AGORA + 3600_000, AGORA), Error, "token_invalido");
});

// Bug de 21-22/09: o refresh dentro do lock usava só a margem de 5 min. Com validade entre
// 5 e 15 min o /rd-token pedia renovação, o refresh desistia e a rota devolvia 503 —
// ~10 min de falha a cada ciclo de 2h (dead-letter 105–108).
const MIN = 60 * 1000;

Deno.test("com 10 min de validade, quem exige 15 min precisa renovar", () => {
  assertEquals(precisaRenovar(AGORA + 10 * MIN, AGORA, MIN_VALIDADE_MS), true);
});

Deno.test("com 10 min de validade, a margem padrão de 5 min não renova", () => {
  assertEquals(precisaRenovar(AGORA + 10 * MIN, AGORA, 5 * MIN), false);
});

Deno.test("com exatamente o mínimo de validade, não renova", () => {
  assertEquals(precisaRenovar(AGORA + MIN_VALIDADE_MS, AGORA, MIN_VALIDADE_MS), false);
});

Deno.test("token vencido sempre renova", () => {
  assertEquals(precisaRenovar(AGORA - MIN, AGORA, 5 * MIN), true);
});
