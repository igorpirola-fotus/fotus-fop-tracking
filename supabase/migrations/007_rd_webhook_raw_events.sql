-- 007 — tabela de eventos brutos do RD Station CRM
-- Serve como camada de persistência antes do processamento e como mecanismo de deduplicação

CREATE TABLE rdstation_crm_webhook_events (
  id              BIGSERIAL    PRIMARY KEY,
  dedup_key       TEXT         NOT NULL UNIQUE,
  event_name      TEXT,
  entity_id       TEXT,
  payload         JSONB        NOT NULL,
  processing_status TEXT       NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_rd_wh_event_name    ON rdstation_crm_webhook_events (event_name);
CREATE INDEX idx_rd_wh_entity_id     ON rdstation_crm_webhook_events (entity_id);
CREATE INDEX idx_rd_wh_received_at   ON rdstation_crm_webhook_events (received_at);
CREATE INDEX idx_rd_wh_status        ON rdstation_crm_webhook_events (processing_status);

ALTER TABLE rdstation_crm_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON rdstation_crm_webhook_events
  FOR ALL USING (auth.role() = 'service_role');
