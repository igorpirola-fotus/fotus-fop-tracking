# 05 — WhatsApp Business API

## Setup inicial

### Variáveis necessárias
```bash
supabase secrets set WHATSAPP_TOKEN=EAAxxxxxx        # token permanente de sistema
supabase secrets set WHATSAPP_PHONE_ID=1234567890    # ID do número Fotus
supabase secrets set WHATSAPP_VERIFY_TOKEN=fotus_wh_verify_2025
```

### Configurar webhook no Meta

1. Meta Business → WhatsApp → Configurações → Webhooks
2. URL do webhook: `https://SEU-PROJECT-ID.supabase.co/functions/v1/whatsapp-handler`
3. Token de verificação: `fotus_wh_verify_2025`
4. Assinar campos: `messages`

## 4 templates a criar e aprovar

Templates precisam de aprovação do Meta (≈24h). Criar em:
**Meta Business → WhatsApp → Gerenciar → Modelos de mensagem**

### Template 1: Boas-vindas / Qualificação pós-Lead

```
Nome: fotus_boas_vindas_qualificacao
Categoria: UTILITY
Idioma: pt_BR

Cabeçalho: Bem-vindo à Fotus Solar! 🌞

Corpo:
Olá, {{1}}! Vi o interesse da {{2}} na Fotus Solar.
Para te conectar com o consultor ideal, você já distribui
equipamentos solares atualmente?

Rodapé: Responda SIM ou NÃO

Botões de resposta rápida: [SIM] [NÃO]
```

### Template 2: Reativação 90 dias

```
Nome: fotus_reativacao_90d
Categoria: MARKETING
Idioma: pt_BR

Corpo:
Olá, {{1}}! Aqui é a Fotus Solar.
Notamos que faz um tempo desde seu último pedido.
Temos novidades nos kits {{2}} que podem te interessar.
Posso te apresentar as condições atuais?

Botões: [SIM, QUERO VER] [AGORA NÃO]
```

### Template 3: NPS pós-entrega

```
Nome: fotus_nps_pos_entrega
Categoria: UTILITY
Idioma: pt_BR

Corpo:
{{1}}, seu pedido #{{2}} chegou bem?
De 0 a 10, como foi sua experiência com a Fotus?
(Responda com um número de 0 a 10)
```

### Template 4: Agradece review Google

```
Nome: fotus_agradece_review
Categoria: UTILITY
Idioma: pt_BR

Corpo:
Obrigado pela avaliação, {{1}}! 🙏
Ficamos felizes em saber que foi uma boa experiência.
Você toparia responder rapidinho nossa pesquisa de satisfação?
Leva menos de 1 minuto.
```

## Fluxo de qualificação automática

Após Lead criado, o `track-event` dispara automaticamente:

1. Busca integrador no banco
2. Se `phone` preenchido → envia Template 1
3. Registra em `whatsapp_interactions` com `intent = 'qualificacao'`
4. Quando integrador responde SIM/NÃO → recalcula lead_score

## Checklist WhatsApp

- [ ] Token permanente (não de usuário) configurado
- [ ] Webhook configurado e verificado no Meta Business
- [ ] 4 templates criados e aprovados
- [ ] Fluxo de qualificação testado com número real
- [ ] NPS pós-entrega integrado com webhook do ERP
- [ ] Respostas sendo registradas em `whatsapp_interactions`
