// =============================================================
// supabase/functions/meta-ads-scheduler/index.ts
//
// Edge Function disparada a cada minuto via pg_cron.
// Lê regras de ad_schedule_rules e aplica pause/resume em campanhas
// e ad sets do Meta Ads conforme o cron / run_at configurado.
//
// Regra de prioridade:
//   one_shot PAUSE > recurring RESUME
// Ou seja: se um target tem um one_shot ativo de pause cuja janela ainda
// está em vigor (run_at <= now() e ainda não foi "encerrado" por um one_shot
// de resume posterior), não executamos resume recurring nele.
//
// Envs necessárias:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   META_ACCESS_TOKEN          (system user token, 60d)
//
// Endpoint Meta: POST https://graph.facebook.com/v23.0/{id}  body: status=PAUSED|ACTIVE
// =============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const META_API_VERSION = 'v23.0'
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`
const TZ = 'America/Sao_Paulo'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const META_TOKEN = Deno.env.get('META_ACCESS_TOKEN')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Rule = {
  id: string
  target_type: 'campaign' | 'adset'
  target_id: string
  target_name: string | null
  action: 'pause' | 'resume'
  schedule_type: 'recurring' | 'one_shot'
  cron_expression: string | null
  run_at: string | null
  timezone: string
  reason: string | null
  active: boolean
  last_run_at: string | null
  last_run_status: string | null
}

// ---------------------------------------------------------------------------
// CRON MATCHING — implementação minimalista (5 campos: min hour dom mon dow)
// Suporta: números puros, *, listas (1,2,3), ranges (1-5), steps (*/5).
// Suficiente para os usos atuais: "0 17 * * 5", "0 7 * * 1".
// ---------------------------------------------------------------------------

function parseField(field: string, min: number, max: number): number[] {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    let step = 1
    let range = part
    if (part.includes('/')) {
      const [r, s] = part.split('/')
      range = r
      step = parseInt(s, 10)
    }
    let start = min
    let end = max
    if (range === '*') {
      // start/end já no default
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map((x) => parseInt(x, 10))
      start = a
      end = b
    } else {
      start = parseInt(range, 10)
      end = start
    }
    for (let v = start; v <= end; v += step) {
      if (v >= min && v <= max) out.add(v)
    }
  }
  return [...out]
}

function cronMatchesNow(cronExpr: string, now: Date): boolean {
  // now em horário local BR (offset embutido manualmente — Deno tem Intl, mas
  // queremos algo direto e auditável).
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minF, hourF, domF, monF, dowF] = parts

  // Converter `now` (UTC) para BR (-03 fixo; Brasil não tem horário de verão desde 2019)
  const brOffsetMs = -3 * 60 * 60 * 1000
  const brNow = new Date(now.getTime() + brOffsetMs)
  const min = brNow.getUTCMinutes()
  const hour = brNow.getUTCHours()
  const dom = brNow.getUTCDate()
  const mon = brNow.getUTCMonth() + 1
  // JS getUTCDay(): 0=Domingo .. 6=Sábado. Cron: 0=Domingo .. 6=Sábado, 7=Domingo. OK.
  const dow = brNow.getUTCDay()

  return (
    parseField(minF, 0, 59).includes(min) &&
    parseField(hourF, 0, 23).includes(hour) &&
    parseField(domF, 1, 31).includes(dom) &&
    parseField(monF, 1, 12).includes(mon) &&
    parseField(dowF, 0, 6).includes(dow === 7 ? 0 : dow)
  )
}

// ---------------------------------------------------------------------------
// META API
// ---------------------------------------------------------------------------

async function setMetaStatus(targetId: string, status: 'PAUSED' | 'ACTIVE'): Promise<{ ok: boolean; response: unknown }> {
  const url = `${META_BASE}/${targetId}`
  const form = new URLSearchParams()
  form.set('status', status)
  form.set('access_token', META_TOKEN)

  const resp = await fetch(url, { method: 'POST', body: form })
  const json = await resp.json().catch(() => ({ raw: 'no-json' }))
  return { ok: resp.ok && (json as { success?: boolean }).success !== false, response: json }
}

// ---------------------------------------------------------------------------
// PRIORIDADE — descobrir targets sob "blackout" por one_shot pause
// ---------------------------------------------------------------------------
//
// Um target está em blackout se:
//   - existe regra ativa one_shot PAUSE com run_at <= now()
//   - E não existe regra ativa one_shot RESUME para o mesmo target com
//     run_at > (run_at do pause) E run_at <= now() (ou seja, o resume
//     posterior ainda não chegou)
//
// Targets em blackout NÃO recebem ações recurring (nem pause adicional,
// nem resume — ficam congelados PAUSED até o resume one_shot chegar).

async function getBlackoutTargets(now: Date): Promise<Set<string>> {
  const nowIso = now.toISOString()
  const { data: oneShots, error } = await supabase
    .from('ad_schedule_rules')
    .select('target_type, target_id, action, run_at')
    .eq('schedule_type', 'one_shot')
    .eq('active', true)
    .lte('run_at', nowIso)
    .order('run_at', { ascending: true })

  if (error || !oneShots) return new Set()

  // Para cada target, escanear histórico em ordem cronológica para descobrir
  // estado atual (PAUSE pendente sem RESUME posterior = blackout).
  const stateByTarget = new Map<string, 'paused' | 'released'>()
  for (const r of oneShots) {
    const key = `${r.target_type}:${r.target_id}`
    if (r.action === 'pause') stateByTarget.set(key, 'paused')
    else if (r.action === 'resume') stateByTarget.set(key, 'released')
  }

  const blackout = new Set<string>()
  for (const [key, state] of stateByTarget) {
    if (state === 'paused') blackout.add(key)
  }
  return blackout
}

// ---------------------------------------------------------------------------
// LOG
// ---------------------------------------------------------------------------

async function log(entry: {
  rule_id: string
  target_type: string
  target_id: string
  target_name: string | null
  action: string
  status: 'success' | 'error' | 'noop' | 'skipped'
  message?: string
  meta_response?: unknown
}) {
  await supabase.from('ad_schedule_log').insert({
    rule_id: entry.rule_id,
    target_type: entry.target_type,
    target_id: entry.target_id,
    target_name: entry.target_name,
    action: entry.action,
    status: entry.status,
    message: entry.message ?? null,
    meta_response: entry.meta_response ?? null,
  })

  await supabase
    .from('ad_schedule_rules')
    .update({
      last_run_at: new Date().toISOString(),
      last_run_status: entry.status,
      last_run_message: entry.message ?? null,
    })
    .eq('id', entry.rule_id)
}

// ---------------------------------------------------------------------------
// HANDLER
// ---------------------------------------------------------------------------

async function tick(now: Date): Promise<{ executed: number; skipped: number; errors: number }> {
  const counters = { executed: 0, skipped: 0, errors: 0 }

  // 1. Carregar todas as regras ativas
  const { data: rules, error } = await supabase
    .from('ad_schedule_rules')
    .select('*')
    .eq('active', true)

  if (error || !rules) {
    console.error('Failed to load rules:', error)
    return counters
  }

  // 2. Descobrir targets em blackout (one_shot pause pendente)
  const blackout = await getBlackoutTargets(now)

  // 3. Avaliar cada regra
  for (const r of rules as Rule[]) {
    const targetKey = `${r.target_type}:${r.target_id}`

    // 3a. Decidir se a regra deve disparar agora
    let shouldFire = false
    if (r.schedule_type === 'one_shot') {
      // Dispara se run_at <= now e ainda não foi executada (last_run_at < run_at)
      if (!r.run_at) continue
      const runAt = new Date(r.run_at)
      if (runAt > now) continue
      if (r.last_run_at && new Date(r.last_run_at) >= runAt) continue
      shouldFire = true
    } else {
      // recurring: cron match minuto exato
      if (!r.cron_expression) continue
      shouldFire = cronMatchesNow(r.cron_expression, now)
      if (!shouldFire) continue
      // Deduplicação: se já rodou neste minuto, pular
      if (r.last_run_at) {
        const last = new Date(r.last_run_at)
        if (now.getTime() - last.getTime() < 60_000) continue
      }
    }

    if (!shouldFire) continue

    // 3b. Aplicar regra de prioridade
    //   - one_shot sempre executa (independente de blackout — pode ser o próprio resume liberando)
    //   - recurring é skipado se o target está em blackout (one_shot pause pendente)
    if (r.schedule_type === 'recurring' && blackout.has(targetKey)) {
      await log({
        rule_id: r.id,
        target_type: r.target_type,
        target_id: r.target_id,
        target_name: r.target_name,
        action: r.action,
        status: 'skipped',
        message: 'Target em blackout por one_shot pause ativo',
      })
      counters.skipped++
      continue
    }

    // 3c. Disparar Meta API
    const newStatus = r.action === 'pause' ? 'PAUSED' : 'ACTIVE'
    try {
      const { ok, response } = await setMetaStatus(r.target_id, newStatus)
      await log({
        rule_id: r.id,
        target_type: r.target_type,
        target_id: r.target_id,
        target_name: r.target_name,
        action: r.action,
        status: ok ? 'success' : 'error',
        message: ok ? `Set status=${newStatus}` : `Meta API rejected: ${JSON.stringify(response)}`,
        meta_response: response,
      })
      if (ok) counters.executed++
      else counters.errors++
    } catch (err) {
      await log({
        rule_id: r.id,
        target_type: r.target_type,
        target_id: r.target_id,
        target_name: r.target_name,
        action: r.action,
        status: 'error',
        message: `Exception: ${(err as Error).message}`,
      })
      counters.errors++
    }
  }

  return counters
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('authorization') || ''
  const expectedAuth = `Bearer ${Deno.env.get('CRON_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  const now = new Date()
  const result = await tick(now)

  return new Response(
    JSON.stringify({
      timestamp: now.toISOString(),
      timezone: TZ,
      ...result,
    }),
    { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
})
