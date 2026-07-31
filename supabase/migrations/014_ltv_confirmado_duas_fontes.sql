-- 014 — LTV só com pedido confirmado nas DUAS fontes
--
-- REGRA (decisão do Igor, 31/jul/2026): "para a nossa análise de LTV vamos
-- considerar apenas os que correspondem nas duas fontes".
--
-- POR QUE ISSO RESOLVE DOIS PROBLEMAS DE UMA VEZ:
--   • 6.980 pedidos faturados no ERP (19%) nunca viraram deal ganho no CRM —
--     entram no faturamento mas não têm rastro de funil;
--   • o CRM tem 364 números de pedido inválidos ('00', '11111111111'), deals em
--     funil que não é venda, e valores digitados errado (o SUN PRIZE de R$ 46,85
--     mi que o ERP desmentiu).
-- Exigir presença nas duas pontas elimina os dois lados do ruído.
--
-- MEDIDO EM 31/jul: 30.869 dos 37.852 pedidos do ERP confirmam (81,6%),
-- somando R$ 505,67 M e 394,0 MWp em 6.172 clientes.
--
-- A ponte é o `numero_pedido` normalizado. A extração do ERP traz ClienteId e
-- não CNPJ, então o CNPJ vem do lado do CRM.

CREATE OR REPLACE VIEW public.vw_pedidos_confirmados AS
SELECT
  e.numero_pedido, b.rd_deal_id, b.cnpj,
  e.data_ganho,
  e.valor_total AS valor_erp,   -- fonte de verdade do valor
  b.valor       AS valor_crm,   -- ao lado, para auditoria (batem em 90,4%)
  e.potencia_kwp, e.equipe, e.vendedor,
  b.pipeline_id, b.utm_source, b.utm_medium, b.utm_campaign,
  b.deal_source, b.atribuicao_fonte,
  round(abs(coalesce(e.valor_total,0) - coalesce(b.valor,0))::numeric, 2) AS diferenca_valor
FROM public.erp_pedidos e
JOIN public.rd_won_backfill b ON b.numero_pedido = e.numero_pedido;

COMMENT ON VIEW public.vw_pedidos_confirmados IS
  'Pedidos presentes NAS DUAS FONTES (faturado no ERP + deal ganho no CRM). Base oficial de LTV.';

-- Coorte por canal de captação sobre o LTV confirmado.
DROP VIEW IF EXISTS public.vw_ltv_confirmado_por_canal;
CREATE VIEW public.vw_ltv_confirmado_por_canal AS
WITH cap AS (
  SELECT DISTINCT ON (s.integrador_id)
    s.integrador_id,
    CASE lower(coalesce(nullif(s.utm_source,''),'(direto)'))
      WHEN 'fb' THEN 'meta' WHEN 'facebook' THEN 'meta' WHEN 'ig' THEN 'instagram'
      ELSE lower(coalesce(nullif(s.utm_source,''),'(direto)'))
    END AS canal,
    lower(coalesce(nullif(s.utm_medium,''),'-')) AS midia,
    s.created_at::date AS captado_em
  FROM public.sessions s
  WHERE s.integrador_id IS NOT NULL
  ORDER BY s.integrador_id, s.created_at ASC
), conf AS (
  SELECT cnpj, count(*) AS pedidos, sum(valor_erp) AS ltv, sum(potencia_kwp) AS kwp,
         min(data_ganho) AS primeira, max(data_ganho) AS ultima
  FROM public.vw_pedidos_confirmados GROUP BY cnpj
)
SELECT
  c.canal, c.midia,
  count(*)                                                             AS leads,
  count(*) FILTER (WHERE (CURRENT_DATE - c.captado_em) >= 30)           AS leads_maduros,
  count(f.cnpj) FILTER (WHERE f.primeira >= c.captado_em)               AS clientes,
  round(coalesce(sum(f.ltv)  FILTER (WHERE f.primeira >= c.captado_em),0)::numeric,2) AS ltv_confirmado,
  round(coalesce(avg(f.ltv)  FILTER (WHERE f.primeira >= c.captado_em),0)::numeric,2) AS ltv_por_cliente,
  round(coalesce(avg(f.pedidos) FILTER (WHERE f.primeira >= c.captado_em),0)::numeric,2) AS pedidos_por_cliente,
  round(coalesce(sum(f.kwp)  FILTER (WHERE f.primeira >= c.captado_em),0)::numeric,1) AS kwp,
  round(coalesce(avg(f.primeira - c.captado_em) FILTER (WHERE f.primeira >= c.captado_em),0)::numeric,1) AS dias_ate_comprar,
  count(*) FILTER (WHERE f.primeira >= c.captado_em AND f.ultima < CURRENT_DATE - 180) AS precisam_reativacao
FROM cap c
JOIN public.integradores i ON i.id = c.integrador_id
LEFT JOIN conf f ON f.cnpj = i.cnpj
GROUP BY 1,2;

COMMENT ON VIEW public.vw_ltv_confirmado_por_canal IS
  'Coorte por canal com LTV confirmado nas duas fontes. LER leads_maduros: lead com <30 dias nao teve janela (mediana 7 dias ate a 1a compra). Em 31/jul so 60 de 583 leads eram maduros.';
