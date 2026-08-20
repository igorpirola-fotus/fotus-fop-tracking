const API = "https://fotus-fop-functions.mk863j.easypanel.host";
const $ = (id) => document.getElementById(id);

// ── autor persistente ──────────────────────────────────────────────────────
const autor = $("autor");
chrome.storage.local.get("autor", (o) => { if (o.autor) autor.value = o.autor; });
autor.addEventListener("change", () => chrome.storage.local.set({ autor: autor.value.trim() }));

// ── abas ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("pane-web").classList.toggle("hidden", t.dataset.tab !== "web");
    $("pane-app").classList.toggle("hidden", t.dataset.tab !== "app");
  };
});

// ── autofill da URL da aba ativa ─────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]?.url && /^https?:/.test(tabs[0].url)) $("w-url").value = tabs[0].url;
});

// ── catálogo (com cache local) ───────────────────────────────────────────────
async function carregarCatalogo() {
  const cache = await chrome.storage.local.get("catalogo");
  if (cache.catalogo) preencherSelects(cache.catalogo);
  try {
    const res = await fetch(`${API}/utm-config`);
    const cat = await res.json();
    chrome.storage.local.set({ catalogo: cat });
    preencherSelects(cat);
  } catch (e) { /* mantém o cache */ }
}
function preencherSelects(cat) {
  const map = { "w-canal": "canal", "w-objetivo": "objetivo", "w-produto": "produto", "w-publico": "publico", "w-geo": "geo" };
  for (const [id, key] of Object.entries(map)) {
    const sel = $(id); const rows = cat[key] || [];
    sel.innerHTML = rows.map((r) => `<option value="${r.codigo}">${r.codigo}</option>`).join("");
  }
}
carregarCatalogo();

// ── aba Web: gerar & salvar ──────────────────────────────────────────────────
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

// ── aba App: gerar & salvar + QR ─────────────────────────────────────────────
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
    if (d.play) linhas.push(`<span class="lk">Play: ${d.play}</span>`);
    if (d.apple) linhas.push(`<span class="lk">Apple: ${d.apple}</span>`);
    if (d.smart) linhas.push(`<span class="lk">Smart: ${d.smart}</span>`);
    out.innerHTML = linhas.join("") + `<div class="ok">✓ ${d.status === "exists" ? "já existia" : "salvo"} no fop-db</div>`;
    const principal = d.smart || d.play || d.apple;
    if (principal) {
      await navigator.clipboard.writeText(principal);
      qr.classList.remove("hidden");
      $("a-qrimg").src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(principal);
    }
  } catch (e) { out.innerHTML = `<div class="err">erro: ${e.message}</div>`; }
};
