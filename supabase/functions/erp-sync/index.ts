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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const body = await req.json()
    const {
      cnpj,
      order_id,
      order_value,
      is_first_order,
      erp_id,
      webhook_secret,
    } = body

    // Validar secret fail-closed
    const expectedSecret = Deno.env.get('ERP_WEBHOOK_SECRET')
    if (!expectedSecret || webhook_secret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    const cnpjClean = cnpj?.replace(/\D/g, '')
    if (!cnpjClean || !order_id) {
      return new Response(JSON.stringify({ error: 'cnpj e order_id são obrigatórios' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    // Buscar integrador
    const { data: integrador } = await supabase
      .from('integradores')
      .select('id, email, phone, nome_contato, estado_operacao, cidade_operacao, numero_pedidos, ltv_total, ticket_medio')
      .eq('cnpj', cnpjClean)
      .maybeSingle()

    if (!integrador) {
      return new Response(JSON.stringify({ error: `integrador CNPJ ${cnpjClean} não encontrado` }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    // Buscar última sessão
    const { data: session } = await supabase
      .from('sessions')
      .select('session_id, fbp, fbc, gclid, ga4_client_id, utm_source, utm_campaign')
      .eq('integrador_id', integrador.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Purchase = primeiro pedido | PurchaseRecorrente = pedidos seguintes
    const eventName = is_first_order ? 'Purchase' : 'PurchaseRecorrente'

    // Idempotência: event_id determinístico
    const eventIdStr = `${eventName}_${order_id}_${cnpjClean}`
    const eventIdBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(eventIdStr))
    const eventId = Array.from(new Uint8Array(eventIdBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 36)

    const { data: existingEvent } = await supabase
      .from('events')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle()

    if (existingEvent) {
      return new Response(JSON.stringify({ skipped: true, reason: 'duplicate_event' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200
      })
    }

    // Atualizar métricas do integrador
    const numeroPedidos = (integrador.numero_pedidos || 0) + 1
    const ltvTotal      = Number(integrador.ltv_total || 0) + Number(order_value || 0)

    await supabase.from('integradores').update({
      status:           'cliente',
      numero_pedidos:   numeroPedidos,
      ltv_total:        ltvTotal,
      ticket_medio:     ltvTotal / numeroPedidos,
      data_ultima_compra: new Date().toISOString(),
      ...(erp_id && { erp_id }),
      ...(is_first_order && { data_primeira_compra: new Date().toISOString() }),
      updated_at: new Date().toISOString()
    }).eq('id', integrador.id)

    // User data com Advanced Matching
    const userData = await buildUserData({
      email:  integrador.email           || undefined,
      phone:  integrador.phone           || undefined,
      nome:   integrador.nome_contato    || undefined,
      estado: integrador.estado_operacao || undefined,
      cidade: integrador.cidade_operacao || undefined,
      fbp:    session?.fbp || undefined,
      fbc:    session?.fbc || undefined,
    })

    // Insert evento
    await supabase.from('events').insert({
      event_id:      eventId,
      session_id:    session?.session_id || null,
      integrador_id: integrador.id,
      event_name:    eventName,
      event_source:  'system_generated',
      funnel:        'aquisicao',
      event_data:    body,
      meta_capi_status: 'pending',
      gclid:         session?.gclid        || null,
      utm_source:    session?.utm_source   || null,
      utm_campaign:  session?.utm_campaign || null,
    })

    // Meta CAPI
    const capiResult = await sendToCAPI({
      event_name:    eventName,
      event_id:      eventId,
      action_source: 'system_generated',
      user_data:     userData,
      custom_data: {
        currency: 'BRL',
        value:    order_value || 0,
        order_id,
        cnpj:     cnpjClean,
      },
    })

    await supabase.from('events').update({
      meta_capi_status: capiResult.success ? 'sent' : 'failed',
      meta_event_id:    capiResult.eventId    || null,
      meta_fbtrace_id:  capiResult.fbtrace_id || null,
      meta_error:       capiResult.error       || null,
    }).eq('event_id', eventId)

    // GA4 — só Purchase (primeiro pedido) vai para GA4 → Google Ads
    // PurchaseRecorrente vai apenas para Meta (audiências de retenção)
    if (is_first_order) {
      sendToGA4({
        event_name: 'Purchase',
        client_id:  session?.ga4_client_id || session?.session_id || cnpjClean,
        session_id: session?.session_id || undefined,
        user_id:    integrador.id,
        event_params: {
          transaction_id: order_id,
          value:          order_value || 0,
          currency:       'BRL',
          gclid:          session?.gclid || undefined,
        }
      }).catch(() => {})
    }

    return new Response(
      JSON.stringify({ success: true, event: eventName, capi: capiResult.success }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    await supabase.from('error_logs').insert({
      function_name: 'erp-sync',
      error_message: error.message,
      payload: null
    }).catch(() => {})

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})
