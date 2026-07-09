-- Migration 010 — Schema `ultron` (lado do CUSTO de mídia)
-- Projeto: fotus-tracking | Região: sa-east-1 (São Paulo)
-- Ref: docs/12-adr-ultron-fop-boundary.md (Sprint A)
--
-- IMPORTANTE: o schema `ultron` JÁ EXISTE e é gravado pelos ETLs n8n do ULTRON
-- (etl-meta-ads → UPSERT ultron.campanhas / ultron.eventos_normalizados).
-- Esta migration recria esse schema DENTRO da base do FOP, no contrato EXATO
-- que os UPSERTs do n8n esperam — para que, ao repontar a credencial Postgres
-- do n8n para esta base, o ETL funcione SEM mudança de lógica.
-- Assim o join custo (ultron) ↔ conversão (public) vira uma VIEW, não uma
-- integração entre bancos. Fim das duas fontes de verdade.

CREATE SCHEMA IF NOT EXISTS ultron;

-- ── Dimensão de campanhas ──────────────────────────────────────────────────
-- Contrato do nó "UPSERT ultron.campanhas":
--   ON CONFLICT (plataforma, campanha_id)
CREATE TABLE IF NOT EXISTS ultron.campanhas (
  id           BIGSERIAL PRIMARY KEY,
  plataforma   TEXT NOT NULL,             -- 'meta' | 'google' | ...
  campanha_id  TEXT NOT NULL,
  nome         TEXT,
  status       TEXT DEFAULT 'active',
  -- enriquecimento p/ o join com o funil do FOP (Sprint B; pode começar nulo):
  utm_campaign TEXT,                       -- casa com public.events.utm_campaign
  funnel       TEXT,                       -- 'aquisicao' | 'reativacao' (da nomenclatura)
  ultima_sync  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_ultron_campanhas UNIQUE (plataforma, campanha_id)
);

-- ── Fato de insights/custo normalizado ─────────────────────────────────────
-- Contrato do nó "UPSERT ultron.eventos_normalizados":
--   ON CONFLICT (data, plataforma, campanha_id, criativo_id)
-- OBS: receita_brl aqui é a RECEITA REPORTADA PELA PLATAFORMA (Meta), usada só
-- para sanity check. A receita oficial é a do FOP (Purchase real do ERP/RD).
CREATE TABLE IF NOT EXISTS ultron.eventos_normalizados (
  id                BIGSERIAL PRIMARY KEY,
  data              DATE NOT NULL,
  plataforma        TEXT NOT NULL,
  campanha_id       TEXT NOT NULL,
  criativo_id       TEXT NOT NULL DEFAULT '',
  impressoes        BIGINT  DEFAULT 0,
  cliques           BIGINT  DEFAULT 0,
  spend_brl         NUMERIC DEFAULT 0,
  leads             INT     DEFAULT 0,      -- leads reportados pela plataforma
  receita_brl       NUMERIC DEFAULT 0,      -- receita reportada pela plataforma (sanity check)
  conversoes_custom JSONB,                  -- array `actions` original (auditoria)
  ultima_sync       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_ultron_eventos UNIQUE (data, plataforma, campanha_id, criativo_id)
);

-- ── Índices para os joins/filtros mais comuns ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ultron_ev_data        ON ultron.eventos_normalizados (data);
CREATE INDEX IF NOT EXISTS idx_ultron_ev_plat_camp   ON ultron.eventos_normalizados (plataforma, campanha_id);
CREATE INDEX IF NOT EXISTS idx_ultron_camp_utm       ON ultron.campanhas (utm_campaign);

-- ── Segurança (lente CIO): RLS ligada, sem policies ⇒ só service_role acessa ─
ALTER TABLE ultron.campanhas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ultron.eventos_normalizados ENABLE ROW LEVEL SECURITY;
-- O ETL do ULTRON escreve com a service_role key. Nenhum acesso anon/authenticated.

-- ── View de conveniência (Sprint A): custo agregado por dia/plataforma/funil ─
-- (ainda SEM join a vendas — o mv_cac_canal_funil que cruza com public.events
--  e public.integradores vem na Sprint B.)
CREATE OR REPLACE VIEW ultron.v_spend_diario AS
SELECT
  e.data,
  e.plataforma,
  c.funnel,
  SUM(e.spend_brl)   AS spend_brl,
  SUM(e.impressoes)  AS impressoes,
  SUM(e.cliques)     AS cliques,
  SUM(e.leads)       AS leads_plataforma,
  SUM(e.receita_brl) AS receita_plataforma
FROM ultron.eventos_normalizados e
LEFT JOIN ultron.campanhas c
  ON c.plataforma = e.plataforma AND c.campanha_id = e.campanha_id
GROUP BY e.data, e.plataforma, c.funnel;

COMMENT ON SCHEMA ultron IS 'Lado do custo de mídia (ETLs n8n do ULTRON). Ref: docs/12-adr-ultron-fop-boundary.md';
COMMENT ON TABLE  ultron.eventos_normalizados IS 'Spend/insights diário por plataforma/campanha/criativo. Join ao funil via ultron.campanhas.utm_campaign = public.events.utm_campaign.';
