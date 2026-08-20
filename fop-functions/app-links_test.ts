import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAppleLink, buildPlayLink, buildSmartLink, slug } from "./app-links.ts";

Deno.test("slug normaliza espaços, remove acentos e símbolos", () => {
  // \w não inclui acentuados → ç/ã são removidos (comportamento do slug do Lucas).
  assertEquals(slug("Lançamento Painel 2026!"), "lanamento_painel_2026");
});

Deno.test("buildPlayLink monta referrer com utm inteiro codificado", () => {
  const url = buildPlayLink({ pkg: "com.fotus.mobile", source: "instagram", medium: "social", campaign: "feirao" });
  assertEquals(
    url,
    "https://play.google.com/store/apps/details?id=com.fotus.mobile&referrer=utm_source%3Dinstagram%26utm_medium%3Dsocial%26utm_campaign%3Dfeirao",
  );
});

Deno.test("buildAppleLink usa pt, ct<=30, mt=8", () => {
  const url = buildAppleLink({ appid: "6780997966", pt: "58265800", campaign: "campanha_muito_muito_longa_acima_de_30" });
  assertEquals(
    url,
    "https://apps.apple.com/app/apple-store/id6780997966?pt=58265800&ct=campanha_muito_muito_longa_aci&mt=8",
  );
});

Deno.test("buildSmartLink adiciona s/m/c e respeita ? existente", () => {
  const url = buildSmartLink({ smarthost: "https://fotus.com.br/app?x=1", source: "google", medium: "cpc", campaign: "promo" });
  assertEquals(url, "https://fotus.com.br/app?x=1&s=google&m=cpc&c=promo");
});
