# =============================================================
# scripts/audit-lal-sizes.ps1
# Audita tamanho dos LAL-1PCT usados nos ad sets de CD novos.
#
# Por que: a Fase 2 do plano de junho/2026 só deve trocar de CBO->ABO
# em RET após confirmar que cada LAL-1PCT por CD tem audiência suficiente
# (>=300k pessoas). LALs muito pequenos travam entrega.
#
# Saida: tabela com CD, audience_id, lower_bound, upper_bound e recomendação.
#
# Uso:  .\audit-lal-sizes.ps1
# =============================================================

$TOKEN   = $env:META_ACCESS_TOKEN
$BASE    = "https://graph.facebook.com/v23.0"
$ACCOUNT = $env:META_AD_ACCOUNT_ID

if (-not $TOKEN)   { Write-Host "ERRO: META_ACCESS_TOKEN nao definida"  -ForegroundColor Red; exit 1 }
if (-not $ACCOUNT) { Write-Host "ERRO: META_AD_ACCOUNT_ID nao definida" -ForegroundColor Red; exit 1 }

$THRESHOLD = 300000   # pessoas — abaixo disso, recomendar expandir para LAL-2PCT/3PCT

# Ad sets novos de CD (criados em 21/mai) na campanha ACQ e RET
# Estrutura: @{ cd = ...; acq_adset_id = ...; ret_adset_id = ... }
$cds = @(
    @{ cd = "CD-ES"; acq = "120245845792910638"; ret = "120245849783390638" }
    @{ cd = "CD-BA"; acq = "120245845794600638"; ret = "120245849786330638" }
    @{ cd = "CD-PE"; acq = "120245845795880638"; ret = "120245849788290638" }
    @{ cd = "CD-PA"; acq = "120245845797030638"; ret = "120245849790230638" }
    @{ cd = "CD-SC"; acq = "120245845797840638"; ret = "120245849791940638" }
    @{ cd = "CD-GO"; acq = "120245845798920638"; ret = "120245849793680638" }
)

function Get-Targeting([string]$adSetId) {
    $uri = $BASE + "/" + $adSetId + "?fields=targeting&access_token=" + $TOKEN
    try {
        $r = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
        return $r.targeting
    } catch {
        Write-Host ("  ERR ao buscar targeting de $adSetId : " + $_.Exception.Message) -ForegroundColor Red
        return $null
    }
}

function Get-AudienceSize([string]$audienceId) {
    # estimate_audience_size requer targeting completo; usar reach_estimate em vez disso
    # com targeting_spec mínimo apontando para o LAL.
    $targeting = @{
        custom_audiences = @(@{ id = $audienceId })
        geo_locations    = @{ countries = @("BR") }
    } | ConvertTo-Json -Depth 5 -Compress

    $uri = $BASE + "/" + $ACCOUNT + "/delivery_estimate?optimization_goal=OFFSITE_CONVERSIONS&targeting_spec=" + [System.Uri]::EscapeDataString($targeting) + "&access_token=" + $TOKEN
    try {
        $r = Invoke-RestMethod -Uri $uri -Method GET -ErrorAction Stop
        if ($r.data -and $r.data.Count -gt 0) {
            return @{
                lower = $r.data[0].estimate_mau_lower_bound
                upper = $r.data[0].estimate_mau_upper_bound
            }
        }
        return $null
    } catch {
        Write-Host ("  ERR ao estimar audiência $audienceId : " + $_.Exception.Message) -ForegroundColor Red
        return $null
    }
}

# Resultado consolidado
$results = @()

Write-Host "`n=== AUDIT LAL-1PCT POR CD ===" -ForegroundColor Cyan

foreach ($entry in $cds) {
    Write-Host ("`n[" + $entry.cd + "]") -ForegroundColor Yellow

    # 1) Buscar audience ID via targeting do ad set ACQ (LAL clientes deve estar lá)
    $targeting = Get-Targeting -adSetId $entry.acq
    if (-not $targeting -or -not $targeting.custom_audiences) {
        Write-Host "  Sem custom_audiences no targeting; pular." -ForegroundColor DarkGray
        continue
    }

    # Heurística: o LAL-1PCT é o primeiro custom_audience que tem 'LAL' ou similar no nome.
    # Como o campo name não vem com targeting, exportar apenas os IDs.
    foreach ($aud in $targeting.custom_audiences) {
        $size = Get-AudienceSize -audienceId $aud.id
        if (-not $size) { continue }

        $reco = if ($size.lower -lt $THRESHOLD) { "EXPANDIR -> LAL-2PCT" } else { "OK" }

        $results += [pscustomobject]@{
            CD          = $entry.cd
            Audience_ID = $aud.id
            Lower       = $size.lower
            Upper       = $size.upper
            Recomendacao = $reco
        }

        $cor = if ($size.lower -lt $THRESHOLD) { "Red" } else { "Green" }
        Write-Host ("  " + $aud.id + " : " + $size.lower + " - " + $size.upper + " => " + $reco) -ForegroundColor $cor
    }
}

Write-Host "`n=== RESUMO ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

# Listar CDs que precisam expandir
$expandir = $results | Where-Object { $_.Recomendacao -eq "EXPANDIR -> LAL-2PCT" }
if ($expandir.Count -gt 0) {
    Write-Host "`nAÇÃO REQUERIDA — criar LAL-2PCT para os seguintes audiences:" -ForegroundColor Yellow
    $expandir | ForEach-Object { Write-Host ("  - " + $_.CD + " : " + $_.Audience_ID) }
} else {
    Write-Host "`nTodos os LAL-1PCT estão acima do threshold de $THRESHOLD pessoas. OK para prosseguir com migração ABO." -ForegroundColor Green
}
