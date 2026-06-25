import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildResult, type Canal } from "../_shared/utm-builder.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // valida o canal contra a tabela-mestra (não confia no front)
    const { data: canalRow, error: canalErr } = await supabase
      .from("codigos_canal").select("*").eq("codigo", body.canal).eq("ativo", true).single();
    if (canalErr || !canalRow) {
      return new Response(JSON.stringify({ error: `canal inválido: ${body.canal}` }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const r = buildResult({
      url_destino: body.url_destino,
      canal: canalRow as Canal,
      objetivo: body.objetivo, produto: body.produto, publico: body.publico,
      geo: body.geo, periodo: body.periodo, content: body.content, term: body.term,
    });

    // anti-duplicata por hash
    const { data: existente } = await supabase
      .from("utm_links").select("*").eq("hash_dedupe", r.hash_dedupe).maybeSingle();
    if (existente) {
      return new Response(JSON.stringify({ ...existente, status: "exists" }),
        { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const { data: inserido, error: insErr } = await supabase.from("utm_links").insert({
      criado_por: body.criado_por ?? null,
      url_destino: body.url_destino,
      utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign,
      utm_content: r.utm_content || null, utm_term: r.utm_term || null, utm_id: r.utm_id,
      funnel: r.funnel, plataforma: r.plataforma, url_final: r.url_final, hash_dedupe: r.hash_dedupe,
    }).select().single();
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ ...inserido, gera_via: r.gera_via, tracking_value: r.tracking_value, status: "created" }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
