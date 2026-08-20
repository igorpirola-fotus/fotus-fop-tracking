// server.ts — FOP tracking server-side (Deno standalone, self-hosted no EasyPanel).
// Porta as Edge Functions track-event, enrich-cnpj e rd-sync do Supabase para Postgres direto (fop-db).
// Regras preservadas do CLAUDE.md: SHA-256 PII, dedup por event_id, retry CAPI, GA4 fire-and-forget, geo Cloudflare.
import { insert, logError, one, q, update } from "./db.ts";
import { buildUserData, normalizePhone, sendToCAPI } from "./capi-sender.ts";
import { sendToGA4 } from "./ga4-sender.ts";
import { listWonDeals, resolveDealCnpj, wonDealsMeta } from "./rd-crm-client.ts";
import { cleanCnpj, findCnpjDeep } from "./cnpj.ts";
import { backfillWon, preencherPipelines } from "./backfill-integradores.ts";
import { extractPipelineId, isFunilDeVenda } from "./funis.ts";
import { resolverAtribuicaoDoDeal } from "./atribuicao.ts";
import { buildResult, type Canal } from "./utm-builder.ts";
import { buildAppleLink, buildPlayLink, buildSmartLink, slug } from "./app-links.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// O GTM já envia Meta Pixel/CAPI + GA4 com deduplicação por event_id.
// Por padrão, este servidor só GRAVA NO BANCO (evita double-count no Meta/GA4).
// Para reativar o envio server-side, setar env CAPI_ENABLED=true.
// ATENÇÃO: esta flag vale só para /track-event (eventos de site que o GTM duplica).
// O /rd-sync NÃO usa esta flag — ver comentário na seção rd-sync.
const CAPI_ENABLED = Deno.env.get("CAPI_ENABLED") === "true";

// Eventos de CRM só vão ao Meta/GA4 se o integrador tiver sessão rastreada
// (sinal de mídia). Grava no banco sempre. Ver comentário no gate, em
// processRdEvent. Default LIGADO — desligar só por decisão explícita.
const REQUIRE_SESSION_FOR_CAPI = Deno.env.get("RD_SYNC_CAPI_REQUIRE_SESSION") !== "false";


// ─────────────────────────── rd-sync: mapas ─────────────────────────────────
// Etapa RD CRM → evento Meta/GA4 (chaves em lowercase; nomes reais das etapas — doc 11)
const STAGE_TO_EVENT: Record<string, string> = {
  "contato realizado": "Contact",   // SDR + BDR
  "em contato":        "Contact",   // Funil Comercial
  "qualificado sqls":  "Schedule",  // SQL "Lead Qualificado Fotus" — otimização das campanhas
  "reunião agendada":  "AddToCart", // SDR → handoff Comercial
  "negociação":        "AddToCart", // BDR
  "orçamento":         "AddToCart", // Funil Comercial
  "perdido":           "OportunidadePerdida",
  "ganho":             "Purchase",  // deal won no RD
};

const EVENT_TO_STATUS: Record<string, string> = {
  Contact: "em_contato",
  Schedule: "qualificado",
  AddToCart: "proposta",
  OportunidadePerdida: "perdido",
  Purchase: "cliente",
  PurchaseRecorrente: "cliente",
};

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─────────────────────────── track-event ────────────────────────────────────
async function trackEvent(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const {
      event_id, event_name, session_id,
      fbp, fbc,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, ga4_client_id, ga4_session_id,
      referrer, page_url, device_type,
      scroll_depth_pct, time_on_page_seconds,
      email, phone, nome, cnpj, estado,
      test_event_code,
    } = body;

    if (!event_id || !event_name || !session_id) {
      return json({ error: "event_id, event_name e session_id são obrigatórios" }, 400);
    }

    // Geo via Cloudflare headers (zero latência)
    const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for") || "";
    const country = req.headers.get("CF-IPCountry") || "BR";
    const cfState = req.headers.get("CF-IPRegion") || "";
    const cfCity = req.headers.get("CF-IPCity") || "";
    const userAgent = req.headers.get("user-agent") || "";
    const geoState = estado || cfState;
    const geoCity = cfCity;

    // 1. Upsert session
    await insert("public.sessions", {
      session_id, fbp, fbc,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      ip_address: ip || null,
      user_agent: userAgent || null,
      country,
      state: geoState || null,
      city: geoCity || null,
      gclid: gclid || null,
      ga4_client_id: ga4_client_id || null,
      ga4_session_id: ga4_session_id || null,
      referrer: referrer || null,
      device_type: device_type || null,
      scroll_depth_pct: scroll_depth_pct ?? null,
      time_on_page_seconds: time_on_page_seconds ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "session_id" });

    // 2. Upsert integrador (somente Lead com CNPJ)
    let integradorId: string | null = null;
    let isNewIntegrador = false;

    if (event_name === "Lead" && cnpj) {
      const cnpjClean = cnpj.replace(/\D/g, "");
      const existing = await one<{ id: string; status: string }>(
        "SELECT id, status FROM public.integradores WHERE cnpj = $1",
        [cnpjClean],
      );
      isNewIntegrador = !existing;

      const payload: Record<string, unknown> = {
        cnpj: cnpjClean,
        email: email || null,
        phone: phone ? normalizePhone(phone).replace("+", "") : null,
        nome_contato: nome || null,
        estado_operacao: geoState || null,
        cidade_operacao: geoCity || null,
        status: existing?.status ?? "lead",
        updated_at: new Date().toISOString(),
      };
      if (isNewIntegrador) payload.data_primeiro_contato = new Date().toISOString();

      const int = await insert("public.integradores", payload, { onConflict: "cnpj", returning: "id" });
      integradorId = (int?.id as string) ?? null;

      if (integradorId) {
        await update("public.sessions", { integrador_id: integradorId }, "session_id", session_id);
      }
    } else {
      const sess = await one<{ integrador_id: string | null }>(
        "SELECT integrador_id FROM public.sessions WHERE session_id = $1",
        [session_id],
      );
      integradorId = sess?.integrador_id ?? null;
    }

    // 3. Enrich CNPJ async para novos integradores (fire-and-forget, chamada local)
    if (isNewIntegrador && integradorId && cnpj) {
      enrichCnpj(cnpj.replace(/\D/g, ""), integradorId).catch(() => {});
    }

    // 4. User data com Advanced Matching (SHA-256)
    const userData = await buildUserData({
      email: email || undefined,
      phone: phone || undefined,
      nome: nome || undefined,
      estado: geoState || undefined,
      cidade: geoCity || undefined,
      ip,
      userAgent,
      fbp: fbp || undefined,
      fbc: fbc || undefined,
    });

    const matchKeys = {
      has_em: !!userData.em, has_ph: !!userData.ph, has_fn: !!userData.fn,
      has_fbp: !!userData.fbp, has_fbc: !!userData.fbc, has_ct: !!userData.ct, has_st: !!userData.st,
    };

    // 5. Insert evento (pending) — ON CONFLICT event_id DO NOTHING (dedup client-side)
    await insert("public.events", {
      event_id, session_id, integrador_id: integradorId,
      event_name, event_source: "website", funnel: "aquisicao",
      event_data: JSON.stringify(body),
      meta_capi_status: "pending",
      match_keys: JSON.stringify(matchKeys),
      gclid: gclid || null,
      utm_source: utm_source || null,
      utm_campaign: utm_campaign || null,
      utm_content: utm_content || null,
    }, { onConflict: "event_id", conflictDoNothing: true });

    // 6. Meta CAPI + 7. GA4 — só quando CAPI_ENABLED (padrão OFF: o GTM já envia com dedup).
    let capiOk = false;
    if (CAPI_ENABLED) {
      const capiResult = await sendToCAPI({
        event_name, event_id,
        event_source_url: page_url || undefined,
        action_source: "website",
        user_data: userData,
        custom_data: cnpj ? { cnpj: cnpj.replace(/\D/g, "") } : undefined,
        test_event_code: test_event_code || undefined,
      });
      capiOk = capiResult.success;

      await update("public.events", {
        meta_capi_status: capiResult.success ? "sent" : "failed",
        meta_event_id: capiResult.eventId || null,
        meta_fbtrace_id: capiResult.fbtrace_id || null,
        meta_error: capiResult.error || null,
        meta_retry_count: capiResult.success ? 0 : 1,
      }, "event_id", event_id);

      sendToGA4({
        event_name,
        client_id: ga4_client_id || session_id,
        session_id,
        user_id: integradorId || undefined,
        event_params: {
          page_location: page_url || undefined,
          utm_source, utm_campaign, utm_content,
          gclid: gclid || undefined,
        },
      });
    } else {
      // Modo só-banco: marca que o Meta/GA4 é responsabilidade do GTM.
      await update("public.events", { meta_capi_status: "gtm" }, "event_id", event_id);
    }

    return json({ success: true, capi: capiOk, integrador_id: integradorId });
  } catch (error) {
    await logError("track-event", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
}

// ─────────────────────────── enrich-cnpj ─────────────────────────────────────
function calcularScoreInicial(dados: Record<string, unknown>): number {
  let score = 20;
  if (dados.porte === "MEDIO") score += 25;
  else if (dados.porte === "GRANDE") score += 35;
  else if (dados.porte === "MICRO EMPRESA" || dados.porte === "EMPRESA DE PEQUENO PORTE") score += 15;

  const anos = dados.anos_mercado as number;
  if (anos >= 5) score += 20;
  else if (anos >= 2) score += 10;

  if ((dados.situacao_cadastral as string)?.toUpperCase() === "ATIVA") score += 10;

  const cnae = String(dados.cnae_principal || "");
  if (cnae.startsWith("43") || cnae.startsWith("35")) score += 10;

  return Math.min(score, 100);
}

async function enrichCnpj(cnpj: string, integradorId: string): Promise<{ success: boolean }> {
  try {
    const cnpjClean = cnpj.replace(/\D/g, "");
    const apiRes = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjClean}`);
    if (!apiRes.ok) {
      await logError("enrich-cnpj", `BrasilAPI retornou ${apiRes.status} para CNPJ ${cnpjClean}`, { cnpj: cnpjClean, integrador_id: integradorId });
      return { success: false };
    }
    const dados = await apiRes.json();

    let anosNoMercado: number | null = null;
    if (dados.data_inicio_atividade) {
      const inicio = new Date(dados.data_inicio_atividade);
      anosNoMercado = Math.floor((Date.now() - inicio.getTime()) / (1000 * 60 * 60 * 24 * 365));
    }

    const enrichPayload: Record<string, unknown> = {
      razao_social: dados.razao_social || null,
      nome_fantasia: dados.nome_fantasia || null,
      cnae_principal: dados.cnae_fiscal?.toString() || null,
      cnae_descricao: dados.cnae_fiscal_descricao || null,
      porte: dados.porte || null,
      data_abertura: dados.data_inicio_atividade || null,
      anos_mercado: anosNoMercado,
      situacao_cadastral: dados.descricao_situacao_cadastral || null,
      capital_social: dados.capital_social || null,
      endereco_logradouro: dados.logradouro || null,
      endereco_numero: dados.numero || null,
      endereco_complemento: dados.complemento || null,
      endereco_bairro: dados.bairro || null,
      endereco_municipio: dados.municipio || null,
      endereco_uf: dados.uf || null,
      endereco_cep: dados.cep?.replace(/\D/g, "") || null,
      updated_at: new Date().toISOString(),
    };

    const scoreNovo = calcularScoreInicial({
      porte: enrichPayload.porte,
      anos_mercado: anosNoMercado,
      situacao_cadastral: enrichPayload.situacao_cadastral,
      cnae_principal: enrichPayload.cnae_principal,
    });

    const intAtual = await one<{ lead_score: number | null }>(
      "SELECT lead_score FROM public.integradores WHERE id = $1",
      [integradorId],
    );
    const scoreAnterior = intAtual?.lead_score ?? 0;
    if (scoreNovo > scoreAnterior) enrichPayload.lead_score = scoreNovo;

    await update("public.integradores", enrichPayload, "id", integradorId);

    if (scoreNovo > scoreAnterior) {
      await insert("public.lead_score_log", {
        integrador_id: integradorId,
        score_anterior: scoreAnterior,
        score_novo: scoreNovo,
        delta: scoreNovo - scoreAnterior,
        motivo: "enriquecimento_cnpj",
      });
    }
    return { success: true };
  } catch (error) {
    await logError("enrich-cnpj", (error as Error).message);
    return { success: false };
  }
}

async function enrichCnpjHandler(req: Request): Promise<Response> {
  try {
    const { cnpj, integrador_id } = await req.json();
    if (!cnpj || !integrador_id) return json({ error: "cnpj e integrador_id são obrigatórios" }, 400);
    const r = await enrichCnpj(cnpj, integrador_id);
    return json({ success: r.success });
  } catch (error) {
    await logError("enrich-cnpj", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
}

// ─────────────────────────── rd-sync ─────────────────────────────────────────
// Recebe os webhooks do RD Station CRM e gera os eventos de FUNDO DE FUNIL
// (Contact/Schedule/AddToCart/Purchase/OportunidadePerdida).
//
// IMPORTANTE — por que aqui o CAPI/GA4 ficam SEMPRE LIGADOS (≠ /track-event):
// estes eventos nascem no CRM (webhook), não no navegador. O GTM só dispara
// client-side na LP, então NÃO tem como enviá-los. Este servidor é o ÚNICO
// emissor — inclusive do `Schedule` ("Lead Qualificado Fotus"), objetivo de
// otimização das campanhas. Não há double-count com o GTM. Não gatear por CAPI_ENABLED.
async function rdSync(req: Request): Promise<Response> {
  let rawBody: unknown = null;
  try {
    rawBody = await req.json();
    const body = rawBody as Record<string, unknown>;

    // Auth via Authorization: Bearer (padrão API v2)
    const authHeader = req.headers.get("authorization") || "";
    const receiverToken = Deno.env.get("RD_WEBHOOK_RECEIVER_TOKEN");
    if (!receiverToken || authHeader !== `Bearer ${receiverToken}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    let stage: string, cnpj: string, email: string, phone: string,
      nome: string, rd_deal_id: string, deal_value: number;

    if (body.event_name && body.document) {
      // RD Station CRM v2 — payload nativo (event_name + document)
      if (!(body.event_name as string).includes("deal")) {
        return json({ skipped: true, reason: `event_name '${body.event_name}' não é de negociação` }, 200);
      }
      const doc = body.document as Record<string, unknown>;

      if (doc.status === "won") stage = "ganho";
      else if (doc.status === "lost") stage = "perdido";
      else stage = ((doc.deal_stage as Record<string, unknown>)?.name as string) || "";

      // Idempotência: dedup_key + persistência do raw event
      const entityId = doc.id?.toString() || null;
      const updatedAt = (doc.updated_at as string) || "no-updated-at";
      const dedupKey = entityId
        ? `rdstation:${body.event_name}:${entityId}:${updatedAt}`
        : `rdstation:${body.event_name}:payload:${await sha256Hex(JSON.stringify(body))}`;

      // Modo reprocessamento: a linha da fila JÁ existe (foi recebida antes e
      // ficou failed/skipped_no_cnpj). Reenviar o payload cru cairia no dedup e
      // seria ignorado — então aqui pulamos o insert e seguimos direto para o
      // processamento, preservando o `received_at` original da fila.
      // Usado pelo workflow n8n de reprocessamento em lote.
      const isReprocess = body.reprocess === true;

      if (!isReprocess) {
        const inserted = await insert("public.rdstation_crm_webhook_events", {
          dedup_key: dedupKey,
          event_name: body.event_name as string,
          entity_id: entityId,
          payload: JSON.stringify(body),
          processing_status: "processing",
          received_at: new Date().toISOString(),
        }, { onConflict: "dedup_key", conflictDoNothing: true, returning: "id" });

        // insert null = conflito de dedup_key = evento já processado → skip silencioso
        if (!inserted) {
          return json({ skipped: true, reason: "duplicate_event", dedup_key: dedupKey }, 200);
        }
      } else {
        // A idempotência no reprocessamento vem do event_id determinístico em
        // public.events: um evento já enviado ao Meta não é reenviado.
        const exists = await one<{ dedup_key: string }>(
          "SELECT dedup_key FROM public.rdstation_crm_webhook_events WHERE dedup_key = $1",
          [dedupKey],
        );
        if (!exists) {
          return json({ error: "reprocess sem linha correspondente na fila", dedup_key: dedupKey }, 404);
        }
      }

      // Funil que não é de venda não gera evento de funil. Sem isso, um card de
      // "MKT Movimentação" fechado como ganho na etapa "Descarte" viraria
      // Purchase (levantado em 30/jul: 734 deals nessa situação).
      if (!isFunilDeVenda(body)) {
        const pipe = (doc.deal_pipeline as Record<string, unknown> | undefined)?.name ??
          extractPipelineId(body) ?? "desconhecido";
        await update("public.rdstation_crm_webhook_events",
          {
            processing_status: "skipped_funil_nao_venda",
            processed_at: new Date().toISOString(),
            error_message: `funil '${pipe}' nao conta como venda`,
          },
          "dedup_key", dedupKey);
        return json({ skipped: true, reason: `funil '${pipe}' fora do escopo de venda` }, 200);
      }

      // Etapa fora do STAGE_TO_EVENT não vira evento — marcar `skipped`, não
      // `processed`. Antes ia como "processed" e inflava a saúde da fila
      // (6.6k "processed"/dia sem um único evento gerado — auditoria 29/jul).
      if (!STAGE_TO_EVENT[stage.toLowerCase().trim()]) {
        await update("public.rdstation_crm_webhook_events",
          { processing_status: "skipped", processed_at: new Date().toISOString() },
          "dedup_key", dedupKey);
        return json({ skipped: true, reason: `etapa '${stage}' fora do mapa de eventos` }, 200);
      }

      // CNPJ — o payload nativo do webhook NÃO traz `organization`, `contacts`
      // nem `organization_id` (auditoria 29/jul/2026), e o CNPJ não está em
      // `deal_custom_fields`. Resolvemos via API do CRM (deal completo →
      // organização), com cache e negative caching por deal.
      let cnpjFonte: string;
      try {
        const resolved = await resolveDealCnpj(entityId || "", body);
        cnpj = resolved.cnpj;
        cnpjFonte = resolved.fonte;
      } catch (resolveErr) {
        // API do RD fora, token revogado, rate limit estourado: o payload está
        // ok, o ambiente não. Fica `failed` para o reprocessamento em lote.
        const msg = `resolver CNPJ do deal ${entityId}: ${(resolveErr as Error).message}`;
        await update("public.rdstation_crm_webhook_events",
          { processing_status: "failed", error_message: msg },
          "dedup_key", dedupKey);
        await logError("rd-sync", msg);
        return json({ success: false, retryable: true, error: msg }, 200);
      }

      if (!cnpj) {
        // Deal sem CNPJ em lugar nenhum: não é erro recuperável, é dado ausente
        // no CRM. Status próprio para não se misturar com falha de execução.
        await update("public.rdstation_crm_webhook_events",
          {
            processing_status: "skipped_no_cnpj",
            processed_at: new Date().toISOString(),
            error_message: `deal ${entityId} sem CNPJ (fonte consultada: ${cnpjFonte})`,
          },
          "dedup_key", dedupKey);
        return json({ skipped: true, reason: "deal sem CNPJ" }, 200);
      }

      const contact = (((doc.contacts as unknown[]) || [])[0] as Record<string, unknown>) || {};
      email = (contact.email as string) || "";
      phone = (contact.mobile_phone as string) || (contact.phone as string) || "";
      nome = (contact.name as string) || "";
      rd_deal_id = entityId || "";
      deal_value = (doc.amount_total as number) || 0;

      try {
        const result = await processRdEvent({
          stage, cnpj, email, phone, nome, rd_deal_id, deal_value, body,
          test_event_code: body.test_event_code as string | undefined,
        });
        await update("public.rdstation_crm_webhook_events",
          { processing_status: "processed", processed_at: new Date().toISOString() },
          "dedup_key", dedupKey);
        return json({ success: true, ...result }, 200);
      } catch (procError) {
        const msg = (procError as Error).message;
        // Integrador inexistente no fop-db não é falha de execução: é deal de
        // empresa que nunca passou pelo funil rastreado (a base tem ~2k
        // integradores contra ~12k deals). Status próprio e sem error_logs,
        // senão a tabela vira ruído de dezenas de milhares de linhas/dia.
        const semIntegrador = msg.includes("não encontrado");
        await update("public.rdstation_crm_webhook_events",
          {
            processing_status: semIntegrador ? "skipped_sem_integrador" : "failed",
            ...(semIntegrador ? { processed_at: new Date().toISOString() } : {}),
            error_message: msg,
          },
          "dedup_key", dedupKey);
        if (semIntegrador) return json({ skipped: true, reason: msg }, 200);
        throw procError;
      }
    } else {
      // Formato interno normalizado (testes/chamadas manuais) — sem dedup
      stage = (body.stage as string) || "";
      cnpj = (body.cnpj as string) || findCnpjDeep(body);
      email = (body.email as string) || "";
      phone = (body.phone as string) || "";
      nome = (body.nome as string) || "";
      rd_deal_id = (body.rd_deal_id as string) || "";
      deal_value = (body.deal_value as number) || (body.order_value as number) || 0;

      const result = await processRdEvent({
        stage, cnpj, email, phone, nome, rd_deal_id, deal_value, body,
        test_event_code: body.test_event_code as string | undefined,
      });
      return json({ success: true, ...result }, 200);
    }
  } catch (error) {
    await logError("rd-sync", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
}

async function processRdEvent(params: {
  stage: string; cnpj: string; email: string; phone: string;
  nome: string; rd_deal_id: string; deal_value: number;
  body: Record<string, unknown>; test_event_code?: string;
}): Promise<{ event: string; capi: boolean }> {
  const { stage, cnpj, email, phone, nome, rd_deal_id, deal_value, body, test_event_code } = params;

  const eventName = STAGE_TO_EVENT[stage.toLowerCase().trim()];
  if (!eventName) return { event: "skipped", capi: false };

  const cnpjClean = cleanCnpj(cnpj);
  if (!cnpjClean) throw new Error("cnpj obrigatório");

  const integrador = await one<{
    id: string; email: string | null; phone: string | null; nome_contato: string | null;
    estado_operacao: string | null; cidade_operacao: string | null; rd_deal_id: string | null;
    numero_pedidos: number | null; ltv_total: number | null;
  }>(
    "SELECT id, email, phone, nome_contato, estado_operacao, cidade_operacao, rd_deal_id, numero_pedidos, ltv_total FROM public.integradores WHERE cnpj = $1",
    [cnpjClean],
  );
  if (!integrador) throw new Error(`integrador CNPJ ${cnpjClean} não encontrado`);

  let finalEventName = eventName;
  if (eventName === "Purchase") {
    const isFirstOrder = !integrador.numero_pedidos || integrador.numero_pedidos === 0;
    finalEventName = isFirstOrder ? "Purchase" : "PurchaseRecorrente";
  }

  const eventId = (await sha256Hex(`rd_${finalEventName}_${rd_deal_id}_${cnpjClean}`)).substring(0, 36);

  const existingEvent = await one<{ id: string }>(
    "SELECT id FROM public.events WHERE event_id = $1", [eventId],
  );
  if (existingEvent) return { event: finalEventName, capi: false };

  const session = await one<{
    session_id: string; fbp: string | null; fbc: string | null; gclid: string | null;
    ga4_client_id: string | null; utm_source: string | null; utm_campaign: string | null;
  }>(
    "SELECT session_id, fbp, fbc, gclid, ga4_client_id, utm_source, utm_campaign FROM public.sessions WHERE integrador_id = $1 ORDER BY created_at DESC LIMIT 1",
    [integrador.id],
  );

  // ── Origem DESTE negócio ──────────────────────────────────────────────────
  // Requisito do Igor (30/jul): cada deal preserva a UTM de origem DELE. Uma
  // mesma empresa pode ter a 1ª compra vinda de google search, a 2ª de e-mail e
  // a 3ª do WhatsApp do consultor — são negócios distintos, com fontes
  // distintas. Atribuir tudo à primeira sessão do integrador daria todo o
  // crédito ao google e apagaria os outros dois canais.
  const atrib = await resolverAtribuicaoDoDeal({
    deal: body,
    integradorId: integrador.id,
    criadoEm: ((body.document as Record<string, unknown> | undefined)?.created_at as string) ||
      null,
  });

  // Registra a origem do negócio junto do pedido, para o LTV por canal sair
  // por deal e não por empresa. Só grava se o deal já foi contabilizado pelo
  // backfill (o registro existe); caso contrário não há linha para enriquecer.
  if (rd_deal_id) {
    await q(
      `UPDATE public.rd_won_backfill
          SET utm_source = COALESCE(utm_source, $2),
              utm_medium = COALESCE(utm_medium, $3),
              utm_campaign = COALESCE(utm_campaign, $4),
              utm_content = COALESCE(utm_content, $5),
              utm_term = COALESCE(utm_term, $6),
              deal_source = COALESCE(deal_source, $7),
              session_id = COALESCE(session_id, $8),
              atribuicao_fonte = COALESCE(atribuicao_fonte, $9)
        WHERE rd_deal_id = $1`,
      [
        rd_deal_id, atrib.utm_source, atrib.utm_medium, atrib.utm_campaign,
        atrib.utm_content, atrib.utm_term, atrib.deal_source, atrib.session_id,
        atrib.fonte,
      ],
    ).catch(() => {});
  }

  const orderValue = deal_value;
  const updatePayload: Record<string, unknown> = {
    status: EVENT_TO_STATUS[finalEventName] || EVENT_TO_STATUS[eventName],
    rd_deal_id: rd_deal_id || integrador.rd_deal_id,
    updated_at: new Date().toISOString(),
  };
  if (eventName === "Schedule") updatePayload.data_qualificacao = new Date().toISOString();
  if (eventName === "Purchase") {
    const numeroPedidos = (integrador.numero_pedidos || 0) + 1;
    const ltvTotal = Number(integrador.ltv_total || 0) + Number(orderValue);
    updatePayload.numero_pedidos = numeroPedidos;
    updatePayload.ltv_total = ltvTotal;
    updatePayload.ticket_medio = ltvTotal / numeroPedidos;
    updatePayload.data_ultima_compra = new Date().toISOString();
    if (finalEventName === "Purchase") updatePayload.data_primeira_compra = new Date().toISOString();
  }
  await update("public.integradores", updatePayload, "id", integrador.id);

  const userData = await buildUserData({
    email: (email || integrador.email) || undefined,
    phone: (phone || integrador.phone) || undefined,
    nome: (nome || integrador.nome_contato) || undefined,
    estado: integrador.estado_operacao || undefined,
    cidade: integrador.cidade_operacao || undefined,
    fbp: session?.fbp || undefined,
    fbc: session?.fbc || undefined,
  });

  await insert("public.events", {
    event_id: eventId,
    session_id: session?.session_id || null,
    integrador_id: integrador.id,
    event_name: finalEventName,
    event_source: "system_generated",
    funnel: "aquisicao",
    event_data: JSON.stringify(body),
    meta_capi_status: "pending",
    gclid: session?.gclid || null,
    // UTM do NEGOCIO (ver resolverAtribuicaoDoDeal), com a sessao como fallback.
    utm_source: atrib.utm_source || session?.utm_source || null,
    utm_campaign: atrib.utm_campaign || session?.utm_campaign || null,
    utm_content: atrib.utm_content || null,
  }, { onConflict: "event_id", conflictDoNothing: true });

  // ── Gate de sinal de mídia ────────────────────────────────────────────────
  // O fop-db é a fonte COMPLETA (grava sempre, acima). Mas o Meta/GA4 só devem
  // receber eventos de CRM de quem tem sessão rastreada, isto é, sinal de que
  // passou pelo funil de mídia.
  // Por quê: medido em 29/jul/2026, o CRM fecha ~450 deals `won` por dia (pico
  // de 1.468 em 28/jul) contra ~13 leads/dia vindos de mídia paga. Sem este
  // gate, o backfill da base faria o Meta receber centenas de `Purchase`/dia de
  // venda de carteira e prospecção interna — ROAS reportado irreal e otimização
  // aprendendo com sinal que a mídia não produziu.
  // Só desligue (RD_SYNC_CAPI_REQUIRE_SESSION=false) se a intenção for
  // deliberadamente medir TODA a receita no Meta, mídia ou não.
  const temSinalDeMidia = !!session;
  if (!temSinalDeMidia && REQUIRE_SESSION_FOR_CAPI) {
    await update("public.events", { meta_capi_status: "sem_sinal_midia" }, "event_id", eventId);
    return { event: finalEventName, capi: false };
  }

  const capiResult = await sendToCAPI({
    event_name: finalEventName,
    event_id: eventId,
    action_source: "system_generated",
    user_data: userData,
    custom_data: {
      cnpj: cnpjClean,
      ...(eventName === "Purchase" && { currency: "BRL", value: orderValue }),
    },
    test_event_code: test_event_code || undefined,
  });

  await update("public.events", {
    meta_capi_status: capiResult.success ? "sent" : "failed",
    meta_event_id: capiResult.eventId || null,
    meta_fbtrace_id: capiResult.fbtrace_id || null,
    meta_error: capiResult.error || null,
  }, "event_id", eventId);

  if (finalEventName !== "PurchaseRecorrente") {
    sendToGA4({
      event_name: finalEventName,
      client_id: session?.ga4_client_id || session?.session_id || cnpjClean,
      session_id: session?.session_id || undefined,
      user_id: integrador.id,
      event_params: {
        gclid: session?.gclid || undefined,
        utm_source: session?.utm_source || undefined,
        utm_campaign: session?.utm_campaign || undefined,
        ...(finalEventName === "Purchase" && { value: orderValue, currency: "BRL" }),
      },
    });
  }

  return { event: finalEventName, capi: capiResult.success };
}

// ─────────────────────── backfill-integradores ──────────────────────────────
// Reconstrói numero_pedidos/ltv_total/datas a partir dos deals ganhos do CRM.
// Chamado em loop pelo workflow n8n (processa N páginas por chamada).
// Mesma autenticação do rd-sync: só quem tem o RD_WEBHOOK_RECEIVER_TOKEN.
async function backfillHandler(req: Request): Promise<Response> {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const receiverToken = Deno.env.get("RD_WEBHOOK_RECEIVER_TOKEN");
    if (!receiverToken || authHeader !== `Bearer ${receiverToken}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // Diagnóstico: quais campos a LISTAGEM de deals traz. Se ela já vier com o
    // vínculo da organização, o backfill economiza 1 chamada por deal (o
    // GET /deals/{id}) — a diferença entre ~7h e ~30min para 51.661 deals.
    // Devolve só nomes de campos e flags, nunca o conteúdo (evita PII no log).
    if (body.sample_keys === true) {
      const [deal] = await listWonDeals(1, 1, body.desde as string, body.ate as string);
      if (!deal) return json({ success: true, vazio: true });
      return json({
        success: true,
        campos: Object.keys(deal).sort(),
        tem_organization: deal.organization !== undefined && deal.organization !== null,
        tem_organization_id: deal.organization_id !== undefined && deal.organization_id !== null,
        campos_organization: deal.organization && typeof deal.organization === "object"
          ? Object.keys(deal.organization as Record<string, unknown>).sort()
          : null,
        tem_contacts: Array.isArray(deal.contacts) && (deal.contacts as unknown[]).length > 0,
        tem_deal_custom_fields: Array.isArray(deal.deal_custom_fields),
      });
    }

    // Preenche pipeline_id nas linhas gravadas antes da migration 009. Só
    // relista (1 chamada por página) — não toca em LTV nem em integradores.
    if (body.preencher_pipelines === true) {
      const r = await preencherPipelines({
        page: Number(body.page) || 1,
        pagesPerRun: Number(body.pages_per_run) || 10,
        pageSize: Number(body.page_size) || 200,
        desde: body.desde as string | undefined,
        ate: body.ate as string | undefined,
        throttleMs: body.throttle_ms === undefined ? undefined : Number(body.throttle_ms),
      });
      return json({ success: true, ...r });
    }

    // Dimensiona antes de varrer: 1 chamada devolve a paginação da listagem.
    if (body.count_only === true) {
      return json({
        success: true,
        meta: await wonDealsMeta(body.desde as string, body.ate as string),
      });
    }

    const result = await backfillWon({
      page: Number(body.page) || 1,
      pagesPerRun: Number(body.pages_per_run) || 3,
      pageSize: Number(body.page_size) || 100,
      dryRun: body.dry_run === true,
      throttleMs: body.throttle_ms === undefined ? undefined : Number(body.throttle_ms),
      desde: body.desde as string | undefined,
      ate: body.ate as string | undefined,
    });
    return json({ success: true, ...result });
  } catch (error) {
    await logError("backfill-integradores", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
}

// ─────────────────────────── UTM Builder ────────────────────────────────────
// Porta as Edge Functions utm-config (GET) e generate-utm (POST) do Supabase
// para o fop-db. O catálogo (codigos_*) e a tabela utm_links já vivem no fop-db.
// Sem auth (como /track-event): é ferramenta interna de baixa sensibilidade
// (lê catálogo + gera link). A tela estática consome estes dois endpoints.
async function utmConfig(): Promise<Response> {
  try {
    const out: Record<string, unknown> = {};
    for (const t of ["canal", "objetivo", "produto", "publico", "geo"]) {
      // nome de tabela vem de allowlist fixa acima — não há injeção via input.
      out[t] = await q(`SELECT * FROM public.codigos_${t} WHERE ativo = true ORDER BY ordem`);
    }
    return json(out);
  } catch (error) {
    await logError("utm-config", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
}

// Campos extras (source_platform/creative_format) entram como parâmetros
// adicionais no link, NUNCA no utm_campaign. final_url_suffix não recebe query.
function urlFinalExtras(r: { url_final: string; gera_via: string }, body: Record<string, unknown>): string {
  if (r.gera_via === "final_url_suffix") return r.url_final;
  const extras: string[] = [];
  if (body.utm_source_platform) extras.push("utm_source_platform=" + encodeURIComponent(String(body.utm_source_platform)));
  if (body.utm_creative_format) extras.push("utm_creative_format=" + encodeURIComponent(String(body.utm_creative_format)));
  if (!extras.length) return r.url_final;
  return r.url_final + (r.url_final.includes("?") ? "&" : "?") + extras.join("&");
}

async function generateUtm(req: Request): Promise<Response> {
  try {
    const body = await req.json();

    // Valida o canal contra a tabela-mestra (não confia no front).
    const canalRow = await one<Canal & { codigo: string }>(
      "SELECT * FROM public.codigos_canal WHERE codigo = $1 AND ativo = true",
      [body.canal],
    );
    if (!canalRow) return json({ error: `canal inválido: ${body.canal}` }, 400);

    const r = buildResult({
      url_destino: body.url_destino,
      canal: canalRow as Canal,
      objetivo: body.objetivo, produto: body.produto, publico: body.publico,
      geo: body.geo, periodo: body.periodo, content: body.content, term: body.term,
    });

    // Anti-duplicata por hash. Não devolvemos a linha crua do banco: a coluna
    // id é int8 → o driver Postgres do Deno a entrega como BigInt, que o
    // JSON.stringify não serializa. Montamos a resposta a partir de `r` (tudo
    // string), que é determinístico para os mesmos inputs.
    const existe = await one<{ n: number }>(
      "SELECT 1 AS n FROM public.utm_links WHERE hash_dedupe = $1 LIMIT 1",
      [r.hash_dedupe],
    );
    if (!existe) {
      await insert("public.utm_links", {
        criado_por: body.criado_por ?? null,
        url_destino: body.url_destino,
        utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign,
        utm_content: r.utm_content || null, utm_term: r.utm_term || null, utm_id: r.utm_id,
        funnel: r.funnel, plataforma: r.plataforma, url_final: urlFinalExtras(r, body), hash_dedupe: r.hash_dedupe,
        tipo: "web",
        utm_source_platform: body.utm_source_platform || null,
        utm_creative_format: body.utm_creative_format || null,
      });
    }

    return json({
      status: existe ? "exists" : "created",
      url_destino: body.url_destino,
      utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign,
      utm_content: r.utm_content, utm_term: r.utm_term, utm_id: r.utm_id,
      funnel: r.funnel, plataforma: r.plataforma, gera_via: r.gera_via,
      utm_source_platform: body.utm_source_platform ?? null,
      utm_creative_format: body.utm_creative_format ?? null,
      tracking_value: r.tracking_value, url_final: urlFinalExtras(r, body),
    });
  } catch (error) {
    await logError("generate-utm", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
}

// POST /generate-utm-app — gera os 3 links de app (Play/Apple/Smart) e grava
// no fop-db com tipo='app'. Dedupe por hash_dedupe = campaign|source|medium|smarthost.
async function generateUtmApp(req: Request): Promise<Response> {
  try {
    const b = await req.json();
    if (!b.campaign) return json({ error: "campanha obrigatória" }, 400);

    const play = buildPlayLink({ pkg: b.pkg, source: b.source, medium: b.medium, campaign: b.campaign, term: b.term, content: b.content });
    const apple = buildAppleLink({ appid: b.appid, pt: b.pt, campaign: b.campaign });
    const smart = buildSmartLink({ smarthost: b.smarthost, source: b.source, medium: b.medium, campaign: b.campaign });

    const hash = `app|${slug(b.campaign)}|${slug(b.source || "")}|${slug(b.medium || "")}|${b.smarthost || ""}`;
    const existe = await one<{ n: number }>(
      "SELECT 1 AS n FROM public.utm_links WHERE hash_dedupe = $1 LIMIT 1",
      [hash],
    );
    if (!existe) {
      await insert("public.utm_links", {
        criado_por: b.criado_por ?? null,
        url_destino: b.smarthost || play || apple || null,
        utm_source: b.source ? slug(b.source) : null,
        utm_medium: b.medium ? slug(b.medium) : null,
        utm_campaign: b.campaign ? slug(b.campaign) : null,
        utm_content: b.content ? slug(b.content) : null,
        utm_term: b.term ? slug(b.term) : null,
        funnel: "aquisicao",
        plataforma: "app",
        url_final: smart || play || apple || null,
        hash_dedupe: hash,
        tipo: "app",
        store_meta: JSON.stringify({ play, apple, smart, pkg: b.pkg || null, appid: b.appid || null, pt: b.pt || null }),
      });
    }
    return json({ status: existe ? "exists" : "created", play, apple, smart });
  } catch (error) {
    await logError("generate-utm-app", (error as Error).message);
    return json({ error: (error as Error).message }, 500);
  }
}

// ─────────────────────────── router ─────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const path = new URL(req.url).pathname.replace(/\/+$/, "");

  if (path === "" || path === "/health") {
    try {
      await q("SELECT 1");
      return json({ ok: true, service: "fop-functions" });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500);
    }
  }
  if (path === "/track-event") return await trackEvent(req);
  if (path === "/utm-config") return await utmConfig();
  if (path === "/generate-utm") return await generateUtm(req);
  if (path === "/generate-utm-app") return await generateUtmApp(req);
  if (path === "/rd-sync") return await rdSync(req);
  if (path === "/backfill-integradores") return await backfillHandler(req);
  if (path === "/enrich-cnpj") return await enrichCnpjHandler(req);
  return json({ error: "not found" }, 404);
});
