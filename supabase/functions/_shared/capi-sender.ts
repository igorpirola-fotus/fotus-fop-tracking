// supabase/functions/_shared/capi-sender.ts
// Helper compartilhado: hash SHA-256, normalização de telefone, envio CAPI Meta

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const META_API_VERSION = 'v18.0'
const MAX_RETRIES = 3

// ─── Hash SHA-256 ────────────────────────────────────────────────────────────

export async function hashValue(value: string): Promise<string> {
  const normalized = value.toLowerCase().trim()
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Normalização de telefone (E.164) ────────────────────────────────────────

export function normalizePhone(phone: string): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`
  if (digits.length === 11 || digits.length === 10) return `+55${digits}`
  return `+55${digits}`
}

// ─── Construção do user_data com Advanced Matching ───────────────────────────

export async function buildUserData(params: {
  email?: string
  phone?: string
  nome?: string
  cidade?: string
  estado?: string
  cep?: string
  ip?: string
  userAgent?: string
  fbp?: string
  fbc?: string
}): Promise<Record<string, any>> {
  const ud: Record<string, any> = {}

  if (params.email) ud.em = [await hashValue(params.email)]
  if (params.phone) {
    const normalized = normalizePhone(params.phone)
    if (normalized) ud.ph = [await hashValue(normalized)]
  }
  if (params.nome) {
    const parts = params.nome.trim().split(' ')
    if (parts[0]) ud.fn = [await hashValue(parts[0])]
    if (parts.length > 1) ud.ln = [await hashValue(parts.slice(1).join(' '))]
  }
  if (params.cidade) ud.ct = [await hashValue(params.cidade)]
  if (params.estado) ud.st = [await hashValue(params.estado.toLowerCase())]
  if (params.cep) ud.zp = [await hashValue(params.cep.replace(/\D/g, ''))]

  ud.country = ['br']
  if (params.ip) ud.client_ip_address = params.ip
  if (params.userAgent) ud.client_user_agent = params.userAgent
  if (params.fbp) ud.fbp = params.fbp
  if (params.fbc) ud.fbc = params.fbc

  return ud
}

// ─── Envio ao Meta CAPI com retry exponencial ─────────────────────────────

export async function sendToCAPI(params: {
  event_name: string
  event_id: string
  event_source_url?: string
  action_source: string     // 'website' | 'crm' | 'other'
  user_data: Record<string, any>
  custom_data?: Record<string, any>
  test_event_code?: string
}): Promise<{ success: boolean; eventId?: string; fbtrace_id?: string; error?: string }> {

  const pixelId = Deno.env.get('META_PIXEL_ID')!
  const token = Deno.env.get('META_CAPI_TOKEN')!
  const url = `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events`

  const payload = {
    data: [{
      event_name: params.event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: params.event_id,
      event_source_url: params.event_source_url,
      action_source: params.action_source,
      user_data: params.user_data,
      custom_data: params.custom_data
    }],
    access_token: token,
    ...(params.test_event_code && { test_event_code: params.test_event_code })
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const result = await response.json()

      if (response.ok && result.events_received > 0) {
        return { success: true, eventId: result.events_received?.toString(), fbtrace_id: result.fbtrace_id }
      }

      if (attempt === MAX_RETRIES) {
        return { success: false, error: JSON.stringify(result.error || result) }
      }

      // Backoff exponencial: 1s → 2s → 4s
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))

    } catch (err) {
      if (attempt === MAX_RETRIES) {
        return { success: false, error: err.message }
      }
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
    }
  }

  return { success: false, error: 'Max retries exceeded' }
}
