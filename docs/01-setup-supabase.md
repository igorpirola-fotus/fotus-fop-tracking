# 01 — Setup Supabase (Fase 1: Semanas 1–2)

> Objetivo desta fase: banco criado, Edge Functions deployadas, Lead server-side
> rodando em paralelo com Pixel client-side. Critério de avanço: MQ Lead ≥ 8.5.

---

## Passo 1 — Inicializar repositório local

```bash
# Clonar / criar o repositório
git clone https://github.com/SUA-ORG/fotus-fop-tracking.git
cd fotus-fop-tracking

# Inicializar Supabase CLI no projeto
supabase init

# Login no Supabase
supabase login

# Linkar com o projeto remoto (substituir com o ID do seu projeto)
# O project-id está na URL: app.supabase.com/project/SEU-PROJECT-ID
supabase link --project-ref SEU-PROJECT-ID
```

---

## Passo 2 — Aplicar migrations (banco de dados)

As migrations criam as 9 tabelas, índices, RLS e triggers automáticos.

```bash
# Aplicar todas as migrations em sequência
supabase db push

# Verificar se foram aplicadas
supabase db diff
```

> Se preferir aplicar manualmente via SQL Editor do Supabase Dashboard:
> Abra cada arquivo em `supabase/migrations/` e execute na ordem: 001 → 002 → 003 → 004

### Verificar criação das tabelas

No Supabase Dashboard → Table Editor, confirmar que existem:

- `sessions`
- `integradores`
- `events`
- `rfm_snapshots`
- `whatsapp_interactions`
- `pipeline_snapshots`
- `nps_responses`
- `lead_score_log`
- `error_logs`

---

## Passo 3 — Configurar variáveis de ambiente

```bash
# Configurar secrets das Edge Functions
supabase secrets set META_PIXEL_ID=SEU_PIXEL_ID
supabase secrets set META_CAPI_TOKEN=SEU_TOKEN_CAPI
supabase secrets set RD_API_TOKEN=SEU_TOKEN_RD
supabase secrets set WHATSAPP_TOKEN=SEU_TOKEN_WA
supabase secrets set WHATSAPP_PHONE_ID=SEU_PHONE_ID
supabase secrets set WHATSAPP_VERIFY_TOKEN=fotus_wh_verify_2025

# Verificar se foram salvas
supabase secrets list
```

---

## Passo 4 — Deploy das Edge Functions

```bash
# Deploy de todas as funções de uma vez
supabase functions deploy

# Ou individualmente (mais seguro para validar uma a uma)
supabase functions deploy track-event
supabase functions deploy enrich-cnpj
supabase functions deploy rd-sync
supabase functions deploy erp-sync
supabase functions deploy hydrate-integrador
supabase functions deploy rfm-update
supabase functions deploy whatsapp-handler
```

### Verificar URLs das funções

Após o deploy, as URLs seguem o padrão:
```
https://SEU-PROJECT-ID.supabase.co/functions/v1/track-event
https://SEU-PROJECT-ID.supabase.co/functions/v1/rd-sync
https://SEU-PROJECT-ID.supabase.co/functions/v1/erp-sync
https://SEU-PROJECT-ID.supabase.co/functions/v1/hydrate-integrador
https://SEU-PROJECT-ID.supabase.co/functions/v1/enrich-cnpj
https://SEU-PROJECT-ID.supabase.co/functions/v1/rfm-update
https://SEU-PROJECT-ID.supabase.co/functions/v1/whatsapp-handler
```

> Anotar estas URLs — serão usadas nos webhooks do RD e WhatsApp.

---

## Passo 5 — Instalar o script de captura na LP

Inserir o conteúdo de `lp/tracking.js` na LP **antes de `</body>`**, logo após o
código do Meta Pixel existente:

```html
<!-- Meta Pixel existente (manter rodando em paralelo por 30 dias) -->
<script>
  !function(f,b,e,v,n,t,s){...}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'SEU_PIXEL_ID');
  fbq('track', 'PageView');
</script>

<!-- FOP Tracking Fotus — server-side em paralelo -->
<script>
(function() {
  const EDGE_URL = 'https://SEU-PROJECT-ID.supabase.co/functions/v1/track-event'
  
  // ... cole aqui o conteúdo completo de lp/tracking.js ...
})()
</script>
```

> **Importante:** não remover o Pixel client-side original.
> Os dois devem rodar em paralelo por pelo menos 30 dias.
> O event_id compartilhado garante deduplicação no Meta.

---

## Passo 6 — Configurar Test Event Code no Meta

Para testar sem poluir dados de produção:

1. Gerenciador de Eventos → seu Pixel → Test Events
2. Copiar o "Código de evento de teste" (ex: `TEST12345`)
3. Adicionar temporariamente no `lp/tracking.js`:

```javascript
// Apenas durante testes — remover antes de ir para produção!
const TEST_EVENT_CODE = 'TEST12345'
```

---

## Passo 7 — Executar testes da Fase 1

### Teste 1: PageView server-side

```bash
curl -X POST https://SEU-PROJECT-ID.supabase.co/functions/v1/track-event \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-pv-001",
    "event_name": "PageView",
    "session_id": "test-session-001",
    "url": "https://fotus.com.br/lp?utm_source=ig&utm_medium=paid&utm_campaign=teste-fase1",
    "utms": {
      "utm_source": "ig",
      "utm_medium": "paid",
      "utm_campaign": "teste-fase1"
    },
    "fbp": "_fbp.1.1234567890.9876543210",
    "fbc": "fb.1.1234567890.AbCdEfGhIjKlMn",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"
  }'
```

✅ Resposta esperada: `{"success": true}`
✅ Verificar no Supabase: `sessions` com 1 registro, UTMs preenchidos, geo do servidor

### Teste 2: Lead server-side (com CNPJ real de teste)

```bash
curl -X POST https://SEU-PROJECT-ID.supabase.co/functions/v1/track-event \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-lead-001",
    "event_name": "Lead",
    "session_id": "test-session-001",
    "url": "https://fotus.com.br/lp",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
    "event_data": {
      "email": "contato@suaempresateste.com.br",
      "phone": "27999998888",
      "nome": "João da Silva",
      "cnpj": "11.222.333/0001-81",
      "estado": "ES",
      "content_category": "aquisicao"
    }
  }'
```

✅ Verificar no Supabase:
- `integradores`: novo registro com `cnpj = '11222333000181'`
- `events`: registro com `event_name = 'Lead'` e `meta_capi_status = 'sent'`
- `meta_event_id` preenchido (confirma que chegou no Meta)
- `enrich-cnpj` rodou em background: `razao_social`, `porte`, `cnae_principal` preenchidos

### Teste 3: Verificar no Events Manager

1. Gerenciador de Eventos → Test Events (aba)
2. Confirmar que o Lead aparece como recebido via **"Servidor"** (não Navegador)
3. Clicar no evento → verificar `user_data` com `em`, `ph`, `fn`, `ln` presentes

### Teste 4: Match Quality (aguardar 48h de tráfego real)

1. Colocar o script na LP em produção
2. Aguardar 48h com tráfego orgânico/pago real
3. Verificar: Gerenciador de Eventos → Lead → Qualidade da Correspondência

| Resultado | Ação |
|---|---|
| ≥ 8.5 | ✅ Fase 1 concluída — avançar para Fase 2 |
| 7.0 – 8.4 | Verificar normalização do phone (E.164) e email (sem espaços) |
| < 7.0 | Verificar hash SHA-256: deve ser lowercase, sem espaços, sem caracteres especiais |

---

## Checklist de conclusão da Fase 1

- [ ] Todas as migrations aplicadas (9 tabelas criadas)
- [ ] Todas as Edge Functions deployadas (7 funções)
- [ ] Todas as secrets configuradas
- [ ] Script `lp/tracking.js` na LP (junto com Pixel client-side original)
- [ ] Teste de PageView retornou 200 e criou registro em `sessions`
- [ ] Teste de Lead retornou 200, criou `integradores` e `events` com `status = 'sent'`
- [ ] Enriquecimento CNPJ rodando (razao_social preenchida após 5s do Lead)
- [ ] Deduplicação funcionando (evento não aparece dobrado no Events Manager)
- [ ] **Match Quality Lead ≥ 8.5 após 48h** ← critério de avanço para Fase 2
- [ ] Pixel client-side original AINDA RODANDO em paralelo

---

## Troubleshooting comum

| Problema | Causa provável | Solução |
|---|---|---|
| Edge Function retorna 500 | Secret não configurada | `supabase secrets list` — verificar se META_CAPI_TOKEN existe |
| `meta_capi_status = 'failed'` | Token CAPI inválido ou expirado | Regenerar token no Events Manager |
| Match Quality < 7.0 | Phone mal formatado | Verificar `normalizePhone` — deve retornar `+5527...` |
| CNPJ não enriquecendo | BrasilAPI fora do ar ou CNPJ inválido | Testar: `curl https://brasilapi.com.br/api/cnpj/v1/SEU_CNPJ` |
| Deduplicação não funcionando | event_id diferente entre client e server | Garantir que o mesmo UUID gerado no client vai no body da chamada ao Edge |
| CORS error no browser | Header `Access-Control-Allow-Origin` faltando | Edge Function já tem os CORS headers — verificar se o deploy foi feito |
