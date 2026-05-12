# 00 — Baseline (preencher antes de qualquer implementação)

> Este documento é o ponto zero do projeto. Preencha TODOS os campos antes de começar
> a Fase 1. Ele serve como referência para medir o impacto real ao final dos 90 dias.

---

## 1. Credenciais e acessos

### Meta
| Item | Valor | Status |
|---|---|---|
| Business Manager ID | `_______________` | ☐ confirmado |
| Pixel ID | `_______________` | ☐ confirmado |
| Token CAPI gerado | `_______________` | ☐ confirmado |
| Domínio verificado no BM | `fotus.com.br` | ☐ verificado |
| Aggregated Event Measurement configurado | — | ☐ configurado |

**Como gerar o Token CAPI:**
1. Acesse [business.facebook.com](https://business.facebook.com)
2. Gerenciador de Eventos → seu Pixel
3. Configurações → API de Conversões → "Gerar token de acesso"
4. Copie e salve em local seguro — o token só aparece uma vez

**Como verificar o domínio:**
1. Gerenciador de Eventos → Configurações → Verificação de domínio
2. Adicionar `fotus.com.br` → escolher método "Meta-tag HTML"
3. Inserir a meta tag no `<head>` da LP antes de prosseguir

### RD Station
| Item | Valor | Status |
|---|---|---|
| RD CRM — usuário admin | `_______________` | ☐ confirmado |
| RD Marketing — API Token | `_______________` | ☐ confirmado |
| Etapas do pipeline configuradas | Em Contato / Qualificado / Proposta / Ganho / Perdido | ☐ confirmado |

**Como obter o API Token do RD Marketing:**
1. Conta (avatar) → Minha Conta → API Token
2. Copiar o token e salvar

### WhatsApp
| Item | Valor | Status |
|---|---|---|
| WABA ID | `_______________` | ☐ confirmado |
| Phone Number ID | `_______________` | ☐ confirmado |
| Token permanente | `_______________` | ☐ confirmado |
| Número testado (envio manual OK) | — | ☐ testado |

**Como gerar token permanente do WhatsApp:**
1. Meta Business → WhatsApp → Configurações da API
2. Criar token de acesso de sistema (não de usuário) — token de usuário expira em 60 dias
3. Conceder permissão `whatsapp_business_messaging`

### Supabase
| Item | Valor | Status |
|---|---|---|
| Projeto criado em `sa-east-1` (São Paulo) | — | ☐ criado |
| URL do projeto | `https://xxx.supabase.co` | ☐ anotado |
| Service Role Key | `eyJ...` | ☐ anotado |
| Anon Key | `eyJ...` | ☐ anotado |

**Criar projeto Supabase:**
1. [app.supabase.com](https://app.supabase.com) → New Project
2. Nome: `fotus-tracking`
3. Região: **South America (São Paulo)** — obrigatório para LGPD e latência
4. Senha forte para o banco (anotar!)

---

## 2. Métricas atuais (baseline)

> Registre agora. Você vai comparar estes números com os de 90 dias depois.

### Meta Ads — extrair do Ads Manager (últimos 90 dias)

| Métrica | Valor atual | Data da medição |
|---|---|---|
| CPL — Custo por Lead | R$ ___ | ___ / ___ / ___ |
| Leads gerados (90d) | ___ | ___ / ___ / ___ |
| Compras atribuídas (90d) | ___ | ___ / ___ / ___ |
| ROAS reportado pelo Meta | ___ | ___ / ___ / ___ |
| CTR médio | ___% | ___ / ___ / ___ |
| Budget mensal Meta Ads | R$ ___ | ___ / ___ / ___ |

### Match Quality — extrair do Events Manager

| Evento | Match Quality atual |
|---|---|
| Lead | ~6.0 (confirmar) |
| PageView | ___ |
| Outros (se houver) | ___ |

**Como verificar Match Quality:**
1. Gerenciador de Eventos → seu Pixel → Visão Geral
2. Clicar no evento Lead
3. Coluna "Qualidade da Correspondência"

### Funil comercial — extrair do RD CRM (últimos 90 dias)

| Etapa | Quantidade | Taxa de conversão para próxima etapa |
|---|---|---|
| Leads totais | ___ | ___% → Em Contato |
| Em Contato (SDR) | ___ | ___% → Qualificado |
| Qualificados (SQL) | ___ | ___% → Proposta |
| Proposta enviada | ___ | ___% → Ganho |
| Ganhos (clientes) | ___ | — |
| Perdidos | ___ | — |

### ERP — extrair com o time financeiro

| Métrica | Valor atual |
|---|---|
| Novos clientes (últimos 90d) | ___ |
| Receita novos clientes (90d) | R$ ___ |
| Ticket médio primeiro pedido | R$ ___ |
| CAC real (budget / novos clientes) | R$ ___ |
| LTV médio (12 meses) | R$ ___ |
| Taxa de reativação (inativos 90d que voltaram) | ___% |
| Total de integradores ativos | ___ |
| Total de integradores inativos (+90d) | ___ |

---

## 3. Configuração atual do Pixel

| Item | Situação atual |
|---|---|
| Pixel instalado na LP | ☐ sim / ☐ não |
| Eventos disparando | Lead |
| Server-side (CAPI) configurado | ☐ sim / ☐ não |
| fbp sendo capturado | ☐ sim / ☐ não |
| fbc sendo capturado | ☐ sim / ☐ não |
| email sendo enviado ao Meta | ☐ sim / ☐ não |
| phone sendo enviado ao Meta | ☐ sim / ☐ não |

---

## 4. Checklist de pré-requisitos completos

Só avançar para a Fase 1 quando todos estes itens estiverem marcados:

- [ ] Pixel ID e Token CAPI copiados e salvos
- [ ] Domínio `fotus.com.br` verificado no BM
- [ ] API Token RD Marketing copiado
- [ ] Webhooks do RD CRM testados (endpoint de teste disponível)
- [ ] Contato com TI sobre webhook do ERP feito
- [ ] Token permanente WhatsApp gerado
- [ ] Projeto Supabase criado em `sa-east-1`
- [ ] Repositório GitHub criado (`fotus-fop-tracking`)
- [ ] Supabase CLI instalado localmente (`supabase --version`)
- [ ] Baseline de métricas acima preenchido
- [ ] Budget aprovado para o projeto (Supabase Pro ≈ USD 25/mês)
