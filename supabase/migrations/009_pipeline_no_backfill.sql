-- 009 — registra o funil (pipeline) de cada deal contabilizado no backfill
--
-- Contexto (30/jul/2026): o CRM tem 10 pipelines e `status:won` aparece em
-- vários. "MKT Movimentação" tinha 734 deals marcados como ganhos, TODOS na
-- etapa "Descarte" — cards de processo de marketing, não pedidos. Eles entraram
-- no backfill como compras e somaram no LTV.
--
-- Sem o pipeline gravado aqui, a única forma de corrigir era zerar tudo e
-- recalcular. Com ele, dá para reverter cirurgicamente qualquer funil que se
-- descubra depois que não é venda.
ALTER TABLE public.rd_won_backfill
  ADD COLUMN IF NOT EXISTS pipeline_id TEXT;

CREATE INDEX IF NOT EXISTS idx_rd_won_backfill_pipeline
  ON public.rd_won_backfill (pipeline_id);

COMMENT ON COLUMN public.rd_won_backfill.pipeline_id IS
  'Funil do deal no RD CRM. Venda = Funil Comercial (685d9b02...), BDR (688a4580...), SDR (68643e1e...) e Fotus Charge (69e60a4c..., unidade de negocio que recebe midia paga). Os demais sao funis de apoio interno.';
