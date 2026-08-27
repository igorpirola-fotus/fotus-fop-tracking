# fop-functions — tracking server-side (Deno, self-hosted)

Substitui as Edge Functions do Supabase (`track-event`, `enrich-cnpj`) por um servidor Deno
standalone que grava **direto no Postgres** (`fop-db` no EasyPanel), sem PostgREST e sem RLS.
Parte da migração Supabase → EasyPanel (ver `docs/superpowers/plans/DISCOVERY-2026-07-22.md`).

## Endpoints
- `POST /track-event` — mesmo contrato da Edge Function antiga (event_id, event_name, session_id, ...).
- `POST /rd-sync` — recebe os webhooks do RD Station CRM (payload nativo `event_name` + `document`), autenticado via header `Authorization: Bearer <RD_WEBHOOK_RECEIVER_TOKEN>`; mapeia etapa do deal → evento Meta/GA4 (Contact/Schedule/AddToCart/Purchase/OportunidadePerdida) e dispara CAPI/GA4 (sempre, independente de `CAPI_ENABLED` — não há caminho client-side/GTM para eventos de CRM).
- `POST /enrich-cnpj` — `{ cnpj, integrador_id }` (BrasilAPI + lead score).
- `POST /sync-contatos-rd` — espelha contatos do RD CRM em `public.rd_contatos` e enriquece `integradores.email/phone` via `org_id → cnpj`; paginado (`{pagina, max_paginas}` → `proxima_pagina`, que também é devolvida em caso de HTTP 429 para o chamador retomar); autenticado com `RD_WEBHOOK_RECEIVER_TOKEN`. Loop no n8n: workflow `6h1YEDa7XtE9cFuN`.
- `POST /sync-publicos-meta` — sincroniza `ultron.vw_publico_meta` com as Custom Audiences da Meta via `usersreplace` (lotes de 10.000); aceita `{publico, dry_run}`; público com menos de 1.000 linhas é pulado; toda rodada vira linha em `ultron.publicos_meta_sync`. Cron no n8n: workflow `UE5B3a5VCvgmJVPi`. Ver `docs/15-publicos-meta.md`.
- `GET /health` — checa conexão com o banco (`{ ok: true }`).

## Arquivos
- `server.ts` — roteador + handlers (portados do Supabase, lógica preservada).
- `db.ts` — pool Postgres + helpers (insert/update/one/q/logError).
- `capi-sender.ts` — SHA-256, Advanced Matching, Meta CAPI com retry (idêntico ao original).
- `ga4-sender.ts` — GA4 Measurement Protocol fire-and-forget (idêntico ao original).
- `Dockerfile` — imagem Deno 2.1.4, escuta na porta 8000.

## Variáveis de ambiente (setar no serviço EasyPanel — NUNCA no código)
| Var | Descrição |
|---|---|
| `DATABASE_URL` | conexão do fop-db (interna): `postgres://postgres:<senha>@fotus_fop-db:5432/fotus?sslmode=disable` |
| `META_PIXEL_ID` | ID do Pixel Meta |
| `META_CAPI_TOKEN` | token da API de Conversões (sistema) |
| `GA4_MEASUREMENT_ID` | `G-XXXXXXXXXX` (opcional — sem ele, GA4 é pulado) |
| `GA4_API_SECRET` | secret do Measurement Protocol (opcional) |
| `META_AD_ACCOUNT_ID` | ID da conta de anúncios, com ou sem o prefixo `act_` (Fotus Solar 2025: `1017764197039855`) — só para públicos |
| `META_ADS_TOKEN` | token de sistema com escopo `ads_management` — **não** é o `META_CAPI_TOKEN`; sem ele `/sync-publicos-meta` falha. Exige também os Termos de Público Personalizado aceitos na conta |
| `RD_WEBHOOK_RECEIVER_TOKEN` | Bearer exigido na entrada do webhook do RD CRM — obrigatório p/ o `rd-sync` |
| `RD_CRM_TOKEN` | access_token da API RD CRM v2 — usado só para **semear** `public.oauth_tokens` na primeira execução (depois o banco é a fonte da verdade) |
| `RD_CRM_REFRESH_TOKEN` | refresh_token do RD CRM — idem, só para o seed inicial |
| `RD_CRM_CLIENT_ID` | client_id do app CRM na AppStore do RD — **obrigatório** para o rd-sync resolver CNPJ |
| `RD_CRM_CLIENT_SECRET` | client_secret do app CRM — **obrigatório** para o rd-sync resolver CNPJ |

### Como o `rd-sync` resolve o CNPJ (e por que precisa da API do RD)
O payload nativo do webhook de deal **não traz o CNPJ**: nem em `deal_custom_fields`,
nem em `organization` / `contacts` / `organization_id` — esses três campos simplesmente
não vêm. Auditoria de 29/jul/2026: **37.963 webhooks em 7 dias falharam com
"cnpj obrigatório"** e a tabela `events` nunca recebeu um único evento de fundo de
funil (`event_source = 'system_generated'`). Nenhum `Purchase` foi registrado.

Ordem de resolução hoje (`rd-crm-client.ts` + `cnpj.ts`), do mais barato ao mais caro:
1. varredura do payload do webhook (grátis);
2. cache `public.rd_deal_cnpj_cache` — inclui *negative caching* (deal sem CNPJ não é reconsultado);
3. `GET /crm/v2/deals/{id}` — devolve o vínculo com a empresa;
4. reaproveitamento por organização (outro deal da mesma empresa já resolvido);
5. `GET /crm/v2/organizations/{org_id}` — é aqui que o CNPJ está.

**Formato real, validado em 29/jul/2026 contra 4 deals de produção:** o deal **nunca**
traz `organization` inline — só `organization_id`. O CNPJ vive em
`organization.custom_fields["cnpj-41d5"]` (chave com sufixo; em parte dos casos também
aparece dentro de `organization.name`). Logo são **2 chamadas por deal novo**, o que
torna o passo 4 essencial: vários deals por integrador é o padrão nesta base.

A busca não depende do nome do campo: aceita qualquer string que seja um **CNPJ válido**
(dígitos verificadores conferidos), com preferência para campos rotulados "cnpj". Isso
evita depender de um label do CRM que já mudou de lugar duas vezes.

**Token:** o access_token do CRM expira em 2h e o refresh_token é **rotativo** (cada uso
invalida o anterior; 14 dias sem uso e morre). O par vive em `public.oauth_tokens` e a
renovação é serializada por advisory lock do Postgres — dois refreshes concorrentes
derrubariam a credencial. Depois do seed, **o container é o dono do token**: scripts
locais que ainda usem `RD_CRM_REFRESH_TOKEN` do `.env` vão falhar com `invalid_grant`.

**Rate limit:** 120 req/min no CRM contra picos de 10k webhooks/hora → o cache é o que
segura; o `429` respeita o header `Retry-After`.

### Gate de sinal de mídia (`RD_SYNC_CAPI_REQUIRE_SESSION`, default ligado)
Eventos de CRM são **sempre gravados** no fop-db, mas só vão ao Meta/GA4 se o
integrador tiver **sessão rastreada**. Medido em 29/jul/2026: o CRM fecha ~450
deals `won` por dia (pico de 1.468 em 28/jul) contra ~13 leads/dia de mídia paga.
Sem o gate, o Meta receberia centenas de `Purchase`/dia de venda de carteira e
prospecção interna — ROAS reportado irreal e otimização aprendendo com sinal que
a mídia não gerou. Evento barrado fica com `meta_capi_status = 'sem_sinal_midia'`
(fica no banco, contável, e pode ser reenviado depois se a política mudar).
Setar `RD_SYNC_CAPI_REQUIRE_SESSION=false` só se a intenção for deliberadamente
medir toda a receita no Meta, mídia ou não.

### Backfill de integradores (`POST /backfill-integradores`)
Percorre os deals **ganhos** do CRM (`filter=status:won`, `sort[closed_at]=asc`)
e reconstrói `numero_pedidos` / `ltv_total` / `ticket_medio` / datas de compra.
Necessário porque `integradores` só tinha quem passou pela LP (~1.970 contra
~12.000 deals distintos por semana) — e sem histórico o rd-sync mandaria
`Purchase` (primeira compra) no lugar de `PurchaseRecorrente`.

```jsonc
{ "page": 1, "pages_per_run": 3, "page_size": 100,
  "dry_run": true,        // conta sem gravar — sempre comece assim
  "throttle_ms": 500 }    // freio: 2 chamadas por deal novo contra 120 req/min
```
Responde `has_more` / `next_page` para o loop. Idempotente via
`public.rd_won_backfill` (a acumulação é soma: sem esse controle, rodar duas
vezes dobraria o LTV). Workflow: `[ULTRON] backfill-integradores (won) — MANUAL`.
Medição do 1º dry run (20 deals): **17 com CNPJ resolvido, 3 sem, 0 erros**.

### Status da fila `rdstation_crm_webhook_events`
| status | significado |
|---|---|
| `processed` | evento gerado (ou já existia — idempotência por `event_id`) |
| `skipped` | etapa fora do `STAGE_TO_EVENT` — não vira evento por design |
| `skipped_no_cnpj` | deal sem CNPJ em lugar nenhum (dado ausente no CRM, não erro) |
| `skipped_sem_integrador` | CNPJ resolvido, mas a empresa não existe em `public.integradores` |
| `failed` | erro real (API do RD fora, token inválido) — **é o que o reprocessamento pega** |

### Reprocessar a fila
Workflow n8n `[ULTRON] rd-sync — reprocessar fila (MANUAL)` (`7x2Yri8bT2uteSRO`,
inativo, trigger manual). Ele reenvia o payload salvo com `reprocess: true` — sem essa
flag o servidor trataria como duplicado (o `dedup_key` já existe) e ignoraria. O
`received_at` original da fila é preservado, e a idempotência final continua vindo do
`event_id` determinístico em `public.events`.

## Deploy no EasyPanel (via API tRPC ou UI)
1. Serviço **App** no projeto `fotus`, nome ex. `fop-functions`.
2. Source = este diretório (`/fop-functions` do repo `fotus-fop-tracking`) com build por **Dockerfile**.
3. Setar as variáveis de ambiente acima (aba Ambiente).
4. Domínio interno porta **8000**. Expor externo via **Túnel Cloudflare** (mantém headers `CF-*` de geo).
5. Deploy → testar `GET /health`.

## Teste (antes do cutover — em paralelo ao Supabase)
```bash
curl -X POST https://<endpoint>/track-event \
  -H "Content-Type: application/json" \
  -d '{"event_id":"test-'$(date +%s)'","event_name":"Lead","session_id":"sess-test","email":"teste@fotus.com.br","cnpj":"...","test_event_code":"TEST12345"}'
```
Conferir no Meta Events Manager (Test Events) que o evento chega com Match Quality esperado,
e no fop-db que gravou em `sessions`/`integradores`/`events`.

## Cutover
Trocar a URL do endpoint em `fotus-fop-tracking/lp/tracking.js` (hoje aponta pro Supabase)
para `https://<endpoint-cloudflare>/track-event`. Manter o pixel client-side (regra 6 do CLAUDE.md).
