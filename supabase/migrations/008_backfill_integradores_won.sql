-- 008 — controle de idempotência do backfill de integradores (modo `won`)
--
-- Contexto: com o CNPJ finalmente resolvido (migration 007), o rd-sync passou a
-- barrar no filtro seguinte: `integrador CNPJ ... não encontrado`. A base tem
-- ~1.970 integradores contra ~12.000 deals distintos por semana, porque
-- `integradores` só foi semeada com quem passou pela LP.
--
-- O backfill (doc 14 do projeto RD) percorre os deals GANHOS do CRM e reconstrói
-- `numero_pedidos`, `ltv_total`, `ticket_medio` e as datas de compra. Isso importa
-- para além do volume: sem histórico, o rd-sync trataria a compra de um cliente
-- antigo como `Purchase` (primeira compra) em vez de `PurchaseRecorrente`,
-- inflando a Custom Conversion de aquisição.
--
-- Esta tabela existe porque a acumulação é SOMA: sem registro de quais deals já
-- foram contabilizados, rodar o backfill duas vezes dobraria o LTV de todo mundo.
CREATE TABLE IF NOT EXISTS public.rd_won_backfill (
  rd_deal_id  TEXT PRIMARY KEY,
  cnpj        TEXT NOT NULL,
  valor       NUMERIC NOT NULL DEFAULT 0,
  closed_at   TIMESTAMPTZ,
  aplicado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rd_won_backfill_cnpj ON public.rd_won_backfill (cnpj);

COMMENT ON TABLE public.rd_won_backfill IS
  'Deals ganhos ja contabilizados no backfill de integradores. Guarda a idempotencia: a acumulacao de numero_pedidos/ltv_total e soma, entao rodar duas vezes sem este controle dobraria o LTV.';
