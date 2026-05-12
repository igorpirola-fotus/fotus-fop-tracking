# 04 — RFM + Lead Scoring (Fase 4: Semanas 9–12)

## Lead Scoring — fórmula completa (0–100)

| Categoria | Condição | Pontos |
|---|---|---|
| CNPJ | Empresa ATIVA | +10 |
| CNPJ | Porte EPP | +15 |
| CNPJ | Porte ME | +10 |
| CNPJ | Porte MEI | +5 |
| CNPJ | CNAE solar/elétrico (4321-5) | +15 |
| CNPJ | Empresa > 7 anos | +15 |
| CNPJ | Empresa 3–7 anos | +10 |
| Comportamento | 2+ visitas antes de converter | +10 |
| Comportamento | Tempo na página > 120s | +5 |
| Comportamento | Scroll > 75% | +5 |
| Contato | Email corporativo (não gmail/hotmail) | +5 |
| Contato | Phone válido (13+ dígitos E.164) | +5 |
| Histórico | Já foi cliente (ERP) | +20 |
| NPS | Score 9–10 anterior | +10 |
| Geo | Estado top 5 Fotus (SP/MG/RS/SC/PR) | +5 |

**Faixas de ação do SDR:**

| Score | Classificação | Ação |
|---|---|---|
| 70–100 | 🔥 Hot | Ligar em até 2h |
| 40–69 | 🌡️ Warm | Ligar em até 24h |
| 20–39 | ❄️ Cold | WhatsApp primeiro, ligar em 48h |
| 0–19 | 💀 Descarte | Qualificar só via WhatsApp |

## RFM Mensal — configurar cron

Configurar o cron no Supabase Dashboard → Edge Functions → rfm-update:

```
Cron expression: 0 2 1 * *
(Roda no dia 1 de cada mês às 02:00 BRT)
```

## Segmentos RFM

| Segmento | Critério | Evento Meta | Ação |
|---|---|---|---|
| VIP | rfm_score ≥ 13 | IntegradorVIP | Lookalike 1% de aquisição |
| Ativo | R≥4 e rfm_score≥9 | IntegradorAtivo | Exclusão de campanhas de aquisição |
| Risco | R≤2 | IntegradorRisco | Campanha de retenção urgente |
| Expansão | Subiu de segmento | IntegradorExpansao | Campanha de upsell |

## Criar audiências no Meta após primeiro cron

1. Gerenciador de Eventos → Audiências → Criar
2. Tipo: **Audiência customizada de eventos**
3. Para cada segmento:

| Audiência | Evento | Janela |
|---|---|---|
| VIPs Fotus | IntegradorVIP | 365 dias |
| Ativos Fotus | IntegradorAtivo | 180 dias |
| Em risco | IntegradorRisco | 90 dias |
| NPS Promotores | IntegradorNPS9 | 365 dias |

4. Criar **Lookalike 1%** a partir de "VIPs Fotus"
5. Substituir lookalike de Lead genérico pelo Lookalike VIP

## Checklist Fase 4

- [ ] Cron RFM configurado e rodando dia 1 de cada mês
- [ ] Lead score calculado para todos os integradores com enriquecimento completo
- [ ] Segmento RFM preenchido em todos os integradores com pedidos
- [ ] `segmento_rfm` sincronizado no RD Marketing
- [ ] Eventos custom chegando no Meta: IntegradorVIP, IntegradorRisco, IntegradorExpansao
- [ ] Audiências criadas no Meta (tamanho > 1.000 cada)
- [ ] Lookalike de VIP ativo nas campanhas de aquisição
- [ ] Clientes ativos excluídos das campanhas de aquisição
