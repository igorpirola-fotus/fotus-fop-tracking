# CLAUDE.md — FOP Tracking Fotus

Este arquivo é lido pelo Claude Code no início de cada sessão.
Contém as convenções, regras e contexto que devem guiar toda geração de código neste projeto.

---

## Contexto do projeto

**Empresa:** Fotus Distribuidora Solar — Vila Velha, ES  
**Mercado:** B2B solar. Os clientes são integradores (instaladores) em todo o Brasil.  
**Responsável:** Igor — Analista de Mídia Performance  
**Objetivo:** tracking server-side completo com Advanced Matching propagado em todos os eventos do funil, integrando Meta CAPI + Google Ads + GA4 + RD Station + WhatsApp API + ERP via Supabase como hub central.

**Leia antes de qualquer tarefa:**
- `docs/00-baseline.md` — métricas atuais e acessos
- `docs/01-setup-supabase.md` — setup da infraestrutura
- `docs/08-google-stack.md` — stack Google (GA4, Enhanced Conversions, GMB, YouTube)
- O arquivo de referência relevante em `docs/` para a fase em que a tarefa se enquadra

---

## Stack técnica

| Componente | Tecnologia |
|---|---|
| Banco + Edge Functions | Supabase (sa-east-1) — TypeScript/Deno |
| DNS/SSL/Geo | Cloudflare (headers CF-IPCountry, CF-IPCity, CF-IPRegion) |
| Meta CAPI | API Graph v18+, SHA-256 |
| Google Ads | Enhanced Conversions for Leads, API v17 |
| GA4 | Measurement Protocol (fire-and-forget) |
| Google Meu Negócio | My Business API (cron diário) |
| CRM | RD Station CRM + Marketing API v2 |
| WhatsApp | WhatsApp Business API (Graph v18) |
| Enriquecimento CNPJ | BrasilAPI (gratuito, sem chave) |
| Client-side | JavaScript vanilla (sem framework) |

---

## Regras absolutas — nunca violar

Estas regras são inegociáveis. Se uma tarefa exigir violar qualquer uma, pare e avise antes de prosseguir.

### 1. Hash SHA-256 obrigatório em todos os dados PII
Antes de qualquer envio ao Meta, Google Ads ou qualquer API externa:
- `email` → `hashValue(email.toLowerCase().trim())`
- `phone` → `hashValue(normalizePhone(phone))` — sempre E.164 (+5527...)
- `nome` → split em fn/ln, hash individual
- `cidade`, `estado`, `cep` → hash individual
- **NUNCA** enviar PII em texto claro para qualquer API

```typescript
// CORRETO
ud.em = [await hashValue(params.email)]

// ERRADO — jamais fazer isso
body: JSON.stringify({ email: params.email })
```

### 2. CNPJ como chave primária universal
- Toda operação de upsert/update de integrador usa `cnpj` como chave
- CNPJ sempre limpo (só dígitos): `cnpj.replace(/\D/g, '')`
- Nunca criar duplicata de integrador — sempre verificar existência antes de insertar

### 3. event_id único compartilhado entre client e server
- O UUID é gerado no client (`crypto.randomUUID()`)
- O mesmo UUID vai no `fbq('track', ...)` client-side E no body da chamada ao Edge
- A Edge Function armazena e repassa ao Meta/Google para deduplicação
- **Sem event_id = sem deduplicação = eventos duplicados**

### 4. RLS ativo — service_role em todas as operações de banco
- Todas as Edge Functions usam `SUPABASE_SERVICE_ROLE_KEY`
- Nunca usar `SUPABASE_ANON_KEY` em Edge Functions
- Frontend nunca acessa o banco diretamente — sempre via Edge Function
- Todas as tabelas têm RLS ativo (conferir migrations 003)

### 5. Secrets nunca no código
- Variáveis de ambiente sempre via `Deno.env.get('NOME_DA_VAR')`
- Nunca hardcodar tokens, IDs ou chaves no código
- Para adicionar nova secret: `supabase secrets set NOME=valor`
- O arquivo `.env.example` documenta as variáveis sem valores

### 6. Pixel client-side em paralelo por 30 dias
- Nunca remover ou comentar o `fbq('track', ...)` client-side
- O tracking server-side é ADICIONAL, não substituto
- A deduplicação (via event_id) garante que o Meta não conta em dobro
- Só remover o client-side após aprovação explícita do Igor

### 7. Purchase = apenas primeiro pedido
- `is_first_order: true` no webhook ERP → evento `Purchase`
- Pedidos subsequentes → evento `PurchaseRecorrente`
- Isso protege o algoritmo de otimização de aquisição

### 8. Campanhas nunca otimizam por Lead bruto
- O objetivo das campanhas de aquisição é a Custom Conversion "Lead Qualificado Fotus"
- Essa Custom Conversion é baseada no evento `Schedule` (SQL no RD CRM)
- Nunca sugerir otimização por `Lead` padrão

---

## Convenções de código

### Nomenclatura
```
Banco de dados (PostgreSQL): snake_case
  ex: integrador_id, data_ultima_compra, meta_capi_status

TypeScript / JavaScript: camelCase
  ex: integradorId, dataUltimaCompra, metaCAPIStatus

Nomes de Edge Functions: kebab-case
  ex: track-event, rd-sync, enrich-cnpj, rfm-update
```

### Estrutura obrigatória de toda Edge Function

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!  // sempre service_role
)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // lógica principal aqui

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: 200
    })

  } catch (error) {
    // todo erro vai para error_logs — nunca silenciar erros críticos
    await supabase.from('error_logs').insert({
      function_name: 'nome-da-funcao',  // ← atualizar com nome real
      error_message: error.message,
      payload: null   // ou: await req.clone().json().catch(() => null)
    }).catch(() => {})  // o log em si não pode quebrar o handler

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }
})
```

### Imports de helpers compartilhados

```typescript
// Sempre importar do _shared — nunca duplicar lógica
import { sendToCAPI, buildUserData, hashValue, normalizePhone } from '../_shared/capi-sender.ts'
import { sendToGA4 } from '../_shared/ga4-sender.ts'
// google-ads-sender.ts (quando Enhanced Conversions for Leads for implementado)
```

### Retry CAPI — padrão obrigatório
- Máximo 3 tentativas
- Backoff exponencial: 1s, 2s, 4s
- Implementado em `_shared/capi-sender.ts` — usar sempre, nunca reimplementar

### GA4 — sempre fire-and-forget
```typescript
// CORRETO — não bloqueia o fluxo principal
sendToGA4({ ... }).catch(() => {})
// ou sem await, a função já trata internamente

// ERRADO — GA4 não deve ser crítico para o fluxo
await sendToGA4({ ... })  // não fazer isso
```

### Rate limiting no Meta CAPI (eventos em batch)
Quando enviar múltiplos eventos em sequência (ex: cron RFM):
```typescript
// Adicionar delay entre eventos para não estourar rate limit
await new Promise(r => setTimeout(r, 100))  // 100ms entre eventos
```

---

## Arquitetura de dados

### Tabelas e suas funções

| Tabela | Chave | Escrito por | Lido por |
|---|---|---|---|
| `sessions` | `session_id` (text) | `track-event` | analytics, scoring |
| `integradores` | `cnpj` (text unique) | `track-event`, `rd-sync`, `erp-sync` | todas |
| `events` | `event_id` (text unique) | todas as funções | analytics, dashboard |
| `rfm_snapshots` | `(integrador_id, snapshot_date)` | `rfm-update` | Meta audiências |
| `whatsapp_interactions` | `id` (uuid) | `whatsapp-handler` | analytics, NPS |
| `pipeline_snapshots` | `(snapshot_date, stage_name)` | `erp-sync` | forecast |
| `nps_responses` | `id` (uuid) | `whatsapp-handler` | scoring, GMB |
| `lead_score_log` | `id` (uuid) | `enrich-cnpj`, `rfm-update` | SDR |
| `error_logs` | `id` (uuid) | todas | monitoramento |
| `gmb_reviews` | `google_review_id` (text unique) | `gmb-sync` | NPS, reputação |

### Fluxo de dados principal

```
LP (browser)
  → tracking.js gera event_id UUID
  → fbq('track', eventName, data, { eventID: event_id })   ← client-side (paralelo 30d)
  → fetch(EDGE_URL, { body: { event_id, event_name, ... } }) ← server-side

track-event (Edge Function)
  → upsert sessions (UTM, geo, fbp, fbc, gclid, ga4_client_id)
  → Se Lead: upsert integradores (CNPJ como chave)
  → Se novo integrador: dispara enrich-cnpj (async, não bloqueia)
  → insert events (pending)
  → sendToCAPI() → atualiza events (sent/failed)
  → sendToGA4() → fire-and-forget
  → return 200 imediato (não espera GA4)
```

### Geo — ordem de prioridade
1. Cloudflare headers (`CF-IPCountry`, `CF-IPRegion`, `CF-IPCity`) — zero latência, sempre primeiro
2. ipapi.co — quando precisar de ISP ou VPN detection
3. ViaCEP — quando CEP vier do formulário (dado mais preciso)

---

## Funil de eventos

### Funil 1 — Aquisição

| Evento Meta | Trigger | action_source |
|---|---|---|
| `PageView` | LP carregada | `website` |
| `ViewContent` | Scroll 50% OU 30s | `website` |
| `InitiateCheckout` | Foco no 1º campo do form | `website` |
| `Lead` | Submit do form | `website` |
| `Contact` | Webhook RD: etapa "Em Contato" | `crm` |
| `Schedule` | Webhook RD: etapa "Qualificado" | `crm` |
| `AddToCart` | Webhook RD: etapa "Proposta Enviada" | `crm` |
| `Purchase` | Webhook ERP: primeiro pedido aprovado | `crm` |
| `OportunidadePerdida` | Webhook RD: deal Perdido | `crm` |

### Funil 2 — Reativação (inativos 90d+)
LP específica com `?iid={integrador_id}`. Re-hidratação via `hydrate-integrador`.
MQ alvo: 9.0+ desde o primeiro PageView.

### Funil 3 — Retenção (cron mensal)
Eventos custom disparados pelo `rfm-update`. Usados APENAS para audiências, nunca como objetivo de campanha:
`IntegradorVIP`, `IntegradorAtivo`, `IntegradorRisco`, `IntegradorExpansao`, `IntegradorNPS9`

---

## Comandos de desenvolvimento

```bash
# Iniciar ambiente local
supabase start

# Servir função específica para teste local
supabase functions serve track-event --env-file .env.local

# Deploy de função específica
supabase functions deploy track-event

# Deploy de todas as funções
supabase functions deploy

# Aplicar migrations ao banco remoto
supabase db push

# Ver logs em tempo real de uma função
supabase functions logs track-event --tail

# Listar secrets configuradas
supabase secrets list

# Configurar nova secret
supabase secrets set NOME_DA_VAR=valor

# Testar Fase 1
bash scripts/test-phase1.sh https://SEU-PROJECT-ID.supabase.co

# Testar Fase 2
bash scripts/test-phase2.sh https://SEU-PROJECT-ID.supabase.co

# Validar Match Quality (rodar no SQL Editor do Supabase)
# Arquivo: scripts/validate-mq.sql
```

---

## Como criar uma nova Edge Function

Seguir sempre esta sequência:

1. Criar o arquivo em `supabase/functions/NOME-DA-FUNCAO/index.ts`
2. Usar a estrutura obrigatória (serve + try/catch + error_logs)
3. Importar helpers de `../_shared/` — nunca duplicar lógica
4. Adicionar o deploy no README se for função nova
5. Testar localmente com `supabase functions serve`
6. Fazer deploy com `supabase functions deploy NOME-DA-FUNCAO`
7. Testar em produção com curl (ver padrão em `scripts/`)
8. Verificar nos logs: `supabase functions logs NOME-DA-FUNCAO --tail`

---

## Como criar uma nova migration SQL

1. Criar arquivo em `supabase/migrations/00N_descricao.sql` (N = próximo número)
2. Incluir: CREATE TABLE + índices + RLS + trigger de updated_at (quando aplicável)
3. Toda nova tabela tem RLS ativo com policy `service_role_only`
4. Toda nova tabela com `updated_at` tem trigger `update_updated_at()`
5. Aplicar: `supabase db push`
6. Verificar no Dashboard que a tabela aparece corretamente

```sql
-- Template de nova tabela
CREATE TABLE nova_tabela (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- campos aqui
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE nova_tabela ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON nova_tabela FOR ALL USING (auth.role() = 'service_role');

CREATE TRIGGER trg_nova_tabela_updated_at
  BEFORE UPDATE ON nova_tabela
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Mapa de secrets necessárias

```
# Meta
META_PIXEL_ID              ID do Pixel (numérico)
META_CAPI_TOKEN            Token de acesso da API de Conversões (token de sistema, não expira)

# RD Station
RD_API_TOKEN               Token da API do RD Marketing v2

# WhatsApp
WHATSAPP_TOKEN             Token permanente do WABA (sistema, não usuário)
WHATSAPP_PHONE_ID          ID do número de telefone da Fotus
WHATSAPP_VERIFY_TOKEN      Token de verificação do webhook (definido por nós)

# Google Ads
GA4_MEASUREMENT_ID         G-XXXXXXXXXX
GA4_API_SECRET             Secret do Measurement Protocol
GADS_CONVERSION_ID         AW-XXXXXXXXX
GADS_CONVERSION_LABEL_LEAD     label da conversão Lead no Google Ads
GADS_CONVERSION_LABEL_SQL      label da conversão SQL (Schedule)
GADS_CONVERSION_LABEL_PURCHASE label da conversão Purchase
GADS_DEVELOPER_TOKEN       Token de desenvolvedor da Google Ads API
GADS_CUSTOMER_ID           ID do cliente Google Ads (sem hífens)

# Google Meu Negócio
GOOGLE_SERVICE_ACCOUNT_JSON    JSON completo da service account (como string)

# ERP
ERP_WEBHOOK_SECRET         Secret para validar webhooks do ERP
```

---

## O que fazer quando houver dúvida

1. **Sobre o negócio / estratégia** → perguntar ao Igor antes de implementar
2. **Sobre o banco** → consultar `supabase/migrations/001_core_tables.sql` para ver o schema real
3. **Sobre padrão de código** → ver `supabase/functions/_shared/capi-sender.ts` como referência
4. **Sobre o funil de eventos** → ver `docs/02-funil-aquisicao.md` e `docs/03-funil-reativacao.md`
5. **Sobre a stack Google** → ver `docs/08-google-stack.md`
6. **Sobre operação e alertas** → ver `docs/07-runbook.md`

**Quando não souber se uma mudança é segura → não implementar e perguntar.**

---

## O que este projeto NÃO faz (para não inventar)

- Não tem autenticação de usuário final (não é SaaS)
- Não tem frontend de admin — o dashboard é Looker Studio conectando direto no banco
- Não usa GTM server-side — o server-side é via Edge Functions Supabase
- Não usa Segment, mParticle ou CDP externo — o Supabase é o hub de dados
- Não tem fila de mensagens (SQS, Pub/Sub) — o retry é feito na própria Edge Function
- Não tem ambiente de staging separado — usar o Test Event Code do Meta para testes

---

## Fase atual do projeto

> Atualizar esta seção conforme o projeto avança.

| Fase | Status |
|---|---|
| 0 — Baseline e acessos | ☐ não iniciado |
| 1 — Supabase + Lead server-side | ☐ não iniciado |
| 2 — Funil completo + webhooks | ☐ não iniciado |
| 2B — Stack Google | ☐ não iniciado |
| 3 — Funil de reativação | ☐ não iniciado |
| 4 — RFM + audiências Meta | ☐ não iniciado |
| 5 — Operação contínua | ☐ não iniciado |

**Critério de avanço da Fase 1 → 2:** Match Quality Lead ≥ 8.5 no Events Manager após 48h de tráfego real.
