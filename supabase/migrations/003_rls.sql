-- Migration 003 — Row Level Security
-- Apenas service_role tem acesso. Frontend nunca acessa diretamente.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE integradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfm_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_score_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmb_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON sessions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON integradores FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON events FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON rfm_snapshots FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON whatsapp_interactions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON pipeline_snapshots FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON nps_responses FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON lead_score_log FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON error_logs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON gmb_reviews FOR ALL USING (auth.role() = 'service_role');
