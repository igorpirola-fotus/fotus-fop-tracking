# Extensão UTM Builder da Fotus — Design

**Data:** 2026-08-20
**Autor:** Igor + Claude
**Status:** Proposto (aprovado no brainstorming)

## Contexto e objetivo

O time de mídia da Fotus hoje usa uma **extensão de UTM genérica** (de terceiro) no navegador. Ela é genérica: campos livres, sem o vocabulário da Fotus, e **não grava nada num banco nosso**. Em paralelo:

- Já existe um **gerador web da Fotus** (`web/utm-builder`, backend `generate-utm`/`utm-config` no `fop-functions`, catálogo `codigos_*` e tabela `utm_links` no fop-db). Backend migrado do Supabase e validado em 2026-08-20. Adoção ~zero (falta a ferramenta estar "à mão" no navegador).
- O **Lucas** (time do Igor) fez um app (`UTM_BUILDER_APP/index.html`) que gera **UTM para DOWNLOADS de app** (Google Play, App Store, Smart Link + QR), com um **design-system Fotus** próprio.

**Objetivo:** uma **extensão Chrome da Fotus** que o time instala no navegador, unificando os dois geradores (web + app), com o vocabulário controlado da Fotus, e que **grava toda UTM gerada no fop-db** — para saber o que/quem/quando foi gerado e conciliar com a receita.

## Decisões (fechadas no brainstorming)

1. **Instalação:** extensão **desempacotada (modo desenvolvedor)** — piloto com o time; sem loja/revisão.
2. **Escopo:** "Completo" — web + app, histórico, modelos, campos extras.
3. **Link de app também grava no fop-db** (`tipo='app'`), para catálogo único web+app.
4. **Modelos compartilhados** (no fop-db), não por navegador — reforça padronização.

## Arquitetura

```
Extensão Chrome (MV3, desempacotada)  ── popup HTML/JS vanilla
        │  (fetch)
        ▼
fop-functions (Deno, EasyPanel — JÁ NO AR)
   GET  /utm-config          (catálogo — existe)
   POST /generate-utm        (web — existe; estender p/ campos extras + tipo)
   POST /generate-utm-app    (app — NOVO: valida/normaliza e grava tipo='app')
   GET  /utm-history         (NOVO: últimos links por criado_por)
   GET/POST /utm-templates    (NOVO: modelos compartilhados)
        │  (Postgres via db.ts)
        ▼
fop-db (Postgres EasyPanel)
   public.utm_links      (+ colunas: tipo, utm_source_platform, utm_creative_format, store_meta jsonb)
   public.codigos_*      (catálogo — existe)
   public.utm_templates  (NOVO — modelos compartilhados)
```

Sem Supabase. Mesma stack e padrão do `server.ts`/`db.ts`.

## Componentes

### 1. Extensão (novo) — `web/utm-extension/`
- **Manifest MV3** (`manifest.json`): permissões mínimas `activeTab` (pegar URL da aba), `clipboardWrite`, `storage` (guardar nome de quem gera + cache do catálogo). Host permission só para o domínio do fop-functions.
- **Popup** (`popup.html` + `popup.js` + `popup.css`) — visual do design-system do Lucas (dark slate + verde `#22C55E`, Fira Code/Sans). Duas abas:
  - **Link Web:** dropdowns do catálogo (via `/utm-config`, com cache local), **autofill da URL da aba ativa**, campos doc 09 (canal/objetivo/produto/público/geo/período/conteúdo) + extras (`source_platform`, `creative_format`). Botão **Gerar** → mostra o link, **copia** e **salva** (`POST /generate-utm`).
  - **Link de App:** porta a lógica do `UTM_BUILDER_APP` — Google Play (`&referrer=`), App Store (`ct`/`pt`/`mt`), Smart Link + **QR Code**, defaults dos apps Fotus. Botão Gerar → mostra os 3 links + QR, copia, e **salva** (`POST /generate-utm-app`).
  - **Histórico** (Fase 2) e **Modelos** (Fase 2).
- **Identidade:** pede o nome uma vez, guarda em `chrome.storage` → vai como `criado_por`.

### 2. Backend — `fop-functions/`
- Estender `generate-utm`: aceitar `utm_source_platform`, `utm_creative_format`, `tipo` (default `'web'`); acrescentar os extras como parâmetros no link e colunas no insert.
- **`generate-utm-app`** (novo handler + rota): recebe os campos de app, monta os 3 links (lógica portada do `index.html` do Lucas: slug, Play referrer, Apple `ct`≤30/`pt`/`mt`, Smart Link), e grava em `utm_links` com `tipo='app'` e os detalhes de loja em `store_meta` (jsonb). Dedupe por `hash_dedupe`.
- **`utm-history`** (novo): `GET /utm-history?criado_por=&limite=` → últimas linhas de `utm_links` (sem BigInt na resposta — id::text).
- **`utm-templates`** (novo): `GET` lista modelos ativos; `POST` cria modelo. Grava em `public.utm_templates`.
- Sem auth (como `/track-event`) — ferramenta interna de baixa sensibilidade. `criado_por` identifica quem gerou.

### 3. Schema — migration nova
- `ALTER TABLE public.utm_links ADD COLUMN tipo text DEFAULT 'web', ADD COLUMN utm_source_platform text, ADD COLUMN utm_creative_format text, ADD COLUMN store_meta jsonb;`
- `CREATE TABLE public.utm_templates (id bigserial PK, nome text, tipo text, campos jsonb, criado_por text, ativo boolean DEFAULT true, criado_em timestamptz DEFAULT now());`

## Fluxo de dados / conciliação

- **Link Web:** gerado → `utm_links` (com `criado_por` + canal padronizado) → o lead navega → `sessions` recebe a mesma UTM → `normaliza_canal` casa os dois → receita por origem/por quem gerou. **Loop automático completo.**
- **Link de App:** gerado → `utm_links` (`tipo='app'`, `store_meta`). Os downloads são medidos no **Google Play Console** (install referrer) e **App Store Connect** (campanha Apple), **não** em `sessions`. Então o fop-db guarda o **catálogo** (o que/quem/quando); a conciliação de app é cruzar o `utm_campaign`/`ct` gerado com o export do console da loja — **não automática**. (Registrado para não prometer o loop web no lado app.)

## Reaproveitamento
- **Do app do Lucas:** toda a lógica de link de app (Play/Apple/Smart Link/QR) + os defaults dos apps + o **design-system** (`design-system/fotus-utm-builder/MASTER.md`).
- **Do backend atual:** `generate-utm`/`utm-config`, `fop-db`/`utm_links`/`codigos_*`, `normaliza_canal`, helpers `db.ts`.

## Faseamento
- **Fase 1 (MVP):** extensão com as 2 abas (Web salva no fop-db; App = lógica do Lucas + QR + salva no fop-db) + autofill + copiar/salvar; backend `generate-utm` estendido + `generate-utm-app` + migration das colunas de `utm_links`.
- **Fase 2:** aba Histórico (`utm-history`) + aba Modelos compartilhados (`utm_templates` + endpoints).

## Não-objetivos
- Publicar na Chrome Web Store (piloto é desempacotado).
- Push automático de UTM para Meta/Google/LinkedIn (Fase 3 do UTM Builder original, fora daqui).
- Conciliação automática de downloads de app (depende dos consoles das lojas).
- Autenticação de usuário (endpoints internos, `criado_por` basta).

## Riscos / atenção
- **Adoção** é o critério de sucesso real — a extensão só resolve a fragmentação se o time usar. Instalação desempacotada tem fricção (dev mode); mitigar com passo a passo simples e o visual/UX do Lucas.
- Extensão desempacotada **não atualiza sozinha** — mudanças exigem recarregar. Aceitável no piloto.
- Campos extras (`source_platform`/`creative_format`) fogem do doc 09 estrito → vão como parâmetros adicionais, nunca dentro do `utm_campaign`.

## Critério de sucesso
Time gerando links pela extensão (web e app), com `utm_links` crescendo e canais chegando **já padronizados** — reduzindo o `sem_sessao`/fragmentação nas análises de origem.
