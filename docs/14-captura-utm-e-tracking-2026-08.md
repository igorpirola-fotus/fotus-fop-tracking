# 14 — Captura de UTM e tracking: estado real (ago/2026)

> Escrito em **2026-08-25**, depois de auditar e corrigir a cadeia inteira de captura.
> Relacionado: [`10-auditoria-2026-06.md`](./10-auditoria-2026-06.md), [`09-naming-convention.md`](./09-naming-convention.md), [`07-runbook.md`](./07-runbook.md).

## ⚠️ Antes de tudo: este repositório NÃO é a fonte-verdade do que roda no site

Os arquivos `lp/tracking.js` e `lp/fotus-tracking-gtm.html` são **cópias desatualizadas**. Durante a auditoria de ago/2026 eu os tratei como fonte-verdade e cheguei a **duas conclusões erradas** por causa disso (ver a seção de retratações no fim).

**A fonte-verdade é:**

| O quê | Onde | Como ler |
|---|---|---|
| Tags de tracking da LP | GTM **`GTM-5KKTF798`** (conta 6263536727 / container 203180182) | tagmanager.google.com |
| Tags de tracking do site institucional | GTM **`GTM-M3QHDGM`** (conta 6002603401 / container 35640168) | tagmanager.google.com |
| Máscara/validação do formulário | Widget HTML do Elementor, dentro do contêiner do formulário | LP `post=8165` no editor Elementor |
| Snippets do WordPress | WPCode (`/wp-admin/admin.php?page=wpcode`) | 2 snippets ativos, ambos de banner de cookie |

Antes de concluir qualquer coisa sobre tracking, **leia o GTM e o DOM ao vivo**, não este repo.

---

## Arquitetura atual (depois das correções de 25/ago)

São **dois domínios** e **dois containers de GTM**. A jornada típica atravessa os dois:

```
anúncio → fotus.com.br (institucional)  →  energia.fotus.com.br/cotacao-... (LP)  →  RD Station CRM
            GTM-M3QHDGM                       GTM-5KKTF798                            Funil SDR
            grava cookie de UTM               lê cookie, preenche form,               (ou Comercial, se
            em .fotus.com.br                  manda evento pro FOP                     o CNPJ já é da base)
```

### Container do institucional — `GTM-M3QHDGM`

| Tag | Tipo | Acionador | Função |
|---|---|---|---|
| `FOTUS — CAPTURA DE UTM NO SITE INSTITUCIONAL` | HTML personalizado | All Pages | Grava `utm_*`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `landing_page`, `referrer` em **cookie de `.fotus.com.br`**, 90 dias. Normaliza a taxonomia na entrada. |
| `Tag do Google \| institucional → LP` | Tag do Google | Initialization | Carrega `G-CLTDDN2TLB` (property oficial) também no institucional. |

### Container da LP — `GTM-5KKTF798`

| Tag | Tipo | Acionador | Função |
|---|---|---|---|
| `FOP \| Tracking + UTM (única)` | HTML personalizado | All Pages | **Tag única.** Resolve UTM (URL > cookie), grava cookie de `.fotus.com.br`, preenche os campos ocultos do Elementor, e manda `PageView` + `Lead` para o `fop-functions`. |
| `GA4 \| Evento \| generate_lead` | GA4 event | EV – Elementor Sucesso | Evento de lead na property oficial. |
| `Google ADS \| Tag do Google - All Pages` | Tag do Google | Initialization | Carrega `AW-665226779` (ID `4999569529`). **Independente** do GA4. |

**Pausadas em 25/ago** (não deletadas, para poder voltar):
- `HTML \| Persistir IDs de clique/UTMs` — substituída pela tag única
- `HTML \|Preencher os campos ocultos do Elementor` — substituída pela tag única
- `FOP \| fotus-tracking-gtm` — substituída pela tag única
- `Tag do Google G-X0GG5MP2N3` — property aposentada
- `GA4 \| Lead Fotus Geral` — era o mesmo evento da oficial, mandado para a property aposentada

### Widget HTML do Elementor (LP)

Ficou **só com o que é experiência de formulário**: CSS, máscara de CNPJ e telefone, validação de dígito verificador, consulta à BrasilAPI (razão social + UF + situação cadastral) e habilitação do botão. **Toda a captura de UTM saiu daqui.**

---

## Campos do formulário (LP `post=8165`, form `c71be28`)

| Campo | `name` real do Elementor | Observação |
|---|---|---|
| CNPJ | `form_fields[field_18cf28a]` | placeholder "Digite o CNPJ da **empresa**" — a palavra "empresa" aqui já causou bug, ver retratações |
| Nome da empresa | `form_fields[field_d066a45]` | placeholder começa com "Nome" |
| E-mail | `form_fields[message]` | nome do campo é enganoso; o `type` é `email` |
| WhatsApp | `form_fields[field_eaad1ad]` | |
| Estado | `form_fields[UF]` | único `<select>` do form |
| Ocultos | `form_fields[utm_source\|utm_medium\|utm_campaign\|utm_content\|utm_term]`, `form_fields[gclid]`, `form_fields[fbclid]`, `form_fields[cnpj_formatado]`, `form_fields[telefone_formatado]` | ids seguem `form-field-<nome>` |

**Regra de ouro para escrever nesses campos:** um campo com ID `utm_source` no Elementor renderiza como `name="form_fields[utm_source]"` **e** `id="form-field-utm_source"`. Seletor `[name="utm_source"]` **não casa com nada** — foi exatamente esse o bug histórico, em dois lugares diferentes.

---

## O que estava quebrado, e o que foi feito

| # | Defeito | Correção | Estado |
|---|---|---|---|
| 1 | **Nenhuma captura de UTM no site institucional.** A jornada começa lá e a UTM não era guardada. | Tag nova no `GTM-M3QHDGM`. | ✅ 25/ago |
| 2 | **Cinco implementações de captura, nenhuma com `domain=`.** localStorage é por origem, cookie sem `domain` é host-only → UTM de `fotus.com.br` invisível na LP. | Cookie com `;domain=.fotus.com.br` nas duas tags. | ✅ 25/ago |
| 3 | **Seletor errado** no bloco "1) UTMs" do widget: `[name="utm_source"]` vs `form_fields[utm_source]`. | Bloco removido; a tag única escreve por id **e** por name real. | ✅ 25/ago |
| 4 | **`ensureHidden` errado** no bloco de validação: criava input órfão `cnpj_formatado`, e o Elementor só envia `form_fields[...]` → CNPJ e telefone formatados **nunca chegavam ao RD**. | Passou a procurar `form_fields[<nome>]`. | ✅ 25/ago |
| 5 | **First-touch eterno.** Bloco com `FIRST_TOUCH = true` lendo localStorage sem expiração → o form podia enviar para sempre a primeira UTM que o navegador viu. | Bloco localizado e removido. Ordem agora é URL > cookie (90d) > vazio. | ✅ 25/ago |
| 6 | **Taxonomia duplicada:** `meta`/`facebook`, `paid-social`/`paid_social`, `cpc`/`paid-search`/`performance-max`. | Normalização na entrada, nas duas tags, com a mesma tabela. | ✅ 25/ago |
| 7 | **Regex de nome pegava o CNPJ:** `/nome\|razao\|empresa\|company/i` casava com o placeholder "Digite o CNPJ da empresa", que vem antes no DOM → `nome == cnpj` nos eventos, `fn` lixo no Meta CAPI. | Tag única tenta `input[placeholder^="Nome"]` primeiro e exclui explicitamente campos que casem com `cnpj`. | ✅ 25/ago |
| 8 | **Cinco lugares com código de captura.** | Consolidado em **duas tags de GTM**, uma por container. | ✅ 25/ago |
| 9 | **Duas properties GA4 medindo o mesmo tráfego** (`G-CLTDDN2TLB` e `G-X0GG5MP2N3`), com o **mesmo evento** `generate_lead` mandado para as duas. | Oficial = `G-CLTDDN2TLB`. A outra foi desligada. ETL passou a ler só ela. | ✅ 25/ago |
| 10 | **`leads` do GA4 vinha de `metrics.conversions`**, que é *todos os key events somados*, não `generate_lead`. Dava 158 num dia em que o FOP registrou 14. | GA4 **não alimenta mais `leads`** (grava 0). O valor bruto foi para `conversoes_custom.keyEvents`. | ✅ 25/ago |

---

## Verificação ponta a ponta (executada em 25/ago)

O teste que prova a cadeia — **URL da LP limpa, sem UTM**:

1. Abrir `https://fotus.com.br/?utm_source=facebook&utm_medium=paid_social&utm_campaign=TESTE&gclid=TESTE`
2. Confirmar cookie no institucional → veio **`utm_source=meta`** e **`utm_medium=paid-social`** (normalização funcionando)
3. Navegar até `https://energia.fotus.com.br/cotacao-distribuidora-solar/` **sem parâmetro nenhum**
4. Confirmar que os cookies atravessaram → atravessaram
5. Confirmar campos ocultos preenchidos → `utm_source=meta`, `utm_medium=paid-social`, `utm_campaign=TESTE`, `gclid=TESTE`
6. Confirmar chegada em `public.events` → `PageView` com a UTM certa

### Detalhe operacional: WP Rocket adia o JavaScript da LP

A LP serve scripts como `type="text/rocketlazyloadscript"` — o JS só executa **na primeira interação do usuário** (mousemove, scroll, clique). Em teste automatizado, nada carrega até simular interação.

Consequência real: **o `PageView` do FOP subconta** quem entra e sai sem interagir. O **`Lead` não é afetado** (é impossível enviar formulário sem interagir). O `fotus.com.br` não usa WP Rocket.

### Verificação do Google Ads (obrigatória ao mexer em tag do Google)

O painel "Tags do Google" do GTM mostra `AW-665226779` como destino conectado do grupo `Fotus Energia – GA4` — o que dá a impressão de que desligar `G-X0GG5MP2N3` derruba o Ads. **Não derruba na LP**, porque lá o `AW-665226779` carrega como instância própria. Verificado no runtime:

```js
Object.keys(window.google_tag_manager)   // → GT-M3SH34PR, GTM-5KKTF798, AW-665226779
document.cookie                          // → _gcl_aw e _gcl_au presentes
```

**Mas no site institucional é diferente:** ali o `AW-665226779` aparece como destino do grupo `G-X0GG5MP2N3`/`GT-MKTR223`. Se um dia limpar a property aposentada no `GTM-M3QHDGM`, **refazer a verificação naquele contexto** — não assumir que já está validado.

---

## GA4 — propriedade oficial

**`G-CLTDDN2TLB`** = propriedade `energia.fotus`, conta `fotusenergia`, property id **`471519038`**, stream Web `10107698431`.

Coleta os **dois** domínios desde 25/ago, para a jornada institucional → LP aparecer numa sessão só. Isso funciona nativamente porque `fotus.com.br` e `energia.fotus.com.br` são subdomínios do mesmo domínio registrável — o `_ga` é gravado em `.fotus.com.br` e é compartilhado.

**Custo aceito:** a `G-CLTDDN2TLB` não tem histórico do institucional; só a partir de 25/ago. O histórico antigo continua na `G-X0GG5MP2N3`, consultável mas não unificável.

**Aposentada:** `G-X0GG5MP2N3`, property id `367331404`.

### ETL `[ULTRON] etl-ga4` (n8n, id `GVsr4jv014JMUxKf`, cron 06:20)

| Nó | Mudança em 25/ago |
|---|---|
| `Loop Properties GA4` | Devolve **só** `471519038`. |
| `GA4 runReport` | Janela de `14daysAgo` → **`30daysAgo`**. Motivo: a maturação do GA4 é grande — conversões entram retroativamente por semanas, e 14 dias congelava valor cedo demais. |
| `Normalizar para schema ultron` | `leads: Math.round(a.conversions)` → **`leads: 0`**. Valor bruto preservado em `conversoes_custom.keyEvents`. |

Migração do histórico já aplicada: **329 linhas, 3.567 "leads" movidos** para `keyEvents`. `sum(leads)` para `plataforma='ga4'` agora é **0**, com 6.840 key events preservados.

**Regra:** lead de site = evento `Lead` do FOP em `public.events`. GA4 serve para sessão, origem e comportamento — **nunca para contar lead**.

---

## O que continua aberto

| Item | Detalhe |
|---|---|
| **628 linhas órfãs em `ultron.eventos_normalizados`** | Gravadas por runs antigos com a property aposentada; o `runReport` nunca mais as devolve, então nunca serão atualizadas. Somam **13.943 sessões fantasma** contra 20.673 legítimas. Identificáveis por `plataforma='ga4' AND ultima_sync::date < '2026-08-25'` — mas o critério só separa bem as datas de 26/jul em diante. Decisão de deletar ou não está pendente. |
| **Backfill de UTM nos cards do RD** | Teto medido de **~15 a 24 cards** de agosto. Baixo de propósito: quando a UTM se perdia no salto entre domínios, ela não chegava nem ao FOP — dos 305 eventos `Lead` sem UTM desde junho, só 1 tem `fbc` e 5 têm `gclid`. O passado quase todo é irrecuperável. |
| **Lead de teste real** | Falta rodar a jornada completa (institucional → LP → enviar) e confirmar `Origem (UTM)` e `cnpj_formatado` no card do RD. |
| **`(not set)` na origem** | Nas linhas ga4, a dimensão de origem vem `(not set)` numa fatia relevante. Provável mistura de escopo (evento × sessão) na consulta. Não investigado. |
| **Snippet WPCode 8619 `tracking fop`** | Está **inativo** e é uma duplicata do que a tag do GTM faz. Manter inativo ou deletar — mas não reativar, senão duplica evento. |

---

## Retratações (para não repetir)

Três conclusões minhas nesta auditoria estavam erradas. Todas pelo mesmo motivo: **inferi em vez de medir**.

1. **"Risco de apagão do Supabase".** Baseei-me em `lp/tracking.js` e `lp/fotus-tracking-gtm.html` deste repo, que apontam para `wttmlnhzvevtabjetsqz.supabase.co`. A tag que está no ar já aponta para o `fop-functions` no EasyPanel desde antes. O repo estava velho.

2. **"O linker do GA4 está quebrado".** Vi `gtag("set","linker",{"domains":["energia.fotus.com.br"]})` e inferi um problema de cross-domain. Não existe: são subdomínios do mesmo domínio, o `_ga` é compartilhado nativamente. Medido — `_ga` idêntico nos dois hosts. `linker.domains` serve para domínios registráveis **diferentes**.

3. **"O lead do GA4 está dobrado pelas duas properties".** Fiz a conta 55 (GA4) contra 14 (FOP) e atribuí ao par de tags × par de properties. Errado: a property aposentada media o **tráfego** dos dois sites (por isso dobrava sessão) mas quase não tinha key event de lead. A inflação do lead vinha de `metrics.conversions` = todos os key events. Descoberto quando o recálculo fez os leads **subirem** em vez de cair.

**Lição para a próxima:** GTM publicado e DOM ao vivo primeiro; repo depois. E quando uma correção produz o efeito contrário do previsto, a hipótese estava errada — não o dado.
