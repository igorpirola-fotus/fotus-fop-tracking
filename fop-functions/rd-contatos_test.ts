// Testes do parse de contato do RD CRM. Rodar: deno test fop-functions/rd-contatos_test.ts
//
// Formato conforme GET /crm/v2/contacts (doc oficial + amostra real da conta em
// 27/ago/2026): emails[].email, phones[].phone, organization_id. Contato sem
// empresa não serve para público (não há como ligar ao CNPJ) e é descartado.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseContato, SQL_ENRIQUECER_INTEGRADORES } from "./rd-contatos.ts";

Deno.test("extrai primeiro email e primeiro telefone", () => {
  const c = {
    id: "abc123",
    name: "João Silva",
    organization_id: "org1",
    emails: [{ email: "Joao@Empresa.com.BR " }, { email: "outro@empresa.com" }],
    phones: [{ phone: "(11) 98888-7777", type: "cellphone" }],
  };
  assertEquals(parseContato(c), {
    rd_contact_id: "abc123",
    org_id: "org1",
    nome: "João Silva",
    email: "joao@empresa.com.br",
    phone: "(11) 98888-7777",
  });
});

Deno.test("contato sem organization_id é descartado", () => {
  assertEquals(parseContato({ id: "x", name: "Sem Empresa", emails: [{ email: "a@b.com" }] }), null);
});

Deno.test("contato sem email e sem telefone é descartado", () => {
  assertEquals(
    parseContato({ id: "x", organization_id: "org1", name: "Vazio", emails: [], phones: [], custom_fields: {} }),
    null,
  );
});

Deno.test("aceita contato só com telefone", () => {
  const r = parseContato({ id: "y", organization_id: "org2", name: "Só Fone", phones: [{ phone: "11988887777" }] });
  assertEquals(r?.email, null);
  assertEquals(r?.phone, "11988887777");
});

Deno.test("telefone em custom_fields.celular é aproveitado", () => {
  // Formato real de produção: contato 68711103e7bef70001f00aac (Adalberto, ADM),
  // colhido do CRM em 27/ago/2026 — phones[] vazio e o celular no campo
  // personalizado. Sem este fallback o contato seria descartado e a chave perdida.
  const r = parseContato({
    id: "adm1",
    organization_id: "org1",
    name: "ADALBERTO LIMA SANTOS",
    emails: [],
    phones: [],
    custom_fields: { celular: "(77) 98115-9898" },
  });
  assertEquals(r?.phone, "(77) 98115-9898");
  assertEquals(r?.email, null);
});

Deno.test("phones[] tem precedência sobre custom_fields.celular", () => {
  const r = parseContato({
    id: "adm2",
    organization_id: "org1",
    name: "Dois Fones",
    emails: [],
    phones: [{ phone: "11911112222", type: "mobile" }],
    custom_fields: { celular: "(77) 98115-9898" },
  });
  assertEquals(r?.phone, "11911112222");
});

Deno.test("ignora entrada de email vazia ou sem a chave email", () => {
  const r = parseContato({
    id: "z",
    organization_id: "org3",
    name: "Meio Vazio",
    emails: [{ email: "" }, {}, { email: "valido@x.com" }],
    phones: [],
  });
  assertEquals(r?.email, "valido@x.com");
});

Deno.test("nome vazio vira null, não string vazia", () => {
  const r = parseContato({
    id: "n1",
    organization_id: "org1",
    name: "   ",
    emails: [{ email: "a@b.com" }],
  });
  assertEquals(r?.nome, null);
});

Deno.test("SQL de enriquecimento nunca sobrescreve chave existente", () => {
  // COALESCE(i.email, c.email) garante que o dado da LP (mais recente e do
  // próprio decisor) vence o contato do CRM. Se alguém trocar por c.email,
  // este teste cai — é intencional.
  assertEquals(SQL_ENRIQUECER_INTEGRADORES.includes("COALESCE(i.email, c.email)"), true);
  assertEquals(SQL_ENRIQUECER_INTEGRADORES.includes("COALESCE(i.phone, c.phone)"), true);
  assertEquals(SQL_ENRIQUECER_INTEGRADORES.includes("rd_deal_cnpj_cache"), true);
});

Deno.test("SQL de enriquecimento prioriza contato COM email, não o mais recente", () => {
  // Medido em 27/ago/2026: na Bonfim o contato mais antigo tem telefone e nenhum
  // e-mail, e os importados depois têm os dois. Ordenar só por recência entregaria
  // uma chave em vez de duas — e degradaria o público sem quebrar nada visível.
  assertEquals(SQL_ENRIQUECER_INTEGRADORES.includes("(ct.email IS NOT NULL) DESC"), true);
  assertEquals(SQL_ENRIQUECER_INTEGRADORES.includes("(ct.phone IS NOT NULL) DESC"), true);
});

// ─── Sync por organização (contorno do teto de 10.000 registros do RD) ───────
import { montarFiltroOrgs, ORGS_POR_CHAMADA } from "./rd-contatos.ts";

Deno.test("filtro RDQL de várias organizações numa chamada", () => {
  // Formato validado ao vivo em 27/ago/2026: organization_id:(id1,id2) devolveu
  // os contatos das duas empresas numa requisição.
  assertEquals(montarFiltroOrgs(["a1", "b2"]), "organization_id:(a1,b2)");
});

Deno.test("uma organização só não usa parênteses de lista", () => {
  assertEquals(montarFiltroOrgs(["a1"]), "organization_id:a1");
});

Deno.test("lista vazia devolve string vazia (não filtro que pega tudo)", () => {
  // Um filtro vazio faria a chamada varrer a conta inteira e bater no teto de
  // 10.000 — exatamente o bug que este modo existe para evitar.
  assertEquals(montarFiltroOrgs([]), "");
});

Deno.test("lote de organizações por chamada é conservador", () => {
  // 20 orgs x ~30 contatos = 600 registros: bem abaixo do teto de 10.000 por
  // filtro, e ainda assim ~550 chamadas para 11 mil organizações.
  assertEquals(ORGS_POR_CHAMADA <= 25, true);
  assertEquals(ORGS_POR_CHAMADA >= 10, true);
});
