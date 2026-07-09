# run-backfill.ps1 — Runner do backfill de integradores
# Chama a Edge Function backfill-integradores em loop até terminar.
#
# USO:
#   # Fase 1 — criar registros base a partir de todas as organizações
#   .\queries\run-backfill.ps1 -Mode orgs
#
#   # Fase 2 — atualizar clientes com histórico de compras (deals ganhos)
#   .\queries\run-backfill.ps1 -Mode won
#
#   # Teste sem escrever no banco
#   .\queries\run-backfill.ps1 -Mode won -DryRun
#
#   # Continuar de onde parou (ex: caiu na página 42)
#   .\queries\run-backfill.ps1 -Mode won -StartPage 42
#
# PRÉ-REQUISITO: deploy da Edge Function
#   supabase functions deploy backfill-integradores --no-verify-jwt
# (run from fotus-fop-tracking folder)

param(
  [ValidateSet("orgs","won")] [string] $Mode       = "orgs",
  [int]    $StartPage    = 1,
  [int]    $PagesPerRun  = 10,
  [switch] $DryRun       = $false
)

# ── Config ────────────────────────────────────────────────────────────────────
$ProjectRef = "wttmlnhzvevtabjetsqz"
$FunctionUrl = "https://$ProjectRef.supabase.co/functions/v1/backfill-integradores"

# Carregar token de serviço do .env (nunca hardcode)
$envFile = if (Test-Path ".\.env") { ".\.env" } elseif (Test-Path "..\.env") { "..\.env" } else { $null }
if ($envFile) {
  Get-Content $envFile | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $k,$v = $_ -split '=',2; if ($v) { Set-Item "env:$($k.Trim())" $v.Trim() }
  }
}

$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $ServiceRoleKey) {
  Write-Error "SUPABASE_SERVICE_ROLE_KEY não encontrado no .env. Abortando."
  exit 1
}

# ── Loop ──────────────────────────────────────────────────────────────────────
$page     = $StartPage
$total    = @{ processed = 0; upserted = 0; skipped = 0; errors = 0 }
$run      = 0
$started  = Get-Date

Write-Host "`n[$(Get-Date -f 'HH:mm:ss')] Iniciando backfill — mode=$Mode dry_run=$DryRun" -ForegroundColor Cyan

do {
  $run++
  $body = @{
    mode          = $Mode
    page_start    = $page
    pages_per_run = $PagesPerRun
    dry_run       = [bool]$DryRun
  } | ConvertTo-Json

  Write-Host "[$(Get-Date -f 'HH:mm:ss')] Invocação $run — página $page..." -NoNewline

  try {
    $resp = Invoke-RestMethod -Method POST -Uri $FunctionUrl `
      -Headers @{ Authorization = "Bearer $ServiceRoleKey"; "Content-Type" = "application/json" } `
      -Body $body -TimeoutSec 300

    $total.processed += $resp.processed
    $total.upserted  += $resp.upserted
    $total.skipped   += $resp.skipped
    $total.errors    += $resp.errors.Count

    $elapsed = [int](New-TimeSpan -Start $started -End (Get-Date)).TotalMinutes
    Write-Host " ✓ processados=$($resp.processed) upserted=$($resp.upserted) erros=$($resp.errors.Count) [total: up=$($total.upserted) ${elapsed}min]" -ForegroundColor Green

    if ($resp.errors.Count -gt 0) {
      $resp.errors | ForEach-Object { Write-Host "  ⚠ $_" -ForegroundColor Yellow }
    }

    if ($resp.has_more) {
      $page = $resp.next_page
      # Pausa entre invocações para dar tempo ao RD de recuperar do rate limit
      Start-Sleep -Seconds 5
    } else {
      Write-Host "`n[$(Get-Date -f 'HH:mm:ss')] Backfill concluído! Última página: $($resp.last_page)" -ForegroundColor Green
    }

  } catch {
    Write-Host " ✗ Erro HTTP: $($_.Exception.Message)" -ForegroundColor Red
    $total.errors++
    Start-Sleep -Seconds 30  # aguardar antes de tentar novamente
  }

} while ($resp.has_more)

# ── Resumo ────────────────────────────────────────────────────────────────────
$elapsed = [int](New-TimeSpan -Start $started -End (Get-Date)).TotalMinutes
Write-Host "`n═══════════════════════════════" -ForegroundColor Cyan
Write-Host " RESUMO BACKFILL mode=$Mode"       -ForegroundColor Cyan
Write-Host "═══════════════════════════════" -ForegroundColor Cyan
Write-Host " Processados : $($total.processed)"
Write-Host " Upsertados  : $($total.upserted)"
Write-Host " Ignorados   : $($total.skipped)"
Write-Host " Erros       : $($total.errors)"
Write-Host " Tempo total : ${elapsed} minutos"
Write-Host "═══════════════════════════════" -ForegroundColor Cyan

if ($DryRun) { Write-Host "`n⚠ DRY RUN — nenhum dado foi gravado." -ForegroundColor Yellow }
