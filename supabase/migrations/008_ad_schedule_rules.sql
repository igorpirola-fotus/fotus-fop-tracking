-- 008 — Scheduler de pausas/retomadas de campanhas e ad sets Meta Ads
--
-- Sistema que aplica regras de pausa/resume em campanhas e ad sets Meta via
-- chamadas para a Edge Function `meta-ads-scheduler` disparadas por pg_cron.
--
-- Casos de uso iniciais:
--   1) Dayparting de fim de semana (sex 17h -> seg 7h) em campanhas lead-gen
--   2) Pausa única em ad sets do Nordeste durante São João (20/jun)
--
-- Regra de prioridade: regras one_shot têm precedência sobre recurring.
-- Se houver um one_shot ativo de PAUSE para um target, ignora-se resume recurring.
-- A lógica fica na Edge Function (mais fácil de evoluir que em PL/pgSQL).

-- Extensões necessárias (idempotentes)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ===========================================================================
-- TABELA PRINCIPAL DE REGRAS
-- ===========================================================================

CREATE TABLE ad_schedule_rules (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Alvo Meta
  target_type        TEXT         NOT NULL CHECK (target_type IN ('campaign', 'adset')),
  target_id          TEXT         NOT NULL,
  target_name        TEXT,                                   -- nome legível para logs

  -- Ação
  action             TEXT         NOT NULL CHECK (action IN ('pause', 'resume')),

  -- Tipo de agendamento
  schedule_type      TEXT         NOT NULL CHECK (schedule_type IN ('recurring', 'one_shot')),
  cron_expression    TEXT,                                   -- usado se recurring; ex: "0 17 * * 5"
  run_at             TIMESTAMPTZ,                            -- usado se one_shot
  timezone           TEXT         NOT NULL DEFAULT 'America/Sao_Paulo',

  -- Metadados operacionais
  reason             TEXT,                                   -- audit / contexto humano
  active             BOOLEAN      NOT NULL DEFAULT true,

  -- Resultado da última execução
  last_run_at        TIMESTAMPTZ,
  last_run_status    TEXT,                                   -- 'success' | 'error' | 'noop'
  last_run_message   TEXT,

  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Garante consistência: cron quando recurring, run_at quando one_shot
  CONSTRAINT chk_recurring_has_cron
    CHECK (schedule_type <> 'recurring' OR cron_expression IS NOT NULL),
  CONSTRAINT chk_one_shot_has_run_at
    CHECK (schedule_type <> 'one_shot'  OR run_at IS NOT NULL)
);

CREATE INDEX idx_ad_sched_active_type ON ad_schedule_rules (active, schedule_type);
CREATE INDEX idx_ad_sched_run_at      ON ad_schedule_rules (run_at) WHERE schedule_type = 'one_shot' AND active = true;
CREATE INDEX idx_ad_sched_target      ON ad_schedule_rules (target_id, target_type);

-- Trigger de updated_at
CREATE OR REPLACE FUNCTION tg_ad_schedule_rules_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ad_schedule_rules_updated_at
  BEFORE UPDATE ON ad_schedule_rules
  FOR EACH ROW EXECUTE FUNCTION tg_ad_schedule_rules_updated_at();

-- ===========================================================================
-- TABELA DE LOG DE EXECUÇÕES
-- ===========================================================================
-- Histórico imutável de cada chamada que a Edge Function fez à API Meta.

CREATE TABLE ad_schedule_log (
  id              BIGSERIAL    PRIMARY KEY,
  rule_id         UUID         REFERENCES ad_schedule_rules(id) ON DELETE SET NULL,
  target_type     TEXT         NOT NULL,
  target_id       TEXT         NOT NULL,
  target_name     TEXT,
  action          TEXT         NOT NULL,
  status          TEXT         NOT NULL,                     -- 'success' | 'error' | 'noop' | 'skipped'
  message         TEXT,
  meta_response   JSONB,
  executed_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_log_executed_at ON ad_schedule_log (executed_at DESC);
CREATE INDEX idx_ad_log_target      ON ad_schedule_log (target_id, executed_at DESC);
CREATE INDEX idx_ad_log_status      ON ad_schedule_log (status, executed_at DESC);

-- ===========================================================================
-- RLS — apenas service_role escreve/lê (como nas outras tabelas do projeto)
-- ===========================================================================

ALTER TABLE ad_schedule_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_rules" ON ad_schedule_rules
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE ad_schedule_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_log" ON ad_schedule_log
  FOR ALL USING (auth.role() = 'service_role');

-- ===========================================================================
-- VIEW DE SAÚDE — regras que falharam nas últimas 24h
-- ===========================================================================

CREATE VIEW vw_schedule_health AS
SELECT
  r.id,
  r.target_name,
  r.target_id,
  r.target_type,
  r.action,
  r.schedule_type,
  r.cron_expression,
  r.run_at,
  r.last_run_at,
  r.last_run_status,
  r.last_run_message,
  r.active
FROM ad_schedule_rules r
WHERE r.active = true
  AND r.last_run_at >= now() - interval '24 hours'
  AND r.last_run_status NOT IN ('success', 'noop', 'skipped');

-- ===========================================================================
-- CRON TICK — chama a Edge Function a cada minuto
-- ===========================================================================
-- A URL é montada usando o config do projeto.
-- IMPORTANTE: trocar [PROJECT_REF] no schedule abaixo pelo ref do projeto Supabase.
--
-- Para descobrir: supabase status (campo "API URL").
-- Padrão: https://<project-ref>.supabase.co
--
-- O service_role_key é necessário porque a função roda em modo não-público.
-- Use SELECT cron.schedule(...) com o ref correto após o deploy.

-- Exemplo (executar manualmente após deploy, substituindo PROJECT_REF e SERVICE_ROLE_KEY):
--
-- SELECT cron.schedule(
--   'meta-ads-scheduler-tick',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url     := 'https://PROJECT_REF.supabase.co/functions/v1/meta-ads-scheduler',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer SERVICE_ROLE_KEY'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- Para parar: SELECT cron.unschedule('meta-ads-scheduler-tick');
