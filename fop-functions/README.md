# fop-functions — tracking server-side (Deno, self-hosted)

Substitui as Edge Functions do Supabase (`track-event`, `enrich-cnpj`) por um servidor Deno
standalone que grava **direto no Postgres** (`fop-db` no EasyPanel), sem PostgREST e sem RLS.
Parte da migração Supabase → EasyPanel (ver `docs/superpowers/plans/DISCOVERY-2026-07-22.md`).

## Endpoints
- `POST /track-event` — mesmo contrato da Edge Function antiga (event_id, event_name, session_id, ...).
- `POST /enrich-cnpj` — `{ cnpj, integrador_id }` (BrasilAPI + lead score).
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
