-- 012 — motor de venda e CICLOS DE VIDA do integrador
--
-- COMO A OPERAÇÃO FUNCIONA (Igor, 30/jul/2026):
--   • A mídia de performance mira PRIMEIRA COMPRA e cai no Funil SDR (o SDR
--     atende quem nunca comprou).
--   • SDR e BDR fazem apenas ATIVAÇÃO/REATIVAÇÃO — nenhum dos dois retém o
--     cliente. O SDR negocia e, no fechamento, passa o integrador ao consultor
--     do Comercial da região dele. O BDR reativa (faz o pedido) e passa também.
--   • O Comercial recebe o integrador ativado e a missão é MANTÊ-LO ativo na
--     carteira: se passar 180 dias sem comprar, o integrador SAI da carteira —
--     e se for reativado pelo BDR depois, vai para OUTRO consultor.
--   • "Negociação criada automaticamente": o integrador manda um projeto para o
--     consultor orçar, o consultor sobe o pedido na plataforma sem abrir card, e
--     quando a venda fecha a automação cria o card depois — na maioria dos casos
--     o consultor nem sabe que aquele negócio existe no CRM.
--
-- POR QUE CICLOS: um mesmo integrador pode ser ativado por mídia, esfriar, e ser
-- reativado pelo BDR meses depois. Atribuir todo o LTV à primeira ativação daria
-- à mídia o crédito por receita que veio de uma reativação do BDR. O corte de
-- 180 dias é a mesma regra que a Fotus usa para tirar o integrador da carteira.

CREATE OR REPLACE VIEW public.vw_negocios_classificados AS
SELECT
  b.rd_deal_id, b.cnpj, b.numero_pedido, b.valor, b.closed_at, b.criado_em,
  b.potencia_kwp, b.pipeline_id,
  CASE b.pipeline_id
    WHEN '685d9b02b169f4001dd7f804' THEN 'Funil Comercial'
    WHEN '688a45801a5566001921d886' THEN 'Funil BDR'
    WHEN '68643e1eb11bf8001473affc' THEN 'Funil SDR'
    WHEN '69e60a4c9b8aa90015d064d0' THEN 'Fotus Charge'
    ELSE 'outro'
  END AS funil,
  b.deal_source, b.utm_source, b.utm_medium, b.utm_campaign, b.utm_content,
  b.atribuicao_fonte,
  CASE
    WHEN b.pipeline_id = '68643e1eb11bf8001473affc' THEN 'midia_aquisicao_sdr'
    WHEN b.pipeline_id = '688a45801a5566001921d886' THEN 'reativacao_bdr'
    WHEN b.pipeline_id = '69e60a4c9b8aa90015d064d0' THEN 'fotus_charge'
    WHEN b.pipeline_id = '685d9b02b169f4001dd7f804'
         AND b.deal_source = 'Negociação criada automaticamente' THEN 'balcao_pedido_erp'
    WHEN b.pipeline_id = '685d9b02b169f4001dd7f804' THEN 'comercial_com_card'
    ELSE 'outro'
  END AS motor_venda
FROM public.rd_won_backfill b;

-- Ciclos de vida: cada janela de atividade separada por 180+ dias de silêncio.
CREATE OR REPLACE VIEW public.vw_ciclos_integrador AS
WITH d AS (
  SELECT cnpj, closed_at, valor, motor_venda, funil, utm_source, utm_campaign,
         LAG(closed_at) OVER (PARTITION BY cnpj ORDER BY closed_at) AS compra_anterior
    FROM public.vw_negocios_classificados
), marcado AS (
  SELECT *, CASE
    WHEN compra_anterior IS NULL OR closed_at - compra_anterior > interval '180 days'
    THEN 1 ELSE 0 END AS abre_ciclo
  FROM d
), numerado AS (
  SELECT *, SUM(abre_ciclo) OVER (
    PARTITION BY cnpj ORDER BY closed_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ciclo
  FROM marcado
)
SELECT
  cnpj, ciclo,
  (array_agg(motor_venda ORDER BY closed_at))[1]   AS ativador,
  (array_agg(utm_source ORDER BY closed_at))[1]    AS canal_ativacao,
  (array_agg(utm_campaign ORDER BY closed_at))[1]  AS campanha_ativacao,
  min(closed_at)::date                             AS inicio,
  max(closed_at)::date                             AS ultima_compra,
  count(*)                                         AS pedidos_no_ciclo,
  round(sum(valor)::numeric, 2)                    AS receita_no_ciclo,
  (max(closed_at)::date - min(closed_at)::date)    AS dias_ativo
FROM numerado
GROUP BY 1,2;

COMMENT ON VIEW public.vw_ciclos_integrador IS
  'Ciclos de vida do integrador cortados por 180 dias sem compra (mesma regra que tira o integrador da carteira do consultor). O LTV do ciclo pertence a quem o ATIVOU. NB: com recorte de 7 meses quase todo integrador tem 1 ciclo so - a analise ganha poder com historico mais longo.';
