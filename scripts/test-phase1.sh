#!/bin/bash
# Testes de validação — Fase 1
# Uso: bash scripts/test-phase1.sh https://SEU-PROJECT-ID.supabase.co

EDGE_URL="${1:-https://SEU-PROJECT-ID.supabase.co}"

echo "=== TESTE 1: PageView server-side ==="
curl -s -X POST "$EDGE_URL/functions/v1/track-event" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-pv-001",
    "event_name": "PageView",
    "session_id": "test-session-001",
    "url": "https://fotus.com.br/lp?utm_source=ig&utm_medium=paid&utm_campaign=teste-fase1",
    "utms": {"utm_source": "ig","utm_medium": "paid","utm_campaign": "teste-fase1"},
    "fbp": "_fbp.1.1234567890.9876543210",
    "fbc": "fb.1.1234567890.AbCdEfGhIjKlMn",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"
  }' | jq .

echo ""
echo "=== TESTE 2: Lead server-side ==="
curl -s -X POST "$EDGE_URL/functions/v1/track-event" \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-lead-001",
    "event_name": "Lead",
    "session_id": "test-session-001",
    "url": "https://fotus.com.br/lp",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
    "event_data": {
      "email": "contato@integradorateste.com.br",
      "phone": "27999998888",
      "nome": "João da Silva",
      "cnpj": "11.222.333/0001-81",
      "estado": "ES",
      "content_category": "aquisicao"
    }
  }' | jq .

echo ""
echo "=== VERIFICAÇÕES ESPERADAS ==="
echo "✅ sessions: 1 registro com UTMs, geo, fbp, fbc"
echo "✅ integradores: cnpj = '11222333000181'"
echo "✅ events: Lead com meta_capi_status = 'sent' e meta_event_id preenchido"
echo "✅ Aguardar 5s e verificar enriquecimento: razao_social preenchida"
echo "✅ Meta Events Manager → Test Events: evento via 'Servidor'"
echo ""
echo "CRITÉRIO DE AVANÇO PARA FASE 2: MQ Lead ≥ 8.5 após 48h de tráfego real"
