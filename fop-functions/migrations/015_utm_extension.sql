-- 015_utm_extension.sql — colunas para web (campos extras) e app (loja).
-- Aplicada no fop-db via webhook fopdb-q em 2026-08-20.
ALTER TABLE public.utm_links
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS utm_source_platform text,
  ADD COLUMN IF NOT EXISTS utm_creative_format text,
  ADD COLUMN IF NOT EXISTS store_meta jsonb;
