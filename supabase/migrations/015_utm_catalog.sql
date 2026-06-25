-- Migration 015 — Catálogo de UTM (Fase 1)
-- Ref: ULTRON FOTUS/docs/superpowers/specs/2026-06-25-utm-builder-design.md
-- Tabelas-mestras dos códigos do doc 09 + catálogo de links gerados.
-- 100% aditiva: só CREATE de objetos novos; não altera/apaga nada existente.

-- ── Tabelas de código (espelham docs/09-naming-convention.md §3) ────────────
CREATE TABLE IF NOT EXISTS public.codigos_canal (
  codigo      TEXT PRIMARY KEY,            -- 'META', 'GOOGLE-SEARCH', ...
  plataforma  TEXT NOT NULL,               -- 'meta' | 'google' | 'linkedin'
  utm_source  TEXT NOT NULL,               -- 'meta', 'google-search', ...
  utm_medium  TEXT NOT NULL,               -- 'paid-social', 'cpc', ...
  gera_via    TEXT NOT NULL DEFAULT 'url', -- 'url'|'url_tags'|'final_url_suffix'|'adtracking'
  ordem       INT  NOT NULL DEFAULT 100,
  ativo       BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.codigos_objetivo (
  codigo TEXT PRIMARY KEY, label TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 100, ativo BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.codigos_produto (
  codigo TEXT PRIMARY KEY, label TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 100, ativo BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.codigos_publico (
  codigo TEXT PRIMARY KEY, label TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 100, ativo BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.codigos_geo (
  codigo TEXT PRIMARY KEY, label TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 100, ativo BOOLEAN NOT NULL DEFAULT true
);

-- ── Catálogo de links gerados ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.utm_links (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por   TEXT,
  url_destino  TEXT NOT NULL,
  utm_source   TEXT NOT NULL,
  utm_medium   TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  utm_content  TEXT,
  utm_term     TEXT,
  utm_id       TEXT NOT NULL,
  funnel       TEXT,                         -- 'aquisicao'|'reativacao' (derivado do objetivo)
  plataforma   TEXT,
  campanha_id  TEXT,                         -- nulo na Fase 1; preenchido na Fase 3
  url_final    TEXT NOT NULL,
  hash_dedupe  TEXT NOT NULL,
  status_push  TEXT NOT NULL DEFAULT 'n/a',  -- 'n/a'|'pendente'|'aplicado'|'erro'
  CONSTRAINT uq_utm_links_hash UNIQUE (hash_dedupe)
);
CREATE INDEX IF NOT EXISTS idx_utm_links_campaign ON public.utm_links (utm_campaign);
CREATE INDEX IF NOT EXISTS idx_utm_links_created  ON public.utm_links (created_at);

-- ── Segurança: RLS ligada, sem policies ⇒ só service_role (padrão FOP) ───────
ALTER TABLE public.codigos_canal     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_objetivo  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_produto   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_publico   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_geo       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utm_links         ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.utm_links IS 'Catálogo de UTMs geradas. Ref: spec UTM Builder Fase 1.';
