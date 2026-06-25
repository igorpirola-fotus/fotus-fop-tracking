import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const tabelas = ["codigos_canal", "codigos_objetivo", "codigos_produto", "codigos_publico", "codigos_geo"];
    const out: Record<string, unknown> = {};
    for (const t of tabelas) {
      const { data, error } = await supabase.from(t).select("*").eq("ativo", true).order("ordem");
      if (error) throw error;
      out[t.replace("codigos_", "")] = data;
    }
    return new Response(JSON.stringify(out), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
