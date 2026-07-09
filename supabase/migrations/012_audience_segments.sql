-- Migration 012 — Segmentos de público para devolutiva (Meta Custom Audiences + Google Customer Match)
-- Projeto: fotus-tracking | Ref: GERENTE DE PROJETOS/WORKSTREAM-DEVOLUTIVA-PUBLICOS.md
--
-- Gera, a partir de public.integradores, as listas de público com identificadores
-- NORMALIZADOS e HASHEADOS (SHA-256 hex) prontos para upload:
--   - Meta Custom Audiences API (schema EMAIL/PHONE) → telefone só dígitos
--   - Google Customer Match via Data Manager API     → telefone E.164 com '+'
-- E-mail: lowercase+trim, SHA-256 (igual nas duas plataformas).
--
-- ⚠️ LGPD: a coluna `consent_ok` é o portão de base legal. Hoje é um stand-in
--    (tem contato + é cliente/lead). Antes de ATIVAR o push, ligar a uma base
--    legal real (consentimento/legítimo interesse) por contato.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE VIEW ultron.v_audience_members AS
WITH base AS (
  SELECT
    i.cnpj,
    i.segmento_rfm,
    i.status,
    i.numero_pedidos,
    i.data_ultima_compra,
    -- normalização
    lower(btrim(i.email))                                   AS email_norm,
    NULLIF(regexp_replace(coalesce(i.phone,''), '\D', '', 'g'), '') AS phone_digits  -- só dígitos
  FROM public.integradores i
),
norm AS (
  SELECT
    base.*,
    -- telefone BR em E.164: garante prefixo 55
    CASE
      WHEN phone_digits IS NULL THEN NULL
      WHEN left(phone_digits,2) = '55' THEN '+' || phone_digits
      ELSE '+55' || phone_digits
    END AS phone_e164
  FROM base
),
hashed AS (
  SELECT
    cnpj, segmento_rfm, status, numero_pedidos, data_ultima_compra,
    email_norm, phone_digits, phone_e164,
    CASE WHEN email_norm IS NOT NULL
      THEN encode(extensions.digest(email_norm, 'sha256'), 'hex') END AS email_sha256,
    -- Meta: telefone só dígitos (com DDI)
    CASE WHEN phone_e164 IS NOT NULL
      THEN encode(extensions.digest(regexp_replace(phone_e164,'\D','','g'), 'sha256'), 'hex') END AS phone_sha256_meta,
    -- Google: telefone E.164 com '+'
    CASE WHEN phone_e164 IS NOT NULL
      THEN encode(extensions.digest(phone_e164, 'sha256'), 'hex') END AS phone_sha256_google,
    -- portão LGPD (stand-in — trocar por base legal real antes de ativar)
    ((email_norm IS NOT NULL OR phone_e164 IS NOT NULL)
       AND (numero_pedidos > 0 OR status IN ('lead','qualificado'))) AS consent_ok
  FROM norm
),
seg AS (
  -- VIP → seed de lookalike + Customer Match bid-up
  SELECT 'vip'::text AS segment, 'lookalike_seed'::text AS purpose, * FROM hashed WHERE segmento_rfm = 'VIP'
  UNION ALL
  -- Ativo → exclusão (supressão) das campanhas de aquisição
  SELECT 'ativo', 'suppression', * FROM hashed WHERE segmento_rfm = 'Ativo'
  UNION ALL
  -- Risco → retenção
  SELECT 'risco', 'retention', * FROM hashed WHERE segmento_rfm = 'Risco'
  UNION ALL
  -- Inativo 90–180 dias → reativação
  SELECT 'inativo', 'reactivation', * FROM hashed
    WHERE data_ultima_compra <= now() - interval '90 days'
      AND data_ultima_compra >  now() - interval '180 days'
  UNION ALL
  -- Todos os clientes → Customer Match + supressão global
  SELECT 'cliente_all', 'suppression_global', * FROM hashed WHERE numero_pedidos > 0
)
SELECT
  segment, purpose, cnpj,
  email_sha256, phone_sha256_meta, phone_sha256_google,
  'br'::text AS country,
  consent_ok
FROM seg;

COMMENT ON VIEW ultron.v_audience_members IS
  'Membros de público por segmento, com e-mail/telefone hasheados (SHA-256) p/ Meta Custom Audiences e Google Customer Match. Gate LGPD = consent_ok. Ref: WORKSTREAM-DEVOLUTIVA-PUBLICOS.md';

-- Conferência rápida de volumetria por segmento (audiência precisa de >1.000 p/ Meta)
CREATE OR REPLACE VIEW ultron.v_audience_sizes AS
SELECT segment, purpose,
       count(*)                              AS total,
       count(*) FILTER (WHERE consent_ok)    AS elegiveis_lgpd,
       count(email_sha256)                   AS com_email,
       count(phone_sha256_meta)              AS com_telefone
FROM ultron.v_audience_members
GROUP BY segment, purpose
ORDER BY segment;
