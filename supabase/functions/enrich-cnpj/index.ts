import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Score inicial baseado em dados CNPJ públicos (BrasilAPI)
function calcularScoreInicial(dados: Record<string, unknown>): number {
  let score = 20 // base por ter CNPJ válido

  // Porte da empresa
  if (dados.porte === 'MEDIO') score += 25
  else if (dados.porte === 'GRANDE') score += 35
  else if (dados.porte === 'MICRO EMPRESA' || dados.porte === 'EMPRESA DE PEQUENO PORTE') score += 15

  // Tempo de mercado (anos)
  const anos = dados.anos_mercado as number
  if (anos >= 5) score += 20
  else if (anos >= 2) score += 10

  // Situação cadastral ativa
  if ((dados.situacao_cadastral as string)?.toUpperCase() === 'ATIVA') score += 10

  // CNAE solar (setor 43 = construção/instalação)
  const cnae = String(dados.cnae_principal || '')
  if (cnae.startsWith('43') || cnae.startsWith('35')) score += 10

  return Math.min(score, 100)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { cnpj, integrador_id } = await req.json()

    if (!cnpj || !integrador_id) {
      return new Response(
        JSON.stringify({ error: 'cnpj e integrador_id são obrigatórios' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const cnpjClean = cnpj.replace(/\D/g, '')

    // ── Buscar dados na BrasilAPI (gratuito, sem chave) ───────────────────────
    const apiRes = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjClean}`)

    if (!apiRes.ok) {
      await supabase.from('error_logs').insert({
        function_name: 'enrich-cnpj',
        error_message: `BrasilAPI retornou ${apiRes.status} para CNPJ ${cnpjClean}`,
        payload: { cnpj: cnpjClean, integrador_id }
      }).catch(() => {})

      return new Response(
        JSON.stringify({ success: false, error: `BrasilAPI ${apiRes.status}` }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const dados = await apiRes.json()

    // ── Calcular anos no mercado ──────────────────────────────────────────────
    let anosNoMercado: number | null = null
    if (dados.data_inicio_atividade) {
      const inicio = new Date(dados.data_inicio_atividade)
      anosNoMercado = Math.floor((Date.now() - inicio.getTime()) / (1000 * 60 * 60 * 24 * 365))
    }

    // ── Montar payload de enriquecimento ──────────────────────────────────────
    const enrichPayload: Record<string, unknown> = {
      razao_social:        dados.razao_social          || null,
      nome_fantasia:       dados.nome_fantasia          || null,
      cnae_principal:      dados.cnae_fiscal?.toString() || null,
      cnae_descricao:      dados.cnae_fiscal_descricao  || null,
      porte:               dados.porte                  || null,
      data_abertura:       dados.data_inicio_atividade  || null,
      anos_mercado:        anosNoMercado,
      situacao_cadastral:  dados.descricao_situacao_cadastral || null,
      capital_social:      dados.capital_social         || null,
      // Endereço
      endereco_logradouro: dados.logradouro             || null,
      endereco_numero:     dados.numero                 || null,
      endereco_complemento:dados.complemento            || null,
      endereco_bairro:     dados.bairro                 || null,
      endereco_municipio:  dados.municipio              || null,
      endereco_uf:         dados.uf                     || null,
      endereco_cep:        dados.cep?.replace(/\D/g, '') || null,
      updated_at: new Date().toISOString()
    }

    // ── Score inicial ─────────────────────────────────────────────────────────
    const scoreDados = {
      porte:              enrichPayload.porte,
      anos_mercado:       anosNoMercado,
      situacao_cadastral: enrichPayload.situacao_cadastral,
      cnae_principal:     enrichPayload.cnae_principal
    }
    const scoreNovo = calcularScoreInicial(scoreDados as Record<string, unknown>)

    // Buscar score atual para calcular delta
    const { data: intAtual } = await supabase
      .from('integradores')
      .select('lead_score')
      .eq('id', integrador_id)
      .maybeSingle()

    const scoreAnterior = intAtual?.lead_score ?? 0

    if (scoreNovo > scoreAnterior) {
      enrichPayload.lead_score = scoreNovo
    }

    // ── Atualizar integrador ──────────────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('integradores')
      .update(enrichPayload)
      .eq('id', integrador_id)

    if (updateError) throw new Error(`integrador update: ${updateError.message}`)

    // ── Log do score ──────────────────────────────────────────────────────────
    if (scoreNovo > scoreAnterior) {
      await supabase.from('lead_score_log').insert({
        integrador_id,
        score_anterior: scoreAnterior,
        score_novo:     scoreNovo,
        delta:          scoreNovo - scoreAnterior,
        motivo:         'enriquecimento_cnpj'
      }).catch(() => {})
    }

    return new Response(
      JSON.stringify({ success: true, razao_social: dados.razao_social, score: scoreNovo }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    await supabase.from('error_logs').insert({
      function_name: 'enrich-cnpj',
      error_message: error.message,
      payload: null
    }).catch(() => {})

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})
