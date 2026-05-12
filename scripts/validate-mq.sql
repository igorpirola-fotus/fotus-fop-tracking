-- validate-mq.sql — Queries de validação Match Quality e saúde do tracking
-- Executar no Supabase SQL Editor (https://app.supabase.com → SQL Editor)

-- ============================================================
-- 1. Status geral dos eventos CAPI (últimos 7 dias)
-- ============================================================
SELECT
  event_name,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE meta_capi_status = 'sent') as enviados,
  COUNT(*) FILTER (WHERE meta_capi_status = 'failed') as falhos,
  COUNT(*) FILTER (WHERE meta_capi_status = 'pending') as pendentes,
  ROUND(COUNT(*) FILTER (WHERE meta_capi_status = 'sent') * 100.0 / COUNT(*), 1) as pct_enviados
FROM events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY event_name
ORDER BY total DESC;

-- ============================================================
-- 2. Cobertura de Advanced Matching por evento (proxy de Match Quality)
-- ============================================================
SELECT
  event_name,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE match_keys ?& ARRAY['em','ph']) as com_email_phone,
  COUNT(*) FILTER (WHERE match_keys ?& ARRAY['em','ph','fn','ct','st']) as match_completo,
  ROUND(COUNT(*) FILTER (WHERE match_keys ?& ARRAY['em','ph','fn','ct','st']) * 100.0 / NULLIF(COUNT(*),0), 1) as pct_match_completo
FROM events
WHERE meta_capi_status = 'sent'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY event_name
ORDER BY total DESC;

-- ============================================================
-- 3. Erros das Edge Functions (últimas 48h)
-- ============================================================
SELECT
  function_name,
  COUNT(*) as total_erros,
  MAX(created_at) as ultimo_erro,
  error_message
FROM error_logs
WHERE created_at > NOW() - INTERVAL '48 hours'
GROUP BY function_name, error_message
ORDER BY total_erros DESC
LIMIT 20;

-- ============================================================
-- 4. Leads sem enriquecimento CNPJ (problema no enrich-cnpj)
-- ============================================================
SELECT 
  COUNT(*) as leads_sem_enriquecimento,
  MIN(created_at) as mais_antigo
FROM integradores
WHERE razao_social IS NULL
  AND created_at < NOW() - INTERVAL '1 hour';

-- ============================================================
-- 5. Funil de conversão mês atual
-- ============================================================
WITH funil AS (
  SELECT event_name, COUNT(DISTINCT integrador_id) as integradores
  FROM events
  WHERE funnel = 'aquisicao'
    AND meta_capi_status = 'sent'
    AND created_at > DATE_TRUNC('month', NOW())
  GROUP BY event_name
)
SELECT
  MAX(CASE WHEN event_name = 'PageView' THEN integradores END) as pageviews,
  MAX(CASE WHEN event_name = 'ViewContent' THEN integradores END) as view_content,
  MAX(CASE WHEN event_name = 'InitiateCheckout' THEN integradores END) as init_checkout,
  MAX(CASE WHEN event_name = 'Lead' THEN integradores END) as leads,
  MAX(CASE WHEN event_name = 'Contact' THEN integradores END) as contatos,
  MAX(CASE WHEN event_name = 'Schedule' THEN integradores END) as sql_qualificados,
  MAX(CASE WHEN event_name = 'AddToCart' THEN integradores END) as propostas,
  MAX(CASE WHEN event_name = 'Purchase' THEN integradores END) as clientes_novos
FROM funil;

-- ============================================================
-- 6. Cobertura do gclid (Google Ads) nas sessões
-- ============================================================
SELECT
  COUNT(*) as total_sessions,
  COUNT(*) FILTER (WHERE gclid IS NOT NULL) as com_gclid,
  ROUND(COUNT(*) FILTER (WHERE gclid IS NOT NULL) * 100.0 / COUNT(*), 1) as pct_google_traffic
FROM sessions
WHERE created_at > NOW() - INTERVAL '30 days';
