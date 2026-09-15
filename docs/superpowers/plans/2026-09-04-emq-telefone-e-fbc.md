# Plano — elevar o EMQ do Lead: telefone e fbc

Data: 04/set/2026 · Pixel: **Fotus Solar V2 `1313389696600030`** · Janela auditada: 07/ago–04/set

---

## 1. Diagnóstico (dado duro, via API do Meta)

Puxei a qualidade por evento direto da API (`ads_get_dataset_quality`), não do print.
O quadro real desmonta a hipótese inicial de que o rd-sync estaria omitindo o telefone.

| Evento | Emissor | EMQ | email | phone | external_id | fbp | fbc |
|---|---|---|---|---|---|---|---|
| **Lead** | GTM (browser + espelho server) | 7.8 | 100% | **7,2%** | — | 100% | 66% |
| SubscribedButtonClick | GTM | 7.8 | 100% | 5,9% | — | 100% | 65% |
| PageView | GTM | 6.1 | 0,1% | — | — | 100% | 75% |
| **Schedule** ("Programar") | GTM | 6.1 | **0%** | **0%** | **0%** | 100% | 30% |
| Contact | rd-sync | 7.4 | 100% | 100% | 100% | 21% | 14% |
| Purchase | rd-sync | 6.6 | 100% | 100% | 100% | 0% | 0% |
| AddToCart | rd-sync | 6.6 | 100% | 100% | 100% | 0% | 0% |
| PurchaseRecorrente | rd-sync | 8.0 | 100% | 100% | 100% | 100% | 75% |
| OportunidadePerdida | rd-sync | 6.1 | 78% | 82% | 100% | 10% | 6% |

### Conclusões

**1. O rd-sync não é o problema do telefone.** Todo evento que ele emite sai com
`ph` em 100% (exceto OportunidadePerdida, 82%). O código confirma:
`capi-sender.ts:buildUserData` monta `ph` com SHA-256 sobre E.164, e
`server.ts:646` passa `phone || integrador.phone`.

**2. O rd-sync não emite `Lead`.** O mapa `STAGE_TO_EVENT` (`server.ts:47`) cobre só
Contact / Schedule / AddToCart / Purchase / OportunidadePerdida. O `Lead` é do site.

**3. O `Lead` server-side também não é do FOP.** O `/track-event` roda em modo
só-banco (`CAPI_ENABLED` off, `meta_capi_status='gtm'` — `server.ts:37,224`). E o
volume server acompanha o browser em lockstep (razão ~1,5, freshness "hourly"):
assinatura de espelho server-side do próprio GTM/gateway, não de um emissor
independente.

**→ Logo: a correção de telefone e de fbc no `Lead` é dentro do GTM, não neste repo.**
O repo já entrega o telefone: a tag `gtm-5KKTF798` lê o campo do form
(`:252`) e manda pro FOP, que grava normalizado em `integradores.phone`
(`server.ts:135`). O dado existe na página no momento do disparo — a tag do Meta
é que não está pegando.

**4. Achado novo, mais grave que o fbc: o `Schedule` está sem nenhum identificador.**
Zero email, zero telefone, zero external_id, 435 eventos, EMQ 6.1. E o `Schedule`
("Lead Qualificado Fotus") é objetivo de otimização de campanha. Otimizar num
evento que o Meta mal consegue atribuir a uma pessoa é o pior lugar pra ter EMQ baixo.

---

## 2. Frentes

### Frente A — telefone no `Lead` (maior alavanca: 7,2% → meta ≥90%)

Hipótese principal: o Advanced Matching da tag do Meta está mapeando só o e-mail,
ou está mapeando o campo de telefone **formatado** — `(11) 99999-9999` — que o
matching automático descarta. O form já mantém um hidden `telefone_formatado`
(`elementor-widget-html-form-cotacao.html:181`), então há dois campos com telefone
na página e é plausível que a tag esteja no errado.

Passos:
1. **A1 — Auditar a tag do Meta no GTM-5KKTF798** (precisa do Igor: acesso de
   edição ao container). Registrar: qual tag dispara `Lead`, se Advanced Matching
   é automático/manual, e qual seletor/variável alimenta `ph`.
2. **A2 — Criar uma variável GTM `dlv_phone_e164`** que normalize antes de entregar
   ao Meta: só dígitos, sem `+`, com `55` na frente, inserindo o `9` em celular
   antigo de 8 dígitos. Mesma régua já usada em `capi-sender.ts:normalizePhone`
   (mas **sem o `+`** — ver risco R1).
3. **A3 — Ligar `ph` no Advanced Matching manual** da tag de `Lead` apontando
   para essa variável. Fazer o mesmo em `SubscribedButtonClick` (5,9%).
4. **A4 — Validar** no Test Events do Meta com 3 submits reais + conferir
   `Qualidade da correspondência` em 24h.

### Frente B — fbc no `Lead` (66% → meta ≥85%)

O diagnóstico não é "falta capturar": as duas tags já montam `_fbc` a partir do
`fbclid` (`gtm-5KKTF798:108`, `gtm-M3QHDGM:76`). O tell é a comparação interna:
**PageView tem fbc 75% e Lead tem 66%** — perde-se sinal *entre a chegada e o
submit*, não na chegada.

Passos:
1. **B1 — Confirmar o domínio do cookie `_fbc`.** O `_fbc` precisa estar em
   `.fotus.com.br`, igual ao que já foi feito com o cookie de UTM em 25/ago.
   Se estiver no host da LP, o pulo institucional → LP zera.
2. **B2 — Persistir o `fbclid` junto com a UTM** no mesmo cookie de primeira parte
   que já sobrevive ao cross-domain, e reconstruir o `_fbc` a partir dele no
   momento do submit (não só no page load).
3. **B3 — Aumentar a validade** do `_fbc` para 90 dias (a tag `gtm-5KKTF798` grava
   sem `max-age` explícito — verificar).
4. **B4 — Validar** comparando fbc de PageView × Lead: a meta é fechar o gap,
   não chegar a 100% (tráfego orgânico/direto legitimamente não tem `fbclid`).

### Frente C — PII no `Schedule` (0% → 100%) · **recomendo priorizar acima do fbc**

Se o `Schedule` está saindo do GTM sem identificador, o caminho é o mesmo do
`Lead`: ligar email + telefone + external_id no Advanced Matching da tag.
Se parte dele vier do rd-sync, o `external_id` deveria estar em 100% (o rd-sync
descarta deal sem CNPJ) — então 0% confirma que o emissor é outro.

1. **C1 — Identificar quem dispara `Schedule`** (aba "Origem do evento" do Meta).
2. **C2 — Ligar os mesmos identificadores da Frente A** nessa tag.

---

## 3. Riscos e guardrails

- **R1 — `+` no telefone.** O `normalizePhone` atual devolve `+5511...` e o hash é
  feito em cima disso (`capi-sender.ts:81`). A norma do Meta é **só dígitos**.
  Se estiver errado, o `ph` de *todos* os eventos do rd-sync está em 100% de
  cobertura mas 0% de match útil — o que explicaria Purchase/AddToCart presos em
  6.6 com 100% de email+phone+external_id. **Verificar antes de qualquer outra
  coisa: é barato e potencialmente o maior ganho do plano inteiro.**
- **R2 — double-count.** Nada aqui cria evento novo; só enriquece `user_data` de
  eventos que já existem. Não mexer no `CAPI_ENABLED` do `/track-event` — o GTM
  segue dono das conversões de site (decisão de 24/jul).
- **R3 — o repo não é fonte-verdade de tracking.** Toda mudança de tag tem que ser
  refletida no `docs/14-captura-utm-e-tracking-2026-08.md` depois de publicada.
- **R4 — LGPD.** Telefone e e-mail só saem com hash SHA-256 client-side, como já é hoje.

---

## 4. Ordem de execução

| # | Item | Onde | Depende de |
|---|---|---|---|
| 0 | R1 — conferir o `+` no hash de telefone do rd-sync | repo | — |
| 1 | A1 — auditar tag de `Lead` no GTM | GTM | acesso Igor |
| 2 | C1 — identificar emissor do `Schedule` | Meta | — |
| 3 | A2/A3 — variável E.164 + `ph` no Advanced Matching | GTM | A1 |
| 4 | C2 — PII no `Schedule` | GTM | C1 |
| 5 | B1/B2/B3 — `_fbc` no cookie de 1ª parte | GTM | — |
| 6 | A4/B4 — validar EMQ em 24–48h | Meta | 3,4,5 |
| 7 | Atualizar doc 14 | repo | 6 |

Fora de escopo deste plano (mas é o item de maior impacto de negócio):
o `Purchase` com 19 eventos/mês. Vai em plano próprio.
