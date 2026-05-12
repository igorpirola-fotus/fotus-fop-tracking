#!/bin/bash
# Testes de validação — Fase 2
# Uso: bash scripts/test-phase2.sh https://SEU-PROJECT-ID.supabase.co

EDGE_URL="${1:-https://SEU-PROJECT-ID.supabase.co}"

echo "=== TESTE: Webhook RD CRM — Contact ==="
curl -s -X POST "$EDGE_URL/functions/v1/rd-sync" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "funnel_stage_changed",
    "data": {
      "deal": {"id": "12345","deal_stage": {"name": "Em Contato"},"amount": 0},
      "contacts": [{"email": "contato@integradorateste.com.br","cf_cnpj": "11.222.333/0001-81"}]
    }
  }' | jq .

echo ""
echo "=== TESTE: Webhook ERP — Purchase (primeiro pedido) ==="
curl -s -X POST "$EDGE_URL/functions/v1/erp-sync" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: fotus_erp_webhook_secret_2025" \
  -d '{
    "event_type": "purchase_approved",
    "cnpj": "11222333000181",
    "order_id": "PED-TESTE-001",
    "order_value": 8500.00,
    "is_first_order": true
  }' | jq .

echo ""
echo "=== VERIFICAÇÕES MANUAIS ==="
echo "1. RD CRM: mover deal real entre etapas → verificar events no Supabase"
echo "2. Meta Events Manager: Contact, Schedule, AddToCart, Purchase via 'Servidor'"
echo "3. Custom Conversion 'Lead Qualificado Fotus': recebendo eventos Schedule"
echo "4. Google Ads: conversões sendo importadas do GA4"
echo "5. Todos os eventos com MQ ≥ 7.5"
