-- 016_publicos_meta.sql — públicos da Meta alimentados pelo fop-db.
-- Aplicada no fop-db via webhook fopdb-q em 2026-08-27.

-- Espelho dos contatos do RD CRM. É a fonte de email/phone dos integradores que
-- entraram pelo rd-sync (webhook do CRM só resolve CNPJ — ver rd-crm-client.ts).
CREATE TABLE IF NOT EXISTS public.rd_contatos (
  rd_contact_id  text PRIMARY KEY,
  org_id         text,
  nome           text,
  email          text,
  phone          text,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rd_contatos_org ON public.rd_contatos (org_id);

-- Auditoria de origem da chave de match (sem isso não se sabe se o e-mail veio
-- da LP ou do CRM, e um público ruim fica indistinguível de um público certo).
ALTER TABLE public.integradores
  ADD COLUMN IF NOT EXISTS email_fonte text,
  ADD COLUMN IF NOT EXISTS phone_fonte text;

-- Mapa público → audience_id da Meta. O audience_id é identidade permanente:
-- recriar público zera aprendizado dos conjuntos. Por isso vive em tabela.
CREATE TABLE IF NOT EXISTS ultron.publicos_meta (
  publico     text PRIMARY KEY,
  nome_meta   text NOT NULL,
  descricao   text,
  audience_id text UNIQUE,
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

-- Log de cada sync. Guardrail contra o erro dos ETLs: falha silenciosa.
CREATE TABLE IF NOT EXISTS ultron.publicos_meta_sync (
  id             bigserial PRIMARY KEY,
  publico        text NOT NULL,
  audience_id    text,
  linhas_origem  int NOT NULL DEFAULT 0,
  enviados       int NOT NULL DEFAULT 0,
  lotes          int NOT NULL DEFAULT 0,
  status         text NOT NULL,          -- ok | falha | pulado_volume_minimo | dry_run
  http_status    int,
  erro           text,
  session_id     bigint,
  rodado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publicos_sync_publico
  ON ultron.publicos_meta_sync (publico, rodado_em DESC);

-- Seed dos públicos. audience_id fica NULL: quem cria é o /sync-publicos-meta
-- (garantirAudience), que grava o id de volta aqui.
INSERT INTO ultron.publicos_meta (publico, nome_meta, descricao) VALUES
  ('clientes_ativos_180d',  'FOP | Clientes ativos 180d',   'Compra nos últimos 180 dias — excluir de ACQ, alvo de RET|BASE'),
  ('inativos_180_540d',     'FOP | Inativos 180-540d',      'Compraram e pararam — ataque BDR'),
  ('sql_sem_venda',         'FOP | SQL sem venda',          'Evento Schedule (Lead Qualificado Fotus) sem Purchase'),
  ('perdidos_sem_compra',   'FOP | Perdidos sem compra',    'OportunidadePerdida e nunca compraram'),
  ('ltv_alto_semente',      'FOP | LTV alto (semente LAL)', 'Top decil de ltv_total — semente de lookalike')
ON CONFLICT (publico) DO NOTHING;
