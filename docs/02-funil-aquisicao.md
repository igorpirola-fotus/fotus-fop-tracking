# 02 — Funil de Aquisição (Fase 2: Semanas 3–4)

> Objetivo: todos os 9 eventos do funil de aquisição rodando, Custom Conversion
> "Lead Qualificado Fotus" criada, campanhas otimizando por SQL (não Lead bruto).

---

## Mapa de eventos — funil de aquisição

| # | Evento | Trigger | Fonte | Advanced Matching | Prioridade |
|---|---|---|---|---|---|
| 1 | `PageView` | LP carregada | Web (client + server) | IP, fbp, fbc, UA | Alta |
| 2 | `ViewContent` | Scroll 50% OU 30s | Web (client + server) | + session_id | Alta |
| 3 | `InitiateCheckout` | Foco no 1º campo do form | Web (client + server) | + início de preenchimento | Alta |
| 4 | `Lead` | Submit do form | Web (client + server) | **email + phone + CNPJ + nome + UF** | Crítico |
| 5 | `Contact` | SDR registra contato no RD CRM | RD Webhook → Edge Function | + todos os dados do Lead | Alta |
| 6 | `Schedule` | Lead movido para "Qualificado" | RD Webhook → Edge Function | + dados enriquecidos CNPJ | Alta |
| 7 | `AddToCart` | BDR envia proposta formal | RD Webhook → Edge Function | + valor do orçamento | Média |
| 8 | `Purchase` | Primeiro pedido aprovado no ERP | ERP Webhook → Edge Function | + valor real + CNPJ | Crítico |
| — | `OportunidadePerdida` | Deal marcado como Perdido | RD Webhook | + motivo de perda | Exclusão |

> **Regra do Purchase:** apenas o PRIMEIRO pedido vira `Purchase`.
> Pedidos subsequentes viram `PurchaseRecorrente` para não distorcer o algoritmo de aquisição.

---

## Passo 1 — Configurar webhooks no RD Station CRM

### Criar cada webhook

Acesse: **RD CRM → Administração → Integrações → Webhooks → Criar webhook**

| Webhook | Trigger | URL |
|---|---|---|
| `rd-contato` | Deal muda para etapa "Em Contato" | `https://SEU-PROJECT-ID.supabase.co/functions/v1/rd-sync` |
| `rd-qualificado` | Deal muda para etapa "Qualificado" | `https://SEU-PROJECT-ID.supabase.co/functions/v1/rd-sync` |
| `rd-proposta` | Deal muda para etapa "Proposta Enviada" | `https://SEU-PROJECT-ID.supabase.co/functions/v1/rd-sync` |
| `rd-ganho` | Deal marcado como Ganho | `https://SEU-PROJECT-ID.supabase.co/functions/v1/rd-sync` |
| `rd-perdido` | Deal marcado como Perdido | `https://SEU-PROJECT-ID.supabase.co/functions/v1/rd-sync` |

### Configurar campo customizado CNPJ no RD CRM

O webhook do RD precisa enviar o CNPJ do contato para encontrar o integrador no Supabase.

1. **RD CRM → Configurações → Campos personalizados → Contatos**
2. Criar campo: `cnpj` — tipo Texto
3. Garantir que o SDR preencha o CNPJ ao criar o contato (pode ser obrigatório)

> **Por que isso é crítico:** se o CNPJ não vier no webhook, a Edge Function `rd-sync`
> vai tentar buscar por email — o que pode não funcionar se o email foi diferente.
> CNPJ é a chave primária de todo o sistema.

### Testar um webhook manualmente

1. No RD CRM, crie um deal de teste
2. Mova para "Em Contato"
3. Verifique nos logs do Supabase: **Dashboard → Edge Functions → rd-sync → Logs**
4. Confirme em `events`: novo registro com `event_name = 'Contact'` e `event_source = 'rd_webhook'`

---

## Passo 2 — Configurar campos customizados no RD Marketing

Estes campos recebem dados do Supabase e alimentam segmentação e nutrição:

**RD Marketing → Configurações → Campos de Lead → Criar campo**

| Campo | Tipo | Alimentado por |
|---|---|---|
| `cnpj` | Texto | Form da LP |
| `cnpj_porte` | Seleção (MEI/ME/EPP/GRANDE) | enrich-cnpj |
| `cnae_descricao` | Texto | enrich-cnpj |
| `anos_mercado` | Número | enrich-cnpj |
| `lead_score` | Número | rfm-update / enrich-cnpj |
| `segmento_rfm` | Seleção (VIP/Ativo/Risco/Inativo) | rfm-update |
| `ultima_compra_dias` | Número | erp-sync |
| `ticket_medio` | Número | erp-sync |
| `nps_score` | Número | whatsapp-handler |

---

## Passo 3 — Configurar webhook do ERP (Purchase)

> Esta etapa depende do time de TI. Fornecer ao dev do ERP as instruções abaixo.

### O que o ERP deve enviar

Quando um pedido é aprovado/faturado, o ERP deve fazer um POST para:

```
POST https://SEU-PROJECT-ID.supabase.co/functions/v1/erp-sync
Content-Type: application/json

{
  "event_type": "purchase_approved",
  "cnpj": "11222333000181",
  "order_id": "PED-2025-001",
  "order_value": 15000.00,
  "is_first_order": true
}
```

> O campo `is_first_order` é crítico — apenas o primeiro pedido vira `Purchase` no Meta.

### Autenticação do webhook ERP

Para garantir que apenas o ERP pode chamar a Edge Function, adicionar validação de secret:

```bash
supabase secrets set ERP_WEBHOOK_SECRET=fotus_erp_webhook_secret_2025
```

A Edge Function `erp-sync` já verifica o header `X-Webhook-Secret`.

---

## Passo 4 — Criar Custom Conversion "Lead Qualificado Fotus"

Esta é a conversão que as campanhas vão otimizar. Não Lead bruto — SQL.

1. **Gerenciador de Eventos → Custom Conversions → Criar**
2. Nome: `Lead Qualificado Fotus`
3. Tipo: Evento do pixel
4. Evento base: **Schedule** (lead movido para "Qualificado" no RD)
5. Nenhuma regra adicional necessária

> **Por que Schedule?** É quando o SDR confirma que o lead é um SQL (Sales Qualified Lead).
> Neste ponto o integrador tem CNPJ solar confirmado, porte adequado e interesse real.
> Leads brutos incluem curiosos, concorrentes e dados inválidos.

---

## Passo 5 — Atualizar campanhas Meta

### Antes de mudar o objetivo das campanhas

Coletar baseline de CPL e CPA com o objetivo atual (Lead bruto):
- [ ] CPL médio (últimos 30 dias): R$ ___
- [ ] Número de Leads/mês: ___
- [ ] Anotar data da mudança: ___ / ___ / ___

### Alterar objetivo das campanhas de aquisição

Para cada campanha de aquisição ativa:

1. **Nível da campanha:** objetivo mantido como "Leads" ou "Conversões"
2. **Nível do conjunto de anúncios:** trocar o evento de otimização
   - De: `Lead` (evento padrão)
   - Para: `Lead Qualificado Fotus` (Custom Conversion criada no Passo 4)
3. **Orçamento:** não alterar inicialmente — comparar CPA-SQL vs CPL anterior

> ⚠️ **A campanha vai entrar em learning phase por 7–14 dias.**
> Não fazer alterações durante este período. Ter pelo menos 50 eventos de
> "Lead Qualificado Fotus"/semana é o mínimo para sair da learning phase.

### Configurar exclusões de audiência

Em **todas** as campanhas de aquisição, excluir:
- Audiência baseada em `IntegradorAtivo` (180 dias)
- Audiência baseada em `IntegradorVIP` (365 dias)

Isso evita gastar budget de aquisição em clientes já ativos.

---

## Passo 6 — Configurar o Aggregated Event Measurement (AEM)

O AEM define quais eventos são prioritários para o Meta quando o usuário está em iOS 14+.

1. **Gerenciador de Eventos → seu Pixel → Configurações → Configurar eventos da web**
2. Adicionar eventos em ordem de prioridade (máx 8):

| Prioridade | Evento | Motivo |
|---|---|---|
| 1 | Purchase | Conversão mais valiosa — nunca negociar esta posição |
| 2 | Lead Qualificado Fotus (Schedule) | SQL — objetivo principal das campanhas |
| 3 | Contact | SQL em processo de qualificação |
| 4 | Lead | Topo do funil |
| 5 | InitiateCheckout | Intenção de conversão |
| 6 | ViewContent | Engajamento qualificado |
| 7 | AddToCart | Proposta enviada |
| 8 | PageView | Alcance |

---

## Passo 7 — Testes de validação

### Teste de ViewContent e InitiateCheckout

Abrir a LP em aba anônima com DevTools (Network):

1. Aguardar **30 segundos** sem interagir
   - ✅ Verificar POST para `track-event` com `event_name: "ViewContent"`
2. Clicar no primeiro campo do formulário
   - ✅ Verificar POST com `event_name: "InitiateCheckout"`
3. Preencher e enviar o form
   - ✅ Verificar POST com `event_name: "Lead"` + dados PII

### Teste de webhook RD

1. Mover deal de teste para "Em Contato" no RD CRM
2. Verificar em `events`: `Contact` com `event_source = 'rd_webhook'`
3. Verificar no Events Manager: evento chegou via "Servidor"

### Teste de Purchase via ERP (com time de TI)

```bash
# Simular webhook do ERP
curl -X POST https://SEU-PROJECT-ID.supabase.co/functions/v1/erp-sync \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: fotus_erp_webhook_secret_2025" \
  -d '{
    "event_type": "purchase_approved",
    "cnpj": "11222333000181",
    "order_id": "PED-TESTE-001",
    "order_value": 8500.00,
    "is_first_order": true
  }'
```

✅ Verificar: `events` com `event_name = 'Purchase'` e `meta_capi_status = 'sent'`

---

## Checklist de conclusão da Fase 2

- [ ] ViewContent disparando (scroll 50% OU 30s)
- [ ] InitiateCheckout disparando ao focar no primeiro campo
- [ ] 5 webhooks do RD CRM criados e testados
- [ ] Campo `cnpj` criado nos contatos do RD CRM
- [ ] 9 campos customizados criados no RD Marketing
- [ ] Webhook ERP configurado e testado com TI
- [ ] Custom Conversion "Lead Qualificado Fotus" criada
- [ ] AEM configurado com 8 eventos em ordem de prioridade
- [ ] Campanhas atualizadas para otimizar por "Lead Qualificado Fotus"
- [ ] Exclusões de audiência ativas (clientes atuais excluídos das aquisições)
- [ ] Todos os eventos chegando com MQ ≥ 7.5 no Events Manager
- [ ] `meta_capi_status = 'sent'` para ≥ 95% dos eventos nos últimos 7 dias
