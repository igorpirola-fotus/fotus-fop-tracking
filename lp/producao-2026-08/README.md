# Código de tracking em produção — snapshot de 25/ago/2026

Estes três arquivos são **o que está publicado**, não rascunho. Foram colados
nas ferramentas abaixo nesta data. Se você mudar lá, atualize aqui também —
foi a divergência entre repo e produção que gerou duas conclusões erradas na
auditoria de ago/2026 (ver `docs/14-captura-utm-e-tracking-2026-08.md`).

| Arquivo | Onde vive em produção | Acionador |
|---|---|---|
| `gtm-5KKTF798--FOP-Tracking-UTM-unica.html` | GTM `GTM-5KKTF798` (LP), tag `FOP \| Tracking + UTM (única)` | All Pages |
| `gtm-M3QHDGM--captura-utm-institucional.html` | GTM `GTM-M3QHDGM` (fotus.com.br), tag `FOTUS — CAPTURA DE UTM NO SITE INSTITUCIONAL` | All Pages |
| `elementor-widget-html-form-cotacao.html` | Widget HTML do Elementor, dentro do contêiner do formulário da LP `post=8165` | — |

## Regras que não podem se perder

1. **Cookie sempre com `;domain=.fotus.com.br`.** Sem o ponto na frente ele fica
   preso ao host e a UTM não atravessa `fotus.com.br` → `energia.fotus.com.br`.
2. **Campo do Elementor com ID `x` renderiza como `name="form_fields[x]"` e
   `id="form-field-x"`.** Seletor `[name="x"]` não casa com nada.
3. **Prioridade da UTM: URL > cookie (90d) > vazio.** Nunca first-touch sem
   expiração — o formulário passa a enviar para sempre a primeira UTM vista.
4. **A tabela de normalização** (`facebook→meta`, `paid_social→paid-social`, etc.)
   existe nas duas tags de GTM. Se mudar numa, mude na outra.
5. **Não reativar** o snippet WPCode 8619 `tracking fop` — é duplicata da tag do
   GTM e duplicaria evento.
