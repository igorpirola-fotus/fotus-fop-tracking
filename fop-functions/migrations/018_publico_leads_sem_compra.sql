-- 018_publico_leads_sem_compra.sql — sexto público, descoberto ao medir a view.
-- Aplicada no fop-db via webhook fopdb-q em 2026-08-27.
--
-- Por que existe: com a base como está HOJE (antes do enriquecimento via RD CRM),
-- todos os cinco públicos do seed 016 ficam abaixo do mínimo de 1.000 —
-- perdidos_sem_compra 330, clientes_ativos_180d 63, sql_sem_venda 39,
-- ltv_alto_semente 7, inativos_180_540d 4. Este tem 1.207: são os leads da LP
-- (que têm email E telefone) que nunca compraram. É o único que sobe agora,
-- e é remarketing quente de aquisição.
INSERT INTO ultron.publicos_meta (publico, nome_meta, descricao) VALUES
  ('leads_sem_compra', 'FOP | Leads sem compra',
   'Tem chave de match e nunca comprou — remarketing de aquisição; superconjunto de sql_sem_venda e perdidos_sem_compra')
ON CONFLICT (publico) DO NOTHING;
