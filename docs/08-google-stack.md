# 08 — Stack Google: Google Ads, GA4, Google Meu Negócio e YouTube

> Esta camada complementa o FOP Tracking. O Supabase continua sendo o hub central —
> o que muda é que agora o sinal que já existe também alimenta o ecossistema Google,
> eliminando a fragmentação entre Meta e Google e possibilitando atribuição cross-canal real.

---

## Visão geral: como a stack Google se conecta ao FOP

```
LP (tracking.js)
    │
    ├──► Meta CAPI (já implementado nas fases anteriores)
    │
    └──► GA4 Measurement Protocol  ←── Edge Function track-event
              │
              ├──► Google Ads (Enhanced Conversions for Leads)
              │         └── SQL como conversão offline
              │
              ├──► YouTube Ads
              │         └── view-through attribution via GA4 linked
              │
              └──► Google Meu Negócio (locais dos CDs)
                        └── reviews/NPS integrados ao Supabase
```

**Princípio:** o mesmo evento que vai para o Meta CAPI também vai para o GA4
via Measurement Protocol, dentro da mesma Edge Function. Um único evento,
dois destinos, zero duplicação de trabalho.

---

## PARTE 1 — Google Analytics 4 (GA4)

### Por que o GA4 é necessário além do Meta CAPI

| Sem GA4 | Com GA4 |
|---|---|
| Atribuição apenas no ecossistema Meta | Atribuição cross-canal: Meta + Google Ads + YouTube + orgânico |
| YouTube Ads sem attributição de funil | View-through de YouTube visível na jornada |
| Google Ads sem dados de qualidade | Enhanced Conversions habilitadas com dados PII hasheados |
| Ciclo B2B (30–90 dias) invisível | Attribution paths completos no GA4 para ciclos longos |

### Passo 1 — Criar propriedade GA4

1. [analytics.google.com](https://analytics.google.com) → Admin → Criar propriedade
2. Nome: `Fotus Solar - Produção`
3. Fuso horário: `(GMT-03:00) Horário de Brasília`
4. Moeda: `Real brasileiro (BRL)`
5. Setor: `Comércio > Distribuidores`

**Anotar:**
- Measurement ID: `G-XXXXXXXXXX`
- API Secret (para Measurement Protocol):
  Admin → Fluxos de dados → seu site → Measurement Protocol API secrets → Criar

### Passo 2 — Configurar Key Events (ex-conversões) no GA4

> GA4 usa o termo "key event" para conversões. Estes são os que importam para a Fotus:

Admin → Eventos → Marcar como key event:

| Key Event | Equivalente Meta | Quando marca |
|---|---|---|
| `generate_lead` | `Lead` | Submit do form |
| `contact` | `Contact` | SDR conectou (webhook RD) |
| `qualified_lead` | `Schedule` | Lead qualificado no RD |
| `submit_proposal` | `AddToCart` | Proposta enviada |
| `purchase` | `Purchase` | Primeiro pedido ERP |

### Passo 3 — Adicionar GA4 Measurement Protocol à Edge Function

Abrir `supabase/functions/track-event/index.ts` e adicionar o envio ao GA4
**depois** do envio ao CAPI (os dois rodam em paralelo, sem aguardar resposta):

```typescript
// Adicionar no _shared: supabase/functions/_shared/ga4-sender.ts

const GA4_MEASUREMENT_ID = Deno.env.get('GA4_MEASUREMENT_ID')!
const GA4_API_SECRET = Deno.env.get('GA4_API_SECRET')!

// Mapa de eventos Meta → GA4
const META_TO_GA4: Record<string, string> = {
  'PageView':         'page_view',
  'ViewContent':      'view_item',
  'InitiateCheckout': 'begin_checkout',
  'Lead':             'generate_lead',
  'Contact':          'contact',
  'Schedule':         'qualified_lead',
  'AddToCart':        'submit_proposal',
  'Purchase':         'purchase',
  'OportunidadePerdida': 'opportunity_lost'
}

export async function sendToGA4(params: {
  event_name: string          // nome do evento Meta (será mapeado)
  session_id: string
  client_id: string           // usar session_id como client_id
  user_id?: string            // integrador_id quando disponível
  event_params?: Record<string, any>
  user_properties?: Record<string, any>
}) {
  const ga4EventName = META_TO_GA4[params.event_name] || params.event_name.toLowerCase()

  const payload = {
    client_id: params.client_id,
    user_id: params.user_id,
    events: [{
      name: ga4EventName,
      params: {
        session_id: params.session_id,
        engagement_time_msec: 1,
        ...params.event_params
      }
    }],
    // Propriedades de usuário (enriquecimento)
    ...(params.user_properties && { user_properties: 
      Object.fromEntries(
        Object.entries(params.user_properties).map(([k, v]) => [k, { value: v }])
      )
    })
  }

  // Fire-and-forget: não bloqueia o fluxo principal
  fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  ).catch(() => {}) // falha silenciosa
}
```

**Adicionar na Edge Function `track-event`, após o envio ao CAPI:**

```typescript
// Envio ao GA4 (fire-and-forget — não bloqueia resposta ao browser)
sendToGA4({
  event_name,
  session_id,
  client_id: session_id,
  user_id: integradorId || undefined,
  event_params: {
    value: event_data.value,
    currency: 'BRL',
    content_category: event_data.content_category || 'aquisicao',
    ...(utms && {
      campaign: utms.utm_campaign,
      source: utms.utm_source,
      medium: utms.utm_medium
    })
  },
  user_properties: integrador ? {
    integrador_porte: integrador.porte,
    integrador_uf: integrador.estado_operacao,
    lead_score: integrador.lead_score,
    segmento_rfm: integrador.segmento_rfm
  } : undefined
})
```

### Passo 4 — Adicionar secrets do GA4

```bash
supabase secrets set GA4_MEASUREMENT_ID=G-XXXXXXXXXX
supabase secrets set GA4_API_SECRET=xxxxxxxxxxxx
```

### Passo 5 — Instalar gtag.js na LP (client-side GA4)

Inserir no `<head>` da LP, antes do script de tracking server-side:

```html
<!-- Google Analytics 4 — client-side (em paralelo com server-side) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX', {
    // Janela de atribuição estendida para B2B (ciclo 30–90 dias)
    'attribution_reporting': {
      'click_window': 90,   // 90 dias (padrão é 30)
      'view_window': 7      // 7 dias view-through
    }
  });
</script>
```

> **Importante:** o GA4 client-side captura o `client_id` real do navegador (cookie `_ga`).
> O Measurement Protocol usa o `session_id` como proxy. Para máxima precisão,
> capturar o `_ga` cookie no tracking.js e incluí-lo no envio server-side.

Atualizar `lp/tracking.js` para capturar e enviar o GA4 client_id:

```javascript
// Adicionar na função getGA4ClientId():
function getGA4ClientId() {
  const gaCookie = getCookie('_ga')
  if (gaCookie) {
    // _ga = GA1.1.XXXXXXXXXX.YYYYYY → client_id = XXXXXXXXXX.YYYYYY
    const parts = gaCookie.split('.')
    if (parts.length >= 4) return `${parts[2]}.${parts[3]}`
  }
  return session_id // fallback para o session_id do FOP
}

// Incluir no body de todas as chamadas ao track-event:
ga4_client_id: getGA4ClientId()
```

### Passo 6 — Linkar GA4 com Google Ads

1. Google Ads → Ferramentas → Contas vinculadas → Google Analytics
2. Vincular a propriedade `Fotus Solar - Produção`
3. Habilitar importação de key events
4. Habilitar Smart Bidding com dados GA4

**Importar key events como conversões no Google Ads:**

Google Ads → Metas → Conversões → Importar → Google Analytics 4 → selecionar:
- `qualified_lead` (principal — equivale ao SQL)
- `purchase` (máximo valor)
- `generate_lead` (volume)

---

## PARTE 2 — Google Ads + Enhanced Conversions for Leads

### Por que Enhanced Conversions for Leads é crítico para a Fotus

No modelo B2B da Fotus:
- O lead é gerado online (form da LP)
- A venda (Purchase) acontece dias/semanas depois por telefone e ERP
- Sem Enhanced Conversions, o Google Ads nunca "fecha o loop" entre o clique e a venda

Enhanced Conversions for Leads captura o dado do lead no moment do submit do form, depois permite que o anunciante faça upload da conversão offline quando o lead de fato fecha. O Google faz o match do clique original com a conversão offline via os dados hasheados.

### Passo 1 — Ativar Enhanced Conversions for Leads no Google Ads

1. Google Ads → Metas → Configurações → Conversões de cliente
2. Aceitar os termos de dados do cliente
3. Para cada conversão importada:
   - Clicar → Editar → Enhanced Conversions
   - Ativar "Enhanced conversions for leads"
   - Selecionar método: "Tag do Google ou Google Tag Manager"

### Passo 2 — Adicionar Enhanced Conversions à Edge Function

No `_shared`, criar `google-ads-sender.ts`:

```typescript
// supabase/functions/_shared/google-ads-sender.ts

const GADS_CONVERSION_ID = Deno.env.get('GADS_CONVERSION_ID')!      // ex: AW-123456789
const GADS_CONVERSION_LABEL_LEAD = Deno.env.get('GADS_CONVERSION_LABEL_LEAD')!
const GADS_CONVERSION_LABEL_SQL = Deno.env.get('GADS_CONVERSION_LABEL_SQL')!
const GADS_CONVERSION_LABEL_PURCHASE = Deno.env.get('GADS_CONVERSION_LABEL_PURCHASE')!
const GADS_API_KEY = Deno.env.get('GADS_DEVELOPER_TOKEN')!
const GADS_CUSTOMER_ID = Deno.env.get('GADS_CUSTOMER_ID')!          // sem hífens: 1234567890

// Mapa de eventos → labels de conversão
const EVENT_TO_LABEL: Record<string, string | null> = {
  'Lead':     GADS_CONVERSION_LABEL_LEAD,
  'Schedule': GADS_CONVERSION_LABEL_SQL,
  'Purchase': GADS_CONVERSION_LABEL_PURCHASE,
}

export async function sendEnhancedConversion(params: {
  event_name: string
  email?: string
  phone?: string
  gclid?: string        // Google Click ID — capturar da URL na LP
  conversion_value?: number
  order_id?: string     // para Purchase
}) {
  const label = EVENT_TO_LABEL[params.event_name]
  if (!label) return   // evento não mapeado = ignorar

  // Hash SHA-256 (mesmo padrão do Meta)
  const hashEmail = params.email ? await hashValue(params.email) : undefined
  const hashPhone = params.phone ? await hashValue(params.phone) : undefined

  const payload = {
    conversions: [{
      gclid: params.gclid,
      conversion_action: `customers/${GADS_CUSTOMER_ID}/conversionActions/${label}`,
      conversion_date_time: new Date().toISOString().replace('T', ' ').split('.')[0] + '+00:00',
      conversion_value: params.conversion_value,
      currency_code: 'BRL',
      order_id: params.order_id,
      user_identifiers: [
        ...(hashEmail ? [{ hashed_email: hashEmail }] : []),
        ...(hashPhone ? [{ hashed_phone_number: hashPhone }] : [])
      ]
    }],
    partial_failure: true
  }

  fetch(
    `https://googleads.googleapis.com/v17/customers/${GADS_CUSTOMER_ID}:uploadClickConversions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${await getGoogleAccessToken()}`,
        'developer-token': GADS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  ).catch(() => {})
}
```

### Passo 3 — Capturar gclid na LP

O Google Click ID (`gclid`) é passado na URL quando alguém clica num anúncio Google.
Precisa ser capturado e armazenado, igual ao `fbclid` do Meta.

Adicionar em `lp/tracking.js`:

```javascript
// Captura e persiste gclid (Google Click ID)
function getGCLID() {
  const params = new URLSearchParams(window.location.search)
  const gclid = params.get('gclid')
  if (gclid) {
    localStorage.setItem('fotus_gclid', gclid)
    setCookie('fotus_gclid', gclid, 90) // 90 dias
    return gclid
  }
  return localStorage.getItem('fotus_gclid') || getCookie('fotus_gclid') || ''
}

// Incluir no body de todas as chamadas ao track-event:
gclid: getGCLID()
```

Adicionar coluna `gclid` na tabela `sessions`:

```sql
-- Migration 005 — adicionar gclid
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS gclid TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ga4_client_id TEXT;
```

### Passo 4 — Adicionar secrets do Google Ads

```bash
supabase secrets set GADS_CONVERSION_ID=AW-XXXXXXXXX
supabase secrets set GADS_CONVERSION_LABEL_LEAD=AbCdEfGhIj
supabase secrets set GADS_CONVERSION_LABEL_SQL=KlMnOpQrSt
supabase secrets set GADS_CONVERSION_LABEL_PURCHASE=UvWxYzAbCd
supabase secrets set GADS_DEVELOPER_TOKEN=xxxxxxxxxxxx
supabase secrets set GADS_CUSTOMER_ID=1234567890
```

### Passo 5 — Configurar campanhas Google Ads para B2B

**Janela de conversão recomendada para Fotus (ciclo 30–90 dias):**

Google Ads → Metas → Conversões → selecionar cada conversão → Editar:
- Janela de conversão de cliques: **90 dias**
- Janela de conversão de visualizações: **30 dias**
- Modelo de atribuição: **Baseado em dados** (ou Linear para B2B de ciclo longo)

**Campanhas recomendadas:**

| Tipo | Objetivo | Conversão de otimização |
|---|---|---|
| Search (marca) | Capturar demanda existente | `qualified_lead` |
| Search (genérico) | Ex: "distribuidor solar ES" | `generate_lead` |
| Performance Max | Automação cross-canal | `purchase` |
| YouTube (awareness) | Construir demanda solar B2B | `view_content` (view-through) |

---

## PARTE 3 — YouTube Ads

### Papel do YouTube no funil B2B solar

No funil B2B da Fotus, YouTube age principalmente no **topo e meio do funil**:
- **Awareness:** integradores que ainda não conhecem a Fotus descobrem via vídeo
- **Consideração:** integradores que pesquisam solar veem demonstrações de produto, depoimentos
- **Retargeting:** impactar visitantes da LP que não converteram

Um advertiser B2B descobriu via Attribution Paths que a maioria das conversões veio de usuários que viram um anúncio YouTube de awareness primeiro, clicaram em retargeting display depois, e só então pesquisaram a marca. Sob last-click, apenas o search recebia crédito. Mas os dados mostravam que o YouTube estava gerando a demanda — o search só fechava.

### Passo 1 — Vincular YouTube ao Google Ads

1. YouTube Studio → Canal da Fotus
2. Google Ads → Ferramentas → Canais vinculados → YouTube
3. Vincular o canal → confirmar no YouTube Studio

### Passo 2 — Configurar conversões de visualização (VTC)

Para B2B solar, ciclos longos justificam janela de view-through maior:

Google Ads → Metas → Conversões → `qualified_lead` → Editar:
- Janela de conversão de visualizações de vídeo: **30 dias**

> Uma visualização de vídeo de 30s+ ou um skip após 5s em campanha TrueView conta como
> "visualização engajada". Se o usuário converter em até 30 dias, o YouTube recebe crédito.

### Passo 3 — Audiências de retargeting YouTube → Meta e vice-versa

O GA4 como hub permite construir audiências cross-plataforma:

**Audiência YouTube → Meta:**
1. GA4 → Explorar → Audiências → Criar com filtro: `viewed_video = true`
2. Exportar para Google Ads (automático via vinculação)
3. Usar no Meta via integração GA4 ↔ Meta (outubro 2025)

**Audiência Meta → YouTube (via GA4):**
1. Usuários que vieram do Meta mas não converteram aparecem no GA4
2. Criar audiência GA4 de "visitou LP via ig/paid, não gerou lead"
3. Usar como retargeting YouTube

### Passo 4 — UTMs padronizados para YouTube

Todo link nas descrições de vídeo e cards:

```
https://fotus.com.br/lp?utm_source=youtube&utm_medium=video&utm_campaign=NOME-CAMPANHA&utm_content=NOME-VIDEO
```

Template de UTM por tipo de conteúdo:

| Tipo de vídeo | utm_campaign | utm_content |
|---|---|---|
| Institucional / brand | `brand-awareness-2025` | `video-institucional` |
| Produto: kit solar | `produto-kit-solar` | `demo-kit-5kwp` |
| Depoimento integrador | `prova-social` | `depoimento-joao-es` |
| Tutorial instalação | `educacional` | `tutorial-micro-inversor` |
| Oferta / promoção | `oferta-junho-2025` | `promo-kit-economico` |

---

## PARTE 4 — Google Meu Negócio (múltiplos locais)

### Locais da Fotus para gerenciar

| Local | Tipo | Google Meu Negócio |
|---|---|---|
| CD Vila Velha (ES) | Centro de Distribuição principal | A ser verificado |
| CD [cidade 2] | Centro de Distribuição | A ser verificado |
| CD [cidade 3] | Centro de Distribuição | A ser verificado |
| ... | ... | ... |
| Escritório Campinas (SP) | Escritório comercial | A ser verificado |

> **Preencher a tabela acima** com todos os CDs antes de começar esta parte.

### Por que o Google Meu Negócio importa para o FOP

1. **Busca local:** integradores que pesquisam "distribuidor solar Vila Velha" encontram a Fotus
2. **Reviews como sinal de qualidade:** Google usa avaliações no ranking de busca local
3. **Reviews → NPS:** reviews de clientes são dados de satisfação que podem enriquecer o Supabase
4. **Integração com Google Ads:** campanhas locais usam dados do GMB para extensões de local

### Passo 1 — Verificar e otimizar todos os locais

Para cada local, verificar no [business.google.com](https://business.google.com):

**Dados obrigatórios em cada local:**
- [ ] Nome: `Fotus Solar - [Cidade]` (ex: "Fotus Solar - Vila Velha")
- [ ] Categoria principal: `Empresa atacadista de equipamentos elétricos`
- [ ] Categoria secundária: `Fornecedor de painéis solares`
- [ ] Endereço completo e correto (NAP: Name, Address, Phone — deve ser idêntico em todos os lugares)
- [ ] Telefone comercial (DDD + número)
- [ ] Site: `https://fotus.com.br`
- [ ] Horário de funcionamento atualizado
- [ ] Fotos: fachada do CD, interior, logo, equipe (mínimo 10 fotos por local)
- [ ] Descrição: incluir "distribuidor solar", "integradores", "equipamentos fotovoltaicos"

### Passo 2 — Integrar reviews do GMB ao Supabase

Objetivo: reviews de clientes (integradores) no Google são um dado de satisfação que pode
enriquecer o perfil do integrador e alimentar o lead scoring.

Adicionar tabela no Supabase:

```sql
-- Migration 006 — Google Meu Negócio reviews
CREATE TABLE gmb_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrador_id UUID REFERENCES integradores(id), -- quando possível identificar pelo telefone/email
  location_name TEXT NOT NULL,                     -- ex: 'Fotus Solar - Vila Velha'
  google_review_id TEXT UNIQUE,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  reviewer_name TEXT,
  reviewer_photo_url TEXT,
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE gmb_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON gmb_reviews FOR ALL USING (auth.role() = 'service_role');
```

Edge Function para sincronizar reviews do GMB:

```typescript
// supabase/functions/gmb-sync/index.ts
// Executar via cron diário: "0 8 * * *" (todo dia às 08h)

const GMB_LOCATIONS = [
  { name: 'Fotus Solar - Vila Velha', account_id: 'accounts/XXX', location_id: 'locations/YYY' },
  { name: 'Fotus Solar - Campinas',   account_id: 'accounts/XXX', location_id: 'locations/ZZZ' },
  // adicionar todos os CDs
]

serve(async (req) => {
  const accessToken = await getGoogleAccessToken() // OAuth2 service account

  for (const location of GMB_LOCATIONS) {
    const url = `https://mybusiness.googleapis.com/v4/${location.account_id}/${location.location_id}/reviews`
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })
    const data = await response.json()

    for (const review of data.reviews || []) {
      await supabase.from('gmb_reviews').upsert({
        google_review_id: review.reviewId,
        location_name: location.name,
        rating: review.starRating === 'FIVE' ? 5 :
                review.starRating === 'FOUR' ? 4 :
                review.starRating === 'THREE' ? 3 :
                review.starRating === 'TWO' ? 2 : 1,
        review_text: review.comment,
        reviewer_name: review.reviewer?.displayName,
        reply_text: review.reviewReply?.comment,
        replied_at: review.reviewReply?.updateTime,
        published_at: review.createTime
      }, { onConflict: 'google_review_id' })
    }
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 })
})
```

### Passo 3 — Usar GMB para campanhas locais no Google Ads

1. Google Ads → Extensões → Extensões de local → Vincular Google Meu Negócio
2. Criar campanha Performance Max com foco em objetivos de loja:
   - Alcance: raio de 100–200 km de cada CD
   - Objetivo: chamadas + visitas ao local
3. Meta: integradores locais que preferem buscar fornecedor próximo

### Passo 4 — Reviews como gatilho de NPS no WhatsApp

Quando um integrador deixa review 4-5 estrelas no Google:

```typescript
// Após inserir review no gmb_reviews, verificar se é integrador conhecido
// e se NPS WhatsApp ainda não foi enviado nos últimos 90 dias:

async function processNewReview(review: GmbReview) {
  if (review.rating >= 4 && review.integrador_id) {
    // Verificar última interação NPS
    const { data: lastNPS } = await supabase
      .from('whatsapp_interactions')
      .select('created_at')
      .eq('integrador_id', review.integrador_id)
      .eq('intent', 'nps')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const daysSinceNPS = lastNPS 
      ? (Date.now() - new Date(lastNPS.created_at).getTime()) / 86400000
      : 999

    if (daysSinceNPS > 90) {
      // Agradecer pelo review e pedir NPS formal
      await sendWhatsAppTemplate({
        to: integrador.phone,
        template: { name: 'fotus_agradece_review', language: { code: 'pt_BR' } },
        params: [integrador.nome_contato?.split(' ')[0] || 'olá']
      })
    }
  }
}
```

---

## PARTE 5 — Integração GA4 ↔ Meta Ads (outubro 2025)

> Desde outubro 2025, o Meta permite vincular uma propriedade GA4 diretamente ao
> Gerenciador de Anúncios, criando atribuição cross-canal real. Esta é uma integração nova
> e estratégica que não estava disponível quando o FOP foi desenhado originalmente.

Ao conectar sua propriedade GA4 ao Meta Ads Manager, você pode definir quais eventos GA4 — como purchases, sign-ups, ou interações customizadas — serão reconhecidos como conversões dentro do Meta. Isso é especialmente valioso para jornadas que atravessam múltiplas sessões, canais ou dispositivos — comum em B2B e cenários de alta consideração.

### Como ativar

1. Meta Ads Manager → Gerenciador de Eventos → Fontes de dados → Google Analytics
2. Conectar a propriedade `Fotus Solar - Produção` (GA4)
3. Mapear os key events do GA4 para eventos Meta:
   - `qualified_lead` → `Schedule` (Lead Qualificado Fotus)
   - `purchase` → `Purchase`
4. **Não substituir o CAPI** — esta integração complementa, não substitui
5. Monitorar a divergência: eventos via CAPI vs eventos via GA4 devem ter ≤ 15% de diferença

---

## Checklist de implementação da stack Google

### GA4
- [ ] Propriedade criada com fuso e moeda corretos
- [ ] Key events configurados (generate_lead, qualified_lead, purchase)
- [ ] Measurement Protocol ativo via Edge Function
- [ ] gtag.js instalado na LP
- [ ] gclid e ga4_client_id sendo capturados no tracking.js
- [ ] GA4 vinculado ao Google Ads
- [ ] Key events importados como conversões no Google Ads
- [ ] Janela de atribuição configurada para 90 dias (click) + 30 dias (view)

### Google Ads
- [ ] Conversões de Enhanced Conversions for Leads ativadas
- [ ] Termos de dados de cliente aceitos
- [ ] Secrets GADS configurados no Supabase
- [ ] gclid sendo armazenado em `sessions.gclid`
- [ ] Campanha de Search (marca) ativa com objetivo `qualified_lead`
- [ ] Campanha de Search (genérico: "distribuidor solar [estado]") ativa

### YouTube
- [ ] Canal vinculado ao Google Ads
- [ ] Janela de view-through 30 dias configurada
- [ ] UTMs padronizados em todos os links de vídeo
- [ ] Audiência de retargeting (visitantes LP sem conversão) criada

### Google Meu Negócio
- [ ] Todos os locais (CDs + Campinas) listados e verificados
- [ ] Dados NAP idênticos em todos os locais
- [ ] Mínimo 10 fotos por local
- [ ] Categoria correta em todos os locais
- [ ] Tabela `gmb_reviews` criada no Supabase
- [ ] Edge Function `gmb-sync` deployada e configurada como cron diário
- [ ] Extensões de local vinculadas no Google Ads

### Integração GA4 ↔ Meta
- [ ] GA4 conectado ao Meta Ads Manager
- [ ] key events mapeados para eventos Meta
- [ ] Divergência CAPI vs GA4 monitorada (meta: ≤ 15%)

---

## Variáveis de ambiente adicionais

```bash
# Adicionar ao Supabase Secrets:
supabase secrets set GA4_MEASUREMENT_ID=G-XXXXXXXXXX
supabase secrets set GA4_API_SECRET=xxxxxxxxxxxx
supabase secrets set GADS_CONVERSION_ID=AW-XXXXXXXXX
supabase secrets set GADS_CONVERSION_LABEL_LEAD=AbCdEfGhIj
supabase secrets set GADS_CONVERSION_LABEL_SQL=KlMnOpQrSt
supabase secrets set GADS_CONVERSION_LABEL_PURCHASE=UvWxYzAbCd
supabase secrets set GADS_DEVELOPER_TOKEN=xxxxxxxxxxxx
supabase secrets set GADS_CUSTOMER_ID=1234567890
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

O `GOOGLE_SERVICE_ACCOUNT_JSON` é necessário para a Edge Function `gmb-sync` autenticar
com a API do Google Meu Negócio. Para criar:

1. [console.cloud.google.com](https://console.cloud.google.com) → IAM → Contas de serviço
2. Criar conta de serviço: `fotus-gmb-sync`
3. Conceder permissão: `My Business API`
4. Criar chave JSON → salvar o conteúdo como secret
