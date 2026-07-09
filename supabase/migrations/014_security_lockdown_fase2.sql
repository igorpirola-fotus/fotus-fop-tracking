-- Migration 014 — Segurança Fase 2 (remover escrita/leitura anônima de tabelas)
-- Projeto: fotus-fop-tracking (wttmlnhzvevtabjetsqz) | Data: 2026-06-18
-- Ref: continuação de 013_security_lockdown.sql
--
-- Estas tabelas aceitavam INSERT/SELECT pelo papel `anon` (chave pública), mas
-- quem realmente escreve nelas é service_role (Edge Functions) / n8n_user (n8n).
-- A leitura legítima é via painel logado (authenticated, que mantém grant próprio).
-- Logo, remover `anon` não quebra nada e fecha escrita anônima.

BEGIN;

REVOKE ALL ON
  public.ig_comments,
  public.ig_posts,
  public.ig_relatorios,
  public.relatorios
FROM anon;

-- banco_de_tarefas: plataforma BDR confirmada COM login (Supabase Auth → authenticated).
-- Remover acesso anônimo (grant direto a anon + grant a PUBLIC). authenticated tem
-- grant próprio (arw) e mantém leitura/escrita; service_role/n8n_user inalterados.
REVOKE ALL ON ultron.banco_de_tarefas FROM anon, PUBLIC;

COMMIT;
