// rd-contatos.ts — espelho dos contatos do RD CRM em public.rd_contatos.
//
// POR QUE ISSO EXISTE: o rd-sync resolve só CNPJ (o webhook de deal não traz
// contacts — ver rd-crm-client.ts). Resultado medido em 27/ago/2026: 6.869
// integradores que COMPRARAM e apenas 63 deles com e-mail. Sem e-mail/telefone
// não existe Custom Audience. Aqui buscamos a chave de match na API do CRM e
// ligamos ao integrador por org_id → cnpj (public.rd_deal_cnpj_cache).
//
// Validado ao vivo em 27/ago/2026 contra a conta real: 2 de 2 clientes ativos
// sem e-mail no fop-db tinham e-mail E telefone no contato do CRM.
import { q } from "./db.ts";
import { getAccessToken } from "./rd-crm-client.ts";

const RD_API = "https://api.rd.services";

/** Máximo aceito pela API; 190k contatos ÷ 200 ≈ 951 páginas ≈ 8min a 120 req/min. */
const PAGE_SIZE = 200;

export type ContatoRd = {
  rd_contact_id: string;
  org_id: string;
  nome: string | null;
  email: string | null;
  phone: string | null;
};

function primeiro(lista: unknown, chave: string): string | null {
  if (!Array.isArray(lista)) return null;
  for (const item of lista) {
    const valor = (item as Record<string, unknown> | null)?.[chave];
    if (typeof valor === "string" && valor.trim() !== "") return valor.trim();
  }
  return null;
}

export function parseContato(raw: unknown): ContatoRd | null {
  const c = raw as Record<string, unknown>;
  const id = typeof c?.id === "string" ? c.id : "";
  const orgId = typeof c?.organization_id === "string" ? c.organization_id : "";
  if (!id || !orgId) return null;

  const emailBruto = primeiro(c.emails, "email");
  const email = emailBruto ? emailBruto.toLowerCase() : null;

  // phones[] primeiro; se vazio, cai no campo personalizado `celular`.
  // Validado em produção (27/ago/2026): parte dos contatos operacionais tem
  // phones[] vazio e o número em custom_fields.celular.
  let phone = primeiro(c.phones, "phone");
  if (!phone) {
    const cf = c.custom_fields as Record<string, unknown> | undefined;
    const celular = cf?.celular;
    if (typeof celular === "string" && celular.trim() !== "") phone = celular.trim();
  }

  if (!email && !phone) return null;

  return {
    rd_contact_id: id,
    org_id: orgId,
    nome: typeof c.name === "string" && c.name.trim() !== "" ? c.name.trim() : null,
    email,
    phone,
  };
}

// O join que liga contato → integrador: rd_deal_cnpj_cache já mapeia org_id → cnpj
// (populada pelo rd-sync a cada deal). DISTINCT ON escolhe UM contato por CNPJ —
// uma empresa tem vários (a Bonfim tem 7; o Adalberto ~30, quase todos repetidos
// por importações sucessivas).
//
// A ORDEM DA ESCOLHA NÃO É RECÊNCIA, e isso é deliberado: medido em 27/ago/2026,
// o contato mais ANTIGO da Bonfim tem telefone e nenhum e-mail, enquanto os
// importados depois têm os dois. Priorizar e-mail → telefone → recência entrega
// duas chaves de match em vez de uma. Trocar por `atualizado_em DESC` puro
// degrada o público sem quebrar nada visivelmente — não faça.
export const SQL_ENRIQUECER_INTEGRADORES = `
UPDATE public.integradores i
   SET email       = COALESCE(i.email, c.email),
       phone       = COALESCE(i.phone, c.phone),
       email_fonte = CASE WHEN i.email IS NULL AND c.email IS NOT NULL
                          THEN 'rd_contatos' ELSE i.email_fonte END,
       phone_fonte = CASE WHEN i.phone IS NULL AND c.phone IS NOT NULL
                          THEN 'rd_contatos' ELSE i.phone_fonte END,
       updated_at  = now()
  FROM (
        SELECT DISTINCT ON (cache.cnpj)
               cache.cnpj, ct.email, ct.phone
          FROM public.rd_contatos ct
          JOIN public.rd_deal_cnpj_cache cache ON cache.org_id = ct.org_id
         WHERE cache.cnpj IS NOT NULL AND cache.cnpj <> ''
           AND (ct.email IS NOT NULL OR ct.phone IS NOT NULL)
         ORDER BY cache.cnpj,
                  (ct.email IS NOT NULL) DESC,
                  (ct.phone IS NOT NULL) DESC,
                  ct.atualizado_em DESC
       ) c
 WHERE i.cnpj = c.cnpj
   AND ((i.email IS NULL AND c.email IS NOT NULL)
     OR (i.phone IS NULL AND c.phone IS NOT NULL))
RETURNING i.cnpj
`;

/** Extrai o array de contatos da resposta, tolerando as formas conhecidas. */
function extrairItens(body: unknown): unknown[] {
  const b = body as Record<string, unknown>;
  if (Array.isArray(b?.contacts)) return b.contacts as unknown[];
  if (Array.isArray(b?.data)) return b.data as unknown[];
  if (Array.isArray(body)) return body as unknown[];
  return [];
}

export async function syncContatosRd(paginaInicial: number, maxPaginas: number): Promise<{
  paginas: number;
  contatos_lidos: number;
  contatos_gravados: number;
  proxima_pagina: number | null;
}> {
  let pagina = paginaInicial;
  let lidos = 0, gravados = 0, paginas = 0;
  let proxima: number | null = null;

  while (paginas < maxPaginas) {
    const token = await getAccessToken();
    const url = `${RD_API}/crm/v2/contacts?page%5Bnumber%5D=${pagina}&page%5Bsize%5D=${PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    // 429 = limite de 120 req/min da conta. Devolver o cursor em vez de morrer:
    // o chamador (n8n) espera 60s e retoma exatamente daqui.
    if (res.status === 429) {
      return {
        paginas,
        contatos_lidos: lidos,
        contatos_gravados: gravados,
        proxima_pagina: pagina,
      };
    }
    if (!res.ok) {
      throw new Error(`GET /crm/v2/contacts p${pagina}: ${res.status} ${await res.text()}`);
    }

    const itens = extrairItens(await res.json());
    lidos += itens.length;
    paginas++;

    for (const item of itens) {
      const c = parseContato(item);
      if (!c) continue;
      await q(
        `INSERT INTO public.rd_contatos (rd_contact_id, org_id, nome, email, phone, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (rd_contact_id) DO UPDATE
            SET org_id = EXCLUDED.org_id, nome = EXCLUDED.nome,
                email = EXCLUDED.email, phone = EXCLUDED.phone, atualizado_em = now()`,
        [c.rd_contact_id, c.org_id, c.nome, c.email, c.phone],
      );
      gravados++;
    }

    // Página incompleta = fim da lista.
    if (itens.length < PAGE_SIZE) {
      proxima = null;
      break;
    }
    pagina++;
    proxima = pagina;
  }

  return { paginas, contatos_lidos: lidos, contatos_gravados: gravados, proxima_pagina: proxima };
}

/** Devolve quantos integradores ganharam chave de match. */
export async function enriquecerIntegradores(): Promise<number> {
  const linhas = await q<{ cnpj: string }>(SQL_ENRIQUECER_INTEGRADORES);
  return linhas.length;
}
