// Testes com o formato REAL da organização do RD CRM, confirmado em 29/jul/2026
// pelo script scratchpad/1-validar-cnpj-deal-rd.ps1 contra 4 deals de produção:
//   - o deal NÃO traz `organization` inline, só `organization_id`
//   - o CNPJ está em organization.custom_fields["cnpj-41d5"]  (chave com sufixo!)
//   - em parte dos casos o CNPJ também aparece dentro de organization.name
// Rodar: deno test fop-functions/cnpj_org_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findCnpjDeep } from "./cnpj.ts";

Deno.test("organização real: custom_fields com chave sufixada 'cnpj-41d5'", () => {
  const org = {
    id: "68711d96f276b10001769e87",
    name: "ENERGIA SOLAR EXEMPLO LTDA",
    custom_fields: { "cnpj-41d5": "22429517000133", "porte-9a1c": "ME" },
  };
  assertEquals(findCnpjDeep(org), "22429517000133");
});

Deno.test("organização real: CNPJ no name E no custom_field — vence o campo rotulado", () => {
  const org = {
    id: "687119c0f276b1000175a50e",
    name: "SOLAR EXEMPLO 60.827.803/0001-46",
    custom_fields: { "cnpj-41d5": "60827803000146" },
  };
  assertEquals(findCnpjDeep(org), "60827803000146");
});

Deno.test("deal real só com organization_id: nada de CNPJ no deal", () => {
  const deal = {
    id: "6a67aa3d1ccbd5001d2fb555",
    organization_id: "6883a002efb9550001e2132d",
    amount_total: 9923.09,
    deal_custom_fields: [{ value: "1873969-98", custom_field: { label: "Número do Pedido" } }],
  };
  assertEquals(findCnpjDeep(deal), "");
});
