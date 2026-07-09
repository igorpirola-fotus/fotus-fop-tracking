import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendToCAPI, buildUserData } from '../_shared/capi-sender.ts'
import { sendToGA4 } from '../_shared/ga4-sender.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mapeamento etapa RD CRM → evento Meta/GA4
// Chaves em lowercase para comparação case-insensitive
const STAGE_TO_EVENT: Record<string, string> = {
  // Contact — primeiro contato real (case-insensitive já tratado no código)
  'contato realizado':  'Contact',   // SDR + BDR
  'em contato':         'Contact',   // Funil Comercial (mantém compatibilidade)

  // Schedule = SQL "Lead Qualificado Fotus" — evento que as campanhas otimizam
  'qualificado sqls':   'Schedule',  // SDR + BDR

  // AddToCart — proposta/negociação ativa
  'reunião agendada':   'AddToCart', // SDR → handoff para Comercial
  'negociação':         'AddToCart', // BDR
  'orçamento':          'AddToCart', // Funil Comercial

  // won/lost tratados por document.status (independem do nome) — manter
  'perdido':            'OportunidadePerdida',
  'ganho':              'Purchase',   // deal won no RD CRM (vem do ERP via integração)
}

const EVENT_TO_STATUS: Record<string, string> = {
  'Contact':              'em_contato',
  'Schedule':             'qualificado',
  'AddToCart':            'proposta',
  'OportunidadePerdida':  'perdido',
  'Purchase':             'cliente',
  'PurchaseRecorrente':   'cliente',
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  let rawBody: unknown = null

  try {
    rawBody = await req.json()
    const body = rawBody as Record<string, unknown>

    // ── Autenticação via Authorization: Bearer (API v2 padrão) ──────────────
    const authHeader = req.headers.get('authorization') || ''
    const receiverToken = Deno.env.get('RD_WEBHOOK_RECEIVER_TOKEN')
    if (!receiverToken || authHeader !== `Bearer ${receiverToken}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    // ── Extrair campos do payload ────────────────────────────────────────────
    let stage: string, cnpj: string, email: string, phone: string,
        nome: string, rd_deal_id: string, deal_value: number

    if (body.event_name && body.document) {
      // RD Station CRM v2 — payload nativo (event_name + document)
      if (!(body.event_name as string).includes('deal')) {
        return new Response(
          JSON.stringify({ skipped: true, reason: `event_name '${body.event_name}' não é de negociação` }),
          { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      const doc = body.document as Record<string, unknown>

      if (doc.status === 'won') {
        stage = 'ganho'
      } else if (doc.status === 'lost') {
        stage = 'perdido'
      } else {
        stage = (doc.deal_stage as Record<string, unknown>)?.name as string || ''
      }

      // ── Idempotência: gerar dedup_key e persistir payload bruto ───────────
      const entityId = doc.id?.toString() || null
      const updatedAt = (doc.updated_at as string) || 'no-updated-at'
      const dedupKey = entityId
        ? `rdstation:${body.event_name}:${entityId}:${updatedAt}`
        : `rdstation:${body.event_name}:payload:${await sha256Hex(JSON.stringify(body))}`

      const { error: insertError } = await supabase
        .from('rdstation_crm_webhook_events')
        .insert({
          dedup_key:         dedupKey,
          event_name:        body.event_name as string,
          entity_id:         entityId,
          payload:           body,
          processing_status: 'processing',
          received_at:       new Date().toISOString(),
        })

      if (insertError) {
        // Conflito de dedup_key = evento já processado → ignorar silenciosamente
        if (insertError.code === '23505') {
          return new Response(
            JSON.stringify({ skipped: true, reason: 'duplicate_event', dedup_key: dedupKey }),
            { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
          )
        }
        throw new Error(`rdstation_crm_webhook_events insert: ${insertError.message}`)
      }

      // ── Extrair CNPJ — 4 estratégias de fallback ─────────────────────────

      // 1) deal_custom_fields (se existir no deal)
      const cnpjField = ((doc.deal_custom_fields as unknown[]) || []).find(
        (f: unknown) => {
          const field = f as Record<string, unknown>
          return (field.custom_field as Record<string, unknown>)
            ?.label?.toString().toLowerCase().includes('cnpj')
        }
      ) as Record<string, unknown> | undefined
      cnpj = (cnpjField?.value as string) || ''

      // 2) custom_fields da organização vinculada no payload do webhook
      if (!cnpj) {
        const org = doc.organization as Record<string, unknown> | undefined
        if (org?.custom_fields) {
          const orgFields = org.custom_fields as Record<string, unknown>
          const cnpjKey = Object.keys(orgFields).find(k => k.includes('cnpj'))
          if (cnpjKey) cnpj = (orgFields[cnpjKey] as string) || ''
        }
      }

      // 3) Consulta ativa via API CRM caso o webhook envie apenas o organization_id
      if (!cnpj && doc.organization_id) {
        try {
          const rdCrmToken = Deno.env.get('RD_CRM_TOKEN')
          if (rdCrmToken) {
            const orgRes = await fetch(
              `https://api.rd.services/crm/v2/organizations/${doc.organization_id}`,
              {
                headers: {
                  'Authorization': `Bearer ${rdCrmToken}`,
                  'Accept': 'application/json, text/event-stream'
                }
              }
            )
            if (orgRes.ok) {
              const orgJson = await orgRes.json()
              const orgData = orgJson.data || orgJson
              const orgFields = (orgData.custom_fields as Record<string, unknown>) || {}
              const cnpjKey = Object.keys(orgFields).find(k => k.includes('cnpj'))
              if (cnpjKey) cnpj = (orgFields[cnpjKey] as string) || ''
            }
          }
        } catch (apiErr) {
          console.error('Erro ao buscar organização via API CRM no rd-sync:', apiErr.message)
        }
      }

      // 4) CNPJ embutido no nome da organização (padrão "RAZÃO SOCIAL 14DIGITOS")
      if (!cnpj) {
        const orgName = ((doc.organization as Record<string, unknown>)?.name as string) || ''
        const match = orgName.match(/(\d{14})/)
        if (match) cnpj = match[1]
      }

      const contact = ((doc.contacts as unknown[]) || [])[0] as Record<string, unknown> || {}
      email      = (contact.email as string) || ''
      phone      = (contact.mobile_phone as string) || (contact.phone as string) || ''
      nome       = (contact.name as string) || ''
      rd_deal_id = entityId || ''
      deal_value = (doc.amount_total as number) || 0

      // ── Processar evento ──────────────────────────────────────────────────
      try {
        const result = await _processEvent({
          stage, cnpj, email, phone, nome, rd_deal_id, deal_value, body
        })

        await supabase
          .from('rdstation_crm_webhook_events')
          .update({ processing_status: 'processed', processed_at: new Date().toISOString() })
          .eq('dedup_key', dedupKey)

        return new Response(
          JSON.stringify({ success: true, ...result }),
          { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
        )

      } catch (procError) {
        await supabase
          .from('rdstation_crm_webhook_events')
          .update({ processing_status: 'failed', error_message: (procError as Error).message })
          .eq('dedup_key', dedupKey)
        throw procError
      }

    } else {
      // Formato interno normalizado (testes / chamadas manuais) — sem dedup
      stage      = (body.stage as string) || ''
      cnpj       = (body.cnpj as string) || ''
      email      = (body.email as string) || ''
      phone      = (body.phone as string) || ''
      nome       = (body.nome as string) || ''
      rd_deal_id = (body.rd_deal_id as string) || ''
      deal_value = (body.deal_value as number) || (body.order_value as number) || 0

      const result = await _processEvent({ stage, cnpj, email, phone, nome, rd_deal_id, deal_value, body })
      return new Response(
        JSON.stringify({ success: true, ...result }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

  } catch (error) {
    await supabase.from('error_logs').insert({
      function_name: 'rd-sync',
      error_message: (error as Error).message,
      payload: rawBody ?? null
    }).catch(() => {})

    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})

// ── Lógica principal separada para ser chamada após persistência do raw event ──
async function _processEvent(params: {
  stage: string, cnpj: string, email: string, phone: string,
  nome: string, rd_deal_id: string, deal_value: number,
  body: Record<string, unknown>
}): Promise<{ event: string; capi: boolean }> {
  const { stage, cnpj, email, phone, nome, rd_deal_id, deal_value, body } = params

  const stageLower = stage.toLowerCase().trim()
  const eventName = STAGE_TO_EVENT[stageLower]

  if (!eventName) {
    return { event: 'skipped', capi: false }
  }

  const cnpjClean = cnpj.replace(/\D/g, '')
  if (!cnpjClean) {
    throw new Error('cnpj obrigatório')
  }

  const { data: integrador } = await supabase
    .from('integradores')
    .select('id, email, phone, nome_contato, estado_operacao, cidade_operacao, rd_deal_id, numero_pedidos, ltv_total')
    .eq('cnpj', cnpjClean)
    .maybeSingle()

  if (!integrador) {
    throw new Error(`integrador CNPJ ${cnpjClean} não encontrado`)
  }

  let finalEventName = eventName
  if (eventName === 'Purchase') {
    const isFirstOrder = !integrador.numero_pedidos || integrador.numero_pedidos === 0
    finalEventName = isFirstOrder ? 'Purchase' : 'PurchaseRecorrente'
  }

  const eventIdStr = `rd_${finalEventName}_${rd_deal_id}_${cnpjClean}`
  const eventId = (await sha256Hex(eventIdStr)).substring(0, 36)

  const { data: existingEvent } = await supabase
    .from('events')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle()

  if (existingEvent) {
    return { event: finalEventName, capi: false }
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('session_id, fbp, fbc, gclid, ga4_client_id, utm_source, utm_campaign')
    .eq('integrador_id', integrador.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const orderValue = deal_value
  const updatePayload: Record<string, unknown> = {
    status: EVENT_TO_STATUS[finalEventName] || EVENT_TO_STATUS[eventName],
    rd_deal_id: rd_deal_id || integrador.rd_deal_id,
    updated_at: new Date().toISOString()
  }
  if (eventName === 'Schedule') {
    updatePayload.data_qualificacao = new Date().toISOString()
  }
  if (eventName === 'Purchase') {
    const numeroPedidos = (integrador.numero_pedidos || 0) + 1
    const ltvTotal = Number(integrador.ltv_total || 0) + Number(orderValue)
    updatePayload.numero_pedidos   = numeroPedidos
    updatePayload.ltv_total        = ltvTotal
    updatePayload.ticket_medio     = ltvTotal / numeroPedidos
    updatePayload.data_ultima_compra = new Date().toISOString()
    if (finalEventName === 'Purchase') {
      updatePayload.data_primeira_compra = new Date().toISOString()
    }
  }
  await supabase.from('integradores').update(updatePayload).eq('id', integrador.id)

  const resolvedEmail = email || integrador.email
  const resolvedPhone = phone || integrador.phone
  const resolvedNome  = nome  || integrador.nome_contato

  const userData = await buildUserData({
    email:  resolvedEmail || undefined,
    phone:  resolvedPhone || undefined,
    nome:   resolvedNome  || undefined,
    estado: integrador.estado_operacao || undefined,
    cidade: integrador.cidade_operacao || undefined,
    fbp:    session?.fbp  || undefined,
    fbc:    session?.fbc  || undefined,
  })

  // eventId já gerado no início do método

  await supabase.from('events').insert({
    event_id:      eventId,
    session_id:    session?.session_id || null,
    integrador_id: integrador.id,
    event_name:    finalEventName,
    event_source:  'system_generated',
    funnel:        'aquisicao',
    event_data:    body,
    meta_capi_status: 'pending',
    gclid:         session?.gclid        || null,
    utm_source:    session?.utm_source   || null,
    utm_campaign:  session?.utm_campaign || null,
  })

  const capiResult = await sendToCAPI({
    event_name:    finalEventName,
    event_id:      eventId,
    action_source: 'system_generated',
    user_data:     userData,
    custom_data:   {
      cnpj: cnpjClean,
      ...(eventName === 'Purchase' && { currency: 'BRL', value: orderValue })
    },
  })

  await supabase.from('events').update({
    meta_capi_status: capiResult.success ? 'sent' : 'failed',
    meta_event_id:    capiResult.eventId    || null,
    meta_fbtrace_id:  capiResult.fbtrace_id || null,
    meta_error:       capiResult.error       || null,
  }).eq('event_id', eventId)

  if (finalEventName !== 'PurchaseRecorrente') {
    sendToGA4({
      event_name: finalEventName,
      client_id:  session?.ga4_client_id || session?.session_id || cnpjClean,
      session_id: session?.session_id || undefined,
      user_id:    integrador.id,
      event_params: {
        gclid:        session?.gclid        || undefined,
        utm_source:   session?.utm_source   || undefined,
        utm_campaign: session?.utm_campaign || undefined,
        ...(finalEventName === 'Purchase' && { value: orderValue, currency: 'BRL' })
      }
    }).catch(() => {})
  }

  return { event: finalEventName, capi: capiResult.success }
}
