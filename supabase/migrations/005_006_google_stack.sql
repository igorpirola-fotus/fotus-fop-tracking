-- Migration 005 — Colunas Google Ads e GA4 nas tabelas existentes

-- Adicionar gclid e ga4_client_id na tabela sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS gclid TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ga4_client_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ga4_session_id TEXT;

-- Adicionar gclid na tabela events (para atribuição Google Ads em eventos de funil)
ALTER TABLE events ADD COLUMN IF NOT EXISTS gclid TEXT;

-- Índice para buscas por gclid (Google Ads upload de conversões offline)
CREATE INDEX IF NOT EXISTS idx_sessions_gclid ON sessions(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_ga4_client ON sessions(ga4_client_id) WHERE ga4_client_id IS NOT NULL;

-- Migration 006 — Tabela GMB Reviews (Google Meu Negócio)

CREATE TABLE IF NOT EXISTS gmb_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vínculo com integrador (quando identificável pelo telefone/email da conta Google)
  integrador_id UUID REFERENCES integradores(id),

  -- Dados do local
  location_name TEXT NOT NULL,           -- ex: 'Fotus Solar - Vila Velha'
  location_id TEXT,                      -- ID do local na API do GMB

  -- Dados da avaliação
  google_review_id TEXT UNIQUE NOT NULL,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  reviewer_name TEXT,
  reviewer_photo_url TEXT,

  -- Resposta da Fotus
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  reply_pending BOOLEAN DEFAULT FALSE,   -- flag para reviews sem resposta

  -- Metadados
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_gmb_location ON gmb_reviews(location_name);
CREATE INDEX IF NOT EXISTS idx_gmb_rating ON gmb_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_gmb_pending ON gmb_reviews(reply_pending) WHERE reply_pending = TRUE;
CREATE INDEX IF NOT EXISTS idx_gmb_integrador ON gmb_reviews(integrador_id) WHERE integrador_id IS NOT NULL;

-- RLS
ALTER TABLE gmb_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only" ON gmb_reviews;
CREATE POLICY "service_role_only" ON gmb_reviews FOR ALL USING (auth.role() = 'service_role');

-- Trigger de updated_at
DROP TRIGGER IF EXISTS trg_gmb_reviews_updated_at ON gmb_reviews;
CREATE TRIGGER trg_gmb_reviews_updated_at
  BEFORE UPDATE ON gmb_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
