-- Seed dos códigos do doc 09 (docs/09-naming-convention.md §3). Idempotente.
INSERT INTO public.codigos_canal (codigo, plataforma, utm_source, utm_medium, gera_via, ordem) VALUES
  ('META',           'meta',     'meta',           'paid-social',  'url_tags',          10),
  ('GOOGLE-SEARCH',  'google',   'google-search',  'cpc',          'final_url_suffix',  20),
  ('GOOGLE-PMAX',    'google',   'google-pmax',    'cpc',          'final_url_suffix',  30),
  ('GOOGLE-YT',      'google',   'google-yt',      'paid-video',   'final_url_suffix',  40),
  ('GOOGLE-DISPLAY', 'google',   'google-display', 'paid-display', 'final_url_suffix',  50),
  ('LINKEDIN',       'linkedin', 'linkedin',       'paid-social',  'adtracking',        60)
ON CONFLICT (codigo) DO UPDATE SET
  plataforma=EXCLUDED.plataforma, utm_source=EXCLUDED.utm_source,
  utm_medium=EXCLUDED.utm_medium, gera_via=EXCLUDED.gera_via, ordem=EXCLUDED.ordem;

INSERT INTO public.codigos_objetivo (codigo, label, ordem) VALUES
  ('ACQ','Aquisição de novos integradores',10),
  ('RET','Retenção e ativação da base',20),
  ('RMKT','Remarketing / retargeting',30),
  ('REC','Reconhecimento / brand',40),
  ('ENG','Engajamento de conteúdo',50),
  ('VAGAS','Recrutamento (RH)',60),
  ('TESTE','Experimento ou validação',70)
ON CONFLICT (codigo) DO UPDATE SET label=EXCLUDED.label, ordem=EXCLUDED.ordem;

INSERT INTO public.codigos_produto (codigo, label, ordem) VALUES
  ('GERAL','Sem produto específico / mix',10),('MICRO','Microinversores',20),
  ('FC','Fotus Charge',30),('HYB','Sistemas Híbridos',40),('FIN','Financiamento',50),
  ('BRAND','Institucional / marca',60),('LOG','Logística / CDs',70)
ON CONFLICT (codigo) DO UPDATE SET label=EXCLUDED.label, ordem=EXCLUDED.ordem;

INSERT INTO public.codigos_publico (codigo, label, ordem) VALUES
  ('NOVOS','Nunca compraram',10),('BASE','Clientes ativos',20),
  ('LAL','Lookalike',30),('RMKT','Pool de retargeting',40),
  ('AMPLO','Público amplo',50),('ABM','Account Based Marketing',60)
ON CONFLICT (codigo) DO UPDATE SET label=EXCLUDED.label, ordem=EXCLUDED.ordem;

INSERT INTO public.codigos_geo (codigo, label, ordem) VALUES
  ('BR','Brasil completo',10),('NE','Nordeste (residual)',20),('SE','Sudeste (residual)',30),
  ('CO','Centro-Oeste (residual)',40),('N','Norte (residual)',50),('S','Sul (residual)',60),
  ('GV','Grande Vitória (ES)',70),
  ('CD-SP','SP — CD',110),('CD-BA','BA — CD',120),('CD-ES','ES — CD',130),('CD-PE','PE — CD',140),
  ('CD-PA','PA — CD',150),('CD-SC','SC — CD',160),('CD-GO','GO — CD',170),('CD-MT','MT — CD',180)
ON CONFLICT (codigo) DO UPDATE SET label=EXCLUDED.label, ordem=EXCLUDED.ordem;
