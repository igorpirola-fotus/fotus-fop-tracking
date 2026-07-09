# =============================================================
# scripts/debug-cd-errors.ps1
# Diagnostico dos 18 erros HTTP 400 do create-adsets-cd.ps1
#
# Falhas conhecidas:
#   - LOG renames (5 sets): 120243105053420638, 120243104865680638,
#                           120242028706230638, 120242028623100638, 120242028399060638
#   - LOG geo updates (esses mesmos 5 sets)
#   - RET creates (8 novos sets): todos com OFFSITE_CONVERSIONS + daily_budget
#
# Este script:
#   1. Verifica se os LOG sets existem e qual o estado atual
#   2. Tenta o rename com captura real do erro
#   3. Le a config completa de um set RET existente
#   4. Tenta creates minimalistas para o RET com variações
# =============================================================

$TOKEN   = $env:META_ACCESS_TOKEN
$BASE    = "https://graph.facebook.com/v18.0"
$ACCOUNT = $env:META_AD_ACCOUNT_ID
$PIXEL   = $env:META_PIXEL_ID

if (-not $TOKEN)   { Write-Host "ERRO: META_ACCESS_TOKEN nao definida"  -ForegroundColor Red; exit 1 }
if (-not $ACCOUNT) { Write-Host "ERRO: META_AD_ACCOUNT_ID nao definida" -ForegroundColor Red; exit 1 }

# Captura o body real da resposta de erro (PS 5.1)
function Get-ApiError {
    param($err)
    try {
        $resp   = $err.Exception.Response
        $stream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch {
        return "(nao foi possivel ler o body: " + $err.Exception.Message + ")"
    }
}

# ===========================================================================
# BLOCO 1: LOG sets - verificar estado atual
# ===========================================================================
Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host " BLOCO 1: Estado atual dos LOG sets" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$logSets = @(
    @{ id = "120243105053420638"; label = "SUDESTE (SE esperado)" }
    @{ id = "120243104865680638"; label = "NORDESTE (NE esperado)" }
    @{ id = "120242028706230638"; label = "CD-GO (GO)" }
    @{ id = "120242028623100638"; label = "CD-PA (PA)" }
    @{ id = "120242028399060638"; label = "CD-SC (SC)" }
)

foreach ($s in $logSets) {
    $uri = $BASE + "/" + $s.id + "?fields=id,name,status,effective_status,campaign_id,configured_status&access_token=" + $TOKEN
    try {
        $r = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
        Write-Host ("  ID=" + $s.id + " | " + $s.label) -ForegroundColor Green
        Write-Host ("    name=" + $r.name) -ForegroundColor White
        Write-Host ("    status=" + $r.status + " | effective=" + $r.effective_status) -ForegroundColor White
        Write-Host ("    campaign_id=" + $r.campaign_id) -ForegroundColor White
    } catch {
        $errBody = Get-ApiError $_
        Write-Host ("  ERRO GET " + $s.id + " [" + $s.label + "]") -ForegroundColor Red
        Write-Host ("    " + $errBody) -ForegroundColor Red
    }
}

# ===========================================================================
# BLOCO 2: Tentar rename em um LOG set + capturar erro real
# ===========================================================================
Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host " BLOCO 2: Rename LOG set (com erro real)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$testRenameId = "120243105053420638"
Write-Host ("  Tentando rename de " + $testRenameId + " para 'BASE-ATIVA | LOG | SE'...") -ForegroundColor DarkCyan
try {
    $body = @{ name = "BASE-ATIVA | LOG | SE"; access_token = $TOKEN }
    $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $testRenameId) -Body $body -ErrorAction Stop
    Write-Host ("  SUCESSO: " + ($r | ConvertTo-Json -Compress)) -ForegroundColor Green
} catch {
    $errBody = Get-ApiError $_
    Write-Host "  FALHA - body da resposta:" -ForegroundColor Red
    Write-Host ("  " + $errBody) -ForegroundColor Red
}

# ===========================================================================
# BLOCO 3: Config completa de um RET set existente (referencia para criacao)
# ===========================================================================
Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host " BLOCO 3: Config de set RET existente" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$retRefId = "120236319115430638"  # BASE-ATIVA | GERAL | SE (deve existir e estar ativo)
$uri = $BASE + "/" + $retRefId + "?fields=id,name,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,budget_remaining,promoted_object,targeting,campaign_id&access_token=" + $TOKEN
try {
    $r = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
    Write-Host ("  SET: " + $r.name) -ForegroundColor Green
    Write-Host ("  ID: " + $r.id) -ForegroundColor White
    Write-Host ("  status: " + $r.status) -ForegroundColor White
    Write-Host ("  optimization_goal: " + $r.optimization_goal) -ForegroundColor White
    Write-Host ("  billing_event: " + $r.billing_event) -ForegroundColor White
    Write-Host ("  daily_budget: " + $r.daily_budget) -ForegroundColor White
    Write-Host ("  lifetime_budget: " + $r.lifetime_budget) -ForegroundColor White
    Write-Host ("  campaign_id: " + $r.campaign_id) -ForegroundColor White
    Write-Host "  promoted_object:" -ForegroundColor White
    Write-Host ("    " + ($r.promoted_object | ConvertTo-Json -Compress)) -ForegroundColor White
    Write-Host "  targeting (geo):" -ForegroundColor White
    Write-Host ("    " + ($r.targeting.geo_locations | ConvertTo-Json -Compress)) -ForegroundColor White
} catch {
    $errBody = Get-ApiError $_
    Write-Host ("  ERRO GET " + $retRefId) -ForegroundColor Red
    Write-Host ("    " + $errBody) -ForegroundColor Red
}

# Tambem verificar o campaign level para saber se e CBO
$retCampaignId = "120236319115270638"
$uri = $BASE + "/" + $retCampaignId + "?fields=id,name,status,budget_rebalance_flag,daily_budget&access_token=" + $TOKEN
try {
    $r = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
    Write-Host ("`n  CAMPAIGN RET:") -ForegroundColor DarkCyan
    Write-Host ("    name: " + $r.name) -ForegroundColor White
    Write-Host ("    budget_rebalance_flag (CBO): " + $r.budget_rebalance_flag) -ForegroundColor White
    Write-Host ("    daily_budget: " + $r.daily_budget) -ForegroundColor White
} catch {
    $errBody = Get-ApiError $_
    Write-Host ("  ERRO GET campaign RET: " + $errBody) -ForegroundColor Red
}

# ===========================================================================
# BLOCO 4: Criar set RET com variacoes para isolar o problema
# ===========================================================================
Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host " BLOCO 4: Variações de create RET" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$retCampaignId = "120236319115270638"

# Variacao A: sem daily_budget e sem promoted_object (igual ao que funcionou no ACQ)
Write-Host "`n  [VAR-A] Sem daily_budget, sem promoted_object..." -ForegroundColor DarkCyan
try {
    $tgt = @{
        geo_locations = @{
            regions        = @(@{ key = "460" })
            location_types = @("home","recent")
        }
    }
    $body = @{
        name              = "DBG-DELETE | GERAL | VAR-A"
        campaign_id       = $retCampaignId
        optimization_goal = "OFFSITE_CONVERSIONS"
        billing_event     = "IMPRESSIONS"
        targeting         = ($tgt | ConvertTo-Json -Compress -Depth 5)
        status            = "PAUSED"
        access_token      = $TOKEN
    }
    $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $ACCOUNT + "/adsets") -Body $body -ErrorAction Stop
    Write-Host ("  SUCESSO VAR-A: ID=" + $r.id) -ForegroundColor Green
    # Deletar imediatamente para nao sujar a conta
    Invoke-RestMethod -Method DELETE -Uri ($BASE + "/" + $r.id + "?access_token=" + $TOKEN) | Out-Null
    Write-Host "  (set de teste deletado)" -ForegroundColor DarkGray
} catch {
    Write-Host ("  FALHA VAR-A: " + (Get-ApiError $_)) -ForegroundColor Red
}

# Variacao B: com daily_budget, sem promoted_object
Write-Host "`n  [VAR-B] Com daily_budget=3000, sem promoted_object..." -ForegroundColor DarkCyan
try {
    $tgt = @{
        geo_locations = @{
            regions        = @(@{ key = "460" })
            location_types = @("home","recent")
        }
    }
    $body = @{
        name              = "DBG-DELETE | GERAL | VAR-B"
        campaign_id       = $retCampaignId
        optimization_goal = "OFFSITE_CONVERSIONS"
        billing_event     = "IMPRESSIONS"
        targeting         = ($tgt | ConvertTo-Json -Compress -Depth 5)
        status            = "PAUSED"
        daily_budget      = 3000
        access_token      = $TOKEN
    }
    $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $ACCOUNT + "/adsets") -Body $body -ErrorAction Stop
    Write-Host ("  SUCESSO VAR-B: ID=" + $r.id) -ForegroundColor Green
    Invoke-RestMethod -Method DELETE -Uri ($BASE + "/" + $r.id + "?access_token=" + $TOKEN) | Out-Null
    Write-Host "  (set de teste deletado)" -ForegroundColor DarkGray
} catch {
    Write-Host ("  FALHA VAR-B: " + (Get-ApiError $_)) -ForegroundColor Red
}

# Variacao C: com daily_budget E promoted_object (igual ao script original)
Write-Host "`n  [VAR-C] Com daily_budget=3000 + promoted_object LEAD..." -ForegroundColor DarkCyan
try {
    $tgt = @{
        geo_locations = @{
            regions        = @(@{ key = "460" })
            location_types = @("home","recent")
        }
    }
    $body = @{
        name              = "DBG-DELETE | GERAL | VAR-C"
        campaign_id       = $retCampaignId
        optimization_goal = "OFFSITE_CONVERSIONS"
        billing_event     = "IMPRESSIONS"
        targeting         = ($tgt | ConvertTo-Json -Compress -Depth 5)
        status            = "PAUSED"
        daily_budget      = 3000
        promoted_object   = (@{ pixel_id = $PIXEL; custom_event_type = "LEAD" } | ConvertTo-Json -Compress)
        access_token      = $TOKEN
    }
    $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $ACCOUNT + "/adsets") -Body $body -ErrorAction Stop
    Write-Host ("  SUCESSO VAR-C: ID=" + $r.id) -ForegroundColor Green
    Invoke-RestMethod -Method DELETE -Uri ($BASE + "/" + $r.id + "?access_token=" + $TOKEN) | Out-Null
    Write-Host "  (set de teste deletado)" -ForegroundColor DarkGray
} catch {
    Write-Host ("  FALHA VAR-C: " + (Get-ApiError $_)) -ForegroundColor Red
}

# Variacao D: com daily_budget + promoted_object copiando custom_event_type do set RET de referencia
# (so roda se conseguiu ler o set de referencia acima - usar promoted_object do set existente)
Write-Host "`n  [VAR-D] Com daily_budget + promoted_object copiado do set de referencia..." -ForegroundColor DarkCyan
try {
    $refUri = $BASE + "/" + $retRefId + "?fields=promoted_object&access_token=" + $TOKEN
    $refSet = Invoke-RestMethod -Uri $refUri -Method GET -ErrorAction Stop
    $promObjJson = $refSet.promoted_object | ConvertTo-Json -Compress

    Write-Host ("  promoted_object do set ref: " + $promObjJson) -ForegroundColor DarkGray

    $tgt = @{
        geo_locations = @{
            regions        = @(@{ key = "460" })
            location_types = @("home","recent")
        }
    }
    $body = @{
        name              = "DBG-DELETE | GERAL | VAR-D"
        campaign_id       = $retCampaignId
        optimization_goal = "OFFSITE_CONVERSIONS"
        billing_event     = "IMPRESSIONS"
        targeting         = ($tgt | ConvertTo-Json -Compress -Depth 5)
        status            = "PAUSED"
        daily_budget      = 3000
        promoted_object   = $promObjJson
        access_token      = $TOKEN
    }
    $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $ACCOUNT + "/adsets") -Body $body -ErrorAction Stop
    Write-Host ("  SUCESSO VAR-D: ID=" + $r.id) -ForegroundColor Green
    Invoke-RestMethod -Method DELETE -Uri ($BASE + "/" + $r.id + "?access_token=" + $TOKEN) | Out-Null
    Write-Host "  (set de teste deletado)" -ForegroundColor DarkGray
} catch {
    Write-Host ("  FALHA VAR-D: " + (Get-ApiError $_)) -ForegroundColor Red
}

Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host " Diagnostico concluido." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Cole o output acima para o Claude analisar." -ForegroundColor DarkYellow
