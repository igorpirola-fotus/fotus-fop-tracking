-- 013 — coorte por canal de captação: a pergunta do Igor, direta
--
-- REQUISITO (Igor, 31/jul/2026), depois de descartar o modelo de ciclos como
-- complexidade desnecessária: "a visão que precisamos ter é de: um lead captado
-- por meta ads, qual é o tempo de vida dele? qual o LTV dele? ele precisa passar
-- por meta ads de novo? e assim por diante com todos os canais".
--
-- A unidade é o LEAD CAPTADO, agrupado pelo canal da PRIMEIRA sessão dele.
--
-- ARMADILHA QUE ESTA VIEW EVITA: a primeira versão misturava captação com visita
-- de cliente antigo, e o sintoma foi `dias_captacao_ate_compra` NEGATIVO (-34,
-- -108, -327 dias) — a "primeira compra" tinha acontecido antes da sessão. São
-- clientes que já compravam e visitaram o site depois; contá-los como captação
-- infla o resultado da mídia. Daí a coluna `relacao`, que é obrigatória na
-- leitura:
--   captado_e_comprou  → a sessão veio ANTES da 1ª compra (captação de verdade)
--   ja_era_cliente     → cliente antigo que visitou o site (NÃO é captação)
--   captado_sem_compra → lead que ainda não comprou
--
-- `precisam_reativacao` responde ao "ele precisa passar por meta ads de novo?":
-- é quem comprou e está há mais de 180 dias sem comprar — o mesmo corte que tira
-- o integrador da carteira do consultor.
DROP VIEW IF EXISTS public.vw_coorte_captacao;

CREATE VIEW public.vw_coorte_captacao AS
WITH captacao AS (
  SELECT DISTINCT ON (s.integrador_id)
         s.integrador_id,
         lower(coalesce(nullif(s.utm_source, ''), '(direto)')) AS canal_bruto,
         lower(coalesce(nullif(s.utm_medium, ''), '-'))        AS midia,
         s.created_at                                          AS captado_em
    FROM public.sessions s
   WHERE s.integrador_id IS NOT NULL
   ORDER BY s.integrador_id, s.created_at ASC
), base AS (
  SELECT
    CASE c.canal_bruto
      WHEN 'fb' THEN 'meta' WHEN 'facebook' THEN 'meta' WHEN 'ig' THEN 'instagram'
      ELSE c.canal_bruto
    END                                   AS canal,
    c.midia,
    c.captado_em::date                    AS captado_em,
    coalesce(i.numero_pedidos, 0)         AS pedidos,
    coalesce(i.ltv_total, 0)              AS ltv,
    i.data_primeira_compra::date          AS p1,
    i.data_ultima_compra::date            AS ultima,
    CASE
      WHEN i.data_primeira_compra IS NULL          THEN 'captado_sem_compra'
      WHEN i.data_primeira_compra >= c.captado_em  THEN 'captado_e_comprou'
      ELSE 'ja_era_cliente'
    END                                   AS relacao
  FROM captacao c
  JOIN public.integradores i ON i.id = c.integrador_id
)
SELECT
  canal, midia, relacao,
  count(*)                                   AS integradores,
  round(avg(p1 - captado_em), 1)             AS dias_captacao_ate_compra,
  round(avg(ltv)::numeric, 2)                AS ltv_medio,
  round(avg(pedidos)::numeric, 2)            AS pedidos_medio,
  round(avg(ultima - p1), 1)                 AS tempo_de_vida_dias,
  count(*) FILTER (
    WHERE pedidos > 0 AND ultima <  (now() - interval '180 days')::date) AS precisam_reativacao,
  count(*) FILTER (
    WHERE pedidos > 0 AND ultima >= (now() - interval '180 days')::date) AS ativos
FROM base
GROUP BY 1,2,3;

COMMENT ON VIEW public.vw_coorte_captacao IS
  'Coorte por canal de captacao. LER SEMPRE com a coluna RELACAO: so captado_e_comprou e captacao real. Dia negativo em dias_captacao_ate_compra denuncia mistura com cliente antigo.';
