-- 021_motivos_perda_classificacao.sql — os 88 motivos de perda do RD CRM,
-- classificados pelo que significam PARA MIDIA. NÃO APLICADA AINDA.
--
-- Por que existe: "perdido" nao e um estado homogeneo. Um deal perdido por
-- "Preco" e o melhor publico de oferta que existe na base; um perdido por
-- "CNPJ Baixado" nao pode receber anuncio nunca mais; e "Ativo na Plataforma"
-- nem e perda — e repasse interno, e anunciar pra essa pessoa e competir com o
-- proprio consultor. Tratar os tres como um publico so desperdicia verba e
-- queima base.
--
-- Fonte: GET /crm/v2/lost_reasons lido ao vivo em 15/set/2026 (88 motivos).
-- Classificacao validada pelo Igor na mesma data.
--
-- DESENHO: a classificacao mora AQUI (tabela versionada), nao dentro da view.
-- Quando o comercial criar motivo novo, insere uma linha — nao mexe em view.
-- Motivo sem linha nesta tabela NAO entra em publico nenhum (fail-safe: o
-- default e nao anunciar, nunca anunciar por engano).

CREATE TABLE IF NOT EXISTS ultron.motivos_perda_classificacao (
  lost_reason_id text PRIMARY KEY,
  nome           text NOT NULL,
  grupo          text NOT NULL
    CHECK (grupo IN ('inapto','ruido','reativavel_quente','reativavel_frio','contato_invalido','depende_etapa')),
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ultron.motivos_perda_classificacao IS
  'Motivo de perda do RD CRM -> uso em midia. inapto=exclusao dura; ruido=nao e perda real; reativavel_quente=objecao de condicao; reativavel_frio=nunca houve contato; contato_invalido=chave de match ruim.';

-- ── GRUPO 1: INAPTO — exclusao dura em TODAS as campanhas ───────────────────
-- Bate com as categorias da base de 16.701 empresas bloqueadas.
INSERT INTO ultron.motivos_perda_classificacao (lost_reason_id, nome, grupo) VALUES
  ('6a6797ca3b9e98001f3e8ff5', '[CADASTRO] CNPJ Suspenso',          'inapto'),
  ('6a67978c847c15001dd05790', '[CADASTRO] Nao atua no Solar',      'inapto'),
  ('6a679741dd6593002225bba8', '[CADASTRO] CNPJ Baixado',           'inapto'),
  ('6a6797350b186d001deb7a0e', '[CADASTRO] CNPJ Inapto',            'inapto'),
  ('6a679722d66e3e001ddc66f7', '[CADASTRO] Sem CNAE compativel',    'inapto'),
  ('6a60b1e8374c99001d5c0895', 'CNPJ Baixado - POC IA',             'inapto'),
  ('6a60b1d7f266170021010242', 'Nao possui CNPJ - POC IA',          'inapto'),
  ('6a4274c46b6ad4001eaca60a', 'Nao possui CNAE - POC IA',          'inapto'),
  ('6a3d7d98bceee0001d86eb00', '[FOTUS CHARGE] Nao aderente ao ICP','inapto'),
  ('6883743354725d00175a37d2', 'Sem CNAE',                          'inapto'),
  ('688373df799b590018152fe8', 'Fora do Mercado Solar',             'inapto'),
  ('688373c18e7bab001afe79c0', 'CNPJ com restricao',                'inapto'),
  ('688373ba7fd5860017524290', 'CNPJ Baixado',                      'inapto'),
  ('688373910071c7001de952d9', 'SDR - Cliente Final',               'inapto'),
  ('68828b0e31490900144fb5b9', 'Irregularidade CNPJ',               'inapto')
ON CONFLICT (lost_reason_id) DO NOTHING;

-- ── GRUPO 2: RUIDO — nao e perda real, nao vira publico ─────────────────────
INSERT INTO ultron.motivos_perda_classificacao (lost_reason_id, nome, grupo, observacao) VALUES
  ('6a8dba286133f600255af245', '[CADASTRO] Cliente ja Cadastrado', 'ruido', NULL),
  ('6a67977c7a4acb00249e244f', '[CADASTRO] Duplicidade',           'ruido', NULL),
  ('6a60b8885dede6001de1b50f', 'Ativo Plataforma Grupo Economico - POC IA', 'ruido', 'repasse interno -> em_atendimento'),
  ('6a60b1b7af89d10026e5f5d3', 'Ativo na Plataforma BDR- POC IA',  'ruido', 'repasse interno -> em_atendimento'),
  ('6a60b1ab37d58e002679b241', 'Ativo na Plataforma SDR- POC IA',  'ruido', 'repasse interno -> em_atendimento'),
  ('6a427ee0efb910001fd3cd7c', 'Ativo na Plataforma Comercial - POC IA', 'ruido', 'repasse interno -> em_atendimento'),
  ('68b9aa1a40b0ad001a0f6a12', 'SDR - Ativo na Plataforma',        'ruido', 'repasse interno -> em_atendimento'),
  ('6a32ad0365835600257095ce', 'Em atendimento por outro BDR',     'ruido', 'esta sendo atendido AGORA -> excluir'),
  ('6a32acfb3817860027bed973', 'Em atendimento por outro SDR',     'ruido', 'esta sendo atendido AGORA -> excluir'),
  ('6a426bf1e0479b00217aeb86', 'Negociacao Transferida - POC IA',  'ruido', NULL),
  ('6a426bb5a8ee9d00248bacbb', 'Card Duplicado - POC IA',          'ruido', NULL),
  ('6a3d3bc089b0e5002a5a116b', 'Teste - POC IA',                   'ruido', NULL),
  ('68ec1a5dd071db001743db52', 'Teste TI',                         'ruido', NULL),
  ('68828adfe972bd0017d07e86', 'Teste |T.I',                       'ruido', NULL),
  ('6a19e28521567e001fc3ce58', 'ACELERA - Encerramento do programa','ruido', 'fim de ciclo do programa, nao perda comercial'),
  ('6a19e25aeaa45e00248df7e0', 'ACELERA - Recusou participar',     'ruido', 'recusou o programa, nao a compra'),
  ('6a19e25229cb2500212837fd', 'ACELERA - Nao atingiu a meta do ciclo', 'ruido', NULL),
  ('68f7ddae3ce5e2001b5fe6fe', 'Substituicao - Alteracao por Divergencia Documentos', 'ruido', NULL),
  ('68f7dc46f806dc0018019b6d', 'Substituicao - Alteracao da estrutura', 'ruido', NULL),
  ('68c99621e5b8000014739a84', 'Substituicao - Alteracao da forma de pagamento', 'ruido', NULL),
  ('68c98eba125e6800141e2d10', 'Substituicao - Alteracao cliente de faturamento', 'ruido', NULL),
  ('68c98ea139ac6a00203f745b', 'Substituicao - Alteracao do endereco de entrega', 'ruido', NULL),
  ('68c98e97ddcc2100208ad0ec', 'Substituicao - Alteracao de modulo ou inversor', 'ruido', NULL),
  ('68a63063a2ad97001732c64f', 'Nao usar - Substituicao',          'ruido', 'motivo descontinuado'),
  ('68a63056a2ad97001732c64a', 'Nao usar - Alteracao',             'ruido', 'motivo descontinuado'),
  ('68828aef979c4700173900a8', 'Nao usar - Desistencia',           'ruido', 'motivo descontinuado'),
  ('68828a96a58ad3002470ddb3', 'Nao usar - Conta de terceiros',    'ruido', 'motivo descontinuado'),
  ('688289bc75f4a500145fd2c0', 'Nao usar - Comprou com o concorrente', 'ruido', 'motivo descontinuado; semanticamente seria reativavel'),
  ('688373a1e1d06000148d29ad', 'SDR - Ja Cadastrado na Plataforma','ruido', NULL),
  ('6883737b0071c7001de952d5', 'SDR - Apontamento menor que 90 dias','ruido', 'regra de processo, nao decisao do cliente'),
  ('68828ad360e736002371a311', 'SDR - Cliente Faturamento',        'ruido', NULL),
  ('68828b468c19e9001aca5b69', 'Inversao de fluxo',                'ruido', NULL),
  ('68828b028c19e90014ca5ad4', 'Pedido duplicado',                 'ruido', NULL)
ON CONFLICT (lost_reason_id) DO NOTHING;

-- ── FECHAMENTO AUTOMATICO — o motivo NAO classifica; a ETAPA classifica ─────
-- Medido em 15/set/2026: juntos somam ~11.845 eventos (a maior massa da base).
-- Classifica-los como ruido jogaria fora o melhor publico que existe:
--   'Expirado Automaticamente' morre 3.637x em "Pedidos (1/9)" aos 62 dias
--   = PEDIDO MONTADO E NAO PAGO (carrinho abandonado), nao faxina.
--   'Limpeza Automatica' varre cards parados ~245 dias, mas em etapas que vao
--   de "Sem contato" (nunca tocado) ate "Orcamento" (754 receberam proposta).
INSERT INTO ultron.motivos_perda_classificacao (lost_reason_id, nome, grupo, observacao) VALUES
  ('6a7f5eb025b32e001f4e77d3', 'Limpeza Automatica',       'depende_etapa', 'ver motivos_perda_por_etapa'),
  ('6882897eb4152d0022343b67', 'Expirado Automaticamente', 'depende_etapa', 'ver motivos_perda_por_etapa')
ON CONFLICT (lost_reason_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ultron.motivos_perda_por_etapa (
  lost_reason_id text NOT NULL,
  etapa          text NOT NULL,
  grupo          text NOT NULL
    CHECK (grupo IN ('inapto','ruido','reativavel_quente','reativavel_frio','contato_invalido')),
  observacao     text,
  PRIMARY KEY (lost_reason_id, etapa)
);

COMMENT ON TABLE ultron.motivos_perda_por_etapa IS
  'Para motivo de fechamento AUTOMATICO, quem carrega a intencao e a etapa em que o card morreu, nao o motivo.';

INSERT INTO ultron.motivos_perda_por_etapa (lost_reason_id, etapa, grupo, observacao) VALUES
  -- Expirado Automaticamente: pedido iniciado que nao se concluiu
  ('6882897eb4152d0022343b67', 'Pedidos (1/9)',                 'reativavel_quente', 'pedido montado e nao pago — carrinho abandonado (3.637)'),
  ('6882897eb4152d0022343b67', 'Aguardando pagamento (4/9)',    'reativavel_quente', 'chegou a aguardar pagamento'),
  ('6882897eb4152d0022343b67', 'Pedido invalido / Revisao',     'reativavel_quente', 'travou em revisao — recuperavel'),
  ('6882897eb4152d0022343b67', 'Monitor de pendencias',         'reativavel_quente', NULL),
  ('6882897eb4152d0022343b67', 'Aguardando entrega',            'ruido',             'pedido em logistica, nao e perda de venda'),
  ('6882897eb4152d0022343b67', 'Sem contato',                   'reativavel_frio',   NULL),
  ('6882897eb4152d0022343b67', 'Em Contato',                    'reativavel_frio',   NULL),
  ('6882897eb4152d0022343b67', 'Orcamento',                     'reativavel_quente', NULL),
  ('6882897eb4152d0022343b67', 'Tentativa contato sem sucesso', 'reativavel_frio',   NULL),
  ('6882897eb4152d0022343b67', 'Follow-Up',                     'reativavel_frio',   NULL),
  ('6882897eb4152d0022343b67', 'Qualificado SQLs',              'reativavel_quente', NULL),
  -- Limpeza Automatica: card parado ~245 dias, varrido pela rotina
  ('6a7f5eb025b32e001f4e77d3', 'Orcamento',                     'reativavel_quente', 'recebeu proposta e esfriou (754)'),
  ('6a7f5eb025b32e001f4e77d3', 'Em Contato',                    'reativavel_frio',   'foi trabalhado e esfriou (3.936)'),
  ('6a7f5eb025b32e001f4e77d3', 'Tentativa contato sem sucesso', 'reativavel_frio',   'tentaram e nao conseguiram falar (1.124) — caso classico de midia'),
  ('6a7f5eb025b32e001f4e77d3', 'Sem contato',                   'reativavel_frio',   'nunca foi tocado (2.254) — alcance puro')
ON CONFLICT (lost_reason_id, etapa) DO NOTHING;

-- ── GRUPO 3: REATIVAVEL QUENTE — teve intencao, travou em condicao ──────────
-- Melhor publico de OFERTA da base (alvo natural do Mes do Integrador).
INSERT INTO ultron.motivos_perda_classificacao (lost_reason_id, nome, grupo, observacao) VALUES
  ('68828a6f473ca40014ad385a', 'Preco',                            'reativavel_quente', NULL),
  ('6882899528a3a0001fb599e5', 'Forma de Pagamento',               'reativavel_quente', NULL),
  ('68828a33226caf001f02abb9', 'Pagamento |Financiamento Negado',  'reativavel_quente', NULL),
  ('688289b2b4152d00143438e2', 'Pagamento |Problemas cartao',      'reativavel_quente', NULL),
  ('68828a80ee2e8f001d1d4663', 'Pagamento Expirado',               'reativavel_quente', NULL),
  ('68828ab377c8a1001e6f50a4', 'Pgt Expirado',                     'reativavel_quente', NULL),
  ('68828aae6836790014fc209f', 'Prazo de Entrega',                 'reativavel_quente', NULL),
  ('688289ee6836790018fc207a', 'Falta de estoque',                 'reativavel_quente', NULL),
  ('68828b226e54b6001b52a6d9', 'Insatisfacao c/ logistica',        'reativavel_quente', NULL),
  ('688373cb473ca40014ad7151', 'Demora no follow',                 'reativavel_quente', 'falha nossa — recuperavel'),
  ('68828b2a979c4700173900ed', 'Erro Vendedor',                    'reativavel_quente', 'falha nossa — recuperavel'),
  ('68828b41aeb38a001b065a00', 'Concessionaria negou o projeto',   'reativavel_quente', 'projeto especifico caiu, o integrador continua'),
  ('688373b28e7bab001afe79be', 'Cliente optou por nao realizar o projeto', 'reativavel_quente', NULL),
  ('68828a93c999e50018411d38', 'Pendencia integrador',             'reativavel_quente', NULL),
  ('69b802268efdce00137220a3', 'Nao aceitou a proposta - MAR_RETENCAO_CLIENTES', 'reativavel_quente', NULL),
  ('688373f45330fc001e85c683', 'Nao gostou do Produto/Servico',    'reativavel_quente', 'decisao Igor 15/set: reativavel'),
  ('688289c349cce30022b5467f', 'Insatisfacao com Produtos',        'reativavel_quente', 'decisao Igor 15/set: reativavel'),
  ('6a6797ed40359800250b1591', '[CADASTRO] Documentacao invalida', 'reativavel_quente', 'quis se cadastrar, travou no processo'),
  ('6a6797d520e6480024782b24', '[CADASTRO] Documentacao incompleta','reativavel_quente', 'quis se cadastrar, travou no processo'),
  ('6a6797fcea45ab002c5ee1a6', '[CADASTRO] Dados cadastrais divergentes', 'reativavel_quente', 'quis se cadastrar, travou no processo')
ON CONFLICT (lost_reason_id) DO NOTHING;

-- ── GRUPO 4: REATIVAVEL FRIO — nunca se conseguiu falar ─────────────────────
-- O problema foi CANAL, nao interesse. Midia alcanca onde a cadencia falhou:
-- e o grupo que mais justifica verba de remarketing.
INSERT INTO ultron.motivos_perda_classificacao (lost_reason_id, nome, grupo, observacao) VALUES
  ('68837387226caf001f02e9ac', 'Cadencia finalizada, sem retorno', 'reativavel_frio', NULL),
  ('6a679772973ebb001dc6e992', '[CADASTRO] Cadencia Sem retorno', 'reativavel_frio', NULL),
  ('6a426bccd47177002063eaeb', 'Cadencia finalizada sem retorno - POC IA', 'reativavel_frio', NULL),
  ('6a3d7e881e8b3e0026fda348', '[FOTUS CHARGE] Cadencia Finalizada Sem Retorno', 'reativavel_frio', NULL),
  ('6a3d7dad3c891e0023373314', '[FOTUS CHARGE] Sem contato',       'reativavel_frio', NULL),
  ('68828a61aeb38a00270655f5', 'Nao responde contato',             'reativavel_frio', NULL),
  ('695404396f76440018e43c2d', 'Nao entrou em contato durante a campanha', 'reativavel_frio', NULL),
  ('6900f0775ab4410013568a5c', 'Encerramento de campanha',         'reativavel_frio', 'fechou sem conclusao'),
  ('6a908f085c3051002fc15e74', 'SDR - Desistencia',                'reativavel_frio', NULL),
  ('6a67975192e993001d2e9310', '[CADASTRO] Desistencia',           'reativavel_frio', NULL),
  ('68c32f2993c35500173f3d52', 'Mercado Reduzido',                 'reativavel_frio', 'decisao Igor 15/set: e "nao agora". Motivo DESCONTINUADO — so cauda historica')
ON CONFLICT (lost_reason_id) DO NOTHING;

-- ── GRUPO 5: CONTATO INVALIDO — chave de match ruim ─────────────────────────
-- Nao sobem: so sujariam a taxa de correspondencia. Reavaliar DEPOIS do
-- enriquecimento via RD CRM — se vier telefone novo, migram para frio.
INSERT INTO ultron.motivos_perda_classificacao (lost_reason_id, nome, grupo) VALUES
  ('6a67982892e993001d2e93fd', '[CADASTRO] Contato invalido',                    'contato_invalido'),
  ('6a3d7e927fd7a3002caa5ca1', '[FOTUS CHARGE] Telefone nao pertence ao responsavel', 'contato_invalido'),
  ('6a3d7da2537ba5001dd68829', '[FOTUS CHARGE] Contato Invalido',                'contato_invalido'),
  ('69fe255be456c50017f1b752', 'Telefone nao pertence ao cliente',               'contato_invalido'),
  ('6883745d7f7d89001e71a915', 'Telefone(s) Invalido(s)',                        'contato_invalido'),
  ('68837449b0cd6800167307a6', 'Telefone cadastrado nao pertence ao Integrador',  'contato_invalido')
ON CONFLICT (lost_reason_id) DO NOTHING;

-- ── Seed dos publicos derivados ─────────────────────────────────────────────
INSERT INTO ultron.publicos_meta (publico, nome_meta, descricao) VALUES
  ('perdidos_reativaveis', 'FOP | Perdidos reativaveis',
   'Perdeu por condicao (preco, pagamento, prazo, estoque, falha nossa) — alvo de OFERTA'),
  ('perdidos_sem_contato', 'FOP | Perdidos sem contato',
   'Cadencia morreu sem resposta — o problema foi canal, nao interesse; alvo de ALCANCE'),
  ('inaptos',              'FOP | Inaptos (exclusao)',
   'CNPJ baixado/inapto/sem CNAE/fora do mercado — EXCLUSAO dura em todas as campanhas')
ON CONFLICT (publico) DO NOTHING;

-- Aposenta o publico generico: virou os tres acima.
UPDATE ultron.publicos_meta SET ativo = false WHERE publico = 'perdidos_sem_compra';

-- ── PENDENTE antes da view (022) ────────────────────────────────────────────
-- Falta UMA verificacao: onde o lost_reason mora no evento. O rd-sync grava o
-- payload inteiro do webhook em public.events.event_data (jsonb), entao o
-- motivo deve estar la — mas isso NAO foi confirmado. Query que resolve:
--
--   SELECT jsonb_pretty(event_data) FROM public.events
--    WHERE event_name = 'OportunidadePerdida' ORDER BY created_at DESC LIMIT 3;
--
-- Confirmado o caminho, a 022 cruza events -> classificacao e materializa
-- perdidos_reativaveis / perdidos_sem_contato / inaptos na vw_publico_meta,
-- e subtrai 'inapto' + 'ruido' de sql_sem_venda e leads_sem_compra.
