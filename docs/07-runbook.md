# 07 — Runbook de Operação Contínua

> Este documento é para o dia a dia após a implementação. Quem opera o projeto
> deve ler isto antes de qualquer intervenção no sistema.

---

## Rotina semanal (toda segunda-feira)

### 1. Verificar saúde do CAPI (5 min)

Executar no Supabase SQL Editor:
```sql
-- Eventos com falha nos últimos 7 dias
SELECT event_name, COUNT(*) as falhos
FROM events
WHERE meta_capi_status = 'failed'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY event_name;
```

Se houver falhas: verificar `error_logs` → investigar a causa → o retry automático já tentou 3x.

### 2. Verificar Match Quality no Meta (3 min)

1. Gerenciador de Eventos → Lead → Qualidade da Correspondência
2. Meta de referência: ≥ 8.5
3. Se caiu abaixo de 7.5: verificar se normalização de phone/email está funcionando

### 3. Verificar leads sem enriquecimento (2 min)

```sql
SELECT COUNT(*) FROM integradores
WHERE razao_social IS NULL AND created_at < NOW() - INTERVAL '1 hour';
```
Se > 0: BrasilAPI pode estar instável → testar manualmente: `curl https://brasilapi.com.br/api/cnpj/v1/11222333000181`

### 4. Verificar reviews GMB sem resposta (2 min)

```sql
SELECT location_name, rating, reviewer_name, published_at
FROM gmb_reviews
WHERE reply_pending = TRUE
ORDER BY published_at ASC;
```
Reviews sem resposta há mais de 48h → acionar time de atendimento.

---

## Rotina mensal (dia 2 de cada mês)

### 1. Verificar execução do cron RFM (dia 1)

```bash
# Verificar se o cron rodou no dia 1
supabase functions logs rfm-update --since 2025-XX-01
```

```sql
-- Confirmar snapshots do mês
SELECT COUNT(*) FROM rfm_snapshots WHERE snapshot_date = CURRENT_DATE - 1;
-- Deve ter pelo menos N registros (N = total de integradores com pedidos)
```

### 2. Atualizar baseline de métricas

Preencher na planilha de baseline (`docs/00-baseline.md`):
- CPL mês anterior
- CPA-SQL mês anterior
- Novos clientes
- Taxa de reativação
- Match Quality médio

### 3. Revisar distribuição RFM

```sql
SELECT segmento_rfm, COUNT(*) as total,
       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as pct
FROM integradores
WHERE numero_pedidos > 0
GROUP BY segmento_rfm ORDER BY total DESC;
```
VIP deve ser ≈20% dos clientes. Se desviar muito, revisar thresholds de quintil.

---

## Alertas críticos e respostas

### Alerta: `meta_capi_status = 'failed'` acima de 5%

**Causa mais comum:** token CAPI expirou (tokens de usuário expiram em 60 dias)

**Solução:**
1. Gerenciador de Eventos → seu Pixel → Configurações → API de Conversões
2. Regenerar token (usar token de sistema — não expira)
3. `supabase secrets set META_CAPI_TOKEN=NOVO_TOKEN`
4. Redeploy: `supabase functions deploy`

### Alerta: Webhooks do RD parando de chegar

**Causa mais comum:** URL da Edge Function mudou após redeploy, ou RD deletou o webhook

**Solução:**
1. Verificar URL atual: `supabase functions list`
2. Recriar webhooks no RD CRM com URL correta
3. Testar manualmente com cURL (ver `scripts/test-phase2.sh`)

### Alerta: Enriquecimento CNPJ falhando em massa

**Causa:** BrasilAPI com instabilidade (acontece esporadicamente)

**Solução:**
1. Monitorar status: [brasilapi.com.br](https://brasilapi.com.br)
2. Leads sem enriquecimento não são perdidos — ficam em `integradores` sem `razao_social`
3. Quando BrasilAPI voltar, re-enriquecer manualmente:

```bash
# Re-enriquecer integradores sem razao_social
supabase functions invoke enrich-cnpj --body '{"integrador_id": "UUID", "cnpj": "CNPJ"}'
```

### Alerta: RFM cron não rodou no dia 1

**Causa:** cron mal configurado ou Edge Function com erro

**Executar manualmente:**
```bash
supabase functions invoke rfm-update --no-verify-jwt
```

---

## Como fazer deploy de atualização segura

Nunca fazer deploy diretamente em produção sem testar. Sequência:

```bash
# 1. Testar localmente
supabase start
supabase functions serve track-event

# 2. Testar com Test Event Code do Meta
# Adicionar TEST_EVENT_CODE temporariamente no código

# 3. Deploy
supabase functions deploy track-event

# 4. Monitorar logs por 30 minutos
supabase functions logs track-event --tail

# 5. Verificar no Supabase Dashboard que events continuam chegando com status 'sent'
```

---

## Quando desligar o Pixel client-side

**Pré-requisitos (todos devem estar OK):**
- [ ] CAPI rodando há pelo menos 30 dias
- [ ] MQ Lead ≥ 8.5 consistente (não apenas pico)
- [ ] Deduplicação verificada: sem inflação de eventos no Events Manager
- [ ] fbp e fbc sendo capturados via JS e repassados ao server (esses campos só existem no client)
- [ ] Aprovação da liderança documentada

**O que NÃO remover:**
- O `fbq('init', ...)` deve continuar — ele cria o cookie `_fbp` que é capturado pelo JS
- O `fbq('track', 'PageView')` pode ser removido, pois o server já envia
- Na prática: remover apenas as chamadas `fbq('track', ...)` para eventos que agora são server-side
- Manter `fbq('init', ...)` e o snippet base para geração do `_fbp`

---

## Manutenção das variáveis de ambiente

```bash
# Listar todas as secrets atuais
supabase secrets list

# Atualizar uma secret específica (não afeta as outras)
supabase secrets set META_CAPI_TOKEN=NOVO_TOKEN

# Após atualizar secrets, redeploy é necessário
supabase functions deploy
```

---

## Backup e recuperação

O Supabase faz backup automático diário. Para backup manual do schema:

```bash
# Exportar schema
supabase db dump --schema-only > backup_schema_$(date +%Y%m%d).sql

# Exportar dados (cuidado com LGPD — não committar no Git)
supabase db dump --data-only > backup_data_$(date +%Y%m%d).sql
```

---

## Contatos de suporte

| Problema | Quem acionar |
|---|---|
| Meta Ads / CAPI | Suporte Meta Business (via chat no BM) |
| Supabase | supabase.com/support (plano Pro inclui suporte) |
| RD Station | Central de ajuda RD + suporte via ticket |
| WhatsApp API | Meta Business Support |
| Google Ads | Suporte Google Ads (0800 na conta) |
| ERP / Webhook ERP | Time de TI interno |
