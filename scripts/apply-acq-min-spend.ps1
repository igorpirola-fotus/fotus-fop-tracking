# =============================================================
# scripts/apply-acq-min-spend.ps1
# Aplica daily_min_spend_target nos 7 ad sets de CD novos da campanha
# META | ACQ | GERAL | NOVOS | BR. Mantém a campanha em CBO mas garante
# que o algoritmo gaste pelo menos X reais/dia em cada CD novo.
#
# Sem isso, o CBO concentra tudo nos ad sets maduros (residuais SE/NE/N/S/CO)
# e os CDs novos seguem sem aprender. Floor garantido = R$ 54/dia dos R$ 250
# da campanha; resto (R$ 196/dia) o algoritmo distribui.
#
# Uso:  .\apply-acq-min-spend.ps1
#       .\apply-acq-min-spend.ps1 -DryRun
# =============================================================

param([switch]$DryRun)

$TOKEN = $env:META_ACCESS_TOKEN
$BASE  = "https://graph.facebook.com/v23.0"

if (-not $TOKEN) { Write-Host "ERRO: META_ACCESS_TOKEN nao definida" -ForegroundColor Red; exit 1 }

# Tabela 2.2 do plano — min spend diário por ad set, em REAIS
$minSpends = @(
    @{ id = "120245845792910638"; name = "LAL-1PCT | CLIENTES | CD-ES"; reais = 10; status = "ACTIVE" }
    @{ id = "120245845794600638"; name = "LAL-1PCT | CLIENTES | CD-BA"; reais = 10; status = "ACTIVE" }
    @{ id = "120245845795880638"; name = "LAL-1PCT | CLIENTES | CD-PE"; reais = 10; status = "ACTIVE" }
    @{ id = "120245845797030638"; name = "LAL-1PCT | CLIENTES | CD-PA"; reais = 8;  status = "ACTIVE" }
    @{ id = "120245845797840638"; name = "LAL-1PCT | CLIENTES | CD-SC"; reais = 8;  status = "ACTIVE" }
    @{ id = "120245845798920638"; name = "LAL-1PCT | CLIENTES | CD-GO"; reais = 8;  status = "ACTIVE" }
    @{ id = "120245845799920638"; name = "LAL-1PCT | CLIENTES | CD-MT"; reais = 0;  status = "PAUSED" }
)

$totalReais = ($minSpends | Where-Object { $_.status -eq "ACTIVE" } | Measure-Object -Property reais -Sum).Sum
Write-Host ("Floor mínimo total: R$ " + $totalReais + "/dia (de R$ 250 CBO)") -ForegroundColor Cyan

if ($DryRun) { Write-Host "`n[DRY RUN - nenhuma chamada de escrita sera feita]`n" -ForegroundColor Yellow }

function Get-ErrBody($ex) {
    try {
        $stream = $ex.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch { return $ex.Exception.Message }
}

# ===========================================================================
# Aplicar daily_min_spend_target em cada ad set
# ===========================================================================
# Campo: daily_min_spend_target (centavos). É um sinal pro algoritmo, não
# uma garantia hard — mas funciona bem para "puxar" entrega em sets novos.

$ok = 0; $fail = 0
foreach ($a in $minSpends) {
    if ($a.status -eq "PAUSED") {
        Write-Host ("  SKIP " + $a.name + " (PAUSED)") -ForegroundColor DarkGray
        continue
    }

    $centavos = [int]($a.reais * 100)

    if ($DryRun) {
        Write-Host ("  [DRY] " + $a.name + " -> daily_min_spend_target=" + $centavos) -ForegroundColor DarkCyan
        continue
    }

    $body = @{ daily_min_spend_target = $centavos; access_token = $TOKEN }
    try {
        $r = Invoke-RestMethod -Method POST -Uri ($BASE + "/" + $a.id) -Body $body -ErrorAction Stop
        if ($r.success) {
            Write-Host ("  OK   " + $a.name + " (min R$ " + $a.reais + "/dia)") -ForegroundColor Green
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

if (-not $DryRun) {
    Write-Host "`nPróximo passo: D+7 rodar análise de spend por ad set." -ForegroundColor Yellow
    Write-Host "  Cada CD novo deve ter acumulado >= R$ 50 na semana." -ForegroundColor Yellow
    Write-Host "  Se ainda <R$ 50, considerar trocar LAL-1PCT por LAL-2PCT (rodar audit-lal-sizes.ps1)." -ForegroundColor Yellow
}
