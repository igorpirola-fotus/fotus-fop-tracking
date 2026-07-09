-- Migration 009 — Stored functions para backfill de integradores
-- Chamadas via supabase.rpc() pela Edge Function backfill-integradores

-- ── Upsert base (modo "orgs") ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_integrador_base(
  p_cnpj          TEXT,
  p_razao_social  TEXT,
  p_cidade        TEXT,
  p_uf            TEXT
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO integradores
    (cnpj, razao_social, cidade_operacao, endereco_uf, status, updated_at)
  VALUES
    (p_cnpj, p_razao_social, p_cidade, p_uf, 'lead', now())
  ON CONFLICT (cnpj) DO UPDATE SET
    razao_social    = COALESCE(integradores.razao_social,    EXCLUDED.razao_social),
    cidade_operacao = COALESCE(integradores.cidade_operacao, EXCLUDED.cidade_operacao),
    endereco_uf     = COALESCE(integradores.endereco_uf,     EXCLUDED.endereco_uf),
    updated_at      = now()
  WHERE integradores.status = 'lead';  -- nunca regride status de clientes
$$;

-- ── Upsert com incremento de compra (modo "won") ──────────────────────────
-- Cada chamada representa 1 deal ganho. Acumula numero_pedidos e ltv atomicamente.
-- Ordenar os deals por closed_at ASC antes de chamar — garante data_primeira_compra correta.
CREATE OR REPLACE FUNCTION upsert_integrador_won_deal(
  p_cnpj          TEXT,
  p_razao_social  TEXT,
  p_cidade        TEXT,
  p_uf            TEXT,
  p_rd_deal_id    TEXT,
  p_amount        NUMERIC,
  p_closed_at     TIMESTAMPTZ
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO integradores
    (cnpj, razao_social, cidade_operacao, endereco_uf,
     rd_deal_id, status, numero_pedidos, ltv_total, ticket_medio,
     data_primeira_compra, data_ultima_compra, updated_at)
  VALUES
    (p_cnpj, p_razao_social, p_cidade, p_uf,
     p_rd_deal_id, 'cliente', 1, p_amount, p_amount,
     p_closed_at, p_closed_at, now())
  ON CONFLICT (cnpj) DO UPDATE SET
    status               = 'cliente',
    rd_deal_id           = p_rd_deal_id,
    razao_social         = COALESCE(integradores.razao_social,    p_razao_social),
    cidade_operacao      = COALESCE(integradores.cidade_operacao, p_cidade),
    endereco_uf          = COALESCE(integradores.endereco_uf,     p_uf),
    numero_pedidos       = integradores.numero_pedidos + 1,
    ltv_total            = integradores.ltv_total + p_amount,
    ticket_medio         = (integradores.ltv_total + p_amount)
                           / (integradores.numero_pedidos + 1),
    data_primeira_compra = COALESCE(integradores.data_primeira_compra, p_closed_at),
    data_ultima_compra   = p_closed_at,
    updated_at           = now();
$$;
