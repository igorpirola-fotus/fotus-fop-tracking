// server.ts — FOP tracking server-side (Deno standalone, self-hosted no EasyPanel).
// Porta as Edge Functions track-event e enrich-cnpj do Supabase para Postgres direto (fop-db).
// Regras preservadas do CLAUDE.md: SHA-256 PII, dedup por event_id, retry CAPI, GA4 fire-and-forget, geo Cloudflare.
import { insert, logError, one, q, update } from "./db.ts";
import { buildUserData, normalizePhone, sendToCAPI } from "./capi-sender.ts";
import { sendToGA4 } from "./ga4-sender.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// O GTM já envia Meta Pixel/CAPI + GA4 com deduplicação por event_id.
// Por padrão, este servidor só GRAVA NO BANCO (evita double-count no Meta/GA4).
// Para reativar o envio server-side, setar env CAPI_ENABLED=true.
const CAPI_ENABLED = Deno.env.get("CAPI_ENABLED") === "true";

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
  if (path === "/enrich-cnpj") return await enrichCnpjHandler(req);
  return json({ error: "not found" }, 404);
});
