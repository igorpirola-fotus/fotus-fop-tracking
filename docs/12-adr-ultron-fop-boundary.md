# 12 — ADR: Fronteira ULTRON × FOP-Tracking (fonte única de verdade de receita)

> **ADR** = Architecture Decision Record. Status: **Proposto** (10/06/2026) · Donos: Igor Pirola.
> Origem: a revisão C-Level apontou risco de **duas fontes de verdade conflitantes** de CAC/receita
> sendo construídas em paralelo (ULTRON e FOP). Este documento decide a fronteira **antes** de gastar mais sprints.

---

## Contexto (estado real, confirmado no código)

**`fotus-fop-tracking`** já é a espinha dorsal do lado **demanda + cliente**:
- `sessions` (UTM, gclid, fbp/fbc, GA4 client_id) — origem do tráfego.
- `events` — os **9 eventos do funil** (`PageView → ViewContent → InitiateCheckout → Lead → Contact → Schedule → AddToCart → Purchase`, + `OportunidadePerdida`), com `funnel` (`aquisicao`/`reativacao`), Meta CAPI status e `match_keys`.
- `integradores` — **CNPJ é a chave primária**; carrega `ltv_total`, `ticket_medio`, `numero_pedidos`, `lead_score`, `segmento_rfm`, IDs de RD/ERP/WhatsApp.
- `rfm_snapshots`, `pipeline_snapshots`, `whatsapp_interactions`, `nps_responses`, `lead_score_log`.
- **Ingestão viva:** webhook RD CRM → `rd-sync` (Edge Function) atualiza `integradores` + insere `events` + envia **Meta CAPI** e **GA4**. Dedup por `event_id`.

**`ULTRON FOTUS`** traz o que falta ao FOP — o lado **custo/mídia** — via **ETLs n8n diários (06h)**:
- `etl-meta-ads` → Graph API `/insights` da conta `act_1017764197039855` (spend, impressões, cliques).
- `etl-google-ads`, `etl-ga4`, `etl-rd-station-crm`.
- Knowledge base RD Station (incl. [08-integracao-fop-tracking](../../ULTRON%20FOTUS) já mapeia o fluxo do FOP).

> **O problema:** sem decisão, ULTRON tende a recriar ingestão de RD/eventos que o FOP já faz,
> e o FOP não tem dados de custo. Resultado: dois RevOps, dois CACs, briga de planilhas.

---

## Decisão

**Uma única base. Duas responsabilidades. Uma camada semântica.**

| Camada | Dono | Responsabilidade | Não faz |
|---|---|---|---|
| **Demanda + Cliente** (verdade do "o que aconteceu e quanto vale") | **FOP-Tracking** | `sessions`, `events` (9 do funil), `integradores`, `rfm`, `pipeline`, WhatsApp, NPS. Ingestão RD CRM, Meta CAPI, GA4. | **Não** traz custo de mídia. |
| **Custo de mídia** (verdade do "quanto gastamos") | **ULTRON** (ETLs n8n) | Spend/insights de Meta Ads, Google Ads, GA4 — gravados no schema **`ultron`** (que **já existe**: `ultron.campanhas`, `ultron.eventos_normalizados`) co-localizado na **MESMA** base Supabase do FOP. | **Não** recria ingestão de RD/eventos/CAPI. |
| **Semântica + Métricas** (verdade do "quanto custa e quanto rende") | **ULTRON** (`metrics.yaml` + views) | Junta custo ⨝ conversão ⨝ valor → CAC, ROAS, LTV:CAC, CPL por canal × funil. Definições canônicas únicas. | — |
| **Apresentação** | **ULTRON** | Dashboards (3 camadas) + consulta em linguagem natural via MCP. | — |

**Por que uma base só (schema `ultron` no Supabase do FOP), e não um warehouse separado:**
o aviso central do board é "não crie duas fontes de verdade". Com tudo no mesmo Postgres, o join custo↔conversão é uma `VIEW`, não uma integração frágil entre bancos. Mais barato e à prova de divergência.

> **Estado real (confirmado no `etl-meta-ads`):** o ETL já normaliza e faz UPSERT em `ultron.eventos_normalizados` (`data, plataforma, campanha_id, criativo_id, impressoes, cliques, spend_brl, leads, receita_brl, conversoes_custom`) e `ultron.campanhas` via um nó Postgres ("Postgres account 2"). A decisão **não** é criar tabela nova — é garantir que esse Postgres seja a **base do FOP** e construir o join. Por isso a Sprint A é majoritariamente *repontar uma credencial*, não reescrever ETL.

---

## Como o custo conversa com a conversão (o join)

```
ultron.eventos_normalizados (+ ultron.campanhas)   public.events / public.integradores
────────────────────────────────────────────      ──────────────────────────────────
data, plataforma, campanha_id,          ──UTM──▶   events.utm_campaign / utm_source
spend_brl, impressoes, cliques, leads   ──gclid─▶   sessions.gclid (Google) · fbp/fbc (Meta)
campanhas.utm_campaign / funnel         ──CNPJ──▶   integradores.cnpj  (valor: ltv_total, ticket_medio)
```

- **Chave de cliente:** `integradores.cnpj`.
- **Chave de mídia → conversão:** `ultron.campanhas.utm_campaign` = `public.events.utm_campaign` (e `gclid`/`fbp`), que dependem da **nomenclatura de campanha padronizada** ([09-naming-convention](09-naming-convention.md)).
- **O elo que falta hoje:** o ETL grava `campanha_id`/`campanha_nome` da Meta, mas **não** deriva `utm_campaign`/`funnel`. Esse mapeamento (nome da campanha → utm/funil) é o que liga custo a conversão — feito em `ultron.campanhas` (Sprint B).
- ⚠️ **Pré-requisito crítico:** a auditoria GTM (conversões duplicadas) e a nomenclatura precisam estar corretas — senão o join custo↔evento mente. É a fundação do número.

### Schema `ultron` (já existente — formalizado na migration `010_ads_schema.sql`)
```sql
-- ultron.campanhas: id, plataforma, campanha_id, nome, status,
--                   utm_campaign, funnel, ultima_sync   [UNIQUE(plataforma, campanha_id)]
-- ultron.eventos_normalizados: id, data, plataforma, campanha_id, criativo_id,
--   impressoes, cliques, spend_brl, leads, receita_brl, conversoes_custom, ultima_sync
--   [UNIQUE(data, plataforma, campanha_id, criativo_id)]
-- (DDL completo e RLS em supabase/migrations/010_ads_schema.sql)
```

---

## Consequências

**Positivas:** um CAC único e auditável; ULTRON entrega valor em semanas (não reconstrói nada); FOP segue dono do dado sensível (PII/CNPJ) com RLS; fim da briga de planilhas.

**Trade-offs:** os ETLs n8n do ULTRON passam a depender da base do FOP (credencial de escrita restrita ao schema `ads`); a nomenclatura de campanha vira contrato — quebrou a nomenclatura, quebrou o CAC por canal.

---

## Plano (3 sprints curtos)

| Sprint | Entrega | Resultado |
|---|---|---|
| **A** (1 sem) | Aprovar ADR · aplicar `010_ads_schema.sql` na base do FOP (cria schema `ultron`) · **repontar a credencial Postgres do `etl-meta-ads` para a base do FOP** · validar 1 dia de spend em `ultron.eventos_normalizados` | Custo de mídia vivo na mesma base, sem reescrever ETL |
| **B** (1 sem) | Enriquecer `ultron.campanhas` com `utm_campaign`/`funnel` (nomenclatura) · `metrics.yaml` canônico · view materializada `mv_cac_canal_funil` = **custo real por venda fechada por canal × funil** | O caso de receita ponta a ponta |
| **C** (1 sem) | Expor via MCP (pergunta em linguagem natural) + dashboard 3 camadas + ritual semanal de RevOps | A "sala de comando" da diretoria |

**Pré-requisitos que destravam a precisão:** auditoria GTM fechada + nomenclatura de campanha padronizada.

---

## 🛑 Risco de segurança detectado (P0) — tratar antes de publicar

Durante a análise foram encontrados **segredos vivos em texto plano** no OneDrive:
- `ULTRON FOTUS/.mcp.json`: `META_ACCESS_TOKEN`, `META_APP_ID`, `N8N_API_KEY` (JWT).
- `ULTRON FOTUS/Especialista RD STATION.../.env`: tokens RD.
- (já reportado) `GERENTE DE PROJETOS/.env.example`: Anthropic + Notion.

**Ação:** rotacionar todos, mover para Supabase Secrets / secret manager, garantir `.gitignore` e `.mcp.json.example` só com placeholders. Ver `GERENTE DE PROJETOS/SEGURANCA-SEGREDOS.md`.
