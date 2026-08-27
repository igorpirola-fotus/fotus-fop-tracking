# 15 — Públicos (Custom Audiences) da Meta alimentados pelo fop-db

> Criado em 27/ago/2026. Plano de origem: `docs/superpowers/plans/2026-08-27-publicos-meta-api.md` (no repo do ULTRON).
>
> **Regra de ouro:** o público na Meta é **espelho** de `ultron.vw_publico_meta`. Nunca edite a lista pelo gerenciador — o próximo sync sobrescreve.

---

## 1. Os públicos

| `publico` | Nome na Meta | Regra |
|---|---|---|
| `clientes_ativos_180d` | FOP \| Clientes ativos 180d | `data_ultima_compra ≥ hoje-180d`. Uso: **excluir** de ACQ e alvo de RET\|BASE |
| `inativos_180_540d` | FOP \| Inativos 180-540d | compra entre 180 e 540 dias atrás. Uso: ataque BDR |
| `sql_sem_venda` | FOP \| SQL sem venda | tem evento `Schedule` ("Lead Qualificado Fotus") e nenhum `Purchase`/`PurchaseRecorrente` |
| `perdidos_sem_compra` | FOP \| Perdidos sem compra | tem `OportunidadePerdida` e nunca comprou |
| `ltv_alto_semente` | FOP \| LTV alto (semente LAL) | top decil de `ltv_total` (p90). Uso: semente de lookalike |
| `leads_sem_compra` | FOP \| Leads sem compra | tem chave de match e nunca comprou. **Superconjunto** de `sql_sem_venda` e `perdidos_sem_compra` |

Sobreposição entre públicos é normal (usos diferentes na campanha) — documentar, não evitar.

O `audience_id` de cada um fica em `ultron.publicos_meta` e é gravado pelo próprio endpoint na primeira execução.

---

## 2. Números medidos

**Base de partida (27/ago/2026, ANTES do enriquecimento via RD CRM):**

| Métrica | Valor |
|---|---|
| `public.integradores` | 8.096 |
| com `email` **e** `phone` | 1.248 (15%) — todos vindos da LP |
| já compraram | 6.869 |
| ativos ≤180d | 5.610, dos quais **63 com e-mail** |
| inativos 180–540d | 1.258, dos quais **4 com e-mail** |

Causa: o `/track-event` (LP) grava e-mail/telefone; o `rd-sync` (webhook do CRM) resolve **só CNPJ**. Quem compra entra pelo CRM.

**Tamanho de cada público na mesma data:**

| `publico` | linhas | veredito (mínimo 1.000) |
|---|---|---|
| `leads_sem_compra` | 1.207 | **SOBE** |
| `perdidos_sem_compra` | 330 | pulado |
| `clientes_ativos_180d` | 63 | pulado |
| `sql_sem_venda` | 39 | pulado |
| `ltv_alto_semente` | 7 | pulado |
| `inativos_180_540d` | 4 | pulado |

**Teto do enriquecimento:** 6.370 integradores sem chave são alcançáveis via `org_id` → contato do RD CRM (`public.rd_deal_cnpj_cache` tem 44.455 deals, 10.939 organizações, 10.790 CNPJs resolvidos). Validado ao vivo em 2 de 2 amostras.

> Reexecutar a medição depois de cada sync de contatos e atualizar esta tabela com a data.

---

## 3. Como rodar

**Enriquecer a base (pré-requisito dos públicos de cliente):** workflow n8n `[FOP] sync-contatos-rd — loop de páginas` (`6h1YEDa7XtE9cFuN`), execução manual. Ele chama `POST /sync-contatos-rd` em loop até `proxima_pagina: null` e, no último lote, roda o enriquecimento. ~951 páginas / ~8–10 min.

**Sincronizar os públicos:** workflow `[FOP] publicos-meta — sync diário` (`UE5B3a5VCvgmJVPi`), cron 05:00. Chama `POST /sync-publicos-meta`.

Ambos autenticam com a credencial n8n `FOP rd-sync receiver token` (o mesmo `RD_WEBHOOK_RECEIVER_TOKEN` do `rd-sync`).

**Dry run** (não chama a Meta, só mede e loga):

```bash
curl -s -X POST "https://fotus-fop-functions.mk863j.easypanel.host/sync-publicos-meta" \
  -H "Authorization: Bearer $RD_WEBHOOK_RECEIVER_TOKEN" \
  -H "Content-Type: application/json" -d '{"dry_run":true}'
```

**Um público só:** trocar o corpo por `{"publico":"leads_sem_compra"}`.

---

## 4. Como auditar

```sql
SELECT publico, status, linhas_origem, enviados, lotes, http_status, erro, rodado_em
  FROM ultron.publicos_meta_sync
 ORDER BY rodado_em DESC LIMIT 20;
```

| `status` | Significado |
|---|---|
| `ok` | lotes aceitos pela Meta; processamento leva **até 24h** para refletir tamanho |
| `falha` | a Graph recusou — ler `erro` e `http_status`; também vai para o `error_log` |
| `pulado_volume_minimo` | menos de 1.000 linhas na view; não gastou chamada. **Não é erro** |
| `dry_run` | medição sem envio |

Se um público sumir do log, o sync não rodou — checar as execuções do workflow no n8n.

---

## 5. Decisões que parecem bug e não são

- **Público pequeno fica `ativo = true`.** O guardrail de volume o pula e loga a cada rodada, e ele **volta a subir sozinho** quando o volume chegar. `ativo = false` exigiria alguém lembrar de religar.
- **`usersreplace`, não `users`.** A doc oficial (v25.0) diz que o replace **não reseta a fase de aprendizado** dos conjuntos que usam o público. É o que torna o sync diário viável.
- **Nunca deletar/recriar público.** O `audience_id` é identidade permanente; recriar zera o aprendizado dos conjuntos. Para parar de sincronizar: `UPDATE ultron.publicos_meta SET ativo = false WHERE publico = '...'` — isso **não** apaga o público na Meta.
- **A escolha do contato por empresa não é por recência.** Uma empresa tem dezenas de contatos duplicados no CRM; o mais antigo pode ter telefone e nenhum e-mail. A ordem é e-mail → telefone → recência (`SQL_ENRIQUECER_INTEGRADORES`), e há teste travando isso.
- **`EXTERN_ID` vai hasheado.** Tem de ser byte-a-byte igual ao `external_id` que o `capi-sender` manda nos eventos; se divergir, público e evento param de casar. Há teste travando a igualdade.

---

## 6. Por que o RD Marketing não é a fonte

Avaliado e recusado em 27/ago/2026. O Marketing **tem** os campos `cf_cnpj` e `cf_cnpj_crm`, mas: não existe endpoint de listar todos os contatos; a listagem por segmentação devolve só `uuid, name, email, phone, last_conversion_date, created_at` (**sem campo personalizado**, logo sem CNPJ); pegar o CNPJ exigiria 1 chamada por contato sobre ~190 mil contatos; e a indexação é por e-mail/telefone, o contrário do nosso problema. No CRM o contato já nasce ligado à organização, e organização tem CNPJ.

---

## 7. LGPD

Só sai **hash SHA-256** do banco — nenhum dado legível vai para a Meta. Base própria de clientes e leads, finalidade de marketing, `customer_file_source = USER_PROVIDED_ONLY`. Os Termos de Público Personalizado precisam estar aceitos na conta de anúncios (aceite na interface do Business Manager; não há API para isso).
