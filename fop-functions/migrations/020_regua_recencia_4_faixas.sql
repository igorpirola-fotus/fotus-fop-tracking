-- 020_regua_recencia_4_faixas.sql — régua ÚNICA de recência + públicos de exclusão.
-- Decisão do Igor em 15/set/2026. NÃO APLICADA AINDA.
--
-- Por que existe: conviviam três réguas no projeto — 180d no seed 016, 90d na
-- necessidade das campanhas de aquisição, 360d no Mês do Integrador. Réguas
-- diferentes fazem o mesmo cliente cair em dois públicos, e aí a EXCLUSÃO fura:
-- a campanha acha que protegeu a base e continua pagando por quem já é cliente.
--
-- Faixas mutuamente exclusivas (cada cliente cai em exatamente uma):
--   ativos      0–90d  | esfriando  90–180d | inativos 180–360d | frios +360d
--
-- Contrato de colunas PRESERVADO (publico, cnpj, email, phone, nome_contato,
-- cidade, uf, cep) — publicos-meta.ts depende dele. Mudar aqui quebra o endpoint.

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

-- ── Faixas de recência (alvo) ───────────────────────────────────────────────
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
SELECT 'frios_360d', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.data_ultima_compra < now() - interval '360 days'

-- ── Exclusão ────────────────────────────────────────────────────────────────
-- todos_clientes = união das 4 faixas + quem comprou mas está sem
-- data_ultima_compra preenchida (o evento existe, a coluna não foi atualizada).
-- Usar como EXCLUSÃO nas campanhas de aquisição de novos.
UNION ALL
SELECT 'todos_clientes', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b
 WHERE b.data_ultima_compra IS NOT NULL
    OR b.id IN (SELECT integrador_id FROM compradores)

-- ── Remarketing / aquisição ─────────────────────────────────────────────────
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
-- leads_sem_compra acumula DOIS usos: alvo de remarketing de aquisição E
-- exclusão de topo ("em_remarketing") — não pagar prospecção por quem já está
-- sendo reconvertido. Mesma lista, dois papéis: não criar público duplicado.
SELECT 'leads_sem_compra', b.cnpj, b.email, b.phone, b.nome_contato, b.cidade, b.uf, b.cep
  FROM base b WHERE b.id NOT IN (SELECT integrador_id FROM compradores);

-- ── Seed dos novos públicos ─────────────────────────────────────────────────
INSERT INTO ultron.publicos_meta (publico, nome_meta, descricao) VALUES
  ('clientes_ativos_90d', 'FOP | Clientes ativos 90d',
   'Compra nos ultimos 90d — alvo RET|BASE; excluir de ACQ'),
  ('esfriando_90_180d',   'FOP | Esfriando 90-180d',
   'Ultima compra 90-180d — reativacao leve antes de virar inativo'),
  ('inativos_180_360d',   'FOP | Inativos 180-360d',
   'Ultima compra 180-360d — ataque BDR'),
  ('frios_360d',          'FOP | Frios +360d',
   'Ultima compra ha mais de 360d — oferta de recuperacao (Mes do Integrador)'),
  ('todos_clientes',      'FOP | Todos os clientes (exclusao)',
   'Ja comprou alguma vez — EXCLUSAO nas campanhas de aquisicao de novos')
ON CONFLICT (publico) DO NOTHING;

-- Aposenta as faixas da régua antiga. Nunca subiram (audience_id NULL), entao
-- desativar nao perde aprendizado de conjunto nenhum.
UPDATE ultron.publicos_meta
   SET ativo = false
 WHERE publico IN ('clientes_ativos_180d', 'inativos_180_540d');

-- PENDENTE — 'em_atendimento' (negocio ABERTO no CRM agora) fica para a 021:
-- depende de inspecionar o schema de public.rdstation_crm_webhook_events e
-- deduplicar os cards que a Solange CRIA em vez de mover (senao exclui gente
-- demais). Nao escrever essa regra no escuro.
