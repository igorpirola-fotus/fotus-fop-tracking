// atribuicao.ts — origem de CADA NEGÓCIO, não do integrador.
//
// REQUISITO (Igor, 30/jul/2026), nas palavras dele:
//   "cada deal tem uma origem e é isso que preciso preservar — a utm de origem
//    dele. uma empresa fez o primeiro contato através de uma campanha de google
//    search ads, mas depois de um mês recebeu um email e ali fez uma compra. 3
//    meses depois fez mais dois pedidos através de uma comunicação que o
//    consultor fez pelo whatsapp corporativo. temos 3 negócios da mesma empresa
//    com fontes distintas. é isso que o FOP precisa trazer."
//
// O QUE ESTAVA ERRADO: a análise de LTV por canal usava a PRIMEIRA sessão do
// integrador e jogava o LTV inteiro naquele canal. No exemplo acima, os 4
// pedidos sairiam todos como "google search" — o e-mail e o WhatsApp do
// consultor nunca apareceriam, e o google levaria crédito por 3 vendas que não
// originou.
//
// ORDEM DE RESOLUÇÃO (do sinal mais específico ao mais genérico):
//   1. UTM no próprio deal — o RD grava nos custom fields quando o lead nasce de
//      campanha. Medido em 30/jul: preenchido em 66% dos deals do Funil SDR e
//      100% do IA SDR. É o sinal mais confiável, porque é do NEGÓCIO.
//   2. Sessão do site ANTERIOR à criação do deal — a última sessão rastreada
//      antes de o negócio existir. NB: "anterior ao deal", não "a mais recente
//      do integrador"; usar a mais recente contaminaria um pedido antigo com
//      uma visita de ontem.
//   3. `deal_source` do CRM — "Negociação criada automaticamente" (= pedido que
//      entrou pelo ERP, venda de balcão), "BASE MKT", "Prospecção Ativa",
//      "Carteira". Não é UTM, mas responde "quem originou".
//   4. Sem origem — registrado como tal, nunca chutado.
import { one } from "./db.ts";

export interface Atribuicao {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  deal_source: string | null;
  session_id: string | null;
  /** De onde a origem veio: crm_utm | sessao_anterior | deal_source | sem_origem */
  fonte: string;
}

/** Normaliza canal/mídia: `Meta`, `META`, `facebook`, `fb` viram a mesma coisa. */
export function normalizeCanal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === "(not set)" || s === "null" || s === "undefined") return null;

  // Fragmentação real medida em 30/jul no fop-db: meta/facebook/fb e
  // instagram/ig quebravam o mesmo canal em linhas separadas na análise.
  const mapa: Record<string, string> = {
    fb: "meta",
    facebook: "meta",
    "facebook.com": "meta",
    ig: "instagram",
    "instagram.com": "instagram",
    "paid_social": "paid-social",
    "paidsocial": "paid-social",
    paid: "paid-social",
    cpc: "paid-search",
    "paid_search": "paid-search",
    ppc: "paid-search",
  };
  return mapa[s] ?? s;
}

/** Lê os custom fields de UTM do deal (webhook ou listagem). */
export function extractUtmDoDeal(deal: unknown): Partial<Atribuicao> {
  const out: Partial<Atribuicao> = {};
  if (!deal || typeof deal !== "object") return out;
  const o = deal as Record<string, unknown>;
  const doc = (o.document as Record<string, unknown> | undefined) ?? o;

  // Mapa dos slugs reais do CRM da Fotus (descobertos em 30/jul):
  //   origem-utm · canal-utm · campanha-utm · content-utm · termo-busca
  const porChave = (chave: string): string | null => {
    const k = chave.toLowerCase();
    if (/(^|[^a-z])origem/.test(k) && k.includes("utm")) return "utm_source";
    if (/(^|[^a-z])canal/.test(k) && k.includes("utm")) return "utm_medium";
    if (k.includes("campanha") && k.includes("utm")) return "utm_campaign";
    if (k.includes("content") && k.includes("utm")) return "utm_content";
    if (k.includes("termo") || k.includes("busca")) return "utm_term";
    return null;
  };

  // Formato da listagem: { "origem-utm": "google", ... }
  const obj = doc.custom_fields as Record<string, unknown> | undefined;
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const campo = porChave(k);
      if (campo && v !== null && v !== undefined && String(v).trim() !== "") {
        (out as Record<string, unknown>)[campo] = String(v).trim();
      }
    }
  }

  // Formato do webhook: [{ value, custom_field: { label } }]
  const arr = doc.deal_custom_fields as unknown[] | undefined;
  if (Array.isArray(arr)) {
    for (const item of arr) {
      const f = item as Record<string, unknown>;
      const label = (f.custom_field as Record<string, unknown> | undefined)?.label;
      if (typeof label !== "string") continue;
      const campo = porChave(label);
      if (campo && f.value !== null && f.value !== undefined && String(f.value).trim() !== "") {
        (out as Record<string, unknown>)[campo] = String(f.value).trim();
      }
    }
  }

  // Normaliza só canal e mídia; campanha/conteúdo/termo ficam como estão.
  if (out.utm_source) out.utm_source = normalizeCanal(out.utm_source);
  if (out.utm_medium) out.utm_medium = normalizeCanal(out.utm_medium);

  const src = doc.deal_source as Record<string, unknown> | undefined;
  if (src?.name) out.deal_source = String(src.name);

  return out;
}

/**
 * Resolve a origem de UM negócio.
 *
 * `criadoEm` é a data de criação do DEAL: define o corte temporal da sessão.
 * Sem esse corte, um pedido de janeiro herdaria a UTM de uma visita de julho.
 */
export async function resolverAtribuicaoDoDeal(params: {
  deal: unknown;
  integradorId: string | null;
  criadoEm: string | null;
}): Promise<Atribuicao> {
  const base: Atribuicao = {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    deal_source: null,
    session_id: null,
    fonte: "sem_origem",
  };

  const doCrm = extractUtmDoDeal(params.deal);
  Object.assign(base, doCrm);

  // 1. UTM do próprio deal — o sinal mais específico que existe.
  if (base.utm_source || base.utm_campaign) {
    base.fonte = "crm_utm";
    return base;
  }

  // 2. Sessão anterior à criação do deal.
  if (params.integradorId) {
    const sess = await one<{
      session_id: string;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      utm_content: string | null;
      utm_term: string | null;
    }>(
      `SELECT session_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term
         FROM public.sessions
        WHERE integrador_id = $1
          AND ($2::timestamptz IS NULL OR created_at <= $2::timestamptz)
          AND utm_source IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [params.integradorId, params.criadoEm],
    );
    if (sess) {
      base.session_id = sess.session_id;
      base.utm_source = normalizeCanal(sess.utm_source);
      base.utm_medium = normalizeCanal(sess.utm_medium);
      base.utm_campaign = sess.utm_campaign;
      base.utm_content = sess.utm_content;
      base.utm_term = sess.utm_term;
      base.fonte = "sessao_anterior";
      return base;
    }
  }

  // 3. Fonte do negócio no CRM — não é UTM, mas diz quem originou.
  if (base.deal_source) {
    base.fonte = "deal_source";
    return base;
  }

  return base;
}
