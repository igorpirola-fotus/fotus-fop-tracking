-- 007 — suporte ao resolvedor de CNPJ do rd-sync (fop-db / EasyPanel)
--
-- Contexto: o payload nativo do webhook do RD Station CRM (`crm_deal_updated`)
-- NÃO traz `organization`, `contacts` nem `organization_id`, e o CNPJ não está em
-- `deal_custom_fields`. Resultado: 100% dos deals em etapa mapeada falhavam com
-- "cnpj obrigatório" (37.963 falhas em 7d, auditoria 29/jul/2026) e nenhum evento
-- de fundo de funil (Contact/Schedule/AddToCart/Purchase) era gerado.
--
-- O fix busca o deal completo na API do RD CRM (que traz a organização) — o que
-- exige (a) token OAuth2 renovável e (b) cache, porque o rate limit do CRM é de
-- 120 req/min e há picos de 10k webhooks/hora.
--
-- NB: este banco é Postgres puro (sem Supabase) — sem RLS, sem policies.

-- ── 1. Tokens OAuth2 persistidos ───────────────────────────────────────────
-- O access_token do RD CRM expira em 2h e o refresh_token é ROTATIVO (cada uso
-- invalida o anterior e a janela é de 14 dias sem uso). Guardar o par no banco
-- é o que permite o container renovar sozinho sem intervenção manual.
CREATE TABLE IF NOT EXISTS public.oauth_tokens (
  provider      TEXT PRIMARY KEY,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.oauth_tokens IS
  'Par (access_token, refresh_token) por provedor OAuth2. refresh_token do RD CRM e rotativo: sempre gravar o novo par apos renovar.';

-- ── 2. Cache deal → CNPJ ───────────────────────────────────────────────────
-- 37k webhooks/24h se concentram em ~12k deals distintos: sem cache o fix
-- estouraria o rate limit da API do RD. `cnpj` nulo = já consultamos e o deal
-- realmente não tem CNPJ (negative caching, evita re-consulta em loop).
CREATE TABLE IF NOT EXISTS public.rd_deal_cnpj_cache (
  rd_deal_id  TEXT PRIMARY KEY,
  cnpj        TEXT,
  org_id      TEXT,
  fonte       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rd_deal_cnpj_cache_cnpj
  ON public.rd_deal_cnpj_cache (cnpj) WHERE cnpj IS NOT NULL;

COMMENT ON TABLE public.rd_deal_cnpj_cache IS
  'Cache deal RD -> CNPJ resolvido via API do CRM. cnpj NULL = deal sem CNPJ (negative cache).';

-- ── 3. Fila de webhooks: status "skipped" ──────────────────────────────────
-- Antes, etapa fora do STAGE_TO_EVENT era marcada como "processed", inflando a
-- métrica de saúde (6.639 "processed"/24h sem um único evento gerado).
COMMENT ON COLUMN public.rdstation_crm_webhook_events.processing_status IS
  'processing | processed (evento gerado ou duplicado) | skipped (etapa fora do mapa) | skipped_no_cnpj (deal sem CNPJ) | failed (erro real)';

-- Reprocessamento em lote consulta por status + received_at.
CREATE INDEX IF NOT EXISTS idx_rd_webhook_events_status_received
  ON public.rdstation_crm_webhook_events (processing_status, received_at DESC);
