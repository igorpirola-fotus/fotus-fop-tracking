// app-links.ts — porte 1:1 da lógica de link de app do UTM_BUILDER_APP/index.html (Lucas).
export function slug(s: string): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
}

function utmString(i: { source?: string; medium?: string; campaign?: string; term?: string; content?: string }): string {
  const p: string[] = [];
  if (i.source) p.push("utm_source=" + encodeURIComponent(slug(i.source)));
  if (i.medium) p.push("utm_medium=" + encodeURIComponent(slug(i.medium)));
  if (i.campaign) p.push("utm_campaign=" + encodeURIComponent(slug(i.campaign)));
  if (i.term) p.push("utm_term=" + encodeURIComponent(slug(i.term)));
  if (i.content) p.push("utm_content=" + encodeURIComponent(slug(i.content)));
  return p.join("&");
}

export function buildPlayLink(i: { pkg: string; source: string; medium: string; campaign: string; term?: string; content?: string }): string {
  if (!i.pkg || !i.source || !i.medium || !i.campaign) return "";
  const ref = encodeURIComponent(utmString(i));
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(i.pkg)}&referrer=${ref}`;
}

export function buildAppleLink(i: { appid: string; pt?: string; campaign: string }): string {
  if (!i.appid || !i.campaign) return "";
  const parts: string[] = [];
  if (i.pt) parts.push("pt=" + encodeURIComponent(i.pt));
  parts.push("ct=" + encodeURIComponent(slug(i.campaign).slice(0, 30)));
  parts.push("mt=8");
  return `https://apps.apple.com/app/apple-store/id${encodeURIComponent(i.appid)}?${parts.join("&")}`;
}

export function buildSmartLink(i: { smarthost: string; source?: string; medium?: string; campaign?: string }): string {
  if (!i.smarthost) return "";
  const sep = i.smarthost.includes("?") ? "&" : "?";
  const q: string[] = [];
  if (i.source) q.push("s=" + encodeURIComponent(slug(i.source)));
  if (i.medium) q.push("m=" + encodeURIComponent(slug(i.medium)));
  if (i.campaign) q.push("c=" + encodeURIComponent(slug(i.campaign)));
  return q.length ? i.smarthost + sep + q.join("&") : i.smarthost;
}
