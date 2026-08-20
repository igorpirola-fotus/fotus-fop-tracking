# 09 — Hierarquia de Fonte-Verdade

> **Leia antes de tirar qualquer conclusão de número de mídia/atribuição.**
> Este documento existe por causa de um incidente real (ago/2026): concluiu-se
> "apagão de conversões no Meta" a partir do ETL e da tabela `events`, quando o
> **pixel** mostrava tudo saudável. O ETL e o `events` são o **espelho, não o rosto**.

---

## Regra de ouro

**Nenhuma conclusão sai de uma fonte DERIVADA (ETL / `public.events`) sem bater com a fonte CANÔNICA (plataforma / pixel / CRM ao vivo) no mesmo recorte de data e fuso.**

Fonte derivada serve para série histórica, tendência e cruzamento — nunca para afirmar "caiu", "subiu", "apagou" sozinha.

---

## Tabela de fonte-verdade

| Pergunta | Fonte CANÔNICA (decide) | Fonte DERIVADA (só apoia, nunca conclui sozinha) |
|---|---|---|
| Quantos leads de mídia ontem/hoje? | **Meta Events Manager / Graph API ao vivo** na conta `act_1017764197039855`, com o `action_type` explicitamente fixado; Google Ads / GA4 ao vivo | `ultron.eventos_normalizados.leads` — **congelada em D-1**, não maturada |
| Conversão de otimização (SQL) | **RD CRM etapa "Qualificado SQLs"** = `public.events` `Schedule` + `rdstation_crm_webhook_events` | Custom Conversion "Lead Qualificado Fotus" no Meta |
| Receita / faturamento | **RD CRM won** (deal Ganho), reconciliado com ERP | **JAMAIS** `eventos_normalizados.receita_brl` (vem do pixel, que quase não registra purchase → ruído) |
| Spend / CPL | **Billing Meta/Google ao vivo** ÷ leads canônico | `eventos_normalizados.spend_brl` |
| Saúde do envio server-side ao Meta | **Meta Events Manager** (eventos recebidos + match quality) | `public.events.meta_capi_status` — é operacional, **não** verdade de negócio |

---

## Pixel correto (fonte-verdade de conversão)

- **Fotus Solar V2** — dataset id `1313389696600030` (business `565235773013229`). É o que o env `META_PIXEL_ID` aponta e o que as campanhas de aquisição usam.
- Cuidado: o business tem **11 datasets** com nomes parecidos ("Fotus Distribuidora Solar" `539758743310797` está quase morto server-side desde fev/2025; há "Fotus 2022", "Pixel Fotus", "Fotus Agro" etc). **Não confundir.** Sempre confirmar pelo id `...600030`.

---

## Por que a fonte derivada engana (armadilhas conhecidas)

1. **Congelamento em D-1:** o ETL captura cada dia uma única vez, no dia seguinte, e nunca reabre a linha. Como a conversão do Meta matura por até 7 dias (e o fundo de funil chega depois), **todo dia recém-puxado parece mais fraco** que os antigos já maturados → falsa "queda".
2. **`meta_capi_status = 'gtm'`** significa "delegado ao GTM", **não** "entregue/confirmado". Só o Events Manager confirma entrega de evento de site.
3. **`leads` tem definição diferente por plataforma** (meta = `action_type='lead'`; google = todas as conversions; ga4 = todos os key events). Não são a mesma coisa e nenhuma é o `lead` do pixel por definição — não somar cegamente nem comparar CPL entre canais sem checar.
4. **`sem_origem` / `sem_sinal_midia` ≠ "veio do orgânico".** Com sessões órfãs e falhas de pipeline, ausência de UTM costuma ser dado perdido, não ausência de mídia.

---

## Antes de gritar "apagão / queda", responda 4 perguntas

1. **O dia entrou?** (a linha existe no ETL para D-1 em todas as plataformas?)
2. **Maturou?** (é um dia recente ainda em janela de atribuição?)
3. **Mudou pixel / conta / naming / evento contado?**
4. **A fonte canônica (Events Manager / plataforma) confirma?**

Se não passou nos quatro, **não é queda — é medição.** Ver o checklist operacional em `07-runbook.md`.
