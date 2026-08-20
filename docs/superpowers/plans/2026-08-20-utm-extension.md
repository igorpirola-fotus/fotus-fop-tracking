# Extensão UTM Builder Fotus — Plano de Implementação (Fase 1 / MVP)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma extensão Chrome da Fotus (desempacotada) com dois geradores de UTM — Web (catálogo doc 09) e App (Play/App Store/Smart Link + QR) — que grava toda UTM gerada no fop-db.

**Architecture:** Extensão MV3 (HTML/JS vanilla) chama o `fop-functions` (Deno no EasyPanel) que grava no `fop-db`. Backend reusa `generate-utm`/`utm-config` já no ar; adiciona `generate-utm-app` e amplia `utm_links`. Lógica de link de app portada 1:1 do app do Lucas (`UTM_BUILDER_APP/index.html`); visual do design-system dele.

**Tech Stack:** Deno + Postgres (`db.ts`) no backend; Chrome Extension MV3 (manifest v3, JS vanilla) no cliente; testes `deno test`.

**Escopo:** Fase 1 (MVP). Fase 2 (aba Histórico lendo fop-db + Modelos compartilhados) fica para um plano posterior. Spec: `docs/superpowers/specs/2026-08-20-utm-extension-design.md`.

**Repos:** backend em `ULTRON FOTUS/fotus-fop-tracking` (branch `feat/fop-functions`); extensão em `fotus-fop-tracking` top-level (branch `feat/utm-builder-fase1`), pasta nova `web/utm-extension/`.

---

## Task 1: Migration — ampliar `utm_links`

**Files:**
- Create: `ULTRON FOTUS/fotus-fop-tracking/fop-functions/migrations/015_utm_extension.sql`
- Test: consulta de schema via webhook `fopdb-q`

- [ ] **Step 1: Escrever a migration**

```sql
-- 015_utm_extension.sql — colunas para web (campos extras) e app (loja).
ALTER TABLE public.utm_links
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS utm_source_platform text,
  ADD COLUMN IF NOT EXISTS utm_creative_format text,
  ADD COLUMN IF NOT EXISTS store_meta jsonb;
```

- [ ] **Step 2: Aplicar no fop-db**

Rodar via script Python (escrita no fop-db é gated — empacotar e Igor autoriza), POST para `https://fotus-n8n-webhook.mk863j.easypanel.host/webhook/fopdb-q` com `{"sql": "<conteúdo acima em uma linha>"}`.

- [ ] **Step 3: Verificar o schema**

Query: `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='utm_links' AND column_name IN ('tipo','utm_source_platform','utm_creative_format','store_meta')`
Expected: 4 linhas.

- [ ] **Step 4: Commit**

```bash
git -C "ULTRON FOTUS/fotus-fop-tracking" add fop-functions/migrations/015_utm_extension.sql
git -C "ULTRON FOTUS/fotus-fop-tracking" commit -m "feat(utm): migration 015 amplia utm_links (tipo, extras, store_meta)"
```

---

## Task 2: `app-links.ts` — lógica pura de link de app (porte do Lucas)

**Files:**
- Create: `ULTRON FOTUS/fotus-fop-tracking/fop-functions/app-links.ts`
- Test: `ULTRON FOTUS/fotus-fop-tracking/fop-functions/app-links_test.ts`

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// app-links_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { slug, buildPlayLink, buildAppleLink, buildSmartLink } from "./app-links.ts";

Deno.test("slug normaliza espaços e remove símbolos", () => {
  assertEquals(slug("Lançamento Painel 2026!"), "lançamento_painel_2026");
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
    "https://apps.apple.com/app/apple-store/id6780997966?pt=58265800&ct=campanha_muito_muito_longa_ac&mt=8",
  );
});

Deno.test("buildSmartLink adiciona s/m/c e respeita ? existente", () => {
  const url = buildSmartLink({ smarthost: "https://fotus.com.br/app?x=1", source: "google", medium: "cpc", campaign: "promo" });
  assertEquals(url, "https://fotus.com.br/app?x=1&s=google&m=cpc&c=promo");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "ULTRON FOTUS/fotus-fop-tracking/fop-functions" && deno test app-links_test.ts`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar `app-links.ts`**

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test app-links_test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git -C "ULTRON FOTUS/fotus-fop-tracking" add fop-functions/app-links.ts fop-functions/app-links_test.ts
git -C "ULTRON FOTUS/fotus-fop-tracking" commit -m "feat(utm): app-links.ts (porte da logica de link de app do Lucas) + testes"
```

---

## Task 3: Estender `generate-utm` (web) com campos extras + `tipo`

**Files:**
- Modify: `ULTRON FOTUS/fotus-fop-tracking/fop-functions/server.ts` (handler `generateUtm`)

- [ ] **Step 1: Ampliar o insert e a resposta do `generateUtm`**

No handler `generateUtm`, no bloco do `insert("public.utm_links", {...})`, acrescentar os campos (o `tipo` default 'web', e os extras vindos do body):

```ts
    if (!existe) {
      await insert("public.utm_links", {
        criado_por: body.criado_por ?? null,
        url_destino: body.url_destino,
        utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign,
        utm_content: r.utm_content || null, utm_term: r.utm_term || null, utm_id: r.utm_id,
        funnel: r.funnel, plataforma: r.plataforma, url_final: urlFinalExtras(r, body),
        hash_dedupe: r.hash_dedupe,
        tipo: "web",
        utm_source_platform: body.utm_source_platform || null,
        utm_creative_format: body.utm_creative_format || null,
      });
    }
```

E adicionar, logo acima do handler, a função que anexa os params extras ao link final:

```ts
function urlFinalExtras(r: { url_final: string; gera_via: string }, body: Record<string, unknown>): string {
  // Campos extras (source_platform/creative_format) entram como parâmetros
  // adicionais no link, NUNCA no utm_campaign. final_url_suffix não recebe query.
  if (r.gera_via === "final_url_suffix") return r.url_final;
  const extras: string[] = [];
  if (body.utm_source_platform) extras.push("utm_source_platform=" + encodeURIComponent(String(body.utm_source_platform)));
  if (body.utm_creative_format) extras.push("utm_creative_format=" + encodeURIComponent(String(body.utm_creative_format)));
  if (!extras.length) return r.url_final;
  return r.url_final + (r.url_final.includes("?") ? "&" : "?") + extras.join("&");
}
```

Na resposta `json({...})` do `generateUtm`, trocar `url_final: r.url_final` por `url_final: urlFinalExtras(r, body)` e acrescentar `utm_source_platform: body.utm_source_platform ?? null, utm_creative_format: body.utm_creative_format ?? null`.

- [ ] **Step 2: Typecheck**

Run: `cd "ULTRON FOTUS/fotus-fop-tracking/fop-functions" && deno check server.ts`
Expected: `Check server.ts` sem erros.

- [ ] **Step 3: Commit**

```bash
git -C "ULTRON FOTUS/fotus-fop-tracking" add fop-functions/server.ts
git -C "ULTRON FOTUS/fotus-fop-tracking" commit -m "feat(utm): generate-utm aceita campos extras (source_platform/creative_format) + tipo web"
```

---

## Task 4: `generate-utm-app` — handler + rota

**Files:**
- Modify: `ULTRON FOTUS/fotus-fop-tracking/fop-functions/server.ts` (import, handler, rota)

- [ ] **Step 1: Importar app-links no topo**

Junto dos outros imports:

```ts
import { buildAppleLink, buildPlayLink, buildSmartLink, slug } from "./app-links.ts";
```

- [ ] **Step 2: Adicionar o handler `generateUtmApp` (antes do router)**

```ts
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
      "SELECT 1 AS n FROM public.utm_links WHERE hash_dedupe = $1 LIMIT 1", [hash],
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
```

- [ ] **Step 3: Registrar a rota** (junto das outras rotas UTM no `Deno.serve`)

```ts
  if (path === "/generate-utm-app") return await generateUtmApp(req);
```

- [ ] **Step 4: Typecheck**

Run: `deno check server.ts`
Expected: `Check server.ts` sem erros.

- [ ] **Step 5: Commit**

```bash
git -C "ULTRON FOTUS/fotus-fop-tracking" add fop-functions/server.ts
git -C "ULTRON FOTUS/fotus-fop-tracking" commit -m "feat(utm): rota generate-utm-app (Play/Apple/Smart) grava tipo=app no fop-db"
```

---

## Task 5: Deploy do backend + verificação por curl

**Files:** nenhum (deploy + teste)

- [ ] **Step 1: Push (Igor autoriza) e redeploy**

```bash
git -C "ULTRON FOTUS/fotus-fop-tracking" push origin feat/fop-functions
```
Depois: EasyPanel → serviço `fop-functions` → **Implantar**. Aguardar `Listening on http://0.0.0.0:8000/`.

- [ ] **Step 2: Testar `/generate-utm` com campos extras**

Run:
```bash
curl -s -X POST "https://fotus-fop-functions.mk863j.easypanel.host/generate-utm" -H "Content-Type: application/json" -d '{"canal":"META","url_destino":"https://energia.fotus.com.br/x/","objetivo":"AQ","produto":"p","publico":"i","geo":"gv","periodo":"ago26","utm_source_platform":"instagram","utm_creative_format":"video","criado_por":"TESTE-EXT"}'
```
Expected: JSON `status:created` com `url_final` contendo `utm_source_platform=instagram&utm_creative_format=video`.

- [ ] **Step 3: Testar `/generate-utm-app`**

Run:
```bash
curl -s -X POST "https://fotus-fop-functions.mk863j.easypanel.host/generate-utm-app" -H "Content-Type: application/json" -d '{"campaign":"feirao_solar","source":"instagram","medium":"social","pkg":"com.fotus.mobile","appid":"6780997966","pt":"58265800","smarthost":"https://fotus.com.br/app","criado_por":"TESTE-EXT"}'
```
Expected: JSON `status:created` com `play`, `apple`, `smart` preenchidos.

- [ ] **Step 4: Limpar linhas de teste**

Rodar (script Python, gated): `DELETE FROM public.utm_links WHERE criado_por='TESTE-EXT'` e confirmar `SELECT count(*) ... = 0`.

---

## Task 6: Scaffold da extensão + tokens de design

**Files:**
- Create: `fotus-fop-tracking/web/utm-extension/manifest.json`
- Create: `fotus-fop-tracking/web/utm-extension/tokens.css`

- [ ] **Step 1: `manifest.json` (MV3)**

```json
{
  "manifest_version": 3,
  "name": "Fotus UTM Builder",
  "version": "1.0.0",
  "description": "Gera UTMs padronizadas da Fotus (web e app) e salva no banco para conciliação.",
  "action": { "default_popup": "popup.html", "default_title": "Fotus UTM Builder" },
  "permissions": ["activeTab", "storage"],
  "host_permissions": ["https://fotus-fop-functions.mk863j.easypanel.host/*"],
  "icons": { "128": "icon128.png" }
}
```

- [ ] **Step 2: `tokens.css` (design-system do Lucas)**

```css
/* tokens.css — paleta e tipografia do design-system fotus-utm-builder (MASTER.md).
   Fontes remotas são bloqueadas pela CSP da extensão → usar fallback do sistema. */
:root{
  --bg:#0F172A; --card:#1B2336; --primary:#1E293B; --secondary:#334155;
  --accent:#22C55E; --on-accent:#0F172A; --fg:#F8FAFC; --muted:#272F42;
  --muted-fg:#94A3B8; --line:#475569; --danger:#EF4444;
  --play:#3ddc84; --apple:#e5e7eb;
  --mono:"Fira Code",ui-monospace,SFMono-Regular,Menlo,monospace;
  --sans:"Fira Sans",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  --radius:12px;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--sans);width:400px;min-height:480px}
```

- [ ] **Step 3: Commit**

```bash
git -C "fotus-fop-tracking" add web/utm-extension/manifest.json web/utm-extension/tokens.css
git -C "fotus-fop-tracking" commit -m "feat(utm-ext): scaffold MV3 + tokens de design (Lucas)"
```

---

## Task 7: `popup.html` — shell com 2 abas

**Files:**
- Create: `fotus-fop-tracking/web/utm-extension/popup.html`

- [ ] **Step 1: Escrever o HTML**

```html
<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="popup.css"></head>
<body>
  <header class="hd">
    <div class="brand">FOTUS · UTM Builder</div>
    <input id="autor" class="autor" placeholder="seu nome (fica salvo)">
  </header>
  <nav class="tabs">
    <button class="tab active" data-tab="web">Link Web</button>
    <button class="tab" data-tab="app">Link de App</button>
  </nav>

  <section id="pane-web" class="pane">
    <label>Canal</label><select id="w-canal"></select>
    <label>Objetivo</label><select id="w-objetivo"></select>
    <label>Produto</label><select id="w-produto"></select>
    <label>Público</label><select id="w-publico"></select>
    <label>Geo</label><select id="w-geo"></select>
    <label>Período</label><input id="w-periodo" placeholder="ex.: ago26">
    <label>Conteúdo (opcional)</label><input id="w-content" placeholder="ex.: video-depoimento">
    <label>Plataforma (opcional)</label><input id="w-splatform" placeholder="ex.: instagram">
    <label>Formato criativo (opcional)</label><input id="w-cformat" placeholder="ex.: video">
    <label>URL de destino</label><input id="w-url" placeholder="URL da aba atual">
    <button id="w-gen" class="btn">Gerar & salvar</button>
    <div id="w-out" class="out"></div>
  </section>

  <section id="pane-app" class="pane hidden">
    <label>Origem (utm_source)</label><input id="a-source" placeholder="ex.: instagram">
    <label>Mídia (utm_medium)</label><input id="a-medium" placeholder="ex.: social">
    <label>Campanha (utm_campaign)</label><input id="a-campaign" placeholder="ex.: feirao_solar">
    <label>Conteúdo (opcional)</label><input id="a-content" placeholder="opcional">
    <details class="stores"><summary>Dados das lojas (já preenchidos)</summary>
      <label>Package (Android)</label><input id="a-pkg" value="com.fotus.mobile">
      <label>App ID (iOS)</label><input id="a-appid" value="6780997966">
      <label>Provider Token (pt)</label><input id="a-pt" value="58265800">
      <label>Smart Link host</label><input id="a-smarthost" placeholder="https://fotus.com.br/app">
    </details>
    <button id="a-gen" class="btn">Gerar & salvar</button>
    <div id="a-out" class="out"></div>
    <div id="a-qr" class="qr hidden"><img id="a-qrimg" alt="QR"></div>
  </section>

  <script src="popup.js"></script>
</body></html>
```

- [ ] **Step 2: `popup.css` (mínimo funcional)**

Create `fotus-fop-tracking/web/utm-extension/popup.css`:

```css
.hd{display:flex;flex-direction:column;gap:6px;padding:12px 14px;background:var(--primary)}
.brand{font-family:var(--mono);font-weight:700;font-size:13px;color:var(--accent);letter-spacing:.04em}
.autor{background:var(--muted);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:6px 8px;font-size:12px}
.tabs{display:flex;gap:4px;padding:8px 14px 0}
.tab{flex:1;background:var(--muted);color:var(--muted-fg);border:1px solid var(--line);border-bottom:none;border-radius:8px 8px 0 0;padding:8px;cursor:pointer;font-family:var(--mono);font-size:12px}
.tab.active{background:var(--card);color:var(--fg)}
.pane{display:flex;flex-direction:column;gap:4px;padding:12px 14px;background:var(--card)}
.pane.hidden{display:none}
label{font-size:11px;color:var(--muted-fg);margin-top:6px}
select,input{background:var(--muted);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:8px;font-size:13px;font-family:var(--sans)}
select:focus,input:focus{outline:none;border-color:var(--accent)}
.btn{margin-top:12px;background:var(--accent);color:var(--on-accent);border:none;border-radius:8px;padding:10px;font-weight:700;cursor:pointer;transition:opacity .2s}
.btn:hover{opacity:.9}
.stores summary{cursor:pointer;color:var(--muted-fg);font-size:12px;margin-top:8px}
.out{margin-top:10px;font-family:var(--mono);font-size:11px;word-break:break-all;color:var(--fg)}
.out .lk{display:block;background:var(--muted);border:1px solid var(--line);border-radius:8px;padding:8px;margin-top:6px}
.out .ok{color:var(--accent);font-size:11px;margin-top:6px}
.out .err{color:var(--danger)}
.qr{margin-top:10px;text-align:center}.qr.hidden{display:none}.qr img{width:200px;height:200px;background:#fff;border-radius:8px}
```

- [ ] **Step 3: Commit**

```bash
git -C "fotus-fop-tracking" add web/utm-extension/popup.html web/utm-extension/popup.css
git -C "fotus-fop-tracking" commit -m "feat(utm-ext): popup shell (2 abas) + css"
```

---

## Task 8: `popup.js` — base (config, autor, abas, autofill)

**Files:**
- Create: `fotus-fop-tracking/web/utm-extension/popup.js`

- [ ] **Step 1: Escrever a base do popup.js**

```js
const API = "https://fotus-fop-functions.mk863j.easypanel.host";
const $ = (id) => document.getElementById(id);

// autor persistente
const autor = $("autor");
chrome.storage.local.get("autor", (o) => { if (o.autor) autor.value = o.autor; });
autor.addEventListener("change", () => chrome.storage.local.set({ autor: autor.value.trim() }));

// abas
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("pane-web").classList.toggle("hidden", t.dataset.tab !== "web");
    $("pane-app").classList.toggle("hidden", t.dataset.tab !== "app");
  };
});

// autofill da URL da aba ativa
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]?.url && /^https?:/.test(tabs[0].url)) $("w-url").value = tabs[0].url;
});

// catálogo (com cache local)
async function carregarCatalogo() {
  const cache = await chrome.storage.local.get("catalogo");
  if (cache.catalogo) preencherSelects(cache.catalogo);
  try {
    const res = await fetch(`${API}/utm-config`);
    const cat = await res.json();
    chrome.storage.local.set({ catalogo: cat });
    preencherSelects(cat);
  } catch (e) { /* usa cache */ }
}
function preencherSelects(cat) {
  const map = { "w-canal": ["canal", "codigo"], "w-objetivo": ["objetivo", "codigo"], "w-produto": ["produto", "codigo"], "w-publico": ["publico", "codigo"], "w-geo": ["geo", "codigo"] };
  for (const [id, [key, campo]] of Object.entries(map)) {
    const sel = $(id); const rows = cat[key] || [];
    sel.innerHTML = rows.map((r) => `<option value="${r[campo]}">${r[campo]}</option>`).join("");
  }
}
carregarCatalogo();
```

- [ ] **Step 2: Verificação manual (parcial)**

Carregar a extensão (Task 11) e abrir o popup: as abas alternam, o campo URL vem preenchido com a aba, e os selects do catálogo populam. (Sem geração ainda.)

- [ ] **Step 3: Commit**

```bash
git -C "fotus-fop-tracking" add web/utm-extension/popup.js
git -C "fotus-fop-tracking" commit -m "feat(utm-ext): popup.js base (config, autor, abas, autofill)"
```

---

## Task 9: Aba Web — gerar & salvar

**Files:**
- Modify: `fotus-fop-tracking/web/utm-extension/popup.js` (adicionar ao final)

- [ ] **Step 1: Adicionar o handler de geração web**

```js
$("w-gen").onclick = async () => {
  const out = $("w-out");
  const body = {
    canal: $("w-canal").value, url_destino: $("w-url").value.trim(),
    objetivo: $("w-objetivo").value, produto: $("w-produto").value,
    publico: $("w-publico").value, geo: $("w-geo").value,
    periodo: $("w-periodo").value.trim(), content: $("w-content").value.trim(),
    utm_source_platform: $("w-splatform").value.trim(),
    utm_creative_format: $("w-cformat").value.trim(),
    criado_por: autor.value.trim(),
  };
  if (!body.url_destino) { out.innerHTML = '<div class="err">Informe a URL de destino.</div>'; return; }
  out.textContent = "gerando…";
  try {
    const res = await fetch(`${API}/generate-utm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    await navigator.clipboard.writeText(d.url_final);
    out.innerHTML = `<span class="lk">${d.url_final}</span><div class="ok">✓ copiado e ${d.status === "exists" ? "já existia" : "salvo"} no fop-db</div>`;
  } catch (e) { out.innerHTML = `<div class="err">erro: ${e.message}</div>`; }
};
```

- [ ] **Step 2: Verificação manual**

No popup, aba Web: preencher, clicar Gerar & salvar → aparece o link, foi copiado, e diz "salvo no fop-db". Conferir no fop-db: `SELECT * FROM utm_links WHERE tipo='web' ORDER BY id DESC LIMIT 1`.

- [ ] **Step 3: Commit**

```bash
git -C "fotus-fop-tracking" add web/utm-extension/popup.js
git -C "fotus-fop-tracking" commit -m "feat(utm-ext): aba Web gera via generate-utm, copia e salva"
```

---

## Task 10: Aba App — gerar & salvar + QR

**Files:**
- Modify: `fotus-fop-tracking/web/utm-extension/popup.js` (adicionar ao final)

- [ ] **Step 1: Adicionar o handler de geração de app**

```js
$("a-gen").onclick = async () => {
  const out = $("a-out"); const qr = $("a-qr");
  const body = {
    source: $("a-source").value.trim(), medium: $("a-medium").value.trim(),
    campaign: $("a-campaign").value.trim(), content: $("a-content").value.trim(),
    pkg: $("a-pkg").value.trim(), appid: $("a-appid").value.trim(),
    pt: $("a-pt").value.trim(), smarthost: $("a-smarthost").value.trim(),
    criado_por: autor.value.trim(),
  };
  if (!body.campaign) { out.innerHTML = '<div class="err">Informe a campanha.</div>'; return; }
  out.textContent = "gerando…";
  try {
    const res = await fetch(`${API}/generate-utm-app`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    const linhas = [];
    if (d.play) linhas.push(`<span class="lk">▶ Play: ${d.play}</span>`);
    if (d.apple) linhas.push(`<span class="lk"> Apple: ${d.apple}</span>`);
    if (d.smart) linhas.push(`<span class="lk">↗ Smart: ${d.smart}</span>`);
    out.innerHTML = linhas.join("") + `<div class="ok">✓ ${d.status === "exists" ? "já existia" : "salvo"} no fop-db</div>`;
    const principal = d.smart || d.play || d.apple;
    if (principal) { await navigator.clipboard.writeText(principal); }
    // QR do link principal (via serviço externo, como no app do Lucas)
    if (principal) { qr.classList.remove("hidden"); $("a-qrimg").src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(principal); }
  } catch (e) { out.innerHTML = `<div class="err">erro: ${e.message}</div>`; }
};
```

- [ ] **Step 2: Ajuste de CSP para o QR externo**

No `manifest.json`, adicionar a permissão de imagem do QR ao host_permissions:

```json
  "host_permissions": ["https://fotus-fop-functions.mk863j.easypanel.host/*", "https://api.qrserver.com/*"]
```

- [ ] **Step 3: Verificação manual**

Aba App: preencher campanha/origem/mídia, Gerar → aparecem Play/Apple/Smart, QR renderiza, link principal copiado. Conferir no fop-db: `SELECT tipo, store_meta FROM utm_links WHERE tipo='app' ORDER BY id DESC LIMIT 1`.

- [ ] **Step 4: Commit**

```bash
git -C "fotus-fop-tracking" add web/utm-extension/popup.js web/utm-extension/manifest.json
git -C "fotus-fop-tracking" commit -m "feat(utm-ext): aba App gera Play/Apple/Smart + QR e salva tipo=app"
```

---

## Task 11: Instalação (desempacotada) + verificação final

**Files:** nenhum

- [ ] **Step 1: Ícone**

Colocar um `icon128.png` (128×128, logo Fotus) em `web/utm-extension/`. Se ainda não houver, usar um PNG placeholder 128×128 temporário.

- [ ] **Step 2: Push**

```bash
git -C "fotus-fop-tracking" push origin feat/utm-builder-fase1
```

- [ ] **Step 3: Instalar no Chrome (passo do time)**

1. Abrir `chrome://extensions`.
2. Ligar **Modo do desenvolvedor** (canto superior direito).
3. **Carregar sem compactação** → selecionar a pasta `fotus-fop-tracking/web/utm-extension`.
4. Fixar a extensão na barra.

- [ ] **Step 4: Verificação E2E**

Abrir o popup numa aba qualquer: aba Web gera+salva (link copiado), aba App gera Play/Apple/Smart+QR+salva. Conferir no fop-db que `utm_links` recebeu 1 linha `web` e 1 `app` com `criado_por` preenchido. Apagar as linhas de teste ao final.

---

## Fase 2 (plano posterior — não implementar agora)
- `GET /utm-history?criado_por=` + aba Histórico lendo do fop-db (substitui localStorage).
- Tabela `utm_templates` + `GET/POST /utm-templates` + aba Modelos compartilhados.
- Bundle das fontes Fira (woff2) na extensão para fidelidade visual total.
- Ícones Fotus definitivos.
