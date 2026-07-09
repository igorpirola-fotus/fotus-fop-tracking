# =============================================================
# scripts/create-crm-webhooks.ps1
#
# Programmatic registration of RD Station CRM V2 Webhooks.
# Since the RD CRM panel has no web interface for webhooks,
# this script automates the registration via the API.
# =============================================================

# 1) Load all available .env files to merge variables
$candidatePaths = @(
    "C:\Users\igor.pirola\ultron\.env",
    "..\ultron\.env",
    ".\.env",
    "..\.env",
    ".\.env.local",
    ".\ULTRON FOTUS\Especialista RD STATION - RD Marketin, RD CRM, RD Conversas, API\.env",
    "..\ULTRON FOTUS\Especialista RD STATION - RD Marketin, RD CRM, RD Conversas, API\.env"
)

$loadedAny = $false
foreach ($p in $candidatePaths) {
    if (Test-Path $p) {
        Write-Host "Carregando variáveis do arquivo: $p" -ForegroundColor Cyan
        Get-Content $p | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
            $k,$v = $_ -split '=',2; 
            if ($v) { 
                $cleanedVal = $v.Trim().Trim("'").Trim('"')
                Set-Item "env:$($k.Trim())" $cleanedVal
            }
        }
        $loadedAny = $true
    }
}

if (-not $loadedAny) {
    Write-Error "Nenhum arquivo .env encontrado nas pastas habituais."
    exit 1
}

# 2) Gather necessary variables
$SUPABASE_URL = $env:SUPABASE_URL
if (-not $SUPABASE_URL) {
    Write-Error "SUPABASE_URL não está definida no seu .env"
    exit 1
}

# Resolve project ref from Supabase URL (e.g. https://wttmlnhzvevtabjetsqz.supabase.co -> wttmlnhzvevtabjetsqz)
$projRef = $SUPABASE_URL -replace 'https://', '' -replace '\.supabase\.co', ''
$webhookUrl = "https://$projRef.supabase.co/functions/v1/rd-sync"

$receiverToken = $env:RD_WEBHOOK_RECEIVER_TOKEN
if (-not $receiverToken) {
    Write-Error "RD_WEBHOOK_RECEIVER_TOKEN não definida no seu .env (Bearer token de entrada do rd-sync)"
    exit 1
}

$rdToken = $env:RD_CRM_TOKEN
$clientId = $env:RD_CRM_CLIENT_ID
$clientSecret = $env:RD_CRM_CLIENT_SECRET
$refreshToken = $env:RD_CRM_REFRESH_TOKEN

if (-not $rdToken -and -not $refreshToken) {
    Write-Error "Falta credencial de acesso ao RD CRM (RD_CRM_TOKEN ou RD_CRM_REFRESH_TOKEN) no seu .env"
    exit 1
}

# Helper to fetch API errors
function Get-ApiError {
    param($err)
    try {
        $resp   = $err.Exception.Response
        $stream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch {
        return "(não foi possível ler o body: " + $err.Exception.Message + ")"
    }
}

# Helper to refresh RD CRM Token
function Refresh-Token {
    if (-not $clientId -or -not $clientSecret -or -not $refreshToken) {
        Write-Error "Não é possível renovar o token: Faltam client_id, client_secret ou refresh_token no .env."
        return $false
    }
    Write-Host "Renovando access_token do RD Station CRM..." -ForegroundColor Yellow
    $body = @{
        client_id     = $clientId
        client_secret = $clientSecret
        refresh_token = $refreshToken
        grant_type    = "refresh_token"
    }
    
    try {
        # Note: RD CRM OAuth token endpoint is oauth2/token
        $resp = Invoke-RestMethod -Method POST -Uri "https://api.rd.services/oauth2/token" `
                                  -ContentType "application/json" -Body ($body | ConvertTo-Json) -ErrorAction Stop
        
        $script:rdToken = $resp.access_token
        $script:refreshToken = $resp.refresh_token
        
        # Tentamos persistir no .env local se tiver permissão
        Write-Host "✅ Novo access_token gerado com sucesso." -ForegroundColor Green
        return $true
    } catch {
        $errBody = Get-ApiError $_
        Write-Error "Falha ao renovar token OAuth: $errBody"
        return $false
    }
}

# Run request with automatic 401 retry
function Invoke-RdRequest {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [object]$Body = $null
    )
    
    $headers = @{
        "Authorization" = "Bearer $rdToken"
        "Accept"        = "application/json"
    }
    
    $reqArgs = @{
        Uri         = $Uri
        Method      = $Method
        Headers     = $headers
        ErrorAction = "Stop"
    }
    if ($Body) {
        $reqArgs.ContentType = "application/json"
        $reqArgs.Body = ($Body | ConvertTo-Json -Depth 5 -Compress)
    }
    
    try {
        return Invoke-RestMethod @reqArgs
    } catch {
        if ($_.Exception.Response.StatusCode -eq "Unauthorized") {
            Write-Host "Acesso expirado (401). Tentando renovação automática..." -ForegroundColor Yellow
            if (Refresh-Token) {
                # Update header with new token
                $headers["Authorization"] = "Bearer $rdToken"
                $reqArgs.Headers = $headers
                try {
                    return Invoke-RestMethod @reqArgs
                } catch {
                    throw $_
                }
            }
        }
        throw $_
    }
}

# 3) Get list of existing webhooks to prevent duplicate registrations
Write-Host "`nListando webhooks cadastrados no RD Station CRM..." -ForegroundColor Cyan
try {
    $existingWebhooks = Invoke-RdRequest -Uri "https://api.rd.services/crm/v2/webhooks" -Method GET
    $registeredEvents = @()
    if ($existingWebhooks -and $existingWebhooks.data) {
        foreach ($wh in $existingWebhooks.data) {
            if ($wh.url -eq $webhookUrl) {
                $registeredEvents += $wh.event_name
                Write-Host "  Found existing webhook for event: $($wh.event_name) -> $webhookUrl" -ForegroundColor Gray
            }
        }
    }
} catch {
    $errBody = Get-ApiError $_
    Write-Error "Falha ao listar webhooks: $errBody"
    exit 1
}

# 4) Create webhooks for target events if not already registered
$targetEvents = @("crm_deal_created", "crm_deal_updated", "crm_deal_deleted")

foreach ($event in $targetEvents) {
    if ($registeredEvents -contains $event) {
        Write-Host "Webhook já existente para o evento '$event'. Ignorando." -ForegroundColor Green
        continue
    }
    
    Write-Host "Cadastrando webhook para o evento '$event'..." -ForegroundColor Yellow
    
    $payload = @{
        data = @{
            event_name  = $event
            http_method = "POST"
            url         = $webhookUrl
            auth_header = "Authorization"
            auth_key    = "Bearer $receiverToken"
        }
    }
    
    try {
        $res = Invoke-RdRequest -Uri "https://api.rd.services/crm/v2/webhooks" -Method POST -Body $payload
        Write-Host "✅ Webhook para o evento '$event' criado com sucesso! ID: $($res.data.id)" -ForegroundColor Green
    } catch {
        $errBody = Get-ApiError $_
        Write-Error "Falha ao criar webhook para o evento '$event': $errBody"
    }
}

Write-Host "`nIntegração concluída." -ForegroundColor Cyan
