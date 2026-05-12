-- Migration 002 — Índices
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_events_integrador ON events(integrador_id);
CREATE INDEX idx_events_name_date ON events(event_name, created_at DESC);
CREATE INDEX idx_events_funnel ON events(funnel, created_at DESC);
CREATE INDEX idx_events_capi_status ON events(meta_capi_status);
CREATE INDEX idx_integradores_cnpj ON integradores(cnpj);
CREATE INDEX idx_integradores_status ON integradores(status);
CREATE INDEX idx_integradores_segmento ON integradores(segmento_rfm);
CREATE INDEX idx_sessions_integrador ON sessions(integrador_id);
CREATE INDEX idx_sessions_gclid ON sessions(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX idx_rfm_integrador_date ON rfm_snapshots(integrador_id, snapshot_date DESC);
CREATE INDEX idx_pipeline_date ON pipeline_snapshots(snapshot_date DESC);
CREATE INDEX idx_gmb_location ON gmb_reviews(location_name);
CREATE INDEX idx_gmb_rating ON gmb_reviews(rating);
CREATE INDEX idx_gmb_pending ON gmb_reviews(reply_pending) WHERE reply_pending = TRUE;
