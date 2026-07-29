// rd-crm-client.ts — cliente da API do RD Station CRM v2 para o rd-sync.
//
// Resolve o problema achado na auditoria de 29/jul/2026: o webhook de deal do RD
// não traz o CNPJ (nem `organization`, nem `contacts`, nem `organization_id`),
// então o rd-sync falhava em 100% dos deals em etapa mapeada e nunca gerava
// Contact/Schedule/AddToCart/Purchase. Aqui buscamos o deal completo na API — que
// traz a organização — e daí extraímos o CNPJ.
//
// Três cuidados que o caminho antigo não tinha:
//  1. TOKEN: o access_token do CRM expira em 2h e o refresh_token é ROTATIVO
//     (cada uso invalida o anterior; 14 dias sem uso e morre). O par fica em
//     public.oauth_tokens e a renovação é serializada por advisory lock, senão
//     dois refreshes concorrentes derrubam a credencial.
//  2. RATE LIMIT: 120 req/min no CRM, contra picos de 10k webhooks/hora →
//     cache deal→CNPJ (com negative caching) e respeito ao Retry-After no 429.
//  3. FALHA ISOLADA: nada aqui pode derrubar o recebimento do webhook; quem
//     chama trata "" como "não resolvido" e marca a linha para reprocessar.

import { one, q, withAdvisoryLock } from "./db.ts";
import { cleanCnpj, findCnpjDeep } from "./cnpj.ts";

const RD_API = "https://api.rd.services";
const PROVIDER = "rd_crm";
/** Chave arbitrária e estável do advisory lock do refresh (só precisa ser única). */
const LOCK_KEY_TOKEN_REFRESH = 815_2026;
/** Renova um pouco antes de expirar para não perder corrida com a borda. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;
/** Idade máxima do cache deal→CNPJ (deal pode trocar de empresa). */
const CACHE_TTL_HOURS = 24 * 7;

interface TokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/** Single-flight por instância: evita N refreshes simultâneos no mesmo container. */
let inflightRefresh: Promise<string> | null = null;

/**
 * Access token válido do RD CRM. Renova (e persiste o novo par) quando preciso.
 * Semeia a tabela a partir das envs na primeira execução.
 */
export async function getAccessToken(): Promise<string> {
  const row = await one<TokenRow>(
    "SELECT access_token, refresh_token, expires_at FROM public.oauth_tokens WHERE provider = $1",
    [PROVIDER],
  );

  if (!row) {
    // Seed inicial: envs setadas manualmente no EasyPanel.
    const at = Deno.env.get("RD_CRM_TOKEN");
    const rt = Deno.env.get("RD_CRM_REFRESH_TOKEN");
    if (!at || !rt) {
      throw new Error(
        "oauth_tokens sem registro rd_crm e envs RD_CRM_TOKEN/RD_CRM_REFRESH_TOKEN ausentes",
      );
    }
    // expires_at no passado força um refresh imediato — o access token semeado
    // pode já estar vencido (ele dura 2h).
    await q(
      `INSERT INTO public.oauth_tokens (provider, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 minute')
       ON CONFLICT (provider) DO NOTHING`,
      [PROVIDER, at, rt],
    );
    return await refreshAccessToken();
  }

  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() + RENEW_MARGIN_MS < expiresAt) return row.access_token;

  return await refreshAccessToken();
}

async function refreshAccessToken(): Promise<string> {
  if (inflightRefresh) return await inflightRefresh;

  inflightRefresh = withAdvisoryLock(LOCK_KEY_TOKEN_REFRESH, async (run) => {
    // Reler DENTRO do lock: outra instância pode ter renovado enquanto esperávamos.
    const rows = await run<TokenRow>(
      "SELECT access_token, refresh_token, expires_at FROM public.oauth_tokens WHERE provider = $1",
      [PROVIDER],
    );
    const cur = rows[0];
    if (!cur) throw new Error("oauth_tokens: registro rd_crm desapareceu");
    if (Date.now() + RENEW_MARGIN_MS < new Date(cur.expires_at).getTime()) {
      return cur.access_token;
    }

    const clientId = Deno.env.get("RD_CRM_CLIENT_ID");
    const clientSecret = Deno.env.get("RD_CRM_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new Error("RD_CRM_CLIENT_ID/RD_CRM_CLIENT_SECRET não definidos");
    }

    // Content-Type form-urlencoded é obrigatório neste endpoint (não aceita JSON).
    const res = await fetch(`${RD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: cur.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`refresh do token RD CRM falhou (${res.status}): ${detail}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const expiresIn = data.expires_in ?? 7200;

    // O RD devolve refresh_token novo e invalida o antigo → gravar SEMPRE.
    await run(
      `UPDATE public.oauth_tokens
          SET access_token = $2,
              refresh_token = $3,
              expires_at = now() + ($4 || ' seconds')::interval,
              updated_at = now()
        WHERE provider = $1`,
      [PROVIDER, data.access_token, data.refresh_token ?? cur.refresh_token, String(expiresIn)],
    );

    return data.access_token;
  }).finally(() => {
    inflightRefresh = null;
  });

  return await inflightRefresh;
}

/**
 * GET autenticado na API do CRM. Renova o token no 401 e respeita Retry-After
 * no 429 (rate limit 120 req/min). Devolve null quando o recurso não existe.
 */
async function rdGet(path: string, attempt = 0): Promise<Record<string, unknown> | null> {
  const token = await getAccessToken();
  const res = await fetch(`${RD_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (res.ok) {
    const body = await res.json();
    return (body?.data ?? body) as Record<string, unknown>;
  }

  if (res.status === 404) return null;

  if (res.status === 401 && attempt === 0) {
    // Token pode ter sido revogado antes do vencimento previsto: força refresh.
    await q(
      "UPDATE public.oauth_tokens SET expires_at = now() - interval '1 minute' WHERE provider = $1",
      [PROVIDER],
    );
    return await rdGet(path, attempt + 1);
  }

  if (res.status === 429 && attempt < 2) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "2");
    const waitMs = Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000, 10_000);
    await new Promise((r) => setTimeout(r, waitMs));
    return await rdGet(path, attempt + 1);
  }

  throw new Error(`RD CRM GET ${path} → ${res.status}`);
}

/**
 * Lista deals GANHOS, mais antigos primeiro. Usado pelo backfill.
 * Ordem `closed_at asc` importa: garante que `data_primeira_compra` seja
 * realmente a primeira. NB: listagens do CRM devolvem no máximo os 10.000
 * primeiros registros do filtro (limite da API, documentado).
 */
export async function listWonDeals(
  page: number,
  pageSize: number,
  desde?: string,
  ate?: string,
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams();
  // Janela de datas é OBRIGATÓRIA para cobrir o histórico completo: medido em
  // 29/jul/2026, a API devolve HTTP 400 no registro 10.001 e existem ≥10.000
  // deals ganhos. Sem fatiar por período, tudo antes dos 10.000 mais antigos
  // ficaria invisível — o backfill silenciosamente cobriria menos do que parece.
  const partes = ["status:won"];
  if (desde) partes.push(`closed_at:>=${desde}`);
  if (ate) partes.push(`closed_at:<${ate}`);
  qs.set("filter", partes.join(" and "));
  qs.set("sort[closed_at]", "asc");
  qs.set("page[number]", String(page));
  qs.set("page[size]", String(pageSize));

  const body = await rdGet(`/crm/v2/deals?${qs.toString()}`);
  if (!body) return [];
  // A API embrulha em `data` (já desembrulhado por rdGet) e pode devolver o
  // array direto ou dentro de outra chave de coleção.
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  for (const k of ["deals", "items", "results"]) {
    const v = (body as Record<string, unknown>)[k];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

/**
 * Metadados da listagem de deals ganhos, para dimensionar o backfill antes de
 * rodá-lo: quantas páginas/registros existem. Uma única chamada, sem varrer.
 * Devolve o envelope cru (links/meta) porque o formato varia entre versões da
 * API — quem chama inspeciona o que veio.
 */
export async function wonDealsMeta(
  desde?: string,
  ate?: string,
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const partes = ["status:won"];
  if (desde) partes.push(`closed_at:>=${desde}`);
  if (ate) partes.push(`closed_at:<${ate}`);
  const qs = new URLSearchParams({
    "filter": partes.join(" and "),
    "page[number]": "1",
    "page[size]": "1",
  });
  const res = await fetch(`${RD_API}/crm/v2/deals?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`RD CRM meta deals → ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  // Sem o `data`, que é o deal em si — aqui só interessa paginação/contagem.
  const { data: _data, ...resto } = body;
  return resto;
}

interface ResolvedCnpj {
  cnpj: string;
  fonte: string;
  orgId: string | null;
}

/**
 * Resolve o CNPJ de um deal, na ordem mais barata → mais cara:
 *   1. o próprio payload do webhook (grátis)
 *   2. cache public.rd_deal_cnpj_cache (grátis; inclui negative caching)
 *   3. GET /crm/v2/deals/{id} — o deal completo traz a organização
 *   4. GET /crm/v2/organizations/{org_id} — quando o deal só traz o id da empresa
 *
 * Devolve cnpj "" quando o deal realmente não tem CNPJ. Nunca lança por
 * indisponibilidade da API: nesse caso propaga o erro para quem chama decidir
 * (o webhook fica marcado para reprocessamento).
 */
export async function resolveDealCnpj(
  rdDealId: string,
  webhookPayload: unknown,
): Promise<ResolvedCnpj> {
  // 1. Payload do webhook.
  const fromPayload = findCnpjDeep(webhookPayload);
  if (fromPayload) return { cnpj: fromPayload, fonte: "webhook_payload", orgId: null };

  if (!rdDealId) return { cnpj: "", fonte: "sem_deal_id", orgId: null };

  // 2. Cache (positivo e negativo).
  const cached = await one<{ cnpj: string | null; org_id: string | null; fresh: boolean }>(
    `SELECT cnpj, org_id, (updated_at > now() - ($2 || ' hours')::interval) AS fresh
       FROM public.rd_deal_cnpj_cache WHERE rd_deal_id = $1`,
    [rdDealId, String(CACHE_TTL_HOURS)],
  );
  if (cached?.fresh) {
    return { cnpj: cached.cnpj ?? "", fonte: "cache", orgId: cached.org_id };
  }

  // 3. Deal completo.
  let orgId: string | null = null;
  let cnpj = "";
  let fonte = "deal_api";

  const deal = await rdGet(`/crm/v2/deals/${rdDealId}`);
  if (deal) {
    const org = deal.organization as Record<string, unknown> | undefined;
    orgId = (org?.id as string) || (deal.organization_id as string) || null;
    cnpj = findCnpjDeep(deal);
  }

  // 4. Organização. Validado em 29/jul/2026 com deals reais: o deal NUNCA traz
  //    `organization` inline, só `organization_id` — o CNPJ vive em
  //    `organization.custom_fields["cnpj-41d5"]`. Ou seja, este passo é a regra,
  //    não a exceção: são 2 chamadas por deal novo, contra 120 req/min.
  //    Por isso, antes de gastar a 2ª chamada, olhamos se a MESMA organização já
  //    foi resolvida por outro deal (vários deals por integrador é o normal aqui).
  if (!cnpj && orgId) {
    const irmao = await one<{ cnpj: string }>(
      `SELECT cnpj FROM public.rd_deal_cnpj_cache
        WHERE org_id = $1 AND cnpj IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`,
      [orgId],
    );
    if (irmao?.cnpj) {
      cnpj = irmao.cnpj;
      fonte = "cache_organizacao";
    } else {
      const organization = await rdGet(`/crm/v2/organizations/${orgId}`);
      if (organization) {
        cnpj = findCnpjDeep(organization);
        if (cnpj) fonte = "organization_api";
      }
    }
  }

  await q(
    `INSERT INTO public.rd_deal_cnpj_cache (rd_deal_id, cnpj, org_id, fonte, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (rd_deal_id) DO UPDATE
        SET cnpj = EXCLUDED.cnpj, org_id = EXCLUDED.org_id,
            fonte = EXCLUDED.fonte, updated_at = now()`,
    [rdDealId, cnpj ? cleanCnpj(cnpj) : null, orgId, cnpj ? fonte : "nao_encontrado"],
  );

  return { cnpj: cnpj ? cleanCnpj(cnpj) : "", fonte: cnpj ? fonte : "nao_encontrado", orgId };
}
