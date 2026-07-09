-- Seed inicial das regras de pausa/retomada — junho/2026
--
-- Regras incluídas:
--   R1  Dayparting FDS pause   (sex 17h)    — 3 campanhas lead-gen
--   R2  Dayparting FDS resume  (seg 7h)     — 3 campanhas lead-gen
--   R3  São João pause         (one_shot)   — 6 ad sets (NE + CD-BA + CD-PE em ACQ e RET)
--   R4  São João resume        (one_shot)   — mesmos 6 ad sets em 01/jul 07:00
--
-- Idempotente: usa ON CONFLICT DO NOTHING (depende de constraint única adicionada
-- abaixo, só nesta primeira carga, para evitar reinserção em re-execuções).
--
-- Para rerodar o seed sem duplicar, faça primeiro:
--   DELETE FROM ad_schedule_rules WHERE reason IN ('Dayparting FDS', 'Festas de São João 2026');

BEGIN;

-- =====================================================================
-- R1 — Dayparting FDS PAUSE (sex 17h BR)
-- =====================================================================
INSERT INTO ad_schedule_rules
  (target_type, target_id, target_name, action, schedule_type, cron_expression, reason)
VALUES
  ('campaign', '120242773309160638', 'META | ACQ | GERAL | NOVOS | BR',  'pause', 'recurring', '0 17 * * 5', 'Dayparting FDS'),
  ('campaign', '120236319115270638', 'META | RET | GERAL | BASE | BR',   'pause', 'recurring', '0 17 * * 5', 'Dayparting FDS'),
  ('campaign', '120235928732030638', 'META | ACQ | MICRO | NOVOS | SP',  'pause', 'recurring', '0 17 * * 5', 'Dayparting FDS');

-- =====================================================================
-- R2 — Dayparting FDS RESUME (seg 7h BR)
-- =====================================================================
INSERT INTO ad_schedule_rules
  (target_type, target_id, target_name, action, schedule_type, cron_expression, reason)
VALUES
  ('campaign', '120242773309160638', 'META | ACQ | GERAL | NOVOS | BR',  'resume', 'recurring', '0 7 * * 1', 'Dayparting FDS'),
  ('campaign', '120236319115270638', 'META | RET | GERAL | BASE | BR',   'resume', 'recurring', '0 7 * * 1', 'Dayparting FDS'),
  ('campaign', '120235928732030638', 'META | ACQ | MICRO | NOVOS | SP',  'resume', 'recurring', '0 7 * * 1', 'Dayparting FDS');

-- =====================================================================
-- R3 — São João PAUSE (one_shot 2026-06-20 00:00 -03)
-- =====================================================================
-- Targets: NE residual + CD-BA + CD-PE, em ambas as campanhas (ACQ e RET).
-- Timestamp em UTC: 2026-06-20 03:00:00Z (00:00 BR = 03:00 UTC).
INSERT INTO ad_schedule_rules
  (target_type, target_id, target_name, action, schedule_type, run_at, reason)
VALUES
  ('adset', '120242773309210638', 'LAL-1PCT | CLIENTES | NE (ACQ)',     'pause', 'one_shot', '2026-06-20 03:00:00+00', 'Festas de São João 2026'),
  ('adset', '120245845794600638', 'LAL-1PCT | CLIENTES | CD-BA (ACQ)',  'pause', 'one_shot', '2026-06-20 03:00:00+00', 'Festas de São João 2026'),
  ('adset', '120245845795880638', 'LAL-1PCT | CLIENTES | CD-PE (ACQ)',  'pause', 'one_shot', '2026-06-20 03:00:00+00', 'Festas de São João 2026'),
  ('adset', '120236319115410638', 'BASE-ATIVA | GERAL | NE (RET)',      'pause', 'one_shot', '2026-06-20 03:00:00+00', 'Festas de São João 2026'),
  ('adset', '120245849786330638', 'BASE-ATIVA | GERAL | CD-BA (RET)',   'pause', 'one_shot', '2026-06-20 03:00:00+00', 'Festas de São João 2026'),
  ('adset', '120245849788290638', 'BASE-ATIVA | GERAL | CD-PE (RET)',   'pause', 'one_shot', '2026-06-20 03:00:00+00', 'Festas de São João 2026');

-- =====================================================================
-- R4 — São João RESUME (one_shot 2026-07-01 07:00 -03)
-- =====================================================================
-- Timestamp em UTC: 2026-07-01 10:00:00Z (07:00 BR = 10:00 UTC).
-- Data sugerida; confirmar com Thiago — pode mudar conforme calendário do time.
INSERT INTO ad_schedule_rules
  (target_type, target_id, target_name, action, schedule_type, run_at, reason)
VALUES
  ('adset', '120242773309210638', 'LAL-1PCT | CLIENTES | NE (ACQ)',     'resume', 'one_shot', '2026-07-01 10:00:00+00', 'Retomada pós-São João 2026'),
  ('adset', '120245845794600638', 'LAL-1PCT | CLIENTES | CD-BA (ACQ)',  'resume', 'one_shot', '2026-07-01 10:00:00+00', 'Retomada pós-São João 2026'),
  ('adset', '120245845795880638', 'LAL-1PCT | CLIENTES | CD-PE (ACQ)',  'resume', 'one_shot', '2026-07-01 10:00:00+00', 'Retomada pós-São João 2026'),
  ('adset', '120236319115410638', 'BASE-ATIVA | GERAL | NE (RET)',      'resume', 'one_shot', '2026-07-01 10:00:00+00', 'Retomada pós-São João 2026'),
  ('adset', '120245849786330638', 'BASE-ATIVA | GERAL | CD-BA (RET)',   'resume', 'one_shot', '2026-07-01 10:00:00+00', 'Retomada pós-São João 2026'),
  ('adset', '120245849788290638', 'BASE-ATIVA | GERAL | CD-PE (RET)',   'resume', 'one_shot', '2026-07-01 10:00:00+00', 'Retomada pós-São João 2026');

COMMIT;

-- =====================================================================
-- Conferência rápida pós-seed
-- =====================================================================
-- SELECT reason, action, schedule_type,
--        COALESCE(cron_expression, run_at::text) AS quando,
--        target_name
-- FROM ad_schedule_rules
-- ORDER BY reason, action, target_name;
