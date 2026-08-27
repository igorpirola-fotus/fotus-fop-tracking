-- 019_rd_org_contatos_sync.sql — controle do sync de contatos POR ORGANIZAÇÃO.
-- Aplicada no fop-db via webhook fopdb-q em 2026-08-27.
--
-- POR QUE ESTA TABELA EXISTE: a API do RD CRM só pagina os primeiros 10.000
-- registros de um filtro ("It is only possible to list the first 10,000 records
-- of the specified filter" — erro 400 real, batido na página 51 de
-- /crm/v2/contacts em 27/ago/2026, depois de 9.600 contatos lidos). Varrer os
-- ~190 mil contatos da conta é impossível por paginação simples.
--
-- A saída é buscar por organização (filtro RDQL organization_id, que aceita
-- vários ids por chamada) — o que também é mais barato, porque só nos interessam
-- as empresas que têm integrador no fop-db.
--
-- Inclui NEGATIVE CACHING: organização sem contato útil fica registrada com
-- contatos = 0 e não é reconsultada. Mesmo padrão do rd_deal_cnpj_cache.
CREATE TABLE IF NOT EXISTS public.rd_org_contatos_sync (
  org_id       text PRIMARY KEY,
  contatos     int NOT NULL DEFAULT 0,
  ultima_sync  timestamptz NOT NULL DEFAULT now()
);
