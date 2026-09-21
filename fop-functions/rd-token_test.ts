// Testes da resposta de /rd-token. Rodar: deno test fop-functions/rd-token_test.ts
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MIN_VALIDADE_MS, montarRespostaToken } from "./rd-token.ts";

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
