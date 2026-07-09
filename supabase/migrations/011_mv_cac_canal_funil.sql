-- Migration 011 — mv_cac_canal_funil (o caso de receita ponta a ponta · Sprint B)
-- Projeto: fotus-tracking | Ref: docs/12-adr-ultron-fop-boundary.md
--
-- Cruza CUSTO (ultron.eventos_normalizados + ultron.campanhas)
-- com CONVERSÃO/VALOR (public.events + public.integradores)
-- por MÊS × CANAL × FUNIL → CAC, CPL, CPL qualificado, ROAS reais.
--
-- ⚠️ A precisão depende dos pré-requisitos de confiabilidade (ver
--    GERENTE DE PROJETOS/INVENTARIO-STACK-CONFIABILIDADE.md):
--    C1 (Meta CAPI v25), C2 (action_source='system_generated'),
--    C6/F (utm_campaign/funnel em ultron.campanhas + nomenclatura/GTM).

CREATE MATERIALIZED VIEW IF NOT EXISTS ultron.mv_cac_canal_funil AS
WITH spend AS (
  SELECT
    date_trunc('month', e.data)::date         AS mes,
    e.plataforma                              AS canal,
    COALESCE(c.funnel, 'aquisicao')           AS funnel,
    SUM(e.spend_brl)                          AS spend,
    SUM(e.leads)                              AS leads_plataforma,
    SUM(e.receita_brl)                        AS receita_plataforma
  FROM ultron.eventos_normalizados e
  LEFT JOIN ultron.campanhas c
    ON c.plataforma = e.plataforma AND c.campanha_id = e.campanha_id
  GROUP BY 1, 2, 3
),
conv AS (
  SELECT
    date_trunc('month', ev.created_at)::date  AS mes,
    CASE
      WHEN ev.utm_source ILIKE ANY (ARRAY['facebook','fb','instagram','ig','meta']) THEN 'meta'
      WHEN ev.utm_source ILIKE 'google%' OR ev.gclid IS NOT NULL                    THEN 'google'
      ELSE COALESCE(NULLIF(lower(ev.utm_source), ''), 'outros')
    END                                       AS canal,
    COALESCE(ev.funnel, 'aquisicao')          AS funnel,
    COUNT(*) FILTER (WHERE ev.event_name = 'Lead')                         AS leads,
    COUNT(*) FILTER (WHERE ev.event_name = 'Schedule')                     AS leads_qualificados,
    COUNT(DISTINCT ev.integrador_id) FILTER (WHERE ev.event_name = 'Purchase') AS novos_clientes,
    COALESCE(SUM((ev.event_data->>'value')::numeric)
      FILTER (WHERE ev.event_name IN ('Purchase','PurchaseRecorrente')), 0) AS receita
  FROM public.events ev
  GROUP BY 1, 2, 3
)
SELECT
  COALESCE(s.mes, c.mes)        AS mes,
  COALESCE(s.canal, c.canal)    AS canal,
  COALESCE(s.funnel, c.funnel)  AS funnel,
  COALESCE(s.spend, 0)              AS spend,
  COALESCE(c.leads, 0)              AS leads,
  COALESCE(c.leads_qualificados, 0) AS leads_qualificados,
  COALESCE(c.novos_clientes, 0)     AS novos_clientes,
  COALESCE(c.receita, 0)            AS receita,
  -- métricas canônicas (ver ULTRON/metrics.yaml)
  ROUND(s.spend / NULLIF(c.leads, 0), 2)              AS cpl,
  ROUND(s.spend / NULLIF(c.leads_qualificados, 0), 2) AS cpl_qualificado,
  ROUND(s.spend / NULLIF(c.novos_clientes, 0), 2)     AS cac,
  ROUND(c.receita / NULLIF(s.spend, 0), 2)            AS roas
FROM spend s
FULL OUTER JOIN conv c
  ON c.mes = s.mes AND c.canal = s.canal AND c.funnel = s.funnel;

-- índice único p/ permitir REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_cac_canal_funil
  ON ultron.mv_cac_canal_funil (mes, canal, funnel);

COMMENT ON MATERIALIZED VIEW ultron.mv_cac_canal_funil IS
  'Custo real por venda por canal × funil × mês. Atribuição coarse por utm_source/funnel. Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY ultron.mv_cac_canal_funil;';
