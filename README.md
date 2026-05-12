# FOP Tracking — Fotus Distribuidora Solar

**Funil de Otimização de Pixel** com tracking server-side completo via Meta CAPI + RD Station + WhatsApp API + ERP, integrados pelo Supabase como hub central de dados.

---

## O que este projeto entrega

| O que | Por quê importa |
|---|---|
| Match Quality de ~6.0 → ≥ 8.5 no Lead | O algoritmo Andromeda usa qualidade de sinal no retrieval antes do leilão |
| Funil completo de 9 eventos (3 funis) | Otimização por SQL (Lead Qualificado Fotus), não por Lead bruto |
| RFM mensal + Custom Events Meta | Lookalike de VIP substitui lookalike de Lead genérico |
| Lead scoring 0–100 automático | SDR prioriza quem vale a pena ligar em 2h |
| Rastreamento server-side imune a ad blocker / iOS | Dados confiáveis para decisões de budget |

---

## Pré-requisitos

### Acessos necessários (coletar antes de começar)

| Sistema | Acesso mínimo | Onde obter |
|---|---|---|
| Meta Business Manager | Admin do BM | business.facebook.com |
| Meta Events Manager | Pixel ID + Token CAPI | Gerenciador de Eventos → seu Pixel → Configurações → API de Conversões |
| Supabase | Owner do projeto | supabase.com |
| RD Station CRM | Admin | Administração → Integrações → API |
| RD Station Marketing | Admin | Conta → API Token |
| WhatsApp Business API | Admin WABA | Meta Business → WhatsApp |
| ERP Fotus | Dev/Admin para webhook | Solicitar ao time de TI |
| Cloudflare | Zona configurada na LP | (já existente) |

### Ferramentas locais

```bash
# Node.js ≥ 18
node --version

# Supabase CLI
npm install -g supabase
supabase --version

# Git
git --version
```

---

## Estrutura do repositório

```
fotus-fop-tracking/
├── README.md                        ← você está aqui
├── docs/
│   ├── 00-baseline.md               ← métricas atuais (preencher antes de começar)
│   ├── 01-setup-supabase.md         ← passo a passo do banco e Edge Functions
│   ├── 02-funil-aquisicao.md        ← eventos + LP + webhooks RD
│   ├── 03-funil-reativacao.md       ← mecanismo de re-hidratação
│   ├── 04-rfm-scoring.md            ← cron mensal + audiências Meta
│   ├── 05-whatsapp.md               ← fluxos de qualificação e NPS
│   ├── 06-dashboard.md              ← queries + Looker Studio
│   └── 07-runbook.md                ← operação contínua e troubleshooting
├── supabase/
│   ├── migrations/
│   │   ├── 001_core_tables.sql
│   │   ├── 002_indexes.sql
│   │   ├── 003_rls.sql
│   │   ├── 004_triggers.sql
│   │   └── 005_006_google_stack.sql ← gclid, ga4_client_id, gmb_reviews
│   └── functions/
│       ├── _shared/
│       │   ├── capi-sender.ts       ← hash SHA-256 + retry CAPI Meta
│       │   ├── ga4-sender.ts        ← Measurement Protocol GA4
│       │   └── google-ads-sender.ts ← Enhanced Conversions for Leads
│       ├── track-event/index.ts     ← recebe eventos da LP (Meta + GA4 + GAds)
│       ├── rd-sync/index.ts         ← webhooks RD CRM → Meta + GA4
│       ├── erp-sync/index.ts        ← webhooks ERP → Meta + GA4 (Purchase)
│       ├── hydrate-integrador/index.ts
│       ├── enrich-cnpj/index.ts
│       ├── rfm-update/index.ts      ← cron mensal
│       ├── whatsapp-handler/index.ts
│       └── gmb-sync/index.ts        ← cron diário reviews Google Meu Negócio
├── lp/
│   └── tracking.js                  ← script de captura client-side para a LP
└── scripts/
    ├── test-phase1.sh               ← testes da Fase 1 via curl
    ├── test-phase2.sh               ← testes da Fase 2
    └── validate-mq.sql              ← queries de validação Match Quality
```

---

## Plano de execução (90 dias + Google)

| Fase | Semana | Entregável | Critério de avanço |
|---|---|---|---|
| **0 — Baseline** | 0 | Métricas documentadas, acessos confirmados | Todas as credenciais em mãos |
| **1 — Fundação** | 1–2 | Supabase + Lead server-side | MQ Lead ≥ 8.5 |
| **2 — Funil aquisição** | 3–4 | 9 eventos + webhooks RD/ERP + Custom Conversion | CPA-SQL sendo rastreado |
| **2B — Stack Google** | 3–4 | GA4 + Enhanced Conversions + GMB + YouTube | gclid capturado, conversões GA4 importadas |
| **3 — Reativação** | 5–8 | Funil de reativação + re-hidratação | Taxa reativação ↑ 2–3x |
| **4 — RFM + Audiências** | 9–12 | Cron RFM + Custom Events Meta + Lookalike VIP | CAC ↓ 15–30% |
| **5 — Operação** | contínuo | Dashboard + monitoramento | Pixel client-side desligado |

> A fase **2B** roda em paralelo com a Fase 2 — não bloqueia o funil Meta.

---

## Regras críticas — nunca violar

1. **Hash obrigatório** — email, phone e CNPJ sempre SHA-256 antes de enviar ao Meta
2. **CNPJ como PK** — chave única em todas as tabelas; nunca duplicar integrador
3. **event_id compartilhado** — mesmo UUID gerado no client repassado ao server (deduplicação Meta)
4. **RLS ativo** — frontend nunca acessa o banco diretamente; só `service_role`
5. **30 dias em paralelo** — nunca desligar Pixel client-side antes de 30 dias rodando com CAPI
6. **Nunca otimizar por Lead bruto** — objetivo das campanhas = Custom Conversion "Lead Qualificado Fotus"
7. **LGPD** — dados de PF (email, telefone) exigem base legal documentada; CNPJ é dado empresarial

---

## Stack completa

| Camada | Ferramenta | Função |
|---|---|---|
| Hub central | Supabase (sa-east-1) | Banco + Edge Functions + orquestração |
| DNS/Geo | Cloudflare | Headers CF-IPCountry, CF-IPCity, zero latência |
| Meta | CAPI v18+ | Eventos server-side hasheados, MQ ≥ 8.5 |
| Google | GA4 Measurement Protocol | Atribuição cross-canal, YouTube, Google Ads |
| Google | Enhanced Conversions for Leads | Upload offline de SQL e Purchase via Google Ads API |
| Google | Google Meu Negócio | Reviews de CDs sincronizados no Supabase |
| YouTube | YouTube Ads | Top/mid funil, view-through 30 dias, retargeting |
| CRM | RD Station CRM + Marketing API v2 | Funil comercial, automações, campos customizados |
| WhatsApp | WhatsApp Business API | Qualificação, reativação, NPS |
| Enriquecimento | BrasilAPI (grátis) | CNPJ → dados fiscais/cadastrais |
| Analytics | Looker Studio / Metabase | Dashboard executivo |

## Variáveis de ambiente completas

```bash
# META
supabase secrets set META_PIXEL_ID=123456789012345
supabase secrets set META_CAPI_TOKEN=EAAxxxxxx

# RD STATION
supabase secrets set RD_API_TOKEN=xxxxxx

# WHATSAPP
supabase secrets set WHATSAPP_TOKEN=EAAxxxxxx
supabase secrets set WHATSAPP_PHONE_ID=1234567890
supabase secrets set WHATSAPP_VERIFY_TOKEN=fotus_wh_verify_2025

# GOOGLE ADS
supabase secrets set GA4_MEASUREMENT_ID=G-XXXXXXXXXX
supabase secrets set GA4_API_SECRET=xxxxxxxxxxxx
supabase secrets set GADS_CONVERSION_ID=AW-XXXXXXXXX
supabase secrets set GADS_CONVERSION_LABEL_LEAD=AbCdEfGhIj
supabase secrets set GADS_CONVERSION_LABEL_SQL=KlMnOpQrSt
supabase secrets set GADS_CONVERSION_LABEL_PURCHASE=UvWxYzAbCd
supabase secrets set GADS_DEVELOPER_TOKEN=xxxxxxxxxxxx
supabase secrets set GADS_CUSTOMER_ID=1234567890

# GOOGLE MEU NEGÓCIO (service account JSON como string)
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

---

## Contato e manutenção

**Responsável técnico:** Igor — Analista de Mídia Performance  
**Documentação complementar:** [Notion FOP Tracking](https://www.notion.so/35e955ef6fa581a9bb5fea6e1728c3e6)
