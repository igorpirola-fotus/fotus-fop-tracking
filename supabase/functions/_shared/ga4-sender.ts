// supabase/functions/_shared/ga4-sender.ts
// Envio de eventos ao GA4 via Measurement Protocol (fire-and-forget)

// Mapa de eventos Meta → GA4 (nomes padrão GA4)
const META_TO_GA4: Record<string, string> = {
  'PageView':              'page_view',
  'ViewContent':           'view_item',
  'InitiateCheckout':      'begin_checkout',
  'Lead':                  'generate_lead',
  'Contact':               'contact',
  'Schedule':              'qualified_lead',
  'AddToCart':             'submit_proposal',
  'Purchase':              'purchase',
  'OportunidadePerdida':   'opportunity_lost',
  'IntegradorVIP':         'integrador_vip',
  'IntegradorAtivo':       'integrador_ativo',
  'IntegradorRisco':       'integrador_risco',
  'IntegradorExpansao':    'integrador_expansao',
  'IntegradorNPS9':        'integrador_nps9',
}

export async function sendToGA4(params: {
  event_name: string       // nome do evento Meta — será mapeado para GA4
  client_id: string        // usar ga4_client_id se disponível, fallback para session_id
  session_id?: string
  user_id?: string         // integrador_id quando disponível
  event_params?: Record<string, any>
  user_properties?: Record<string, any>
}): Promise<void> {
  const measurementId = Deno.env.get('GA4_MEASUREMENT_ID')
  const apiSecret = Deno.env.get('GA4_API_SECRET')

  if (!measurementId || !apiSecret) return  // silencioso se não configurado

  const ga4EventName = META_TO_GA4[params.event_name] || params.event_name.toLowerCase()

  const payload: Record<string, any> = {
    client_id: params.client_id,
    events: [{
      name: ga4EventName,
      params: {
        session_id: params.session_id,
        engagement_time_msec: 100,
        ...params.event_params
      }
    }]
  }

  if (params.user_id) {
    payload.user_id = params.user_id
  }

  if (params.user_properties) {
    payload.user_properties = Object.fromEntries(
      Object.entries(params.user_properties)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, { value: String(v) }])
    )
  }

  // Fire-and-forget: não bloqueia o fluxo principal
  fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  ).catch(() => {})  // falha silenciosa — GA4 não é crítico
}
