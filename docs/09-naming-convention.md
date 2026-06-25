# 09 — Nomenclatura Padrão Fotus Marketing

> **Propósito:** padronizar o nome de campanhas, grupos de anúncios e anúncios em todas as plataformas de mídia paga (Meta, Google, LinkedIn), além de definir a estrutura de UTMs. O objetivo é garantir que qualquer membro do time — humano ou IA — entenda imediatamente o que uma campanha faz sem precisar abri-la.

---

## 1. Princípios

- **Separador:** ` | ` (pipe com espaços)
- **Case:** sempre MAIÚSCULO
- **Campos:** sempre na mesma ordem, sempre com os mesmos códigos
- **Campos opcionais:** só aparecem quando necessário (produto específico, período)
- **Sem abreviações fora da tabela:** usar somente os códigos definidos abaixo
- **Sem emojis, acentos ou caracteres especiais** nos nomes de campanha

---

## 2. Estrutura por Nível

### 2.1 CAMPANHA

```
[CANAL] | [OBJETIVO] | [PRODUTO] | [PÚBLICO] | [GEO] | [PERÍODO]*
```

> `*` Período é opcional — usar apenas em campanhas com data de encerramento definida.

---

### 2.2 GRUPO DE ANÚNCIOS (Ad Set / Ad Group)

```
[TIPO-PÚBLICO] | [DETALHE] | [GEO]
```

---

### 2.3 ANÚNCIO (Ad / Creative)

```
[FORMATO] | [MENSAGEM] | V[N]
```

---

## 3. Tabelas de Códigos

> 📋 Os códigos canônicos agora vivem nas tabelas `public.codigos_*` do Supabase do FOP. Espelho gerado e legível: [`09-codigos.generated.md`](09-codigos.generated.md) (via `scripts/gen-doc09.ts`). Para mudar um código, edite a TABELA e rode o script — as tabelas abaixo são referência humana.

### 3.1 CANAL

| Código | Plataforma |
|---|---|
| `META` | Meta Ads (Facebook + Instagram) |
| `GOOGLE-SEARCH` | Google Ads — Search |
| `GOOGLE-PMAX` | Google Ads — Performance Max |
| `GOOGLE-YT` | Google Ads — YouTube |
| `GOOGLE-DISPLAY` | Google Ads — Display |
| `LINKEDIN` | LinkedIn Ads |

---

### 3.2 OBJETIVO

| Código | Significado | Objetivo na Plataforma |
|---|---|---|
| `ACQ` | Aquisição de novos integradores | Conversão / Leads |
| `RET` | Retenção e ativação da base de clientes | Conversão / Tráfego |
| `RMKT` | Remarketing / retargeting | Conversão / Leads |
| `REC` | Reconhecimento / brand awareness | Alcance / Awareness |
| `ENG` | Engajamento de conteúdo | Engajamento |
| `VAGAS` | Recrutamento (RH) | Tráfego / Alcance |
| `TESTE` | Experimento ou validação | Qualquer |

---

### 3.3 PRODUTO *(omitir campo se for campanha geral)*

| Código | Produto / Tema |
|---|---|
| `GERAL` | Sem produto específico / mix completo |
| `MICRO` | Microinversores |
| `FC` | Fotus Charge (carregador veicular) |
| `HYB` | Sistemas Híbridos |
| `FIN` | Financiamento |
| `BRAND` | Institucional / marca |
| `LOG` | Logística / Centros de Distribuição |

---

### 3.4 PÚBLICO

| Código | Quem é |
|---|---|
| `NOVOS` | Prospectos que nunca compraram com a Fotus |
| `BASE` | Clientes ativos |
| `LAL` | Lookalike audience (similar à base) |
| `RMKT` | Pool de retargeting (visitou LP, form, etc.) |
| `AMPLO` | Público amplo / sem restrição de audience |
| `ABM` | Account Based Marketing |

---

### 3.5 GEO

| Código | Região / Estado | Observação |
|---|---|---|
| `BR` | Brasil completo | |
| `NE` | Nordeste | Residual: MA, PI, CE, RN, PB, AL, SE (exclui BA e PE que têm CD) |
| `SE` | Sudeste | Residual: RJ, MG (exclui SP e ES que têm CD) |
| `CO` | Centro-Oeste | Residual: MS, DF (exclui GO e MT que têm/terão CD) |
| `N` | Norte | Residual: AM, RR, AP, TO, RO, AC (exclui PA que tem CD) |
| `S` | Sul | Residual: PR, RS (exclui SC que tem CD) |
| `GV` | Grande Vitória (ES) | Micro-geo para campanhas ABM/TESTE |
| `CD-SP` | São Paulo — CD | Estado com Centro de Distribuição ativo |
| `CD-BA` | Bahia — CD | Estado com Centro de Distribuição ativo |
| `CD-ES` | Espírito Santo — CD | Estado com Centro de Distribuição ativo |
| `CD-PE` | Pernambuco — CD | Estado com Centro de Distribuição ativo |
| `CD-PA` | Pará — CD | Estado com Centro de Distribuição ativo |
| `CD-SC` | Santa Catarina — CD | Estado com Centro de Distribuição ativo |
| `CD-GO` | Goiás — CD | Estado com Centro de Distribuição ativo |
| `CD-MT` | Mato Grosso — CD | CD em inauguração — conjuntos criados pausados |

> **Regra de sobreposição:** quando um estado tem conjunto `CD-[ESTADO]` dentro de uma campanha, o conjunto regional correspondente (`SE`, `NE`, etc.) **deve excluir esse estado** na segmentação do Meta Ads. A exclusão é obrigatória para evitar que o mesmo integrador seja elegível para dois ad sets diferentes na mesma campanha.
>
> **Regra de nomenclatura CD:** usar `CD-` apenas no campo GEO do **grupo de anúncios**. No nível de **campanha**, o GEO continua sendo `BR` (cobertura nacional). O prefixo `CD-` sinaliza que o conjunto tem copy de proximidade logística e receberá criativos específicos por estado.

---

### 3.6 PERÍODO *(opcional — apenas campanhas com prazo definido)*

| Formato | Exemplos |
|---|---|
| `MMMAA` (mês + ano) | `MAI26`, `JAN27`, `BF26` |
| Nome de evento | `INTERSOLAR26`, `GREENER26`, `ANIVERSARIO26` |

---

### 3.7 TIPO DE PÚBLICO — Grupos de Anúncios

| Código | Segmentação |
|---|---|
| `AMPLO` | Sem restrição de audience |
| `LAL-1PCT` | Lookalike 1% |
| `LAL-2PCT` | Lookalike 2% |
| `LAL-5PCT` | Lookalike 5% |
| `BASE-ATIVA` | Clientes com compra nos últimos 90 dias |
| `BASE-INATIVA` | Clientes sem compra há 90d+ |
| `ABM-EMP` | ABM via Empresômetro |
| `ABM-PROP` | ABM via Proprietários |
| `RMKT-LP` | Visitou landing page |
| `RMKT-FORM` | Iniciou mas não completou formulário |
| `INT-SOLAR` | Interesse em energia solar |
| `KW-EXATO` | Palavras-chave — correspondência exata *(Google)* |
| `KW-AMPLO` | Palavras-chave — amplo modificado *(Google)* |
| `KW-PHRASE` | Palavras-chave — correspondência de frase *(Google)* |

---

### 3.8 FORMATO — Anúncios

| Código | Formato |
|---|---|
| `IMG` | Imagem estática |
| `VID` | Vídeo |
| `CAR` | Carrossel |
| `STORY` | Stories / formato vertical |
| `REEL` | Reels |
| `RSA` | Responsive Search Ad *(Google Search)* |
| `PMAX` | Asset Group *(Google PMax)* |

---

### 3.9 MENSAGEM — Anúncios

| Código | Tema criativo |
|---|---|
| `OFERTA` | Promoção, desconto ou condição especial |
| `BENEFICIO` | Vantagem competitiva da Fotus |
| `PROVA` | Case, depoimento ou resultado de cliente |
| `PRODUTO` | Feature ou especificação de produto |
| `MARCA` | Institucional / brand |
| `URGENCIA` | Prazo, escassez ou senso de oportunidade |
| `LOGISTICA` | CD local, pronta entrega, agilidade |

---

## 4. Exemplos Completos

### Meta

| Nível | Nome |
|---|---|
| Campanha | `META \| ACQ \| GERAL \| NOVOS \| BR` |
| Ad Set | `LAL-1PCT \| CLIENTES \| NE` |
| Anúncio | `VID \| BENEFICIO \| V1` |

| Nível | Nome |
|---|---|
| Campanha | `META \| RET \| GERAL \| BASE \| BR` |
| Ad Set | `BASE-ATIVA \| GERAL \| SE` |
| Anúncio | `IMG \| LOGISTICA \| V2` |

| Nível | Nome |
|---|---|
| Campanha | `META \| ACQ \| MICRO \| NOVOS \| SP` |
| Ad Set | `LAL-1PCT \| CLIENTES \| SP` |
| Anúncio | `IMG \| OFERTA \| V1` |

| Nível | Nome |
|---|---|
| Campanha | `META \| RMKT \| GERAL \| RMKT \| BR` |
| Ad Set | `RMKT-FORM \| GERAL \| BR` |
| Anúncio | `IMG \| URGENCIA \| V1` |

| Nível | Nome |
|---|---|
| Campanha | `META \| TESTE \| FC \| NOVOS \| GV` |
| Ad Set | `ABM-EMP \| FC \| GV` |
| Anúncio | `VID \| PRODUTO \| V1` |

---

### Google

| Nível | Nome |
|---|---|
| Campanha | `GOOGLE-SEARCH \| ACQ \| GERAL \| NOVOS \| BR` |
| Ad Group | `KW-EXATO \| DISTRIBUIDOR-SOLAR \| BR` |
| Anúncio | `RSA \| BENEFICIO \| V1` |

| Nível | Nome |
|---|---|
| Campanha | `GOOGLE-SEARCH \| REC \| BRAND \| AMPLO \| BR` |
| Ad Group | `KW-EXATO \| FOTUS-SOLAR \| BR` |
| Anúncio | `RSA \| MARCA \| V1` |

| Nível | Nome |
|---|---|
| Campanha | `GOOGLE-PMAX \| ACQ \| GERAL \| NOVOS \| BR` |
| Ad Group | `PMAX \| GERAL \| BR` |
| Anúncio | `PMAX \| BENEFICIO \| V1` |

| Nível | Nome |
|---|---|
| Campanha | `GOOGLE-YT \| REC \| BRAND \| AMPLO \| BR` |
| Ad Group | `AMPLO \| GERAL \| BR` |
| Anúncio | `VID \| MARCA \| V1` |

---

### LinkedIn

| Nível | Nome |
|---|---|
| Campanha | `LINKEDIN \| ACQ \| GERAL \| NOVOS \| BR` |
| Ad Group | `ABM-EMP \| INTEGRADORES \| BR` |
| Anúncio | `IMG \| BENEFICIO \| V1` |

---

## 5. UTM Parameters

Os UTMs seguem a mesma lógica da nomenclatura de campanhas, garantindo que o dado que chega ao GA4 / Supabase seja consistente com o que está nas plataformas.

### Estrutura

| Parâmetro | Origem | Formato |
|---|---|---|
| `utm_source` | Canal | `meta` / `google-search` / `google-pmax` / `google-yt` / `linkedin` |
| `utm_medium` | Tipo de mídia | `paid-social` / `cpc` / `paid-video` / `paid-display` |
| `utm_campaign` | Campanha | Código em lowercase com hífens |
| `utm_content` | Anúncio | Código em lowercase com hífens |
| `utm_term` | Palavra-chave | Apenas Google Search |

### Regra de conversão: maiúsculo → lowercase + hífens

```
META | ACQ | GERAL | NOVOS | BR  →  meta|acq|geral|novos|br
```

### Exemplos de URL com UTM

**Meta — Aquisição geral:**
```
https://fotus.com.br/integrador
  ?utm_source=meta
  &utm_medium=paid-social
  &utm_campaign=acq|geral|novos|br
  &utm_content=vid|beneficio|v1
```

**Google Search — Aquisição:**
```
https://fotus.com.br/integrador
  ?utm_source=google-search
  &utm_medium=cpc
  &utm_campaign=acq|geral|novos|br
  &utm_content=rsa|beneficio|v1
  &utm_term={keyword}
```

**Google YouTube — Reconhecimento:**
```
https://fotus.com.br
  ?utm_source=google-yt
  &utm_medium=paid-video
  &utm_campaign=rec|brand|amplo|br
  &utm_content=vid|marca|v1
```

**LinkedIn — Aquisição:**
```
https://fotus.com.br/integrador
  ?utm_source=linkedin
  &utm_medium=paid-social
  &utm_campaign=acq|geral|novos|br
  &utm_content=img|beneficio|v1
```

---

## 6. Campanhas Ativas no Meta (referência)

Estado após padronização em maio/2026:

| ID | Nome Padronizado | Status |
|---|---|---|
| 120242773309160638 | `META \| ACQ \| GERAL \| NOVOS \| BR` | ✅ Ativa |
| 120236319115270638 | `META \| RET \| GERAL \| BASE \| BR` | ✅ Ativa |
| 120243097387940638 | `META \| REC \| BRAND \| AMPLO \| BR` | ✅ Ativa |
| 120235928732030638 | `META \| ACQ \| MICRO \| NOVOS \| SP` | ✅ Ativa |
| 120242028399070638 | `META \| ENG \| LOG \| BASE \| BR` | ✅ Ativa |
| 120244275509250638 | `META \| ENG \| LOG \| BASE \| BR \| ABR26` | ✅ Ativa |
| 120244467657010638 | `META \| ENG \| BRAND \| BASE \| NE \| MAI26` | ✅ Ativa |
| 120245339317220638 | `META \| TESTE \| FC \| NOVOS \| GV` | ✅ Ativa |
| 120242790156080638 | `META \| VAGAS \| GERAL \| AMPLO \| CO \| ABR26` | ✅ Ativa |
| 120240277985950638 | `META \| RMKT \| GERAL \| RMKT \| BR` | ⏸️ Pausada |

---

## 7. Regras de Aplicação

1. **Toda campanha nova** deve seguir esta nomenclatura antes de ser publicada
2. **Toda campanha existente** deve ser renomeada ao ser editada ou duplicada
3. **Grupos e anúncios** devem ser renomeados ao criar novos conjuntos
4. **UTMs** devem ser geradas a partir dos códigos da campanha, não inventadas manualmente
5. **Novos produtos ou mercados** que não estejam na tabela devem ser adicionados a este documento antes de serem usados
6. **Testes A/B** de criativos: usar mesmo nome base, incrementar `V[N]` (V1, V2, V3...)
7. **Campanhas duplicadas para teste**: usar objetivo `TESTE` em vez do objetivo original até validar

---

*Documento criado em: Maio 2026*  
*Responsável: Igor Pirola — Analista de Mídia Performance, Fotus Distribuidora Solar*
