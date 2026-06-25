# 11 — Versões de stack e alvos (knowledge refresh 2026-06)

> Knowledge refresh de **2026-06-09**. Versões atuais vs. o que o projeto usa hoje, e os alvos decididos.
> Relacionado: [`10-auditoria-2026-06.md`](./10-auditoria-2026-06.md).

| API / ferramenta | Projeto usa | Atual (jun/2026) | Alvo decidido |
|---|---|---|---|
| **Meta Graph / CAPI** | `v18.0` (capi-sender) e `v23.0` (meta-ads-scheduler) | **v25.0** | **v25.0** — padronizar em const compartilhada |
| **Google Ads ECL** | `v17` (planejado) | v24 / **Data Manager API** | **Data Manager API `IngestEvents`** (deadline 15/jun/2026) |
| **WhatsApp Cloud** | `v18` | **v25.0** | v25.0 quando implementar `whatsapp-handler` |
| **Deno std** | `std@0.177.0/http/server.ts` | `Deno.serve()` nativo (runtime Deno 2.x) | **`Deno.serve()`** |
| **supabase-js** | `esm.sh/@supabase/supabase-js@2` | `npm:@supabase/supabase-js@2` | **`npm:` specifier** + pin de versão |
| GA4 MP | em uso | maintenance mode | manter, sem ação |
| GMB reviews | `v4` | `v4` (ainda ativo) | manter |
| BrasilAPI | `cnpj/v1` | inalterada | manter (ciente da defasagem mensal dos dados da Receita) |

---

## Detalhes que impactam o código

- **Meta Graph v18 expirou em 26/jan/2026** → o CAPI pode estar falhando silenciosamente. v19 expirou 21/mai e v20 expira 24/set/2026.
- **`action_source: 'crm'`** usado em `rd-sync`/`erp-sync` **não é valor válido na Meta**. Válidos: `website, email, app, phone_call, chat, physical_store, system_generated, business_messaging, other`. Provável correção: **`system_generated`** (pendente confirmação).
- **Google Ads ECL:** a partir de **15/jun/2026**, Enhanced Conversions for Leads e offline conversion imports migram para a **Data Manager API**. Developer tokens sem requisições entre jan–jun/2026 provavelmente perderam a janela de allowlist da rota legada. **Não construir `google-ads-sender.ts` na Google Ads API legada** (`UploadClickConversion`).
- **Edge Functions:** trocar `import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'` por `Deno.serve()` nativo; trocar `esm.sh/@supabase/supabase-js@2` por `npm:@supabase/supabase-js@2`. Considerar `deno.json` por função.
- **GA4 MP:** continua funcionando (modo manutenção); limites — body < 130 kB, máx. 25 eventos/request, timestamps nas últimas 72h.
