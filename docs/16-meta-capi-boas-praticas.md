# 16 — Meta Conversions API: boas práticas e conformidade Fotus

**Knowledge refresh:** 04/set/2026 — lido direto da doc oficial da Meta
(`developers.facebook.com/docs/marketing-api/conversions-api`: *Best Practices*,
*Customer Information Parameters*, *Server Event Parameters*).
**Revalidar:** a partir de 04/out/2026.

**Escopo:** este doc é a régua de referência para qualquer envio ao pixel
**Fotus Solar V2 `1313389696600030`** — pelo `fop-functions` (rd-sync) ou pelo GTM.
Não substitui o GTM como fonte-verdade de tag; substitui o "achismo" sobre formato.

---

## 1. Parâmetros de identificação (`user_data`)

### 1.1 Exigem hash SHA-256

Hash sempre sobre o valor **já normalizado**. Normalizar depois do hash não existe:
errar a normalização = hash diferente = 0% de match, mesmo com o campo "presente"
em 100% dos eventos. **Cobertura no painel do Meta não é prova de match.**

| Campo | Regra de normalização (oficial) | Como a Fotus está |
|---|---|---|
| `em` | trim + minúscula | ✅ ok |
| `ph` | **remover símbolos, letras e zeros à esquerda**; sempre com código do país | ✅ `normalizePhone` — corrigido 15/set |
| `fn` / `ln` | minúscula, sem pontuação; alfabeto romano a-z recomendado | ✅ `normalizeName` — corrigido 15/set |
| `ct` | minúscula, **sem pontuação, sem caracteres especiais e sem espaços** | ✅ `normalizeGeo` — corrigido 15/set |
| `st` | fora dos EUA: minúscula, sem pontuação/especiais/espaços | ✅ `normalizeGeo` — corrigido 15/set |
| `zp` | minúscula, sem espaço/hífen | ✅ ok |
| `country` | ISO 3166-1 alpha-2 minúsculo — **e deve ser hasheado** | ✅ hasheado — corrigido 15/set |
| `db` | `YYYYMMDD` | n/a |
| `ge` | `f` / `m` | n/a |
| `external_id` | sem regra fixa; consistente entre canais. Hash **recomendado** | ✅ SHA-256 do CNPJ |

As três funções de normalização vivem em `capi-sender.ts` e são usadas **tanto**
pelo CAPI quanto por `publicos-meta.ts`, de propósito: público e evento precisam
gerar o mesmo hash para o mesmo cliente. Cobertura em `capi-sender_test.ts`.

> **Regra Fotus para telefone:** só dígitos, começando por `55`, DDD, e o `9` do
> celular. `(31) 98765-4321` → `5531987654321`. Sem `+`, sem espaço, sem parêntese.
> Celular antigo de 8 dígitos: inserir o `9` antes de hashear.

> **Regra Fotus para `external_id`:** SHA-256 do CNPJ só-dígitos. É a chave de match
> B2B — o e-mail do integrador é corporativo e raramente é o da conta pessoal na Meta.
> Tem de ser **idêntico** ao usado nos públicos (`publicos-meta.ts`), senão público e
> evento deixam de casar. Há teste travando essa igualdade — não afrouxe.

### 1.2 Não levam hash

| Campo | Formato |
|---|---|
| `client_ip_address` | IPv4/IPv6 real, sem espaço |
| `client_user_agent` | string crua do navegador |
| `fbc` | `fb.${subdomain_index}.${creation_time}.${fbclid}` |
| `fbp` | `fb.${subdomain_index}.${creation_time}.${random_number}` |
| `lead_id`, `fb_login_id` | inteiro |
| `ctwa_clid` | id de clique do Click-to-WhatsApp |

> `fbp` e `fbc` são cookies e mudam. A doc é explícita: **reler o valor a cada envio**,
> nunca congelar num cadastro. No FOP eles vêm da sessão que originou o negócio
> (decisão deliberada de atribuição — ver `resolverAtribuicaoDoDeal`), não da sessão
> mais recente.

> Atenção ao `subdomain_index` do `fbc` montado à mão a partir do `fbclid`: é a
> contagem de subdomínios do domínio em que o cookie foi gravado. Se o valor não
> bater com o que o próprio pixel gravaria, o `fbc` é aceito mas não casa.

### 1.3 Combinações que a Meta REJEITA

Evento que só tenha um destes conjuntos é descartado:

- `ct` + `country` + `st` + `zp` + `ge` + `client_user_agent`
- `db` + `client_user_agent`
- `fn` + `ge` (ou `ln` + `ge`)

Ou seja: geografia + demografia sozinhas não identificam ninguém. Sempre levar
pelo menos um entre `em`, `ph`, `external_id`, `fbp`/`fbc`.

---

## 2. Parâmetros do evento

| Campo | Regra |
|---|---|
| `event_name` | **idêntico** entre pixel e CAPI, senão não deduplica |
| `event_time` | Unix em segundos, do momento **do fato**. Backdating até **7 dias**; um único evento fora da janela **derruba a requisição inteira** |
| `event_id` | string única do anunciante. Formalmente opcional, na prática obrigatório — é o que deduplica |
| `event_source_url` | **obrigatório** em evento de site; tem de bater com domínio verificado |
| `action_source` | obrigatório. Valores: `email`, `website`, `app`, `phone_call`, `chat`, `physical_store`, `system_generated`, `business_messaging`, `other` |
| `opt_out` | `true` = só atribuição, fora da otimização |
| `data_processing_options` | `["LDU"]` ou `[]`. LDU é regra da Califórnia — não é LGPD, não usar por reflexo |

**Deduplicação:** mesmo `event_name` + mesmo `event_id` nos dois lados. Alternativa
aceita: `external_id` + `fbp` iguais. Sem isso, browser e server viram duas conversões.

**Frescor:** enviar em tempo real ou em lote *perto* do tempo real. Lote diário
degrada otimização mesmo dentro dos 7 dias.

**`action_source` correto importa:** venda que fechou no CRM não é `website`. O FOP
usa `system_generated` nos eventos de rd-sync — está certo, e por isso
`event_source_url`/`client_user_agent` não são exigidos ali.

---

## 3. Event Match Quality (EMQ)

Nota de 0 a 10, **só para eventos web**, que estima a chance de casar o evento com
uma conta Meta. Régua prática:

| Faixa | Leitura |
|---|---|
| < 5 | quebrado — investigar antes de otimizar nele |
| 5–6,9 | fraco; sobra ganho fácil |
| 7–8,4 | saudável |
| ≥ 8,5 | bom; ganho marginal daqui pra frente |

Ordem de peso dos identificadores, na prática: `em` e `ph` no topo, depois
`external_id`, `fbp`/`fbc`, e por último geo/demografia.

**Prioridade de correção:** o evento de **otimização de campanha** vem primeiro,
sempre — EMQ baixo ali custa entrega, EMQ baixo num evento de leitura custa relatório.

---

## 4. Desvios encontrados em 04/set/2026 — corrigidos em 15/set

| # | Desvio | Onde | Status |
|---|---|---|---|
| 1 | `ph` hasheado com `+` — telefone em 100% de cobertura casando 0% | `capi-sender.ts` | ✅ corrigido |
| 2 | `country` enviado em texto puro, sem hash | `capi-sender.ts` | ✅ corrigido |
| 3 | `ct`/`st` sem remover espaço e acento | `capi-sender.ts` | ✅ corrigido |
| 4 | `fn`/`ln` sem remover acento e pontuação | `capi-sender.ts` | ✅ corrigido |
| 5 | `client_ip_address`/`client_user_agent` ausentes nos eventos de rd-sync, embora `public.sessions` já os guardasse | `server.ts` | ✅ corrigido |
| 6 | API na `v18.0` | `capi-sender.ts` | 🟡 mantida — ver abaixo |

**Sobre a v18.0:** os eventos continuam chegando ao pixel com freshness
`real_time`, o que prova que a versão segue aceita. Não há urgência; subir versão
é mudança de contrato e pede validação própria. Fica registrado, não corrigido às
pressas.

### Efeitos esperados dessa correção

- **Não há reprocessamento.** Mudar a normalização muda o hash, logo o efeito
  começa no próximo evento. Histórico não se corrige sozinho.
- **A cobertura de telefone pode CAIR no painel** — de propósito. `normalizePhone`
  agora devolve vazio para número irreconhecível, e o campo simplesmente não é
  enviado. Cobertura menor com match real vale mais que 100% de hash inútil.
- **Os públicos precisam ser reenviados** para adotar os hashes novos. Como o
  upload é `usersreplace`, basta rodar o ciclo normal — mas até lá público e
  evento ficam com hashes diferentes.
- **Janela de leitura: 24–48h** no Events Manager, no evento certo.

---

## 5. Guardrails Fotus (não são da Meta, são nossos)

1. **O GTM é dono das conversões de site.** `/track-event` roda em modo só-banco
   (`CAPI_ENABLED=false`). Não ligar sem antes resolver a deduplicação, ou o Lead
   conta duas vezes (decisão de 24/jul).
2. **O rd-sync é o único emissor dos eventos de CRM** (Contact, Schedule, AddToCart,
   Purchase, OportunidadePerdida, PurchaseRecorrente). Aqui o CAPI fica sempre ligado
   — não há tag de GTM equivalente, logo não há double-count.
3. **Gate de sinal de mídia** (`RD_SYNC_CAPI_REQUIRE_SESSION`): evento de CRM só sai
   ao Meta se o *negócio* teve origem em mídia. O CRM fecha ~450 deals/dia contra ~13
   leads/dia de mídia paga — sem o gate, o Meta aprende com receita que a mídia não
   produziu e o ROAS reportado vira ficção.
4. **O fop-db grava sempre, o Meta recebe filtrado.** Banco é a fonte completa; o
   pixel é recorte de mídia. Não inverter.
5. **Antes de declarar problema de tracking, ancorar no pixel**, não no ETL nem em
   `public.events` — lição do incidente de 24/jul.
6. **O repo não é fonte-verdade de tag.** Mudança publicada no GTM tem de voltar
   para o doc 14; mudança de payload CAPI, para este doc.

---

## 6. Checklist antes de mexer em qualquer envio

- [ ] O `event_name` é o mesmo dos dois lados?
- [ ] O `event_id` é determinístico e estável entre reenvios?
- [ ] O `event_time` é o do fato e cabe na janela de 7 dias?
- [ ] O `action_source` descreve onde a coisa aconteceu de verdade?
- [ ] Cada campo hasheado foi normalizado **antes** do hash?
- [ ] O `external_id` é o mesmo do público correspondente?
- [ ] Há pelo menos um identificador forte (`em`/`ph`/`external_id`) além de geo?
- [ ] Testado no **Test Events** com `test_event_code` antes de ir pra produção?
- [ ] Conferido o EMQ 24–48h depois, no evento certo?
