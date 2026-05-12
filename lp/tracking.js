/**
 * FOP Tracking Fotus — Script de captura client-side
 * Inserir antes de </body> na LP, logo após o snippet do Meta Pixel
 *
 * O que este script faz:
 * 1. Cria e persiste session_id único (localStorage + cookie)
 * 2. Captura e persiste UTMs, fbp, fbc, gclid, ga4_client_id
 * 3. Dispara PageView imediato via Edge Function (server-side)
 * 4. Dispara ViewContent (scroll 50% ou 30s)
 * 5. Dispara InitiateCheckout (foco no primeiro campo do form)
 * 6. Dispara Lead (submit do form com PII)
 * 7. Mantém Pixel client-side rodando em paralelo (deduplicação via event_id)
 */
(function() {
  'use strict'

  // ── Configuração ────────────────────────────────────────────────────────────
  const EDGE_URL = 'https://SEU-PROJECT-ID.supabase.co/functions/v1/track-event'

  // ── Helpers de cookie ───────────────────────────────────────────────────────
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
    return match ? decodeURIComponent(match[2]) : ''
  }

  function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString()
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`
  }

  // ── Session ID — persistência tripla (memory + localStorage + cookie) ───────
  function getOrCreateSessionId() {
    const key = 'fotus_sid'
    let sid = localStorage.getItem(key) || getCookie(key)
    if (!sid || sid.length < 10) {
      sid = crypto.randomUUID()
      localStorage.setItem(key, sid)
      setCookie(key, sid, 365)
    }
    return sid
  }

  const SESSION_ID = getOrCreateSessionId()

  // ── UTMs — captura e persiste por 30 dias ───────────────────────────────────
  function getUTMs() {
    const params = new URLSearchParams(window.location.search)
    const utmKeys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']
    const utms = {}
    utmKeys.forEach(k => {
      const v = params.get(k)
      if (v) {
        utms[k] = v
        localStorage.setItem(k, v)
        setCookie(k, v, 30)
      } else {
        const stored = localStorage.getItem(k) || getCookie(k)
        if (stored) utms[k] = stored
      }
    })
    return utms
  }

  // ── fbp e fbc — cookies do Meta Pixel ──────────────────────────────────────
  function getFBParams() {
    const fbp = getCookie('_fbp')
    const fbcFromCookie = getCookie('_fbc')
    const fbclid = new URLSearchParams(window.location.search).get('fbclid')

    let fbc = fbcFromCookie
    if (!fbc && fbclid) {
      fbc = `fb.1.${Date.now()}.${fbclid}`
      setCookie('_fbc', fbc, 90)
    }

    return { fbp, fbc }
  }

  // ── gclid — Google Click ID ─────────────────────────────────────────────────
  function getGCLID() {
    const params = new URLSearchParams(window.location.search)
    const gclid = params.get('gclid')
    if (gclid) {
      localStorage.setItem('fotus_gclid', gclid)
      setCookie('fotus_gclid', gclid, 90)
      return gclid
    }
    return localStorage.getItem('fotus_gclid') || getCookie('fotus_gclid') || ''
  }

  // ── GA4 Client ID — do cookie _ga ──────────────────────────────────────────
  function getGA4ClientId() {
    const gaCookie = getCookie('_ga')
    if (gaCookie) {
      const parts = gaCookie.split('.')
      if (parts.length >= 4) return `${parts[2]}.${parts[3]}`
    }
    return SESSION_ID  // fallback
  }

  // ── Device type ─────────────────────────────────────────────────────────────
  function getDeviceType() {
    const ua = navigator.userAgent
    if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet'
    if (/mobile|iphone|ipod|android|blackberry|mini|windows\sce|palm/i.test(ua)) return 'mobile'
    return 'desktop'
  }

  // ── Anti-fraude básico ──────────────────────────────────────────────────────
  const PAGE_LOAD_TIME = Date.now()

  function isSuspicious(timeToSubmit) {
    if (timeToSubmit < 5) return true  // submit < 5s = bot
    const botUA = /bot|crawler|spider|scraper|headless/i
    if (botUA.test(navigator.userAgent)) return true
    return false
  }

  // ── Visit count ─────────────────────────────────────────────────────────────
  const visitKey = 'fotus_visits'
  const VISIT_COUNT = parseInt(localStorage.getItem(visitKey) || '0') + 1
  localStorage.setItem(visitKey, String(VISIT_COUNT))

  // ── Disparo de evento via Edge Function ─────────────────────────────────────
  async function trackEvent(eventName, eventData = {}) {
    const eventId = crypto.randomUUID()
    const { fbp, fbc } = getFBParams()
    const utms = getUTMs()

    // Pixel client-side em paralelo (deduplicação via eventID)
    if (typeof fbq !== 'undefined') {
      fbq('track', eventName, {
        content_category: eventData.content_category || 'aquisicao',
        value: eventData.value,
        currency: 'BRL'
      }, { eventID: eventId })
    }

    // Edge Function (server-side)
    fetch(EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        event_name: eventName,
        session_id: SESSION_ID,
        url: window.location.href,
        referrer: document.referrer,
        user_agent: navigator.userAgent,
        device_type: getDeviceType(),
        visit_count: VISIT_COUNT,
        utms,
        fbp,
        fbc,
        gclid: getGCLID(),
        ga4_client_id: getGA4ClientId(),
        event_data: eventData
      })
    }).catch(() => {})  // falha silenciosa — não bloqueia UX
  }

  // ── 1. PageView imediato ────────────────────────────────────────────────────
  trackEvent('PageView', {
    content_name: 'LP_Integrador',
    content_category: 'aquisicao'
  })

  // ── 2. ViewContent — scroll 50% OU 30s ─────────────────────────────────────
  let viewContentSent = false

  function sendViewContent() {
    if (viewContentSent) return
    viewContentSent = true
    trackEvent('ViewContent', {
      content_name: 'LP_Integrador',
      content_category: 'aquisicao'
    })
  }

  setTimeout(sendViewContent, 30000)  // 30 segundos

  // Intersection Observer no elemento do meio da página
  const midEl = document.querySelector('[data-track-mid]') ||
                document.body.children[Math.floor(document.body.children.length / 2)]
  if (midEl) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) sendViewContent() })
    }, { threshold: 0.5 })
    observer.observe(midEl)
  }

  // ── 3. InitiateCheckout — foco no primeiro campo do form ────────────────────
  const firstInput = document.querySelector('form input:not([type="hidden"]):first-of-type, form textarea:first-of-type')
  if (firstInput) {
    firstInput.addEventListener('focus', function handler() {
      trackEvent('InitiateCheckout', { content_category: 'aquisicao' })
      firstInput.removeEventListener('focus', handler)
    }, { once: true })
  }

  // ── 4. Lead — submit do form ────────────────────────────────────────────────
  const form = document.querySelector('form')
  if (form) {
    form.addEventListener('submit', function(e) {
      const timeToSubmit = Math.round((Date.now() - PAGE_LOAD_TIME) / 1000)

      // Anti-fraude: registra mas marca como suspeito
      const formData = new FormData(form)
      const email  = (formData.get('email') || '').toString().trim()
      const phone  = (formData.get('phone') || formData.get('whatsapp') || formData.get('telefone') || '').toString().trim()
      const nome   = (formData.get('nome') || formData.get('name') || '').toString().trim()
      const cnpj   = (formData.get('cnpj') || '').toString().trim()
      const estado = (formData.get('estado') || formData.get('uf') || '').toString().trim()

      trackEvent('Lead', {
        email,
        phone,
        nome,
        cnpj,
        estado,
        time_to_submit_seconds: timeToSubmit,
        is_suspicious: isSuspicious(timeToSubmit),
        content_category: 'aquisicao'
      })
    })
  }

  // ── 5. Scroll depth tracking (atualiza session) ─────────────────────────────
  let maxScroll = 0
  let scrollTimer = null

  window.addEventListener('scroll', function() {
    const scrollPct = Math.round(
      (window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight)) * 100
    )
    if (scrollPct > maxScroll) {
      maxScroll = scrollPct
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        fetch(EDGE_URL + '/../session-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: SESSION_ID, scroll_depth_pct: maxScroll })
        }).catch(() => {})
      }, 500)
    }
  })

  // ── 6. Tempo na página (beacon no unload) ───────────────────────────────────
  const startTime = Date.now()
  window.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      const seconds = Math.round((Date.now() - startTime) / 1000)
      navigator.sendBeacon(
        EDGE_URL,
        JSON.stringify({
          event_id: crypto.randomUUID(),
          event_name: 'SessionEnd',
          session_id: SESSION_ID,
          event_data: { time_on_page_seconds: seconds }
        })
      )
    }
  })

})()
