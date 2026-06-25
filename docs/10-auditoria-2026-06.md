# 10 — Auditoria 2026-06 (achados e bloqueadores)

> Auditoria completa em **2026-06-09** (knowledge refresh das APIs + revisão de código).
> Decisão: "só auditar, não mexer" — os achados abaixo estão **PENDENTES de correção**, decididos mas ainda não implementados.

Ver versões-alvo e padrões de stack em [`11-stack-versions-targets.md`](./11-stack-versions-targets.md).

---

## 🔴 Bloqueadores (verificados lendo o código)

### 1. Contrato quebrado `tracking.js` ↔ `track-event` — bug nº1
`lp/tracking.js` envia:
- UTMs em `body.utms.*`
- `page_url` em `body.url`
- PII (email/phone/nome/cnpj/estado) dentro de `body.event_data.*`

Mas `supabase/functions/track-event/index.ts:23-34` lê **tudo no top-level**.

**Resultado:** o Lead chega **sem PII e sem UTM** → Advanced Matching zerado → **Match Quality ≥ 8.5 (critério Fase 1→2) é inatingível**. É também o que o ULTRON precisa na origem para o Attribution Engine.

### 2. Token Meta vazado
`.mcp.json:7` contém `META_ACCESS_TOKEN` real (system user) em texto claro, mais `META_APP_ID`.
**Ação:** rotacionar no Business Manager (assumir vazado) → remover do arquivo → mover para env → garantir `.mcp.json` no `.gitignore`. Viola a regra absoluta #5.

### 3. Endpoints client-side inexistentes
`tracking.js:240` chama `/session-update` (função que não existe) e `tracking.js:254` dispara `SessionEnd` via beacon → `track-event` não trata, gera evento espúrio + chamada CAPI lixo.

---

## 🟠 Integridade de dados / deduplicação

4. **`erp-sync` sem idempotência** por `order_id` — reentrega duplica `numero_pedidos`/`ltv_total` e reenvia `Purchase` (regra #7 furada).
5. **`event_id` não-determinístico** em `rd-sync`/`erp-sync` (usam `crypto.randomUUID()` a cada execução → contagem dupla no Meta). Deveria derivar de `rd_deal_id`/`order_id`.
6. **Webhooks fail-open** — `rd-sync`/`erp-sync` validam o segredo só `if (token && …)`; sem a env setada, aceitam payload anônimo. Deveria falhar fechado.
7. **Funções de cron sem auth** — `gmb-sync`, `meta-ads-scheduler`, `backfill-integradores` com CORS `*` e sem autenticação.

---

## 🟡 Padrão / manutenção

- `backfill-integradores` foge do template (sem try/catch global, sem `error_logs`).
- Hash SHA-256 duplicado em `rd-sync:45` em vez de usar `_shared`.
- `error_logs` grava `payload: null` em track-event/enrich-cnpj/erp-sync (perde o corpo do erro).
- `normalizePhone` (`_shared/capi-sender.ts:25`) gera E.164 inválido para números curtos.
- `.env.example` desatualizado: faltam `META_ACCESS_TOKEN`, `RD_WEBHOOK_RECEIVER_TOKEN`, `RD_CRM_TOKEN`, tokens OAuth do backfill; lista Google Ads/WhatsApp sem código.
- `supabase-js@2` sem pin de versão.

---

## Plano de otimização priorizado

**Sprint A — Destravar:**
1. Corrigir contrato `tracking.js` ↔ `track-event` (PII + UTM + page_url) ← desbloqueia MQ ≥ 8.5
2. Rotacionar + remover token do `.mcp.json`
3. Atualizar Graph API v18→v25 e padronizar versão em const compartilhada
4. Idempotência no `erp-sync` + `event_id` determinístico nos eventos CRM/ERP

**Sprint B — Robustez:**
5. Webhooks fail-closed + auth nas funções de cron
6. Migrar Edge Functions para `Deno.serve()` + `npm:` specifier
7. Padronizar erro/`error_logs` + helpers `_shared`; atualizar `.env.example`

**Sprint C — Estratégico (decisão de negócio):**
8. Definir rota do Google Ads ECL → **Data Manager API** (deadline 15/jun/2026) antes de implementar `google-ads-sender.ts`
9. Resolver `action_source: crm` → `system_generated`
