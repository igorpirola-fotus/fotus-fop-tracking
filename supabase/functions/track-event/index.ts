import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendToCAPI, buildUserData, normalizePhone } from '../_shared/capi-sender.ts'
import { sendToGA4 } from '../_shared/ga4-sender.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const body = await req.json()
    const {
      event_id, event_name, session_id,
      fbp, fbc,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, ga4_client_id, ga4_session_id,
      referrer, page_url, device_type,
      scroll_depth_pct, time_on_page_seconds,
      // Lead-only
      email, phone, nome, cnpj, estado,
      // Teste CAPI
      test_event_code
    } = body

    if (!event_id || !event_name || !session_id) {
      return new Response(
        JSON.stringify({ error: 'event_id, event_name e session_id são obrigatórios' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // ── Geo via Cloudflare headers (zero latência) ────────────────────────────
    const ip          = req.headers.get('CF-Connecting-IP') || req.headers.get('x-forwarded-for') || ''
    const country     = req.headers.get('CF-IPCountry') || 'BR'
    const cfState     = req.headers.get('CF-IPRegion') || ''
    const cfCity      = req.headers.get('CF-IPCity') || ''
    const userAgent   = req.headers.get('user-agent') || ''

    // Dados do formulário têm prioridade sobre Cloudflare
    const geoState = estado || cfState
    const geoCity  = cfCity

    // ── 1. Upsert session ─────────────────────────────────────────────────────
    const { error: sessionError } = await supabase
      .from('sessions')
      .upsert({
        session_id,
        fbp, fbc,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        ip_address: ip || null,
        user_agent: userAgent || null,
        country,
        state: geoState || null,
        city: geoCity || null,
        gclid: gclid || null,
        ga4_client_id: ga4_client_id || null,
        ga4_session_id: ga4_session_id || null,
        referrer: referrer || null,
        device_type: device_type || null,
        scroll_depth_pct: scroll_depth_pct ?? null,
        time_on_page_seconds: time_on_page_seconds ?? null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id' })

    if (sessionError) throw new Error(`session upsert: ${sessionError.message}`)

    // ── 2. Upsert integrador (somente Lead com CNPJ) ──────────────────────────
    let integradorId: string | null = null
    let isNewIntegrador = false

    if (event_name === 'Lead' && cnpj) {
      const cnpjClean = cnpj.replace(/\D/g, '')

      const { data: existing } = await supabase
        .from('integradores')
        .select('id, status')
        .eq('cnpj', cnpjClean)
        .maybeSingle()

      isNewIntegrador = !existing

      const upsertPayload: Record<string, unknown> = {
        cnpj: cnpjClean,
        email: email || null,
        phone: phone ? normalizePhone(phone).replace('+', '') : null,
        nome_contato: nome || null,
        estado_operacao: geoState || null,
        cidade_operacao: geoCity || null,
        status: existing?.status ?? 'lead',
        updated_at: new Date().toISOString()
      }

      if (isNewIntegrador) {
        upsertPayload.data_primeiro_contato = new Date().toISOString()
      }

      const { data: intData, error: intError } = await supabase
        .from('integradores')
        .upsert(upsertPayload, { onConflict: 'cnpj' })
        .select('id')
        .single()

      if (intError) throw new Error(`integrador upsert: ${intError.message}`)
      integradorId = intData.id

      // Vincular integrador à sessão
      await supabase
        .from('sessions')
        .update({ integrador_id: integradorId })
        .eq('session_id', session_id)

    } else {
      // Para outros eventos, recuperar integrador já associado à sessão
      const { data: sess } = await supabase
        .from('sessions')
        .select('integrador_id')
        .eq('session_id', session_id)
        .maybeSingle()
      integradorId = sess?.integrador_id ?? null
    }

    // ── 3. Enrich CNPJ async para novos integradores ──────────────────────────
    if (isNewIntegrador && integradorId && cnpj) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      fetch(`${supabaseUrl}/functions/v1/enrich-cnpj`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ cnpj: cnpj.replace(/\D/g, ''), integrador_id: integradorId })
      }).catch(() => {}) // fire-and-forget — nunca bloqueia o fluxo principal
    }

    // ── 4. User data com Advanced Matching (SHA-256) ──────────────────────────
    const userData = await buildUserData({
      email:     email     || undefined,
      phone:     phone     || undefined,
      nome:      nome      || undefined,
      estado:    geoState  || undefined,
      cidade:    geoCity   || undefined,
      ip,
      userAgent,
      fbp:       fbp       || undefined,
      fbc:       fbc       || undefined
    })

    const matchKeys = {
      has_em:  !!userData.em,
      has_ph:  !!userData.ph,
      has_fn:  !!userData.fn,
      has_fbp: !!userData.fbp,
      has_fbc: !!userData.fbc,
      has_ct:  !!userData.ct,
      has_st:  !!userData.st
    }

    // ── 5. Insert evento (pending) ────────────────────────────────────────────
    const { error: eventError } = await supabase
      .from('events')
      .insert({
        event_id,
        session_id,
        integrador_id: integradorId,
        event_name,
        event_source: 'website',
        funnel: 'aquisicao',
        event_data: body,
        meta_capi_status: 'pending',
        match_keys: matchKeys,
        gclid: gclid || null,
        utm_source:   utm_source   || null,
        utm_campaign: utm_campaign || null,
        utm_content:  utm_content  || null
      })

    // Ignorar duplicata (event_id já existe — deduplicação client-side)
    if (eventError && !eventError.message.includes('duplicate key')) {
      throw new Error(`event insert: ${eventError.message}`)
    }

    // ── 6. Meta CAPI ──────────────────────────────────────────────────────────
    const capiResult = await sendToCAPI({
      event_name,
      event_id,
      event_source_url: page_url || undefined,
      action_source: 'website',
      user_data: userData,
      custom_data: cnpj ? { cnpj: cnpj.replace(/\D/g, '') } : undefined,
      test_event_code: test_event_code || undefined
    })

    await supabase
      .from('events')
      .update({
        meta_capi_status:  capiResult.success ? 'sent' : 'failed',
        meta_event_id:     capiResult.eventId     || null,
        meta_fbtrace_id:   capiResult.fbtrace_id  || null,
        meta_error:        capiResult.error        || null,
        meta_retry_count:  capiResult.success ? 0 : 1
      })
      .eq('event_id', event_id)

    // ── 7. GA4 fire-and-forget ────────────────────────────────────────────────
    sendToGA4({
      event_name,
      client_id:  ga4_client_id || session_id,
      session_id,
      user_id:    integradorId  || undefined,
      event_params: {
        page_location: page_url    || undefined,
        utm_source,
        utm_campaign,
        utm_content,
        gclid: gclid || undefined
      }
    }).catch(() => {})

    return new Response(
      JSON.stringify({ success: true, capi: capiResult.success, integrador_id: integradorId }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    await supabase.from('error_logs').insert({
      function_name: 'track-event',
      error_message: error.message,
      payload: null
    }).catch(() => {})

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})
