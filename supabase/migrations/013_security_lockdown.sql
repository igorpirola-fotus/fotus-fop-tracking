-- Migration 013 — Fechamento de exposição de dados (segurança)
-- Projeto: fotus-fop-tracking (wttmlnhzvevtabjetsqz)
-- Data: 2026-06-18 | Origem: auditoria de segurança (Supabase advisors + logs de API + verificação manual)
--
-- DESCOBERTA QUE DEFINIU A ESTRATÉGIA (confirmada nos logs de API):
-- Existe um app web interno (login via Supabase Auth, papel `authenticated`) que LÊ
-- estas views e a banco_de_tarefas pelo navegador. Logo, NÃO usar security_invoker
-- (quebraria o painel). O furo real é que o papel PÚBLICO `anon` (chave que fica no
-- client-side) consegue ler as mesmas views SEM login — incluindo a carteira de
-- clientes via ultron.v_status_integrador (cnpj, ltv_total, ticket_medio, lead_score...).
--
-- ESTRATÉGIA: remover o acesso do papel `anon` aos objetos sensíveis, preservando
-- `authenticated` (o painel logado segue funcionando) e `service_role` (ETLs/Edge).

BEGIN;

-- 1) Tira a chave PÚBLICA das 7 views sensíveis (authenticated/painel mantém acesso)
REVOKE SELECT ON
  ultron.v_status_integrador,
  ultron.v_kpi_aquisicao,
  ultron.v_anomalias_abertas,
  ultron.v_cx_metrics,
  public.vw_custo_mensal,
  public.vw_ig_resumo_hoje,
  public.weekly_deltas
FROM anon;

-- 1b) As 4 views da ultron tinham permissão concedida ao papel PUBLIC (cobre anon),
--     não só ao anon — então o REVOKE acima não bastou. Tirar de PUBLIC.
--     O painel logado (authenticated) tem grant próprio (authenticated=r) e mantém acesso.
REVOKE ALL ON
  ultron.v_status_integrador,
  ultron.v_kpi_aquisicao,
  ultron.v_cx_metrics,
  ultron.v_anomalias_abertas
FROM PUBLIC;

-- 2) Tabela sem tranca (RLS): ligar e permitir só service_role (ETL usa service_role)
ALTER TABLE ultron.rd_metadata_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON ultron.rd_metadata_cache;
CREATE POLICY service_role_only ON ultron.rd_metadata_cache
  FOR ALL USING (auth.role() = 'service_role');

-- 3) Tira a chave pública da função sensível (painel logado mantém)
REVOKE EXECUTE ON FUNCTION public.get_workflow_config() FROM anon;

-- 4) Defesa em profundidade: search_path fixo nas funções (advisor 0011)
--    (assinaturas exatas confirmadas via pg_get_function_identity_arguments)
ALTER FUNCTION public.update_updated_at() SET search_path = '';
ALTER FUNCTION public.calc_anos_mercado() SET search_path = '';
ALTER FUNCTION public.upsert_integrador_base(p_cnpj text, p_razao_social text, p_cidade text, p_uf text) SET search_path = '';
ALTER FUNCTION public.upsert_integrador_won_deal(p_cnpj text, p_razao_social text, p_cidade text, p_uf text, p_rd_deal_id text, p_amount numeric, p_closed_at timestamp with time zone) SET search_path = '';
ALTER FUNCTION ultron.set_updated_at() SET search_path = '';
ALTER FUNCTION ultron.set_metas_atualizado_em() SET search_path = '';
ALTER FUNCTION ultron.log_metas_change() SET search_path = '';

COMMIT;

-- FASE 2 (precisa confirmar se o app lê ANTES ou DEPOIS do login antes de trancar):
--   ultron.banco_de_tarefas, public.relatorios, public.ig_comments/ig_posts/ig_relatorios
--   → hoje liberam anon; provável uso pelo painel logado (authenticated) → revogar anon.
-- NÃO é SQL (toggle no painel → Authentication):
--   ativar "Leaked password protection"; confirmar que cadastro público (signup) está DESLIGADO
--   (senão alguém cria conta e vira 'authenticated' → leria as views).
-- NOTA: as views seguem SECURITY DEFINER (advisor ainda vai sinalizar como boa-prática);
--   o furo real (leitura sem login) está fechado. Refino p/ security_invoker fica p/ depois.
