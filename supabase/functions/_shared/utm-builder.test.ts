import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalize, buildCampaign, buildUtmId, buildResult } from "./utm-builder.ts";

Deno.test("normalize: minúsculo, sem acento, espaço vira hífen", () => {
  assertEquals(normalize("Promoção Especial"), "promocao-especial");
  assertEquals(normalize("CD-SP"), "cd-sp");
});

Deno.test("buildCampaign: objetivo|produto|publico|geo, sem canal, sem período vazio", () => {
  assertEquals(
    buildCampaign({ objetivo: "ACQ", produto: "GERAL", publico: "NOVOS", geo: "BR" }),
    "acq|geral|novos|br",
  );
  assertEquals(
    buildCampaign({ objetivo: "ENG", produto: "LOG", publico: "BASE", geo: "BR", periodo: "ABR26" }),
    "eng|log|base|br|abr26",
  );
});

Deno.test("buildUtmId: determinístico e estável", () => {
  const a = buildUtmId("meta", "acq|geral|novos|br", "vid|beneficio|v1");
  const b = buildUtmId("meta", "acq|geral|novos|br", "vid|beneficio|v1");
  assertEquals(a, b);
});

Deno.test("buildResult META: gera_via url_tags devolve tracking_value", () => {
  const r = buildResult({
    url_destino: "https://fotus.com.br/integrador",
    canal: { plataforma: "meta", utm_source: "meta", utm_medium: "paid-social", gera_via: "url_tags" },
    objetivo: "ACQ", produto: "GERAL", publico: "NOVOS", geo: "BR",
    content: "vid|beneficio|v1", term: "",
  });
  assertEquals(r.utm_campaign, "acq|geral|novos|br");
  assertEquals(r.gera_via, "url_tags");
  assertEquals(
    r.tracking_value,
    "utm_source=meta&utm_medium=paid-social&utm_campaign=acq%7Cgeral%7Cnovos%7Cbr&utm_content=vid%7Cbeneficio%7Cv1",
  );
  assertEquals(r.funnel, "aquisicao");
});

Deno.test("buildResult Google: gera_via final_url_suffix; url_final preserva gclid (sem UTM na base)", () => {
  const r = buildResult({
    url_destino: "https://fotus.com.br/integrador",
    canal: { plataforma: "google", utm_source: "google-search", utm_medium: "cpc", gera_via: "final_url_suffix" },
    objetivo: "ACQ", produto: "GERAL", publico: "NOVOS", geo: "BR", content: "rsa|beneficio|v1", term: "kit solar",
  });
  assertEquals(r.gera_via, "final_url_suffix");
  assertEquals(r.url_final, "https://fotus.com.br/integrador");
  assertEquals(r.tracking_value.includes("utm_term=kit%20solar"), true);
});

Deno.test("buildResult RET vira funnel reativacao", () => {
  const r = buildResult({
    url_destino: "https://x", canal: { plataforma: "meta", utm_source: "meta", utm_medium: "paid-social", gera_via: "url_tags" },
    objetivo: "RET", produto: "GERAL", publico: "BASE", geo: "BR", content: "", term: "",
  });
  assertEquals(r.funnel, "reativacao");
});
