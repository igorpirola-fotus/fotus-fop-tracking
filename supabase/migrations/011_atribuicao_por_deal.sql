-- 011 — atribuição POR NEGÓCIO (não por integrador)
--
-- REQUISITO (Igor, 30/jul/2026): "cada deal tem uma origem e é isso que preciso
-- preservar — a utm de origem dele. uma empresa fez o primeiro contato através
-- de uma campanha de google search ads, mas depois de um mês recebeu um email e
-- ali fez uma compra. 3 meses depois fez mais dois pedidos através de uma
-- comunicação que o consultor fez pelo whatsapp corporativo. temos 3 negócios da
-- mesma empresa com fontes distintas. é isso que o FOP precisa trazer."
--
-- O QUE ESTAVA ERRADO: a primeira análise de LTV por canal usava a PRIMEIRA
-- sessão do integrador e jogava o LTV inteiro naquele canal. No exemplo acima,
-- os 4 pedidos sairiam como "google search" — o e-mail e o WhatsApp do consultor
-- nunca apareceriam, e o google levaria crédito por 3 vendas que não originou.

ALTER TABLE public.rd_won_backfill
  ADD COLUMN IF NOT EXISTS utm_source       TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium       TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign     TEXT,
  ADD COLUMN IF NOT EXISTS utm_content      TEXT,
  ADD COLUMN IF NOT EXISTS utm_term         TEXT,
  ADD COLUMN IF NOT EXISTS deal_source      TEXT,
  ADD COLUMN IF NOT EXISTS session_id       TEXT,
  ADD COLUMN IF NOT EXISTS atribuicao_fonte TEXT,
  ADD COLUMN IF NOT EXISTS potencia_kwp     NUMERIC,
  ADD COLUMN IF NOT EXISTS criado_em        TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rd_won_utm_source  ON public.rd_won_backfill (utm_source);
CREATE INDEX IF NOT EXISTS idx_rd_won_atribuicao  ON public.rd_won_backfill (atribuicao_fonte);

COMMENT ON COLUMN public.rd_won_backfill.atribuicao_fonte IS
  'De onde veio a origem do NEGOCIO: crm_utm (custom fields de UTM no proprio deal) | sessao_anterior (ultima sessao do site ANTES da criacao do deal) | deal_source (fonte do negocio no CRM) | sem_origem. Nunca chutado.';

-- Receita por origem DO NEGÓCIO. Uma empresa aparece em vários canais.
CREATE OR REPLACE VIEW public.vw_receita_por_origem AS
SELECT
  coalesce(b.utm_source, '(sem utm)')          AS canal,
  coalesce(b.utm_medium, '-')                  AS midia,
  coalesce(b.utm_campaign, '-')                AS campanha,
  coalesce(b.deal_source, '-')                 AS fonte_negocio,
  coalesce(b.atribuicao_fonte, 'nao_resolvido') AS como_foi_atribuido,
  count(*)                                     AS negocios,
  count(DISTINCT b.cnpj)                       AS empresas,
  round(sum(b.valor)::numeric, 2)              AS receita,
  round(avg(b.valor)::numeric, 2)              AS ticket_medio,
  min(b.closed_at)::date                       AS primeiro,
  max(b.closed_at)::date                       AS ultimo
FROM public.rd_won_backfill b
GROUP BY 1,2,3,4,5;

COMMENT ON VIEW public.vw_receita_por_origem IS
  'Receita por origem DO NEGOCIO (nao do integrador): cada deal com a sua propria UTM.';
