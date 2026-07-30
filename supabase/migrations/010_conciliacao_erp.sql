-- 010 — conciliação ERP × CRM: a venda faturada que o card não registrou
--
-- ACHADO QUE MOTIVOU (30/jul/2026, cruzamento com `BASE PEDIDOS 2026.xlsx`):
-- dos 37.705 pedidos faturados no ERP em 2026, **6.980 (R$ 111,52 mi) não têm
-- deal ganho no CRM**. A falha é uniforme entre todas as equipes (14% a 28%),
-- não é agregação de pedidos num card (nenhum deal tem esses valores) e não é
-- calendário (o ano inteiro foi comparado). A causa provável é card que não é
-- marcado como Ganho depois do faturamento.
--
-- Isso importa porque o CRM é a ÚNICA fonte de venda do FOP: o que não vira
-- deal ganho não gera Purchase, não entra no LTV e não aparece em nenhuma
-- análise de mídia. Sem monitorar, o furo cresce silenciosamente.
--
-- Também validado no mesmo cruzamento: `total_price` do CRM = `ValorTotal` do
-- ERP (27.900 de 30.870 pedidos batem ao centavo, 90,4%), e NÃO o SUBTOTAL.
-- ValorTotal = produtos + frete + serviço; SUBTOTAL = só produtos. O painel
-- oficial usa algo próximo do SUBTOTAL, então painel e FOP medem bases
-- diferentes por ~4% — é diferença de definição, não erro.

CREATE TABLE IF NOT EXISTS public.erp_pedidos (
  numero_pedido TEXT PRIMARY KEY,          -- normalizado: <6-8 digitos>-<2 digitos>
  pedido_id     TEXT,
  cliente_id    TEXT,                      -- id do ERP (a extracao nao traz CNPJ)
  data_ganho    DATE,
  potencia_kwp  NUMERIC,
  valor_total   NUMERIC,                   -- produtos + frete + servico (= total_price do CRM)
  subtotal      NUMERIC,                   -- so produtos (base do painel oficial)
  frete         NUMERIC,
  servico       NUMERIC,
  desconto      NUMERIC,
  vendedor      TEXT,
  equipe        TEXT,
  lider         TEXT,
  coordenador   TEXT,
  carga_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_pedidos_data ON public.erp_pedidos (data_ganho);
CREATE INDEX IF NOT EXISTS idx_erp_pedidos_equipe ON public.erp_pedidos (equipe);

COMMENT ON TABLE public.erp_pedidos IS
  'Pedidos faturados no ERP (carga periodica da extracao). Existe para conciliar com os deals ganhos do CRM: pedido faturado sem card ganho nao gera Purchase nem LTV no FOP.';

-- ── Pedido faturado no ERP que NÃO tem deal ganho no CRM ───────────────────
-- É a métrica a monitorar: cada linha aqui é receita que o FOP não vê.
CREATE OR REPLACE VIEW public.vw_erp_sem_card_ganho AS
SELECT
  e.numero_pedido,
  e.data_ganho,
  e.valor_total,
  e.potencia_kwp,
  e.vendedor,
  e.equipe,
  e.coordenador
FROM public.erp_pedidos e
LEFT JOIN public.rd_won_backfill b ON b.numero_pedido = e.numero_pedido
WHERE b.rd_deal_id IS NULL;

COMMENT ON VIEW public.vw_erp_sem_card_ganho IS
  'Pedidos faturados no ERP sem deal ganho correspondente no CRM. Em 30/jul/2026: 6.980 pedidos / R$ 111,52 mi (19% do faturado).';

-- ── Resumo diário da divergência, para alerta e acompanhamento ─────────────
CREATE OR REPLACE VIEW public.vw_conciliacao_erp_crm AS
WITH erp AS (
  SELECT date_trunc('month', data_ganho)::date AS mes,
         count(*) AS pedidos_erp,
         sum(valor_total) AS valor_erp
    FROM public.erp_pedidos GROUP BY 1
), crm AS (
  SELECT date_trunc('month', closed_at)::date AS mes,
         count(*) AS deals_crm,
         sum(valor) AS valor_crm
    FROM public.rd_won_backfill GROUP BY 1
), falta AS (
  SELECT date_trunc('month', data_ganho)::date AS mes,
         count(*) AS pedidos_sem_card,
         sum(valor_total) AS valor_sem_card
    FROM public.vw_erp_sem_card_ganho GROUP BY 1
)
SELECT
  COALESCE(e.mes, c.mes) AS mes,
  e.pedidos_erp,
  c.deals_crm,
  f.pedidos_sem_card,
  round(100.0 * COALESCE(f.pedidos_sem_card,0) / NULLIF(e.pedidos_erp,0), 1) AS pct_sem_card,
  round(e.valor_erp::numeric, 2) AS valor_erp,
  round(c.valor_crm::numeric, 2) AS valor_crm,
  round(f.valor_sem_card::numeric, 2) AS valor_sem_card
FROM erp e
FULL JOIN crm c ON c.mes = e.mes
LEFT JOIN falta f ON f.mes = e.mes
ORDER BY 1;

COMMENT ON VIEW public.vw_conciliacao_erp_crm IS
  'Resumo mensal ERP x CRM: quantos pedidos faturados nao viraram deal ganho. Alerta quando pct_sem_card sobe.';
