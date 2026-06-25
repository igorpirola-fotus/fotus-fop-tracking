export type Canal = {
  plataforma: string;
  utm_source: string;
  utm_medium: string;
  gera_via: "url" | "url_tags" | "final_url_suffix" | "adtracking";
};

export function normalize(s: string): string {
  return (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase()
    .replace(/\s+/g, "-");
}

export function buildCampaign(c: {
  objetivo: string; produto: string; publico: string; geo: string; periodo?: string;
}): string {
  return [c.objetivo, c.produto, c.publico, c.geo, c.periodo]
    .filter((x): x is string => !!x && x.length > 0)
    .map(normalize)
    .join("|");
}

export function funnelDoObjetivo(objetivo: string): "aquisicao" | "reativacao" {
  return ["RET", "RMKT"].includes((objetivo ?? "").toUpperCase()) ? "reativacao" : "aquisicao";
}

export function buildUtmId(source: string, campaign: string, content: string): string {
  const base = `${source}.${campaign}.${content}`.replace(/[^a-z0-9.]+/gi, "-");
  return base.replace(/\.+/g, ".").replace(/^-|-$/g, "");
}

export type BuildInput = {
  url_destino: string; canal: Canal;
  objetivo: string; produto: string; publico: string; geo: string; periodo?: string;
  content?: string; term?: string; criado_por?: string;
};

export type BuildResult = {
  utm_source: string; utm_medium: string; utm_campaign: string;
  utm_content: string; utm_term: string; utm_id: string;
  funnel: "aquisicao" | "reativacao"; plataforma: string;
  gera_via: Canal["gera_via"]; tracking_value: string; url_final: string;
  hash_dedupe: string;
};

export function buildResult(i: BuildInput): BuildResult {
  const utm_campaign = buildCampaign(i);
  const utm_content = i.content ? normalize(i.content) : "";
  const utm_term = i.term ?? "";
  const utm_id = buildUtmId(i.canal.utm_source, utm_campaign, utm_content);

  const params = new URLSearchParams();
  params.set("utm_source", i.canal.utm_source);
  params.set("utm_medium", i.canal.utm_medium);
  params.set("utm_campaign", utm_campaign);
  if (utm_content) params.set("utm_content", utm_content);
  if (utm_term) params.set("utm_term", utm_term);
  // URLSearchParams codifica espaço como '+'; força '%20' (inequívoco em UTM).
  const tracking_value = params.toString().replaceAll("+", "%20");

  const url_final = i.canal.gera_via === "final_url_suffix"
    ? i.url_destino
    : `${i.url_destino}${i.url_destino.includes("?") ? "&" : "?"}${tracking_value}`;

  const hash_dedupe = `${i.canal.utm_source}|${utm_campaign}|${utm_content}|${utm_term}|${i.url_destino}`;

  return {
    utm_source: i.canal.utm_source, utm_medium: i.canal.utm_medium, utm_campaign,
    utm_content, utm_term, utm_id, funnel: funnelDoObjetivo(i.objetivo),
    plataforma: i.canal.plataforma, gera_via: i.canal.gera_via, tracking_value, url_final, hash_dedupe,
  };
}
