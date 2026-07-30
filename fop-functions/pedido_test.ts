// Testes da normalização do Número do Pedido.
// Rodar: deno test fop-functions/pedido_test.ts
//
// Os casos vêm todos do que apareceu de verdade no CRM na conciliação com o ERP
// (30/jul/2026). Regra do Igor: falta hífen → insere; fora do padrão → descarta.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractNumeroPedido, normalizeNumeroPedido } from "./pedido.ts";

Deno.test("já no padrão: mantém", () => {
  assertEquals(normalizeNumeroPedido("1697722-98"), "1697722-98");
  assertEquals(normalizeNumeroPedido(" 1677091-98 "), "1677091-98");
});

Deno.test("separador errado: vira hífen (casos reais do CRM)", () => {
  assertEquals(normalizeNumeroPedido("1486589 98"), "1486589-98");
  assertEquals(normalizeNumeroPedido("1492512 98"), "1492512-98");
  assertEquals(normalizeNumeroPedido("1497163/98"), "1497163-98");
  assertEquals(normalizeNumeroPedido("1498108.98"), "1498108-98");
});

Deno.test("só dígitos: insere o hífen antes dos 2 últimos", () => {
  assertEquals(normalizeNumeroPedido("148658998"), "1486589-98");
  assertEquals(normalizeNumeroPedido("148305998"), "1483059-98");
});

Deno.test("fora do padrão: DESCARTA (nao se adivinha pedido)", () => {
  for (const lixo of ["00", "01", "04", "14", "13151", "11.697", "13.402", "11111111111", "1495184", ""]) {
    assertEquals(normalizeNumeroPedido(lixo), "", `deveria descartar: ${lixo}`);
  }
  assertEquals(normalizeNumeroPedido(null), "");
  assertEquals(normalizeNumeroPedido(undefined), "");
});

Deno.test("1472857-980 (sufixo de 3 digitos) é descartado", () => {
  // Apareceu no CRM; não é padrão do ERP e não há como saber o certo.
  assertEquals(normalizeNumeroPedido("1472857-980"), "");
});

Deno.test("extração do webhook normaliza o valor sujo", () => {
  const wh = {
    document: {
      deal_custom_fields: [
        { value: "8.06 kWp", custom_field: { label: "Potência" } },
        { value: "1486589 98", custom_field: { label: "Número do Pedido" } },
      ],
    },
  };
  assertEquals(extractNumeroPedido(wh), "1486589-98");
});

Deno.test("extração da listagem usa a chave 'numero-do-pedido'", () => {
  const item = { id: "d1", custom_fields: { "numero-do-pedido": "1697722-98", "potencia": "12.4" } };
  assertEquals(extractNumeroPedido(item), "1697722-98");
});

Deno.test("listagem com lixo no campo: devolve vazio, nao o lixo", () => {
  const item = { id: "d2", custom_fields: { "numero-do-pedido": "11111111111" } };
  assertEquals(extractNumeroPedido(item), "");
});
