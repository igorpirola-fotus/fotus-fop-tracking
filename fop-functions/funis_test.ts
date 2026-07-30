// Testes do filtro de funis. Rodar: deno test fop-functions/funis_test.ts
//
// Os IDs e formatos vêm do levantamento de 30/jul/2026 no CRM real: o webhook
// traz `document.deal_pipeline.{id,name}` e a listagem de deals traz
// `pipeline_id` solto. O filtro tem de entender os dois.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractPipelineId, extractPipelineNome, isFunilDeVenda } from "./funis.ts";

const COMERCIAL = "685d9b02b169f4001dd7f804";
const BDR = "688a45801a5566001921d886";
const SDR = "68643e1eb11bf8001473affc";
const MKT_MOV = "6a145c9237df8c0024a16459";
const CHARGE = "69e60a4c9b8aa90015d064d0";
const IA_SDR = "6a5f7f5e5e2882002a8c7f9a";

Deno.test("webhook: extrai id e nome de document.deal_pipeline", () => {
  const wh = {
    event_name: "crm_deal_updated",
    document: { id: "d1", deal_pipeline: { id: COMERCIAL, name: "Funil Comercial" } },
  };
  assertEquals(extractPipelineId(wh), COMERCIAL);
  assertEquals(extractPipelineNome(wh), "Funil Comercial");
  assertEquals(isFunilDeVenda(wh), true);
});

Deno.test("listagem: extrai pipeline_id solto (sem deal_pipeline)", () => {
  const item = { id: "d2", pipeline_id: BDR, total_price: 12000 };
  assertEquals(extractPipelineId(item), BDR);
  assertEquals(extractPipelineNome(item), null);
  assertEquals(isFunilDeVenda(item), true);
});

Deno.test("os funis de venda passam (inclui Fotus Charge)", () => {
  for (const id of [COMERCIAL, BDR, SDR, CHARGE]) {
    assertEquals(isFunilDeVenda({ pipeline_id: id }), true);
  }
});

Deno.test("Fotus Charge conta: recebe leads de midia paga", () => {
  // Unidade de negocio distinta, mesma estrutura, alimentada por trafego de
  // performance. Se ficasse fora, a midia geraria receita sem conversao.
  assertEquals(isFunilDeVenda({ document: { deal_pipeline: { id: CHARGE, name: "Fotus Charge" } } }), true);
});

Deno.test("Funil IA SDR NAO conta: a Solange move o lead p/ o SDR e a venda fecha la", () => {
  assertEquals(isFunilDeVenda({ pipeline_id: IA_SDR }), false);
});

Deno.test("MKT Movimentacao NAO e venda — o caso dos 734 deals em 'Descarte'", () => {
  const wh = {
    document: {
      id: "d3",
      status: "won",
      deal_pipeline: { id: MKT_MOV, name: "MKT Movimentação" },
      deal_stage: { name: "Descarte" },
    },
  };
  assertEquals(isFunilDeVenda(wh), false);
});

Deno.test("funil secundario de apoio interno fica fora (FOTUS FINANCIA)", () => {
  assertEquals(isFunilDeVenda({ pipeline_id: "6a0774294f0c84001c18622a" }), false);
});

Deno.test("sem pipeline identificavel: trata como NAO-venda (nao inventa Purchase)", () => {
  assertEquals(isFunilDeVenda({ id: "d4", total_price: 9000 }), false);
  assertEquals(isFunilDeVenda({}), false);
  assertEquals(isFunilDeVenda(null), false);
  assertEquals(extractPipelineId(null), null);
});
