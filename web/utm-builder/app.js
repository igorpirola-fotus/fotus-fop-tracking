/* ─────────────────────────────────────────────────────────────
   Fotus UTM Builder — app.js
   Fase 1: client-side build + save via Edge Functions
   ───────────────────────────────────────────────────────────── */

const API_BASE = "https://fotus-fop-functions.mk863j.easypanel.host";
const ANON     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0dG1sbmh6dmV2dGFiamV0c3F6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NjMzMDksImV4cCI6MjA5NDEzOTMwOX0.M2nO3V7IZR4GZ5O_X4LBySoHiqb6slj9eprOxsWJNbE";

const HEADERS = {
  "Content-Type":  "application/json",
  "Authorization": `Bearer ${ANON}`,
};

const CACHE_KEY_CONFIG = "utm_config_cache";
const CACHE_KEY_NOME   = "utm_nome";

/* ── State ─────────────────────────────────────────────────── */
let config        = null;   // { canal, objetivo, produto, publico, geo }
let selectedCanal = null;   // canal object from config
let lastResult    = null;   // last generated URL (for copy)

/* ── DOM refs ───────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const elErrorBanner    = $("error-banner");
const elCanalLoading   = $("canal-loading");
const elCanalGrid      = $("canal-grid");
const elSelObjetivo    = $("sel-objetivo");
const elSelProduto     = $("sel-produto");
const elSelPublico     = $("sel-publico");
const elSelGeo         = $("sel-geo");
const elInputPeriodo   = $("input-periodo");
const elPreviewValue   = $("preview-value");
const elInputUrl       = $("input-url");
const elInputContent   = $("input-content");
const elInputTerm      = $("input-term");
const elTermHint       = $("term-hint");
const elInputNome      = $("input-nome");
const elBtnGenerate    = $("btn-generate");
const elResultSection  = $("result-section");
const elSaveStatus     = $("save-status");
const elCleanUrlBlock  = $("clean-url-block");
const elCleanUrlValue  = $("clean-url-value");
const elSuffixBlock    = $("suffix-block");
const elSuffixValue    = $("suffix-value");
const elFullUrlBlock   = $("full-url-block");
const elFullUrlValue   = $("full-url-value");
const elFullUrlNote    = $("full-url-note");
const elCampaignValue  = $("campaign-value");
const elBtnCopy        = $("btn-copy");
const elBtnReset       = $("btn-reset");

/* ── Helpers ────────────────────────────────────────────────── */
function normalize(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

function buildCampaignName() {
  const parts = [
    elSelObjetivo.value,
    elSelProduto.value,
    elSelPublico.value,
    elSelGeo.value,
    elInputPeriodo.value.trim(),
  ].filter(Boolean).map(normalize);
  return parts.join("|");
}

function buildUtmParams(campaignName) {
  if (!selectedCanal) return null;
  const params = new URLSearchParams();
  params.set("utm_source",   selectedCanal.utm_source  || normalize(selectedCanal.codigo));
  params.set("utm_medium",   selectedCanal.utm_medium  || "cpc");
  params.set("utm_campaign", campaignName);
  const content = elInputContent.value.trim();
  if (content) params.set("utm_content", content);
  const term = elInputTerm.value.trim();
  if (term && !elInputTerm.disabled) params.set("utm_term", term);
  // force %20 instead of +
  return params.toString().replaceAll("+", "%20");
}

function getCleanUrl() {
  const raw = elInputUrl.value.trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw;
  }
}

function requiredFieldsFilled() {
  return (
    elInputUrl.value.trim() !== "" &&
    selectedCanal !== null &&
    elSelObjetivo.value !== "" &&
    elSelProduto.value  !== "" &&
    elSelPublico.value  !== "" &&
    elSelGeo.value      !== ""
  );
}

function showError(msg) {
  elErrorBanner.textContent = msg;
  elErrorBanner.style.display = "block";
}

function clearError() {
  elErrorBanner.style.display = "none";
  elErrorBanner.textContent   = "";
}

/* ── Config loading ─────────────────────────────────────────── */
async function loadConfig() {
  elCanalLoading.classList.add("visible");
  try {
    const res = await fetch(`${API_BASE}/utm-config`, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    localStorage.setItem(CACHE_KEY_CONFIG, JSON.stringify(data));
    applyConfig(data);
  } catch (err) {
    const cached = localStorage.getItem(CACHE_KEY_CONFIG);
    if (cached) {
      showError("Não consegui atualizar as opções — usando cache local. Verifique sua conexão.");
      applyConfig(JSON.parse(cached));
    } else {
      showError("Não consegui carregar as configurações. Verifique sua conexão e recarregue a página.");
    }
  } finally {
    elCanalLoading.classList.remove("visible");
  }
}

function applyConfig(data) {
  config = data;
  renderCanalButtons(data.canal || []);
  populateSelect(elSelObjetivo, data.objetivo || []);
  populateSelect(elSelProduto,  data.produto  || []);
  populateSelect(elSelPublico,  data.publico  || []);
  populateSelect(elSelGeo,      data.geo      || []);
}

function renderCanalButtons(canais) {
  elCanalGrid.innerHTML = "";
  const sorted = [...canais]
    .filter((c) => c.ativo !== false)
    .sort((a, b) => (a.ordem || 99) - (b.ordem || 99));

  sorted.forEach((canal) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "canal-btn";
    btn.textContent = canal.codigo;
    btn.dataset.codigo = canal.codigo;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => selectCanal(canal, btn));
    elCanalGrid.appendChild(btn);
  });
}

function populateSelect(sel, items) {
  // keep placeholder
  while (sel.options.length > 1) sel.remove(1);
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.codigo || item.code || item.label || item;
    opt.textContent = item.label || item.codigo || item;
    sel.appendChild(opt);
  });
}

/* ── Canal selection ────────────────────────────────────────── */
function selectCanal(canal, btn) {
  // deselect previous
  elCanalGrid.querySelectorAll(".canal-btn").forEach((b) => {
    b.classList.remove("selected");
    b.setAttribute("aria-pressed", "false");
  });
  btn.classList.add("selected");
  btn.setAttribute("aria-pressed", "true");
  selectedCanal = canal;

  // utm_term: only for GOOGLE-SEARCH
  const isGoogleSearch = (canal.codigo === "GOOGLE-SEARCH");
  elInputTerm.disabled = !isGoogleSearch;
  elTermHint.textContent = isGoogleSearch
    ? "Informe a palavra-chave do grupo de anúncios."
    : "Disponível apenas para Google Search.";

  updatePreview();
  updateGenerateBtn();
  hideResult();
}

/* ── Live preview ───────────────────────────────────────────── */
function updatePreview() {
  const name = buildCampaignName();
  elPreviewValue.textContent = name || "—";
}

/* ── Generate button state ──────────────────────────────────── */
function updateGenerateBtn() {
  elBtnGenerate.disabled = !requiredFieldsFilled();
}

/* ── Result display ─────────────────────────────────────────── */
function hideResult() {
  elResultSection.style.display = "none";
  lastResult = null;
}

function showResult(fullUrl, paramString, geraVia, campaignName) {
  lastResult = fullUrl;

  elCampaignValue.textContent = campaignName;

  // Reset all blocks
  elCleanUrlBlock.style.display = "none";
  elSuffixBlock.style.display   = "none";
  elFullUrlBlock.style.display  = "none";

  if (geraVia === "final_url_suffix") {
    // Google Ads: show clean URL + suffix separately
    elCleanUrlValue.textContent = getCleanUrl();
    elCleanUrlBlock.style.display = "block";
    elSuffixValue.textContent = paramString;
    elSuffixBlock.style.display   = "block";
    lastResult = paramString; // copy the suffix, not the full URL
  } else if (geraVia === "url_tags") {
    elFullUrlValue.textContent = fullUrl;
    elFullUrlNote.textContent  = "No Meta, isto vai no campo 'Parâmetros de URL' do anúncio.";
    elFullUrlBlock.style.display = "block";
  } else if (geraVia === "adtracking") {
    elFullUrlValue.textContent = fullUrl;
    elFullUrlNote.textContent  = "No LinkedIn vai nos parâmetros de rastreamento da campanha.";
    elFullUrlBlock.style.display = "block";
  } else {
    // "url" or unknown
    elFullUrlValue.textContent = fullUrl;
    elFullUrlNote.textContent  = "";
    elFullUrlBlock.style.display = "block";
  }

  elResultSection.style.display = "block";
  elResultSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── Generate & Save ────────────────────────────────────────── */
async function generateAndSave() {
  if (!requiredFieldsFilled()) return;
  clearError();

  const campaignName = buildCampaignName();
  const paramString  = buildUtmParams(campaignName);
  const destUrl      = elInputUrl.value.trim();
  const geraVia      = selectedCanal.gera_via || "url";

  // Build full URL
  let fullUrl;
  try {
    const u = new URL(destUrl);
    // Append each param manually to preserve %20
    const sep = destUrl.includes("?") ? "&" : "?";
    fullUrl = destUrl + sep + paramString;
  } catch {
    fullUrl = destUrl + "?" + paramString;
  }

  // Show result immediately (client-side, resilient)
  elSaveStatus.textContent = "Salvando no catálogo...";
  elSaveStatus.className   = "save-status";
  showResult(fullUrl, paramString, geraVia, campaignName);

  // POST to edge function
  const body = {
    url_destino: destUrl,
    canal:       selectedCanal.codigo,
    objetivo:    elSelObjetivo.value,
    produto:     elSelProduto.value,
    publico:     elSelPublico.value,
    geo:         elSelGeo.value,
  };
  const periodo = elInputPeriodo.value.trim();
  if (periodo) body.periodo = periodo;
  const content = elInputContent.value.trim();
  if (content) body.content = content;
  const term = elInputTerm.value.trim();
  if (term && !elInputTerm.disabled) body.term = term;
  const nome = elInputNome.value.trim();
  if (nome) body.criado_por = nome;

  try {
    const res = await fetch(`${API_BASE}/generate-utm`, {
      method:  "POST",
      headers: HEADERS,
      body:    JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const status = data.status || "created";
    if (status === "created" || status === "exists") {
      elSaveStatus.textContent = "salvo no catálogo ✓";
      elSaveStatus.className   = "save-status ok";
    } else {
      throw new Error("status inesperado: " + status);
    }
  } catch (err) {
    elSaveStatus.textContent = "link gerado, mas não registrei — tenta de novo depois.";
    elSaveStatus.className   = "save-status err";
  }
}

/* ── Copy to clipboard ──────────────────────────────────────── */
function copyLink() {
  if (!lastResult) return;
  navigator.clipboard.writeText(lastResult).then(() => {
    const orig = elBtnCopy.textContent;
    elBtnCopy.textContent = "Copiado!";
    setTimeout(() => { elBtnCopy.textContent = orig; }, 1800);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = lastResult;
    ta.style.position = "fixed";
    ta.style.opacity  = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    elBtnCopy.textContent = "Copiado!";
    setTimeout(() => { elBtnCopy.textContent = "Copiar link"; }, 1800);
  });
}

/* ── Reset ──────────────────────────────────────────────────── */
function resetForm() {
  elInputUrl.value        = "";
  elInputContent.value    = "";
  elInputTerm.value       = "";
  elInputPeriodo.value    = "";
  elSelObjetivo.value     = "";
  elSelProduto.value      = "";
  elSelPublico.value      = "";
  elSelGeo.value          = "";
  selectedCanal           = null;

  elCanalGrid.querySelectorAll(".canal-btn").forEach((b) => {
    b.classList.remove("selected");
    b.setAttribute("aria-pressed", "false");
  });

  elInputTerm.disabled    = true;
  elTermHint.textContent  = "Disponível apenas para Google Search.";
  elPreviewValue.textContent = "—";
  elBtnGenerate.disabled  = true;

  hideResult();
  clearError();
  elInputUrl.focus();
}

/* ── Event listeners ────────────────────────────────────────── */
// Nome persistence
elInputNome.addEventListener("input", () => {
  localStorage.setItem(CACHE_KEY_NOME, elInputNome.value);
});

// Live preview triggers
[elSelObjetivo, elSelProduto, elSelPublico, elSelGeo].forEach((el) => {
  el.addEventListener("change", () => {
    updatePreview();
    updateGenerateBtn();
    hideResult();
  });
});
elInputPeriodo.addEventListener("input", () => {
  updatePreview();
  hideResult();
});
elInputUrl.addEventListener("input", () => {
  updateGenerateBtn();
  hideResult();
});
elInputContent.addEventListener("input", () => { hideResult(); });
elInputTerm.addEventListener("input",    () => { hideResult(); });

// Buttons
elBtnGenerate.addEventListener("click", generateAndSave);
elBtnCopy.addEventListener("click",     copyLink);
elBtnReset.addEventListener("click",    resetForm);

/* ── Init ───────────────────────────────────────────────────── */
(function init() {
  // Restore nome
  const savedNome = localStorage.getItem(CACHE_KEY_NOME);
  if (savedNome) elInputNome.value = savedNome;

  // Load config
  loadConfig();
})();
