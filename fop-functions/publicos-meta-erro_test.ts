// Testes da leitura de erro da Graph API. Rodar: deno test fop-functions/publicos-meta-erro_test.ts
//
// O objetivo é traduzir o erro cru da Meta na AÇÃO que resolve. Sem isso, o
// operador recebe "(#200) Permissions error" e não sabe se o problema é o token,
// os termos ou a conta — três causas com soluções diferentes.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { interpretarErroMeta } from "./publicos-meta-client.ts";

Deno.test("code 200 = token sem ads_management", () => {
  const r = interpretarErroMeta({ code: 200, message: "(#200) Permissions error" });
  assertEquals(r.causa, "token_sem_permissao");
  assertEquals(r.acao.includes("ads_management"), true);
});

Deno.test("menção a terms of service = termos não aceitos", () => {
  const r = interpretarErroMeta({
    code: 2654,
    message: "Custom Audience Terms of Service has not been accepted",
  });
  assertEquals(r.causa, "termos_nao_aceitos");
  assertEquals(r.acao.includes("Business Manager"), true);
});

Deno.test("token expirado/invalido é distinguido de falta de permissao", () => {
  const r = interpretarErroMeta({
    code: 190,
    message: "Error validating access token: Session has expired",
  });
  assertEquals(r.causa, "token_invalido");
});

Deno.test("conta inexistente ou sem acesso", () => {
  const r = interpretarErroMeta({ code: 100, message: "Unsupported get request. Object with ID 'act_x' does not exist" });
  assertEquals(r.causa, "conta_inacessivel");
});

Deno.test("erro desconhecido devolve o texto cru sem inventar causa", () => {
  const r = interpretarErroMeta({ code: 1, message: "An unknown error occurred" });
  assertEquals(r.causa, "desconhecido");
  assertEquals(r.acao.includes("An unknown error occurred"), true);
});

Deno.test("erro sem objeto nao explode", () => {
  const r = interpretarErroMeta(undefined);
  assertEquals(r.causa, "desconhecido");
});
