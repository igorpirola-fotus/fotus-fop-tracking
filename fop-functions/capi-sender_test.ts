// Testes das regras de normalização do CAPI. Rodar:
//   deno test fop-functions/capi-sender_test.ts
//
// Régua: docs/16-meta-capi-boas-praticas.md, seção 1 (doc oficial lida em
// 04/set/2026). Normalização errada não degrada o match — zera, e some do
// painel como 100% de "cobertura". Por isso cada regra tem teste.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildUserData,
  hashValue,
  normalizeGeo,
  normalizeName,
  normalizePhone,
} from "./capi-sender.ts";

// ─── Telefone ────────────────────────────────────────────────────────────────

Deno.test("telefone: nunca sai com o '+' (é símbolo, a Meta manda remover)", () => {
  assertEquals(normalizePhone("(11) 98888-7777").includes("+"), false);
  assertEquals(normalizePhone("+55 11 98888-7777").includes("+"), false);
});

Deno.test("telefone: celular com DDD vira 55 + DDD + 9 dígitos", () => {
  assertEquals(normalizePhone("(11) 98888-7777"), "5511988887777");
  assertEquals(normalizePhone("11988887777"), "5511988887777");
  assertEquals(normalizePhone("+55 (11) 98888-7777"), "5511988887777");
  assertEquals(normalizePhone("5511988887777"), "5511988887777");
});

Deno.test("telefone: celular antigo de 8 dígitos ganha o 9", () => {
  assertEquals(normalizePhone("(11) 8888-7777"), "5511988887777");
  assertEquals(normalizePhone("5511 8888-7777"), "5511988887777");
});

Deno.test("telefone: fixo de 8 dígitos NÃO ganha o 9", () => {
  assertEquals(normalizePhone("(11) 3333-4444"), "551133334444");
});

Deno.test("telefone: DDD 55 (RS) não é confundido com código de país", () => {
  // 10 dígitos começando em 55 = DDD do RS, não "+55 + 8 dígitos".
  assertEquals(normalizePhone("(55) 3333-4444"), "555533334444");
  assertEquals(normalizePhone("(55) 99999-8888"), "5555999998888");
});

Deno.test("telefone: zero à esquerda some", () => {
  assertEquals(normalizePhone("011988887777"), "5511988887777");
});

Deno.test("telefone: número irreconhecível vira vazio (não infla cobertura)", () => {
  assertEquals(normalizePhone("1234"), "");
  assertEquals(normalizePhone("não tenho"), "");
  assertEquals(normalizePhone(""), "");
  assertEquals(normalizePhone("11988887777999999"), "");
});

// ─── Texto ───────────────────────────────────────────────────────────────────

Deno.test("nome: minúscula, sem acento, sem pontuação", () => {
  assertEquals(normalizeName("João da Silva"), "joao da silva");
  assertEquals(normalizeName("  MARIA   J. CONCEIÇÃO "), "maria j conceicao");
});

Deno.test("geo: sem acento e sem espaço", () => {
  assertEquals(normalizeGeo("São Paulo"), "saopaulo");
  assertEquals(normalizeGeo("Belo Horizonte"), "belohorizonte");
  assertEquals(normalizeGeo("SP"), "sp");
});

// ─── user_data ───────────────────────────────────────────────────────────────

Deno.test("buildUserData: country vai hasheado, não em texto puro", async () => {
  const ud = await buildUserData({ email: "a@b.com" });
  assertEquals(ud.country, [await hashValue("br")]);
});

Deno.test("buildUserData: ph é o hash do telefone já normalizado", async () => {
  const ud = await buildUserData({ phone: "(11) 98888-7777" });
  assertEquals(ud.ph, [await hashValue("5511988887777")]);
});

Deno.test("buildUserData: telefone quebrado não vira campo ph", async () => {
  const ud = await buildUserData({ email: "a@b.com", phone: "1234" });
  assertEquals(ud.ph, undefined);
});

Deno.test("buildUserData: cidade composta perde o espaço antes do hash", async () => {
  const ud = await buildUserData({ cidade: "Belo Horizonte", estado: "MG" });
  assertEquals(ud.ct, [await hashValue("belohorizonte")]);
  assertEquals(ud.st, [await hashValue("mg")]);
});

Deno.test("buildUserData: external_id é o sha256 do CNPJ só-dígitos", async () => {
  const ud = await buildUserData({ cnpj: "12.345.678/0001-99" });
  assertEquals(ud.external_id, [await hashValue("12345678000199")]);
});

Deno.test("buildUserData: ip e user_agent passam crus, sem hash", async () => {
  const ud = await buildUserData({ ip: "200.1.2.3", userAgent: "Mozilla/5.0" });
  assertEquals(ud.client_ip_address, "200.1.2.3");
  assertEquals(ud.client_user_agent, "Mozilla/5.0");
});
