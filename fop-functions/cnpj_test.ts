// Testes do resolvedor de CNPJ. Rodar: deno test fop-functions/cnpj_test.ts
//
// Os payloads aqui são recortes de webhooks REAIS do RD Station CRM capturados
// em 29/jul/2026 na tabela rdstation_crm_webhook_events (dados sensíveis
// substituídos). O caso "deal_sem_cnpj_em_lugar_nenhum" é exatamente o que
// derrubava 100% dos eventos de fundo de funil.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanCnpj, findCnpjDeep, isValidCnpj } from "./cnpj.ts";

// CNPJs válidos usados nos testes (DV conferido).
const CNPJ_A = "19131243000197"; // válido
const CNPJ_B = "11222333000181"; // válido

Deno.test("isValidCnpj aceita válido com e sem máscara", () => {
  assertEquals(isValidCnpj(CNPJ_A), true);
  assertEquals(isValidCnpj("19.131.243/0001-97"), true);
});

Deno.test("isValidCnpj rejeita DV errado, tamanho errado e repetido", () => {
  assertEquals(isValidCnpj("19131243000198"), false); // DV alterado
  assertEquals(isValidCnpj("1913124300019"), false); // 13 dígitos
  assertEquals(isValidCnpj("11111111111111"), false); // sequência
  assertEquals(isValidCnpj(""), false);
  assertEquals(isValidCnpj(null), false);
});

Deno.test("cleanCnpj tira máscara e aceita número", () => {
  assertEquals(cleanCnpj("19.131.243/0001-97"), CNPJ_A);
  assertEquals(cleanCnpj(19131243000197), CNPJ_A);
  assertEquals(cleanCnpj(undefined), "");
});

Deno.test("acha CNPJ em custom field do deal (formato RD: value + custom_field.label)", () => {
  const payload = {
    document: {
      id: "6a67aa3d1ccbd5001d2fb555",
      deal_custom_fields: [
        { value: "8.06 kWp", custom_field: { label: "Potência" } },
        { value: "19.131.243/0001-97", custom_field: { label: "CNPJ do integrador" } },
      ],
    },
  };
  assertEquals(findCnpjDeep(payload), CNPJ_A);
});

Deno.test("acha CNPJ em campo nativo da organização", () => {
  const deal = { id: "x", organization: { id: "org1", name: "FOTUS LTDA", cnpj: CNPJ_B } };
  assertEquals(findCnpjDeep(deal), CNPJ_B);
});

Deno.test("acha CNPJ embutido na razão social", () => {
  const deal = { organization: { name: "SOLAR X LTDA - 19.131.243/0001-97" } };
  assertEquals(findCnpjDeep(deal), CNPJ_A);
});

Deno.test("campo rotulado CNPJ ganha de CNPJ solto em outro texto", () => {
  const deal = {
    organization: { name: `PARCEIRA DA ${CNPJ_B} LTDA`, custom_fields: { cnpj_empresa: CNPJ_A } },
  };
  assertEquals(findCnpjDeep(deal), CNPJ_A);
});

Deno.test("não confunde telefone, CEP, valor nem id do RD com CNPJ", () => {
  const payload = {
    document: {
      id: "6a67aa3d1ccbd5001d2fb555",
      amount_total: 9923.09,
      contacts: [{ mobile_phone: "27999998888", phone: "2733334444" }],
      address: { zip_code: "29100000" },
      deal_custom_fields: [{ value: "1873969-98", custom_field: { label: "Número do Pedido" } }],
    },
  };
  assertEquals(findCnpjDeep(payload), "");
});

Deno.test("deal_sem_cnpj_em_lugar_nenhum: payload real do webhook devolve vazio", () => {
  // Recorte fiel do crm_deal_updated recebido em 29/jul 13:20 — sem organization,
  // sem contacts, sem organization_id. É por isso que precisamos chamar a API.
  const real = {
    event_name: "crm_deal_updated",
    event_timestamp: "2026-07-29T13:20:31.000Z",
    transaction_uuid: "57373b52-a0fb-42a8-a5c2-839dbd28c51d",
    document: {
      id: "6a67aa3d1ccbd5001d2fb555",
      name: "8.06 kWp - MATHEUS INSTALADOR",
      status: "won",
      amount_total: 9923.09,
      deal_stage: { id: "6864396d378236001f34913b", name: "Aguardando entrega" },
      deal_pipeline: { id: "685d9b02b169f4001dd7f804", name: "Funil Comercial" },
      deal_custom_fields: [
        { value: "8.06 kWp", custom_field: { label: "Potência" } },
        { value: "1873969-98", custom_field: { label: "Número do Pedido" } },
        { value: "CIF", custom_field: { label: "Tipo Frete" } },
        { value: null, custom_field: { label: "Fonte do Negócio" } },
      ],
    },
  };
  assertEquals(findCnpjDeep(real), "");
});

Deno.test("não estoura com ciclo, null e profundidade grande", () => {
  const cyclic: Record<string, unknown> = { a: 1, cnpj: CNPJ_A };
  cyclic.self = cyclic;
  assertEquals(findCnpjDeep(cyclic), CNPJ_A);
  assertEquals(findCnpjDeep(null), "");
  assertEquals(findCnpjDeep({ a: { b: { c: { d: { e: { f: { g: { h: { i: CNPJ_A } } } } } } } } }), "");
});
