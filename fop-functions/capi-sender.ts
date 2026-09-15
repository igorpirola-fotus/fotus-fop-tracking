// capi-sender.ts — hash SHA-256, normalização de telefone, envio CAPI Meta.
// Idêntico ao _shared/capi-sender.ts do Supabase, SEM o import do supabase-js (não era usado).

const META_API_VERSION = "v18.0";
const MAX_RETRIES = 3;

// ─── Hash SHA-256 ────────────────────────────────────────────────────────────
export async function hashValue(value: string): Promise<string> {
  const normalized = value.toLowerCase().trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Normalização (doc oficial da Meta, lida em 04/set/2026) ─────────────────
// Toda normalização acontece ANTES do hash. Errar aqui não degrada o match:
// zera. E é invisível no painel — o campo aparece com 100% de "cobertura"
// mesmo casando 0%. Ver docs/16-meta-capi-boas-praticas.md.

/** Remove acento mantendo a letra base: "josé" → "jose". */
function semAcento(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Telefone — regra literal da Meta: "Remove symbols, letters, and any leading
// zeros. Phone numbers must include a country code to be used for matching."
// O `+` É símbolo: até 04/set/2026 esta função devolvia "+55..." e o hash saía
// com ele, o que invalidava o match de TODO evento do rd-sync e dos públicos.
// Devolve "" quando o número não é reconhecível — telefone quebrado não casa
// com ninguém, e mandá-lo só infla a cobertura aparente no painel.
export function normalizePhone(phone: string): string {
  if (!phone) return "";
  const digitos = phone.replace(/\D/g, "").replace(/^0+/, "");

  // 12 = 55 + DDD + 8 (fixo); 13 = 55 + DDD + 9 (celular). Só nesses tamanhos
  // o "55" da frente é código de país — em 10/11 dígitos ele é o DDD do RS.
  const local = (digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")
    ? digitos.slice(2)
    : digitos;

  if (local.length !== 10 && local.length !== 11) return "";

  // Celular antigo de 8 dígitos (DDD + 8 começando em 6-9) → insere o 9.
  // Fixo começa em 2-5 e fica como está. Mesma régua do import do RD CRM.
  const ajustado = local.length === 10 && /^[6-9]/.test(local.slice(2))
    ? `${local.slice(0, 2)}9${local.slice(2)}`
    : local;

  return `55${ajustado}`;
}

/** Nome (fn/ln): minúscula, sem acento, sem pontuação. */
export function normalizeName(v: string): string {
  return semAcento(v).toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Cidade/UF (ct/st): minúscula, sem acento, sem pontuação e SEM ESPAÇO —
 *  a Meta exige "belohorizonte", não "belo horizonte". */
export function normalizeGeo(v: string): string {
  return semAcento(v).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ─── Construção do user_data com Advanced Matching ───────────────────────────
export async function buildUserData(params: {
  email?: string;
  phone?: string;
  cnpj?: string;
  nome?: string;
  cidade?: string;
  estado?: string;
  cep?: string;
  ip?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
}): Promise<Record<string, unknown>> {
  const ud: Record<string, unknown> = {};

  if (params.email) ud.em = [await hashValue(params.email)];
  if (params.phone) {
    const normalized = normalizePhone(params.phone);
    if (normalized) ud.ph = [await hashValue(normalized)];
  }
  if (params.nome) {
    const parts = normalizeName(params.nome).split(" ").filter(Boolean);
    if (parts[0]) ud.fn = [await hashValue(parts[0])];
    if (parts.length > 1) ud.ln = [await hashValue(parts.slice(1).join(" "))];
  }
  if (params.cidade) {
    const ct = normalizeGeo(params.cidade);
    if (ct) ud.ct = [await hashValue(ct)];
  }
  if (params.estado) {
    const st = normalizeGeo(params.estado);
    if (st) ud.st = [await hashValue(st)];
  }
  if (params.cep) ud.zp = [await hashValue(params.cep.replace(/\D/g, ""))];

  // external_id = sha256 do CNPJ (só dígitos). É a chave de match B2B estável:
  // o e-mail é corporativo e frequentemente não é o da conta pessoal na Meta.
  // Tem de ser IDÊNTICO ao EXTERN_ID de publicos-meta.ts — se divergir, público
  // e evento deixam de casar (há teste travando essa igualdade).
  if (params.cnpj) {
    const digitos = params.cnpj.replace(/\D/g, "");
    if (digitos) ud.external_id = [await hashValue(digitos)];
  }

  // `country` está na lista de campos que a Meta EXIGE hasheado — ia em texto
  // puro até 04/set/2026 e era simplesmente descartado.
  ud.country = [await hashValue("br")];
  if (params.ip) ud.client_ip_address = params.ip;
  if (params.userAgent) ud.client_user_agent = params.userAgent;
  if (params.fbp) ud.fbp = params.fbp;
  if (params.fbc) ud.fbc = params.fbc;

  return ud;
}

// ─── Envio ao Meta CAPI com retry exponencial (1s → 2s → 4s) ─────────────────
export async function sendToCAPI(params: {
  event_name: string;
  event_id: string;
  event_source_url?: string;
  action_source: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
  test_event_code?: string;
  event_time?: number;
}): Promise<{ success: boolean; eventId?: string; fbtrace_id?: string; error?: string }> {
  const pixelId = Deno.env.get("META_PIXEL_ID")!;
  const token = Deno.env.get("META_CAPI_TOKEN")!;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`;

  const payload = {
    data: [{
      event_name: params.event_name,
      event_time: params.event_time ?? Math.floor(Date.now() / 1000),
      event_id: params.event_id,
      event_source_url: params.event_source_url,
      action_source: params.action_source,
      user_data: params.user_data,
      custom_data: params.custom_data,
    }],
    access_token: token,
    ...(params.test_event_code && { test_event_code: params.test_event_code }),
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (response.ok && result.events_received > 0) {
        return {
          success: true,
          eventId: result.events_received?.toString(),
          fbtrace_id: result.fbtrace_id,
        };
      }
      if (attempt === MAX_RETRIES) {
        return { success: false, error: JSON.stringify(result.error || result) };
      }
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        return { success: false, error: (err as Error).message };
      }
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  return { success: false, error: "Max retries exceeded" };
}
