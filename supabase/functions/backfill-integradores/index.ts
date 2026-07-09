/**
 * backfill-integradores v3
 *
 * Fixes:
 * - Token refresh só roda em 401 (não no startup) — evita invalidar refresh_token prematuramente
 * - Após refresh bem-sucedido, salva novos tokens via Supabase Management API (SB_ADMIN_TOKEN)
 * - Evita consumir o refresh_token em cada invocação
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RD_BASE    = 'https://api.rd.services/crm/v2'
const PROJECT_REF = 'wttmlnhzvevtabjetsqz'

// Token lido dos secrets — válido por 2h
let rdToken = Deno.env.get('RD_CRM_TOKEN') || Deno.env.get('RD_ACCESS_TOKEN') || ''
let tokenRefreshed = false  // garante no máximo 1 refresh por invocação

// ── Refresh: salva novos tokens nos secrets via Management API ──────────────

async function refreshRdToken(): Promise<boolean> {
  if (tokenRefreshed) return false  // já tentou nesta invocação
  tokenRefreshed = true

  const cid = Deno.env.get('RD_CRM_CLIENT_ID')    || Deno.env.get('RD_CLIENT_ID')
  const cs  = Deno.env.get('RD_CRM_CLIENT_SECRET') || Deno.env.get('RD_CLIENT_SECRET')
  const rt  = Deno.env.get('RD_CRM_REFRESH_TOKEN') || Deno.env.get('RD_REFRESH_TOKEN')
  if (!cid || !cs || !rt) {
    console.warn('Refresh: credenciais não encontradas (RD_CRM_CLIENT_ID/SECRET/REFRESH_TOKEN).')
    return false
  }

  const params = new URLSearchParams({ client_id: cid, client_secret: cs,
                                        refresh_token: rt, grant_type: 'refresh_token' })
  const res = await fetch('https://api.rd.services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => `${res.status}`)
    console.error(`Refresh falhou (${res.status}): ${err.slice(0, 200)}`)
    return false
  }

  const j = await res.json()
  if (!j.access_token) { console.error('Refresh: access_token ausente na resposta.'); return false }

  rdToken = j.access_token
  console.log('✅ Token RD renovado via refresh.')

  // Salvar novos tokens nos secrets via Supabase Management API
  const adminToken = Deno.env.get('SB_ADMIN_TOKEN')
  if (adminToken && j.refresh_token) {
    const mgmt = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { name: 'RD_CRM_TOKEN',         value: j.access_token },
        { name: 'RD_CRM_REFRESH_TOKEN', value: j.refresh_token },
      ]),
    })
    if (mgmt.ok) console.log('✅ Novos tokens salvos nos secrets do Supabase.')
    else console.warn(`Falha ao salvar tokens nos secrets: ${mgmt.status}`)
  } else {
    console.warn('SB_ADMIN_TOKEN não encontrado — novos tokens NÃO foram salvos nos secrets.')
  }

  return true
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function rdHeaders() {
  return { Authorization: `Bearer ${rdToken}`, 'Content-Type': 'application/json' }
}

async function rateWait() { await new Promise(r => setTimeout(r, 520)) }

/** Fetch com retry em 429 e refresh automático em 401 */
async function rdFetch(url: string): Promise<Response> {
  let res = await fetch(url, { headers: rdHeaders() })

  if (res.status === 401) {
    console.warn(`401 em ${url} — tentando refresh do token...`)
    const ok = await refreshRdToken()
    if (ok) {
      res = await fetch(url, { headers: rdHeaders() })
    }
  }

  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') || '60') * 1000
    console.warn(`429 — aguardando ${wait/1000}s...`)
    await new Promise(r => setTimeout(r, wait))
    res = await fetch(url, { headers: rdHeaders() })
  }

  return res
}

// ── Extração de CNPJ (3 fallbacks) ───────────────────────────────────────────

function extractCnpj(org: Record<string, unknown>): string {
  const cf  = (org.custom_fields as Record<string, unknown>) || {}
  const key = Object.keys(cf).find(k => k.includes('cnpj'))
  if (key && cf[key]) return String(cf[key]).replace(/\D/g, '')
  const m = ((org.name as string) || '').match(/(\d{14})/)
  return m ? m[1] : ''
}

// ── Servidor ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const authHeader = req.headers.get("authorization") || ""
  const expectedAuth = `Bearer ${Deno.env.get("CRON_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    })
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const mode        = (body.mode           as string)  || 'won'
  const pageStart   = (body.page_start     as number)  || 1
  const pagesPerRun = Math.min((body.pages_per_run as number) || 10, 20)
  const dryRun      = (body.dry_run        as boolean) || false

  const result = {
    mode, page_start: pageStart, last_page: pageStart - 1,
    processed: 0, upserted: 0, skipped: 0,
    errors: [] as string[], has_more: false, next_page: pageStart,
  }

  // ── Modo orgs ───────────────────────────────────────────────────────────────
  if (mode === 'orgs') {
    for (let page = pageStart; page < pageStart + pagesPerRun; page++) {
      const res = await rdFetch(`${RD_BASE}/organizations?page[number]=${page}&page[size]=25`)
      if (!res.ok) { result.errors.push(`/organizations p${page}: ${res.status}`); break }
      const json = await res.json()
      const orgs: Record<string, unknown>[] = json.data || []
      result.processed += orgs.length
      result.last_page  = page
      result.has_more   = !!json.links?.next
      for (const org of orgs) {
        const cnpj  = extractCnpj(org)
        if (!cnpj || cnpj.length !== 14) { result.skipped++; continue }
        const cf    = (org.custom_fields as Record<string, unknown>) || {}
        const razao = (org.name as string)?.replace(/\s*\d{14}\s*$/, '').trim() || null
        if (!dryRun) {
          const { error } = await supabase.rpc('upsert_integrador_base', {
            p_cnpj: cnpj, p_razao_social: razao,
            p_cidade: (cf['cidade'] as string) || null,
            p_uf:     (cf['uf']     as string) || null,
          })
          if (error) { result.errors.push(`org ${cnpj}: ${error.message}`); continue }
        }
        result.upserted++
      }
      if (!result.has_more) break
      await rateWait()
    }
  }

  // ── Modo won ────────────────────────────────────────────────────────────────
  else if (mode === 'won') {
    const orgCache: Record<string, {
      cnpj: string; razao: string | null; cidade: string | null; uf: string | null
    }> = {}

    for (let page = pageStart; page < pageStart + pagesPerRun; page++) {
      const res = await rdFetch(
        `${RD_BASE}/deals?filter=status:won&sort[closed_at]=asc&page[number]=${page}&page[size]=25`
      )
      if (!res.ok) { result.errors.push(`/deals?won p${page}: ${res.status}`); break }
      const json  = await res.json()
      const deals: Record<string, unknown>[] = json.data || []
      result.last_page = page
      result.has_more  = !!json.links?.next

      for (const deal of deals) {
        result.processed++
        const orgId = deal.organization_id as string
        if (!orgId) { result.skipped++; continue }

        if (!orgCache[orgId]) {
          await rateWait()
          const orgRes = await rdFetch(`${RD_BASE}/organizations/${orgId}`)
          if (!orgRes.ok) {
            result.errors.push(`org ${orgId}: ${orgRes.status}`)
            result.skipped++; continue
          }
          const orgJson = await orgRes.json()
          const org  = orgJson.data as Record<string, unknown>
          const cnpj = extractCnpj(org)
          if (!cnpj || cnpj.length !== 14) { result.skipped++; continue }
          const cf = (org.custom_fields as Record<string, unknown>) || {}
          orgCache[orgId] = {
            cnpj,
            razao:  (org.name as string)?.replace(/\s*\d{14}\s*$/, '').trim() || null,
            cidade: (cf['cidade'] as string) || null,
            uf:     (cf['uf']     as string) || null,
          }
        }

        const o = orgCache[orgId]
        if (!o) { result.skipped++; continue }

        if (!dryRun) {
          const { error } = await supabase.rpc('upsert_integrador_won_deal', {
            p_cnpj:         o.cnpj,
            p_razao_social: o.razao,
            p_cidade:       o.cidade,
            p_uf:           o.uf,
            p_rd_deal_id:   deal.id as string,
            p_amount:       Number(deal.total_price) || 0,
            p_closed_at:    deal.closed_at as string,
          })
          if (error) { result.errors.push(`deal ${deal.id}: ${error.message}`); continue }
        }
        result.upserted++
      }

      if (!result.has_more) break
      await rateWait()
    }
  }

  else {
    result.errors.push(`mode inválido: "${mode}". Use "orgs" ou "won".`)
  }

  result.next_page = result.has_more ? result.last_page + 1 : result.last_page

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
