-- Migration 004 — Triggers automáticos

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_integradores_updated_at
  BEFORE UPDATE ON integradores FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_gmb_reviews_updated_at
  BEFORE UPDATE ON gmb_reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION calc_anos_mercado()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.data_abertura IS NOT NULL THEN
    NEW.anos_mercado = EXTRACT(YEAR FROM AGE(NOW(), NEW.data_abertura))::INT;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calc_anos_mercado
  BEFORE INSERT OR UPDATE OF data_abertura ON integradores
  FOR EACH ROW EXECUTE FUNCTION calc_anos_mercado();
