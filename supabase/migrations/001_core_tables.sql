-- Migration 001 — Tabelas core
-- Projeto: fotus-tracking | Região: sa-east-1 (São Paulo)

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  fbp TEXT, fbc TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
  ip_address TEXT, user_agent TEXT,
  country TEXT DEFAULT 'BR', state TEXT, city TEXT, isp TEXT,
  is_vpn BOOLEAN DEFAULT FALSE, is_bot BOOLEAN DEFAULT FALSE,
  visit_count INT DEFAULT 1,
  scroll_depth_pct INT, time_on_page_seconds INT,
  device_type TEXT, referrer TEXT,
  gclid TEXT, ga4_client_id TEXT, ga4_session_id TEXT,
  integrador_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE integradores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj TEXT UNIQUE NOT NULL,
  email TEXT, phone TEXT,
  nome_contato TEXT, razao_social TEXT, nome_fantasia TEXT,
  cnae_principal TEXT, cnae_descricao TEXT,
  porte TEXT, data_abertura DATE, anos_mercado INT, situacao_cadastral TEXT,
  endereco_logradouro TEXT, endereco_numero TEXT, endereco_complemento TEXT,
  endereco_bairro TEXT, endereco_municipio TEXT, endereco_uf TEXT, endereco_cep TEXT,
  capital_social NUMERIC,
  estado_operacao TEXT, cidade_operacao TEXT,
  rd_lead_id TEXT, rd_deal_id TEXT, erp_id TEXT, whatsapp_id TEXT,
  status TEXT DEFAULT 'lead',
  data_primeiro_contato TIMESTAMPTZ, data_qualificacao TIMESTAMPTZ,
  data_primeira_compra TIMESTAMPTZ, data_ultima_compra TIMESTAMPTZ, data_ultimo_contato TIMESTAMPTZ,
  ticket_medio NUMERIC, ltv_total NUMERIC, numero_pedidos INT DEFAULT 0,
  lead_score INT DEFAULT 0, nps_score INT,
  segmento_rfm TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE NOT NULL,
  session_id TEXT REFERENCES sessions(session_id),
  integrador_id UUID REFERENCES integradores(id),
  event_name TEXT NOT NULL,
  event_source TEXT NOT NULL,
  event_data JSONB,
  funnel TEXT,
  meta_capi_status TEXT DEFAULT 'pending',
  meta_event_id TEXT, meta_fbtrace_id TEXT, meta_error TEXT, meta_retry_count INT DEFAULT 0,
  match_keys JSONB,
  gclid TEXT,
  utm_source TEXT, utm_campaign TEXT, utm_content TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rfm_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrador_id UUID REFERENCES integradores(id),
  snapshot_date DATE NOT NULL,
  recency_days INT,
  frequency_12m INT, monetary_12m NUMERIC,
  r_score INT CHECK (r_score BETWEEN 1 AND 5),
  f_score INT CHECK (f_score BETWEEN 1 AND 5),
  m_score INT CHECK (m_score BETWEEN 1 AND 5),
  rfm_score INT,
  segment TEXT, previous_segment TEXT,
  UNIQUE(integrador_id, snapshot_date)
);

CREATE TABLE whatsapp_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrador_id UUID REFERENCES integradores(id),
  session_id TEXT,
  direction TEXT NOT NULL,
  message_type TEXT, template_name TEXT, message_body TEXT,
  intent TEXT, response_time_minutes INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pipeline_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  stage_name TEXT NOT NULL,
  deals_count INT, deals_value NUMERIC,
  avg_days_in_stage NUMERIC, conversion_rate_pct NUMERIC,
  UNIQUE(snapshot_date, stage_name)
);

CREATE TABLE nps_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrador_id UUID REFERENCES integradores(id),
  score INT CHECK (score BETWEEN 0 AND 10),
  category TEXT, response_text TEXT, trigger_event TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE lead_score_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrador_id UUID REFERENCES integradores(id),
  score_anterior INT, score_novo INT, motivo TEXT, delta INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  error_message TEXT, payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gmb_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrador_id UUID REFERENCES integradores(id),
  location_name TEXT NOT NULL, location_id TEXT,
  google_review_id TEXT UNIQUE NOT NULL,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT, reviewer_name TEXT, reviewer_photo_url TEXT,
  reply_text TEXT, replied_at TIMESTAMPTZ, reply_pending BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
