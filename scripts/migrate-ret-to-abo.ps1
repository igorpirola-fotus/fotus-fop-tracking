# =============================================================
# scripts/migrate-ret-to-abo.ps1
# Migra a campanha META | RET | GERAL | BASE | BR de CBO para ABO.
#
# CBO -> ABO no Meta:
#   1) Tirar daily_budget da CAMPANHA (setar para vazio via bid_strategy=null
#      não funciona — o caminho oficial é POST com campos vazios + cada ad set
#      recebe seu próprio daily_budget).
#   2) Para cada ad set, POST daily_budget (em centavos).
#
# IMPORTANTE: o Meta exige que, ao migrar para ABO, TODOS os ad sets ativos
# da campanha tenham daily_budget setado. CD-MT permanece PAUSED.
#
# Uso:  .\migrate-ret-to-abo.ps1            (executa de verdade)
#       .\migrate-ret-to-abo.ps1 -DryRun    (apenas simula)
# =============================================================

param([switch]$DryRun)

$TOKEN     = $env:META_ACCESS_TOKEN
$BASE      = "https://graph.facebook.com/v23.0"

if (-not $TOKEN) { Write-Host "ERRO: META_ACCESS_TOKEN nao definida" -ForegroundColor Red; exit 1 }

$CAMPAIGN_RET = "120236319115270638"   # META | RET | GERAL | BASE | BR

# Tabela 2.1 do plano — budget diário por ad set, em REAIS (convertido para centavos abaixo)
$adsetBudgets = @(
    @{ id = "120236319115410638"; name = "BASE-ATIVA | GERAL | NE";    reais = 18; status = "ACTIVE"  }
    @{ id = "120236319115430638"; name = "BASE-ATIVA | GERAL | SE";    reais = 18; status = "ACTIVE"  }
    @{ id = "120245849778240638"; name = "BASE-ATIVA | GERAL | CD-SP"; reais = 18; status = "ACTIVE"  }
    @{ id = "120236319115420638"; name = "BASE-ATIVA | GERAL | CO";    reais = 15; status = "ACTIVE"  }
    @{ id = "120236319115310638"; name = "BASE-ATIVA | GERAL | S";     reais = 10; status = "ACTIVE"  }
    @{ id = "120245849786330638"; name = "BASE-ATIVA | GERAL | CD-BA"; reais = 10; status = "ACTIVE"  }
    @{ id = "120236319115390638"; name = "BASE-ATIVA | GERAL | N";     reais = 8;  status = "ACTIVE"  }
    @{ id = "120245849783390638"; name = "BASE-ATIVA | GERAL | CD-ES"; reais = 8;  status = "ACTIVE"  }
    @{ id = "120245849788290638"; name = "BASE-ATIVA | GERAL | CD-PE"; reais = 8;  status = "ACTIVE"  }
    @{ id = "120245849791940638"; name = "BASE-ATIVA | GERAL | CD-SC"; reais = 8;  status = "ACTIVE"  }
    @{ id = "120245849793680638"; name = "BASE-ATIVA | GERAL | CD-GO"; reais = 8;  status = "ACTIVE"  }
    @{ id = "120245849790230638"; name = "BASE-ATIVA | GERAL | CD-PA"; reais = 6;  status = "ACTIVE"  }
    @{ id = "120245849795810638"; name = "BASE-ATIVA | GERAL | CD-MT"; reais = 0;  status = "PAUSED" }  # aguarda inauguração
)

$totalReais = ($adsetBudgets | Where-Object { $_.status -eq "ACTIVE" } | Measure-Object -Property reais -Sum).Sum
Write-Host ("Budget total ABO planejado: R$ " + $totalReais + "/dia (vs R$ 100 CBO atual)") -ForegroundColor Cyan

if ($DryRun) { Write-Host "`n[DRY RUN - nenhuma chamada de escrita sera feita]`n" -ForegroundColor Yellow }

function Get-ErrBody($ex) {
    try {
        $stream = $ex.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch { return $ex.Exception.Message }
}

# ===========================================================================
# 1) Remover daily_budget da campanha (transforma de CBO em ABO)
# ===========================================================================
#
# Endpoint: POST /<campaign_id>  body: daily_budget=
# Passar string vazia remove o budget no nível campanha.
#
# IMPORTANTE: o Meta retorna erro se você tentar deixar a campanha sem budget
# e algum ad set ativo também sem budget. Ordem segura:
#   a) Atribuir daily_budget em CADA ad set primeiro (passo 2)
#   b) Depois zerar o daily_budget da campanha
#
# Mas o Meta também não aceita ad set com daily_budget enquanto a campanha
# está em CBO — vai retornar "campaign uses budget optimization".
#
# Solução: usar `disable_budget_optimization` na campanha em uma única chamada
# que faz a transição. Documentação: https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/
# Campo: `is_using_l3_schedule` não — o correto é o campo computed `bid_strategy`
# + remover daily_budget. Na prática: setamos daily_budget=0 (ou string vazia)
# e enviamos o conjunto de ad sets com budgets na mesma transação manual.

Write-Host "`n[1] Removendo daily_budget da CAMPANHA $CAMPAIGN_RET (desabilita CBO)..." -ForegroundColor Cyan

if (-not $DryRun) {
    $body = @{ daily_budget = ""; access_token = $TOKEN }
    try {
        $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $CAMPAIGN_RET) -Body $body -ErrorAction Stop
        if ($r.success) { Write-Host "  OK CBO desabilitado." -ForegroundColor Green }
        else            { Write-Host "  FAIL ao desabilitar CBO." -ForegroundColor Red; exit 1 }
    } catch {
        $errBody = Get-ErrBody $_
        Write-Host ("  ERR " + $errBody) -ForegroundColor Red
        Write-Host "`n  IMPORTANTE: se erro for 'campaign uses budget optimization', desativar CBO manualmente no Ads Manager primeiro." -ForegroundColor Yellow
        Write-Host "  Caminho UI: Editar campanha -> Desativar otimização de orçamento da campanha -> Aplicar." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  [DRY] POST /$CAMPAIGN_RET daily_budget=''" -ForegroundColor DarkCyan
}

# ===========================================================================
# 2) Atribuir daily_budget em cada ad set
# ===========================================================================

Write-Host "`n[2] Atribuindo daily_budget por ad set..." -ForegroundColor Cyan

$ok = 0; $fail = 0
foreach ($a in $adsetBudgets) {
    if ($a.status -eq "PAUSED") {
        Write-Host ("  SKIP " + $a.name + " (PAUSED - aguarda inauguração)") -ForegroundColor DarkGray
        continue
    }

    $centavos = [int]($a.reais * 100)

    if ($DryRun) {
        Write-Host ("  [DRY] " + $a.name + " -> daily_budget=" + $centavos + " centavos (R$ " + $a.reais + ")") -ForegroundColor DarkCyan
        continue
    }

    $body = @{ daily_budget = $centavos; access_token = $TOKEN }
    try {
        $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $a.id) -Body $body -ErrorAction Stop
        if ($r.success) {
            Write-Host ("  OK   " + $a.name + " (R$ " + $a.reais + "/dia)") -ForegroundColor Green
            $ok++
        } else {
            Write-Host ("  FAIL " + $a.name) -ForegroundColor Red
            $fail++
        }
    } catch {
        Write-Host ("  ERR  " + $a.name + " : " + (Get-ErrBody $_)) -ForegroundColor Red
        $fail++
    }
}

Write-Host ("`n[RESUMO] OK=" + $ok + " FAIL=" + $fail) -ForegroundColor Cyan

# ===========================================================================
# 3) Verificação pós-migração
# ===========================================================================
Write-Host "`n[3] Verificando estado pós-migração..." -ForegroundColor Cyan

if (-not $DryRun) {
    $uri = $BASE + "/" + $CAMPAIGN_RET + "?fields=name,daily_budget,bid_strategy&access_token=" + $TOKEN
    try {
        $r = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
        Write-Host ("  Campanha: " + $r.name)
        Write-Host ("  daily_budget: " + $r.daily_budget + "  <- esperado vazio/0 se ABO ativado")
        Write-Host ("  bid_strategy: " + $r.bid_strategy)
    } catch {
        Write-Host ("  ERR verificação: " + (Get-ErrBody $_)) -ForegroundColor Red
    }
}
