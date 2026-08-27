-- 017_vw_publico_meta.sql — regras de público num só lugar.
-- Aplicada no fop-db via webhook fopdb-q em 2026-08-27.
--
-- Contrato consumido por publicos-meta.ts: publico, cnpj, email, phone,
-- nome_contato, cidade, uf, cep. Mudar nome de coluna aqui quebra o endpoint.
CREATE OR REPLACE VIEW ultron.vw_publico_meta AS
WITH base AS (
  SELECT i.id, i.cnpj, i.email, i.phone, i.nome_contato,
         i.endereco_municipio AS cidade,
         i.endereco_uf        AS uf,
         i.endereco_cep       AS cep,
         i.numero_pedidos, i.ltv_total, i.data_ultima_compra
    FROM public.integradores i
   WHERE i.cnpj IS NOT NULL
     AND (i.email IS NOT NULL OR i.phone IS NOT NULL)  -- sem chave não sobe
),
compradores AS (
  SELECT DISTINCT integrador_id FROM public.events
   WHERE event_name IN ('Purchase', 'PurchaseRecorrente')
     AND integrador_id IS NOT NULL
),
sql_sem_venda AS (
  SELECT DISTINCT e.integrador_id
    FROM public.events e
   WHERE e.event_name = 'Schedule'
     AND e.integrador_id IS NOT NULL
     AND e.integrador_id NOT IN (SELECT integrador_id FROM compradores)
),
perdidos AS (
  SELECT DISTINCT e.integrador_id
    FROM public.events e
   WHERE e.event_name = 'OportunidadePerdida'
     AND e.integrador_id IS NOT NULL
     AND e.integrador_id NOT IN (SELECT integrador_id FROM compradores)
),
corte_ltv AS (
  SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY ltv_total) AS p90
    FROM base WHERE ltv_total > 0
)
SELECT 'clientes_ativos_180d' AS publico, b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.data_ultima_compra >= now() - interval '180 days'
UNION ALL
SELECT 'inativos_180_540d', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.data_ultima_compra <  now() - interval '180 days'
               AND b.data_ultima_compra >= now() - interval '540 days'
UNION ALL
SELECT 'sql_sem_venda', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b JOIN sql_sem_venda s ON s.integrador_id = b.id
UNION ALL
SELECT 'perdidos_sem_compra', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b JOIN perdidos p ON p.integrador_id = b.id
UNION ALL
SELECT 'ltv_alto_semente', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b, corte_ltv c WHERE b.ltv_total >= c.p90
UNION ALL
-- leads_sem_compra é SUPERCONJUNTO de sql_sem_venda e perdidos_sem_compra:
-- todo mundo com chave de match que nunca comprou. Medido em 27/ago/2026 = 1.207,
-- o ÚNICO público que passa do mínimo de 1.000 antes do enriquecimento rodar.
-- Sobreposição entre públicos é normal na Meta (usos diferentes) — documentar, não evitar.
SELECT 'leads_sem_compra', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.id NOT IN (SELECT integrador_id FROM compradores);
