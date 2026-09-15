-- 022_vw_publico_perdidos_classificados.sql — os perdidos deixam de ser UM
-- publico e viram tres, pelo motivo (e, nos fechamentos automaticos, pela etapa).
--
-- Depende de 020 (regua de recencia) e 021 (classificacao dos 88 motivos).
-- Caminho do motivo CONFIRMADO no fop-db em 15/set/2026:
--   event_data -> 'document' -> 'deal_lost_reason' ->> 'id'   (chave e 'id', nao '_id')
--   event_data -> 'document' -> 'deal_stage'       ->> 'name'
--
-- PRECEDENCIA quando o integrador tem varios eventos de perda com grupos
-- diferentes: inapto vence tudo (uma vez inapto, nao se anuncia mais), depois
-- quente, depois frio. contato_invalido e ruido so classificam se forem o unico
-- sinal. Motivo sem classificacao cai em ruido — o default e NAO anunciar.

CREATE OR REPLACE VIEW ultron.vw_publico_meta AS
WITH base AS (
  SELECT i.id, i.cnpj, i.email, i.phone, i.nome_contato,
         i.endereco_municipio AS cidade,
         i.endereco_uf        AS uf,
         i.endereco_cep       AS cep,
         i.numero_pedidos, i.ltv_total, i.data_ultima_compra
    FROM public.integradores i
   WHERE i.cnpj IS NOT NULL
     AND (i.email IS NOT NULL OR i.phone IS NOT NULL)
),
compradores AS (
  SELECT DISTINCT integrador_id FROM public.events
   WHERE event_name IN ('Purchase', 'PurchaseRecorrente')
     AND integrador_id IS NOT NULL
),
perdas AS (
  SELECT e.integrador_id,
         e.event_data->'document'->'deal_lost_reason'->>'id'  AS mid,
         e.event_data->'document'->'deal_stage'->>'name'      AS etapa
    FROM public.events e
   WHERE e.event_name = 'OportunidadePerdida'
     AND e.integrador_id IS NOT NULL
),
-- Fechamento automatico ('depende_etapa') resolve pela etapa; o resto, pelo motivo.
perdas_class AS (
  SELECT p.integrador_id,
         COALESCE(pe.grupo, c.grupo) AS grupo
    FROM perdas p
    JOIN ultron.motivos_perda_classificacao c
      ON c.lost_reason_id = p.mid
    LEFT JOIN ultron.motivos_perda_por_etapa pe
      ON pe.lost_reason_id = p.mid AND pe.etapa = p.etapa
),
perdas_prio AS (
  SELECT integrador_id,
         MIN(CASE grupo
               WHEN 'inapto'            THEN 1
               WHEN 'reativavel_quente' THEN 2
               WHEN 'reativavel_frio'   THEN 3
               WHEN 'contato_invalido'  THEN 4
               ELSE 5
             END) AS prio
    FROM perdas_class
   GROUP BY 1
),
inaptos AS (SELECT integrador_id FROM perdas_prio WHERE prio = 1),
sql_sem_venda AS (
  SELECT DISTINCT e.integrador_id
    FROM public.events e
   WHERE e.event_name = 'Schedule'
     AND e.integrador_id IS NOT NULL
     AND e.integrador_id NOT IN (SELECT integrador_id FROM compradores)
     AND e.integrador_id NOT IN (SELECT integrador_id FROM inaptos)
),
corte_ltv AS (
  SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY ltv_total) AS p90
    FROM base WHERE ltv_total > 0
)

-- ── Faixas de recencia ──────────────────────────────────────────────────────
SELECT 'clientes_ativos_90d' AS publico, b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.data_ultima_compra >= now() - interval '90 days'
UNION ALL
SELECT 'esfriando_90_180d', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.data_ultima_compra <  now() - interval '90 days'
               AND b.data_ultima_compra >= now() - interval '180 days'
UNION ALL
SELECT 'inativos_180_360d', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.data_ultima_compra <  now() - interval '180 days'
               AND b.data_ultima_compra >= now() - interval '360 days'
UNION ALL
-- ATENCAO: cego por falta de historico. data_ultima_compra so existe a partir
-- dos eventos de 2026 — quem comprou antes disso nao aparece aqui. Medido em
-- 15/set/2026: 29 linhas. O publico +360d do Mes do Integrador NAO sai daqui;
-- precisa de extracao do ERP/CRM com historico maior.
SELECT 'frios_360d', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.data_ultima_compra < now() - interval '360 days'

-- ── Exclusao ────────────────────────────────────────────────────────────────
UNION ALL
SELECT 'todos_clientes', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b
 WHERE b.data_ultima_compra IS NOT NULL
    OR b.id IN (SELECT integrador_id FROM compradores)
UNION ALL
-- Exclusao dura. Inclui quem ja comprou: CNPJ baixado hoje nao volta a comprar,
-- e anunciar pra ele e desperdicio garantido.
SELECT 'inaptos', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b JOIN inaptos x ON x.integrador_id = b.id

-- ── Perdidos, agora separados por intencao ──────────────────────────────────
UNION ALL
-- Travou em condicao (preco, pagamento, prazo, estoque, falha nossa) OU teve
-- pedido/orcamento que nao se concluiu. Alvo de OFERTA.
SELECT 'perdidos_reativaveis', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b JOIN perdas_prio p ON p.integrador_id = b.id
 WHERE p.prio = 2
   AND b.id NOT IN (SELECT integrador_id FROM compradores)
UNION ALL
-- Nunca se conseguiu falar: o problema foi CANAL, nao interesse. Midia alcanca
-- onde a cadencia falhou. Alvo de ALCANCE.
SELECT 'perdidos_sem_contato', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b JOIN perdas_prio p ON p.integrador_id = b.id
 WHERE p.prio = 3
   AND b.id NOT IN (SELECT integrador_id FROM compradores)

-- ── Remarketing / semente ───────────────────────────────────────────────────
UNION ALL
SELECT 'sql_sem_venda', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b JOIN sql_sem_venda s ON s.integrador_id = b.id
UNION ALL
SELECT 'ltv_alto_semente', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b, corte_ltv c WHERE b.ltv_total >= c.p90
UNION ALL
-- Superconjunto dos perdidos; agora SEM os inaptos.
SELECT 'leads_sem_compra', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b
 WHERE b.id NOT IN (SELECT integrador_id FROM compradores)
   AND b.id NOT IN (SELECT integrador_id FROM inaptos);

-- perdidos_sem_compra saiu da view: virou perdidos_reativaveis + perdidos_sem_contato.
UPDATE ultron.publicos_meta SET ativo = false WHERE publico = 'perdidos_sem_compra';
