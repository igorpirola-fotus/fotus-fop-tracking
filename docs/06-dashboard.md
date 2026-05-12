# 06 — Dashboard e Analytics

## Conectar Looker Studio ao Supabase

1. [lookerstudio.google.com](https://lookerstudio.google.com) → Criar → Fonte de dados
2. Tipo: **PostgreSQL**
3. Host: `db.SEU-PROJECT-ID.supabase.co`
4. Porta: `5432`
5. Banco: `postgres`
6. Usuário: `postgres`
7. Senha: senha do banco Supabase

> Criar um usuário read-only é recomendado para segurança:
> ```sql
> CREATE USER dashboard_reader WITH PASSWORD 'senha_segura';
> GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_reader;
> ```

## Queries para as 6 seções do dashboard

### Seção 1: Funil mês atual

```sql
-- Copiar de scripts/validate-mq.sql → Query 5
```

### Seção 2: Match Quality por evento

```sql
-- Copiar de scripts/validate-mq.sql → Query 2
```

### Seção 3: Segmentação RFM

```sql
SELECT segmento_rfm, COUNT(*) as total,
       AVG(ticket_medio) as ticket_medio,
       SUM(ltv_total) as ltv_total,
       ROUND(AVG(EXTRACT(DAY FROM NOW() - data_ultima_compra))) as recencia_media_dias
FROM integradores WHERE numero_pedidos > 0
GROUP BY segmento_rfm ORDER BY ltv_total DESC NULLS LAST;
```

### Seção 4: Performance WhatsApp

```sql
SELECT intent,
       COUNT(*) FILTER (WHERE direction = 'outbound') as enviados,
       COUNT(*) FILTER (WHERE direction = 'inbound') as respostas,
       ROUND(COUNT(*) FILTER (WHERE direction='inbound') * 100.0 /
             NULLIF(COUNT(*) FILTER (WHERE direction='outbound'),0), 1) as taxa_resposta
FROM whatsapp_interactions
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY intent;
```

### Seção 5: CAC composto

```sql
SELECT DATE_TRUNC('month', data_primeira_compra) as mes,
       COUNT(id) as novos_clientes,
       AVG(ticket_medio) as ticket_medio_novos
FROM integradores WHERE data_primeira_compra IS NOT NULL
GROUP BY mes ORDER BY mes DESC LIMIT 6;
```

### Seção 6: Google Meu Negócio — reviews

```sql
SELECT location_name,
       COUNT(*) as total_reviews,
       ROUND(AVG(rating), 2) as nota_media,
       COUNT(*) FILTER (WHERE rating >= 4) as positivos,
       COUNT(*) FILTER (WHERE reply_pending = TRUE) as sem_resposta
FROM gmb_reviews GROUP BY location_name ORDER BY nota_media DESC;
```

## KPIs do painel executivo (uma tela)

| Seção | Métricas |
|---|---|
| **Hoje** | Novos leads, MQ médio do dia, erros CAPI |
| **30 dias** | CPL, taxa Lead→SQL, CAC composto, novos clientes |
| **Funil** | Conversão entre etapas (PageView → Lead → SQL → Compra) |
| **Reativação** | Inativos em campanha, taxa de reativação |
| **RFM** | Distribuição de segmentos, VIPs em risco, expansões |
| **WhatsApp** | Taxa de resposta, NPS médio, alertas detratores |
| **GMB** | Nota média por local, reviews sem resposta |
| **Google Ads** | Conversões Enhanced, gclid capturado % |
