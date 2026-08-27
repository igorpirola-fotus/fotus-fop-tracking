// Testes do módulo de públicos da Meta. Rodar: deno test fop-functions/publicos-meta_test.ts
//
// Regras da doc oficial (Marketing API v25.0, 27/ago/2026): SHA-256 hex minúsculo,
// e-mail trim+lowercase, telefone só dígitos, geo minúsculo sem pontuação,
// COUNTRY em ISO-2, máximo 10.000 registros por chamada.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildUserData, hashValue, normalizePhone } from "./capi-sender.ts";
import { chunk, linhaParaData, montarBody, SCHEMA_META } from "./publicos-meta.ts";

const LINHA = {
  cnpj: "12345678000199",
  email: " Joao@Empresa.COM ",
  phone: "(11) 98888-7777",
  nome_contato: "João da Silva",
  cidade: "São Paulo",
  uf: "SP",
  cep: "01310-100",
};

Deno.test("schema tem a ordem que o payload.data respeita", () => {
  assertEquals([...SCHEMA_META], ["EMAIL", "PHONE", "FN", "LN", "CT", "ST", "ZIP", "COUNTRY", "EXTERN_ID"]);
});

Deno.test("email é normalizado antes do hash", async () => {
  const data = await linhaParaData(LINHA);
  assertEquals(data[0], await hashValue("joao@empresa.com"));
});

Deno.test("telefone usa a mesma normalização do CAPI", async () => {
  const data = await linhaParaData(LINHA);
  assertEquals(data[1], await hashValue(normalizePhone("(11) 98888-7777")));
});

Deno.test("nome é quebrado em FN e LN", async () => {
  const data = await linhaParaData(LINHA);
  assertEquals(data[2], await hashValue("joão"));
  assertEquals(data[3], await hashValue("da silva"));
});

Deno.test("geo minúsculo, CEP só dígitos, país fixo br", async () => {
  const data = await linhaParaData(LINHA);
  assertEquals(data[4], await hashValue("são paulo"));
  assertEquals(data[5], await hashValue("sp"));
  assertEquals(data[6], await hashValue("01310100"));
  assertEquals(data[7], await hashValue("br"));
});

Deno.test("EXTERN_ID é o mesmo hash de CNPJ que o CAPI manda como external_id", async () => {
  const data = await linhaParaData(LINHA);
  assertEquals(data[8], await hashValue("12345678000199"));
});

Deno.test("campo ausente vira string vazia, não 'null'", async () => {
  const data = await linhaParaData({
    cnpj: "12345678000199",
    email: null,
    phone: "11988887777",
    nome_contato: null,
    cidade: null,
    uf: null,
    cep: null,
  });
  assertEquals(data[0], "");
  assertEquals(data[2], "");
  assertEquals(data[3], "");
  assertEquals(data[4], "");
  assertEquals(data[7], await hashValue("br"));
});

Deno.test("nome de uma palavra só preenche FN e deixa LN vazio", async () => {
  const data = await linhaParaData({ ...LINHA, nome_contato: "Cleydson" });
  assertEquals(data[2], await hashValue("cleydson"));
  assertEquals(data[3], "");
});

Deno.test("CNPJ formatado com pontuação gera o mesmo EXTERN_ID", async () => {
  const comMascara = await linhaParaData({ ...LINHA, cnpj: "12.345.678/0001-99" });
  const semMascara = await linhaParaData(LINHA);
  assertEquals(comMascara[8], semMascara[8]);
});

Deno.test("chunk respeita o limite de 10.000 por chamada", () => {
  const arr = Array.from({ length: 10_001 }, (_, i) => i);
  const lotes = chunk(arr, 10_000);
  assertEquals(lotes.length, 2);
  assertEquals(lotes[0].length, 10_000);
  assertEquals(lotes[1].length, 1);
});

Deno.test("chunk de lista vazia não gera lote", () => {
  assertEquals(chunk([], 10_000).length, 0);
});

Deno.test("montarBody costura os lotes na mesma sessão e marca o último", () => {
  const primeiro = montarBody({ sessionId: 42, batchSeq: 1, ultimo: false, estimadoTotal: 15_000, data: [["a"]] });
  assertEquals(primeiro.session.session_id, 42);
  assertEquals(primeiro.session.batch_seq, 1);
  assertEquals(primeiro.session.last_batch_flag, false);
  assertEquals(primeiro.session.estimated_num_total, 15_000);
  assertEquals(primeiro.payload.schema, SCHEMA_META);

  const ultimo = montarBody({ sessionId: 42, batchSeq: 2, ultimo: true, estimadoTotal: 15_000, data: [["b"]] });
  assertEquals(ultimo.session.session_id, 42);
  assertEquals(ultimo.session.batch_seq, 2);
  assertEquals(ultimo.session.last_batch_flag, true);
});

Deno.test("external_id do CAPI é o mesmo hash de CNPJ do EXTERN_ID do público", async () => {
  const ud = await buildUserData({ email: "joao@empresa.com", cnpj: "12.345.678/0001-99" });
  const esperado = await hashValue("12345678000199");
  assertEquals(ud.external_id, [esperado]);

  const data = await linhaParaData({
    cnpj: "12345678000199",
    email: "joao@empresa.com",
    phone: null,
    nome_contato: null,
    cidade: null,
    uf: null,
    cep: null,
  });
  assertEquals(data[8], esperado);
});

Deno.test("sem cnpj, external_id não é enviado", async () => {
  const ud = await buildUserData({ email: "joao@empresa.com" });
  assertEquals(ud.external_id, undefined);
});
