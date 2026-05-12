# 03 — Funil de Reativação (Fase 3: Semanas 5–8)

> Critério de inativo: integrador sem compra há 90+ dias no ERP.
> Objetivo: taxa de reativação ↑ 2–3x vs baseline.

## Mecanismo de re-hidratação

```
Campanha Meta (audiência inativos)
    → Link: fotus.com.br/lp-reativacao?iid={integrador_id}
    → JS captura iid
    → Chama hydrate-integrador
    → Retorna razao_social para personalizar LP
    → PageView dispara com PII completo hasheado → MQ 9.3 imediato
```

## 5 eventos do funil de reativação

| # | Evento | Trigger | MQ esperado |
|---|---|---|---|
| 1 | PageView | LP reativação com ?iid= | ≥ 9.0 (dados completos desde o 1º toque) |
| 2 | ViewContent | Scroll 50% | ≥ 9.0 |
| 3 | AddToCart | Clique no CTA principal | ≥ 9.0 |
| 4 | Lead | Form de reativação enviado | ≥ 9.0 |
| 5 | Purchase | Pedido aprovado no ERP | ≥ 9.5 |

## Passo 1 — Criar LP de reativação

A LP de reativação é diferente da LP de aquisição:
- Título personalizado: "Bem-vindo de volta, {razao_social}!"
- Oferta específica: "Condições especiais para clientes Fotus"
- CTA direto: "Quero reativar meu cadastro"
- Não pedir CNPJ no form — já temos no banco

Adicionar no `<head>` da LP de reativação:

```javascript
// Script de re-hidratação — lê ?iid= da URL e personaliza a página
(async function() {
  const params = new URLSearchParams(window.location.search)
  const iid = params.get('iid')
  if (!iid) return

  try {
    const res = await fetch('https://SEU-PROJECT-ID.supabase.co/functions/v1/hydrate-integrador', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iid })
    })
    const data = await res.json()

    if (data.found) {
      // Personalizar LP com razao_social
      const el = document.querySelector('[data-empresa]')
      if (el) el.textContent = data.razao_social || 'sua empresa'

      // Passar integrador_id para o tracking.js
      window.FOTUS_INTEGRADOR_ID = data.integrador_id
      window.FOTUS_ESTADO = data.estado
    }
  } catch (e) {}
})()
```

## Passo 2 — Criar segmentação de inativos no Supabase

```sql
-- Query para exportar inativos 90-180 dias (para audiência Meta)
SELECT
  i.id, i.email, i.phone, i.cnpj, i.nome_contato, i.razao_social,
  EXTRACT(DAY FROM NOW() - i.data_ultima_compra) as dias_sem_compra
FROM integradores i
WHERE i.data_ultima_compra IS NOT NULL
  AND i.data_ultima_compra < NOW() - INTERVAL '90 days'
  AND i.data_ultima_compra > NOW() - INTERVAL '180 days'
  AND i.status != 'churned'
ORDER BY dias_sem_compra ASC;
```

## Passo 3 — Criar audiência customizada no Meta

1. Gerenciador de Anúncios → Audiências → Criar → Arquivo de clientes
2. Exportar a query acima como CSV (email + phone hasheados)
3. Ou usar o Custom Event `IntegradorRisco` gerado pelo cron RFM (mais automatizado)

## Passo 4 — Criar campanha de reativação

- Objetivo: Conversão por "Lead Qualificado Fotus" (Schedule)
- Audiência: Inativos 90–180 dias (excluir IntegradorAtivo e IntegradorVIP)
- URL dos anúncios: `https://fotus.com.br/lp-reativacao?iid={{integrador_id}}&utm_source=ig&utm_medium=paid&utm_campaign=reativacao-90d`
- Budget separado do de aquisição (não competem)

## Checklist Fase 3

- [ ] LP de reativação criada com suporte a `?iid=`
- [ ] Script de re-hidratação instalado na LP
- [ ] Edge Function `hydrate-integrador` testada (retorna `found: true`)
- [ ] PageView de reativação com MQ ≥ 9.0
- [ ] Audiência de inativos criada no Meta (> 1.000 pessoas)
- [ ] Campanha de reativação ativa com budget separado
