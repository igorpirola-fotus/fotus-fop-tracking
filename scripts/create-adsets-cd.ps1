# =============================================================
# scripts/create-adsets-cd.ps1
# Granulacao geografica por CD - criar e renomear ad sets Meta
#
# Pre-requisitos (variaveis de ambiente):
#   $env:META_ACCESS_TOKEN   - token de acesso Meta
#   $env:META_AD_ACCOUNT_ID  - ID da conta ex: "act_123456789"
#   $env:META_PIXEL_ID       - ID do pixel (para campanhas ACQ e RET)
#
# O que este script faz:
#   1. Busca as chaves de targeting de todos os estados BR necessarios
#   2. Renomeia os sets existentes para o padrao CD-[ESTADO] / [REGIAO]
#   3. Atualiza o geo targeting dos sets regionais para excluir estados com CD
#   4. Cria os novos sets por estado (PAUSED - audiences a adicionar depois)
#
# Uso:
#   .\create-adsets-cd.ps1           - executa tudo
#   .\create-adsets-cd.ps1 -DryRun   - apenas simula, sem chamar a API
# =============================================================

param([switch]$DryRun)

$TOKEN   = $env:META_ACCESS_TOKEN
$BASE    = "https://graph.facebook.com/v18.0"
$ACCOUNT = $env:META_AD_ACCOUNT_ID
$PIXEL   = $env:META_PIXEL_ID

$ok = 0; $fail = 0

if ($DryRun) {
    Write-Host "`n[DRY RUN - nenhuma chamada de escrita sera feita]`n" -ForegroundColor Yellow
} else {
    if (-not $TOKEN)   { Write-Host "ERRO: META_ACCESS_TOKEN nao definida"  -ForegroundColor Red; exit 1 }
    if (-not $ACCOUNT) { Write-Host "ERRO: META_AD_ACCOUNT_ID nao definida" -ForegroundColor Red; exit 1 }
}

# ===========================================================================
# HELPERS
# ===========================================================================

function Get-StateKey([string]$fullName) {
    # Em DryRun, retorna chave simulada sem chamar a API
    if ($DryRun) { return "DRY_" + $fullName.Replace(" ","_").ToUpper() }
    $enc = [System.Uri]::EscapeDataString($fullName)
    # URI montada por concatenacao para evitar problema de parse com & no PS5.1
    $uri = $BASE + "/search?type=adgeolocation&q=" + $enc + "&location_types=%5B%22region%22%5D&country_code=BR&access_token=" + $TOKEN
    $r = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
    if ($r.data.Count -gt 0) { return [string]$r.data[0].key }
    Write-Host ("  [WARN] Sem resultado para: " + $fullName) -ForegroundColor Yellow
    return $null
}

function Get-ErrBody($ex) {
    try {
        $stream = $ex.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch { return $ex.Exception.Message }
}

function Rename-MetaObject([string]$id, [string]$newName) {
    if ($DryRun) { Write-Host "  [DRY] RENAME $id -> $newName" -ForegroundColor DarkCyan; return }
    $body = @{ name = $newName; access_token = $TOKEN }
    try {
        $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $id) -Body $body -ErrorAction Stop
        if ($r.success) { Write-Host "  OK  [$newName]" -ForegroundColor Green; $script:ok++ }
        else             { Write-Host "  FAIL [$newName]" -ForegroundColor Red; $script:fail++ }
    } catch {
        Write-Host ("  ERR [$newName] " + (Get-ErrBody $_)) -ForegroundColor Red
        $script:fail++
    }
}

function Get-AdSetTargeting([string]$adSetId) {
    # URI montada por concatenacao para evitar problema de parse com & no PS5.1
    $uri = $BASE + "/" + $adSetId + "?fields=targeting&access_token=" + $TOKEN
    $r = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
    return $r.targeting
}

function Update-AdSetGeo([string]$adSetId, [string]$label, [string[]]$regionKeys) {
    if ($DryRun) {
        Write-Host ("  [DRY] UPDATE GEO [" + $label + "] -> estados: " + ($regionKeys -join ", ")) -ForegroundColor DarkCyan
        return
    }

    # GET targeting completo para preservar audiencias e demais configs
    try { $current = Get-AdSetTargeting $adSetId }
    catch {
        Write-Host ("  ERR GET targeting [" + $label + "]: " + (Get-ErrBody $_)) -ForegroundColor Red
        $script:fail++
        return
    }

    # Substituir apenas geo_locations
    $current.geo_locations = [PSCustomObject]@{
        regions        = @($regionKeys | ForEach-Object { [PSCustomObject]@{ key = $_ } })
        location_types = @("home","recent")
    }

    $targetingJson = $current | ConvertTo-Json -Compress -Depth 10
    $body = @{ targeting = $targetingJson; access_token = $TOKEN }

    try {
        $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $adSetId) -Body $body -ErrorAction Stop
        if ($r.success) { Write-Host ("  OK GEO [" + $label + "]") -ForegroundColor Green; $script:ok++ }
        else             { Write-Host ("  FAIL GEO [" + $label + "]") -ForegroundColor Red; $script:fail++ }
    } catch {
        Write-Host ("  ERR GEO [" + $label + "] " + (Get-ErrBody $_)) -ForegroundColor Red
        $script:fail++
    }
}

function New-AdSet([string]$campaignId, [string]$name, [string]$optGoal,
                   [string]$billingEvt, [string[]]$regionKeys,
                   [string]$setStatus = "PAUSED", [int]$dailyBudget = 0) {
    if ($DryRun) {
        Write-Host ("  [DRY] CRIAR [" + $name + "] status=" + $setStatus + " geo=(" + ($regionKeys -join ", ") + ")") -ForegroundColor DarkCyan
        return
    }

    $geoTargeting = @{
        geo_locations                      = @{
            regions        = @($regionKeys | ForEach-Object { @{ key = $_ } })
            location_types = @("home","recent")
        }
        brand_safety_content_filter_levels = @("FACEBOOK_STANDARD")
        targeting_optimization             = "none"
    }
    $targetingJson = $geoTargeting | ConvertTo-Json -Compress -Depth 5

    $body = [ordered]@{
        name                        = $name
        campaign_id                 = $campaignId
        optimization_goal           = $optGoal
        billing_event               = $billingEvt
        targeting                   = $targetingJson
        status                      = $setStatus
        configured_status           = $setStatus
        is_dynamic_creative         = "false"
        use_new_app_click           = "false"
        recurring_budget_semantics  = "false"
        access_token                = $TOKEN
    }

    if ($dailyBudget -gt 0) { $body.daily_budget = $dailyBudget }

    # OFFSITE_CONVERSIONS requer promoted_object com pixel + custom_event_type
    if ($optGoal -eq "OFFSITE_CONVERSIONS" -and $PIXEL) {
        $body.promoted_object = (@{ pixel_id = $PIXEL; custom_event_type = "LEAD" } | ConvertTo-Json -Compress)
    }

    try {
        $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $ACCOUNT + "/adsets") -Body $body -ErrorAction Stop
        if ($r.id) { Write-Host ("  CRIADO [" + $name + "] ID=" + $r.id) -ForegroundColor Green; $script:ok++ }
        else        { Write-Host ("  FAIL [" + $name + "]") -ForegroundColor Red; $script:fail++ }
    } catch {
        Write-Host ("  ERR [" + $name + "] " + (Get-ErrBody $_)) -ForegroundColor Red
        $script:fail++
    }
}

# ===========================================================================
# STEP 1: BUSCAR CHAVES DE REGIAO (Meta Targeting Search API)
# ===========================================================================
Write-Host "`n=== STEP 1: Region key lookup ===" -ForegroundColor Cyan

# Nomes sem acentos para evitar problemas de encoding na URL
$stateSearch = [ordered]@{
    SP = "Sao Paulo";           ES = "Espirito Santo";      BA = "Bahia"
    PE = "Pernambuco";          PA = "Para";                SC = "Santa Catarina"
    GO = "Goias";               MT = "Mato Grosso";         RJ = "Rio de Janeiro"
    MG = "Minas Gerais";        PR = "Parana";              RS = "Rio Grande do Sul"
    MS = "Mato Grosso do Sul";  DF = "Distrito Federal";    AM = "Amazonas"
    RR = "Roraima";             AP = "Amapa";               TO = "Tocantins"
    RO = "Rondonia";            AC = "Acre";                MA = "Maranhao"
    PI = "Piaui";               CE = "Ceara";               RN = "Rio Grande do Norte"
    PB = "Paraiba";             AL = "Alagoas";             SE = "Sergipe"
}

# Usando nome $Keys (nao $K/$k para evitar colisao case-insensitive do PS)
$Keys = @{}
foreach ($code in $stateSearch.Keys) {
    try {
        $found = Get-StateKey $stateSearch[$code]
        $Keys[$code] = $found
        Write-Host ("  " + $code + " (" + $stateSearch[$code] + ") -> " + $found) -ForegroundColor DarkGreen
    } catch {
        Write-Host ("  ERRO " + $code + " : " + $_.Exception.Message) -ForegroundColor Red
        $Keys[$code] = $null
    }
}

# Abortar se faltarem chaves criticas (apenas no modo real)
if (-not $DryRun) {
    $critical = @("SP","ES","BA","PE","PA","SC","GO","MT","RJ","MG","PR","RS","MS","DF")
    $missing  = $critical | Where-Object { -not $Keys[$_] }
    if ($missing.Count -gt 0) {
        Write-Host ("`n[ABORTADO] Chaves nao encontradas: " + ($missing -join ", ")) -ForegroundColor Red
        exit 1
    }
}

# Grupos residuais (estados sem CD proprio dentro da regiao)
$SE_RES = @($Keys.RJ, $Keys.MG)
$S_RES  = @($Keys.PR, $Keys.RS)
$NE_RES = @($Keys.MA, $Keys.PI, $Keys.CE, $Keys.RN, $Keys.PB, $Keys.AL, $Keys.SE)
$N_RES  = @($Keys.AM, $Keys.RR, $Keys.AP, $Keys.TO, $Keys.RO, $Keys.AC)
$CO_RES = @($Keys.MS, $Keys.DF)

# ===========================================================================
# STEP 2: META | ENG | LOG | BASE | BR
# ===========================================================================
$LOG_ID = "120242028399070638"
Write-Host ("`n=== STEP 2: LOG - " + $LOG_ID + " ===") -ForegroundColor Cyan

Write-Host "`n-- 2a. Renomear sets existentes --" -ForegroundColor DarkCyan
# CD's SUDESTE          -> residual SE (RJ + MG)
Rename-MetaObject "120243105053420638" "BASE-ATIVA | LOG | SE"
# CD's NORDESTE         -> residual NE (sem BA e PE)
Rename-MetaObject "120243104865680638" "BASE-ATIVA | LOG | NE"
# CD APARECIDA DE GOIANIA -> CD-GO (apenas Goias)
Rename-MetaObject "120242028706230638" "BASE-ATIVA | LOG | CD-GO"
# CD ANANINDEUA         -> CD-PA (apenas Para)
Rename-MetaObject "120242028623100638" "BASE-ATIVA | LOG | CD-PA"
# CD GUARAMIRIM         -> CD-SC (apenas Santa Catarina)
Rename-MetaObject "120242028399060638" "BASE-ATIVA | LOG | CD-SC"

Write-Host "`n-- 2b. Atualizar geo (restringir CD-sets ao estado; excluir CD-states dos regionais) --" -ForegroundColor DarkCyan
Update-AdSetGeo "120243105053420638" "BASE-ATIVA | LOG | SE"     $SE_RES
Update-AdSetGeo "120243104865680638" "BASE-ATIVA | LOG | NE"     $NE_RES
Update-AdSetGeo "120242028706230638" "BASE-ATIVA | LOG | CD-GO"  @($Keys.GO)
Update-AdSetGeo "120242028623100638" "BASE-ATIVA | LOG | CD-PA"  @($Keys.PA)
Update-AdSetGeo "120242028399060638" "BASE-ATIVA | LOG | CD-SC"  @($Keys.SC)

Write-Host "`n-- 2c. Criar novos sets (PAUSED) --" -ForegroundColor DarkCyan
# CD-states que nao existiam: SP, ES, BA, PE
New-AdSet $LOG_ID "BASE-ATIVA | LOG | CD-SP" "IMPRESSIONS" "IMPRESSIONS" @($Keys.SP)
New-AdSet $LOG_ID "BASE-ATIVA | LOG | CD-ES" "IMPRESSIONS" "IMPRESSIONS" @($Keys.ES)
New-AdSet $LOG_ID "BASE-ATIVA | LOG | CD-BA" "IMPRESSIONS" "IMPRESSIONS" @($Keys.BA)
New-AdSet $LOG_ID "BASE-ATIVA | LOG | CD-PE" "IMPRESSIONS" "IMPRESSIONS" @($Keys.PE)
# Residuais que nao existiam (CD-GO/PA/SC cobriam toda a regiao)
New-AdSet $LOG_ID "BASE-ATIVA | LOG | N"     "IMPRESSIONS" "IMPRESSIONS" $N_RES
New-AdSet $LOG_ID "BASE-ATIVA | LOG | S"     "IMPRESSIONS" "IMPRESSIONS" $S_RES
New-AdSet $LOG_ID "BASE-ATIVA | LOG | CO"    "IMPRESSIONS" "IMPRESSIONS" $CO_RES
# MT pausado ate inauguracao do CD
New-AdSet $LOG_ID "BASE-ATIVA | LOG | CD-MT" "IMPRESSIONS" "IMPRESSIONS" @($Keys.MT)

# ===========================================================================
# STEP 3: META | ACQ | GERAL | NOVOS | BR
# ===========================================================================
$ACQ_ID = "120242773309160638"
Write-Host ("`n=== STEP 3: ACQ - " + $ACQ_ID + " ===") -ForegroundColor Cyan

Write-Host "`n-- 3a. Renomear SP -> CD-SP --" -ForegroundColor DarkCyan
Rename-MetaObject "120242773309260638" "LAL-1PCT | CLIENTES | CD-SP"

Write-Host "`n-- 3b. Atualizar geo dos regionais (excluir CD-states) --" -ForegroundColor DarkCyan
Update-AdSetGeo "120242773309280638" "LAL-1PCT | CLIENTES | SE"     $SE_RES
Update-AdSetGeo "120242773309210638" "LAL-1PCT | CLIENTES | NE"     $NE_RES
Update-AdSetGeo "120242773309300638" "LAL-1PCT | CLIENTES | CO"     $CO_RES
Update-AdSetGeo "120242773309290638" "LAL-1PCT | CLIENTES | N"      $N_RES
Update-AdSetGeo "120242773309270638" "LAL-1PCT | CLIENTES | S"      $S_RES
Update-AdSetGeo "120242773309260638" "LAL-1PCT | CLIENTES | CD-SP"  @($Keys.SP)

Write-Host "`n-- 3c. Criar novos sets CD (PAUSED - audiencia LAL a adicionar depois) --" -ForegroundColor DarkCyan
# Nota: duplicar audience LAL-1% do set CD-SP como referencia para cada novo set
New-AdSet $ACQ_ID "LAL-1PCT | CLIENTES | CD-ES" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.ES)
New-AdSet $ACQ_ID "LAL-1PCT | CLIENTES | CD-BA" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.BA)
New-AdSet $ACQ_ID "LAL-1PCT | CLIENTES | CD-PE" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.PE)
New-AdSet $ACQ_ID "LAL-1PCT | CLIENTES | CD-PA" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.PA)
New-AdSet $ACQ_ID "LAL-1PCT | CLIENTES | CD-SC" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.SC)
New-AdSet $ACQ_ID "LAL-1PCT | CLIENTES | CD-GO" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.GO)
New-AdSet $ACQ_ID "LAL-1PCT | CLIENTES | CD-MT" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.MT)

# ===========================================================================
# STEP 4: META | RET | GERAL | BASE | BR
# ===========================================================================
$RET_ID           = "120236319115270638"
$RET_DAILY_BUDGET = 3000   # R$ 30/dia = 3000 centavos (igual aos sets existentes)
Write-Host ("`n=== STEP 4: RET - " + $RET_ID + " ===") -ForegroundColor Cyan

Write-Host "`n-- 4a. Atualizar geo dos regionais (excluir CD-states) --" -ForegroundColor DarkCyan
Update-AdSetGeo "120236319115430638" "BASE-ATIVA | GERAL | SE" $SE_RES
Update-AdSetGeo "120236319115420638" "BASE-ATIVA | GERAL | CO" $CO_RES
Update-AdSetGeo "120236319115410638" "BASE-ATIVA | GERAL | NE" $NE_RES
Update-AdSetGeo "120236319115390638" "BASE-ATIVA | GERAL | N"  $N_RES
Update-AdSetGeo "120236319115310638" "BASE-ATIVA | GERAL | S"  $S_RES

Write-Host "`n-- 4b. Criar novos sets CD (PAUSED - audiencia BASE-ATIVA a adicionar depois) --" -ForegroundColor DarkCyan
# Nota: duplicar audience do set BASE-ATIVA | GERAL | SE como referencia
New-AdSet $RET_ID "BASE-ATIVA | GERAL | CD-SP" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.SP) "PAUSED" $RET_DAILY_BUDGET
New-AdSet $RET_ID "BASE-ATIVA | GERAL | CD-ES" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.ES) "PAUSED" $RET_DAILY_BUDGET
New-AdSet $RET_ID "BASE-ATIVA | GERAL | CD-BA" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.BA) "PAUSED" $RET_DAILY_BUDGET
New-AdSet $RET_ID "BASE-ATIVA | GERAL | CD-PE" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.PE) "PAUSED" $RET_DAILY_BUDGET
New-AdSet $RET_ID "BASE-ATIVA | GERAL | CD-PA" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.PA) "PAUSED" $RET_DAILY_BUDGET
New-AdSet $RET_ID "BASE-ATIVA | GERAL | CD-SC" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.SC) "PAUSED" $RET_DAILY_BUDGET
New-AdSet $RET_ID "BASE-ATIVA | GERAL | CD-GO" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.GO) "PAUSED" $RET_DAILY_BUDGET
New-AdSet $RET_ID "BASE-ATIVA | GERAL | CD-MT" "OFFSITE_CONVERSIONS" "IMPRESSIONS" @($Keys.MT) "PAUSED" $RET_DAILY_BUDGET

# ===========================================================================
# RESULTADO
# ===========================================================================
Write-Host "`n=============================" -ForegroundColor Cyan
Write-Host ("  OK:   " + $ok)   -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
Write-Host "=============================" -ForegroundColor Cyan

if (-not $DryRun) {
    Write-Host "`nPROXIMOS PASSOS MANUAIS (Meta Ads Manager):" -ForegroundColor DarkYellow
    Write-Host "  ACQ - novos sets CD: adicionar audiencia LAL-1% (ref: CD-SP)" -ForegroundColor DarkYellow
    Write-Host "  RET - novos sets CD: adicionar audiencia BASE-ATIVA (ref: GERAL | SE)" -ForegroundColor DarkYellow
    Write-Host "  Apos audiencias configuradas, ativar os sets pausados." -ForegroundColor DarkYellow
    Write-Host "  MT - ativar CD-MT nos 3 sets no dia da inauguracao do CD." -ForegroundColor DarkYellow
}
