$TOKEN = $env:META_ACCESS_TOKEN
$BASE = "https://graph.facebook.com/v18.0"

# Contador de resultados
$ok = 0
$fail = 0

function Rename-MetaObject($id, $newName) {
    try {
        $body = @{ name = $newName; access_token = $TOKEN }
        $r = Invoke-RestMethod -Method POST -Uri "$BASE/$id" -Body $body -ErrorAction Stop
        if ($r.success) {
            Write-Host "  OK  $id -> $newName" -ForegroundColor Green
            $script:ok++
        } else {
            Write-Host "  FAIL $id -> $newName | $($r | ConvertTo-Json -Compress)" -ForegroundColor Red
            $script:fail++
        }
    } catch {
        Write-Host "  ERR  $id -> $newName | $($_.Exception.Message)" -ForegroundColor Red
        $script:fail++
    }
}

# ==============================================================
# AD SETS
# ==============================================================

Write-Host "`n=== AD SETS ===" -ForegroundColor Cyan

# META | ACQ | GERAL | NOVOS | BR
Rename-MetaObject "120242773309300638" "LAL-1PCT | CLIENTES | CO"
Rename-MetaObject "120242773309290638" "LAL-1PCT | CLIENTES | N"
Rename-MetaObject "120242773309280638" "LAL-1PCT | CLIENTES | SE"
Rename-MetaObject "120242773309270638" "LAL-1PCT | CLIENTES | S"
Rename-MetaObject "120242773309260638" "LAL-1PCT | CLIENTES | CD-SP"   # SP -> CD-SP (granulação por CD)
Rename-MetaObject "120242773309210638" "LAL-1PCT | CLIENTES | NE"

# META | RET | GERAL | BASE | BR
Rename-MetaObject "120236319115430638" "BASE-ATIVA | GERAL | SE"
Rename-MetaObject "120236319115420638" "BASE-ATIVA | GERAL | CO"
Rename-MetaObject "120236319115410638" "BASE-ATIVA | GERAL | NE"
Rename-MetaObject "120236319115390638" "BASE-ATIVA | GERAL | N"
Rename-MetaObject "120236319115310638" "BASE-ATIVA | GERAL | S"
# Novos sets CD (criados via /copies em Mai/2026)
# Rename-MetaObject "120245849778240638" "BASE-ATIVA | GERAL | CD-SP"  # ja criados com nome correto
# Rename-MetaObject "120245849783390638" "BASE-ATIVA | GERAL | CD-ES"
# Rename-MetaObject "120245849786330638" "BASE-ATIVA | GERAL | CD-BA"
# Rename-MetaObject "120245849788290638" "BASE-ATIVA | GERAL | CD-PE"
# Rename-MetaObject "120245849790230638" "BASE-ATIVA | GERAL | CD-PA"
# Rename-MetaObject "120245849791940638" "BASE-ATIVA | GERAL | CD-SC"
# Rename-MetaObject "120245849793680638" "BASE-ATIVA | GERAL | CD-GO"
# Rename-MetaObject "120245849795810638" "BASE-ATIVA | GERAL | CD-MT"  # PAUSED ate inauguracao

# META | REC | BRAND | AMPLO | BR
Rename-MetaObject "120243097388300638" "LAL-1PCT | CLIENTES | BR"
Rename-MetaObject "120243097388280638" "AMPLO | FIN | BR"
Rename-MetaObject "120243097388240638" "AMPLO | HYB | BR"
Rename-MetaObject "120243097388220638" "AMPLO | ENG365D | BR"
Rename-MetaObject "120243097388210638" "AMPLO | ENG10D | BR"

# META | ACQ | MICRO | NOVOS | SP
Rename-MetaObject "120236320694160638" "RMKT-LP | MICRO | SP"
Rename-MetaObject "120235929372150638" "LAL-1PCT | CLIENTES | SP"
Rename-MetaObject "120235928732180638" "BASE-ATIVA | MICRO | SP"

# META | ENG | LOG | BASE | BR
# Estes sets são renomeados e atualizados por scripts/create-adsets-cd.ps1
# (granulação por CD: CD-GO, CD-PA, CD-SC + residuais regionais)
# Não rodar estes renames aqui para não sobrescrever os nomes do create-adsets-cd.ps1
# Rename-MetaObject "120243105053420638" "BASE-ATIVA | LOG | SE"
# Rename-MetaObject "120243104865680638" "BASE-ATIVA | LOG | NE"
# Rename-MetaObject "120242028706230638" "BASE-ATIVA | LOG | CD-GO"
# Rename-MetaObject "120242028623100638" "BASE-ATIVA | LOG | CD-PA"
# Rename-MetaObject "120242028399060638" "BASE-ATIVA | LOG | CD-SC"

# META | ENG | LOG | BASE | BR | ABR26
Rename-MetaObject "120244275509270638" "BASE-ATIVA | LOG | BR"

# META | ENG | BRAND | BASE | NE | MAI26
Rename-MetaObject "120244467657120638" "LAL-1PCT | CLIENTES | NE"

# META | TESTE | FC | NOVOS | GV
Rename-MetaObject "120245342548060638" "ABM-PROP | FC | GV"
Rename-MetaObject "120245342193090638" "ABM-EMP | FC | GV"

# META | VAGAS | GERAL | AMPLO | CO | ABR26
Rename-MetaObject "120244407524760638" "AMPLO | CUIABA | CO"
Rename-MetaObject "120242790156090638" "AMPLO | SEP-AUX-OP | CO"

# META | RMKT | GERAL | RMKT | BR
Rename-MetaObject "120240277986070638" "RMKT-LP | 30D | BR"
Rename-MetaObject "120240277986020638" "RMKT-LP | 3D | BR"

# ==============================================================
# ADS
# ==============================================================

Write-Host "`n=== ADS ===" -ForegroundColor Cyan

# --- ACQ | GERAL | NOVOS | BR ---
# IMG | LOGISTICA | V1 (ativos)
Rename-MetaObject "120242773309240638" "IMG | LOGISTICA | V1"
Rename-MetaObject "120242773309330638" "IMG | LOGISTICA | V1"
Rename-MetaObject "120242773309350638" "IMG | LOGISTICA | V1"
Rename-MetaObject "120242773309190638" "IMG | LOGISTICA | V1"
# REEL | BENEFICIO | V1 (ativos)
Rename-MetaObject "120242773309170638" "REEL | BENEFICIO | V1"
Rename-MetaObject "120242773309360638" "REEL | BENEFICIO | V1"
Rename-MetaObject "120242773309230638" "REEL | BENEFICIO | V1"
Rename-MetaObject "120242773309200638" "REEL | BENEFICIO | V1"
Rename-MetaObject "120242773309220638" "REEL | BENEFICIO | V1"
Rename-MetaObject "120242773309140638" "REEL | BENEFICIO | V1"
# REEL | OFERTA | V1 (pausados)
Rename-MetaObject "120242773309180638" "REEL | OFERTA | V1"
Rename-MetaObject "120242773309310638" "REEL | OFERTA | V1"
Rename-MetaObject "120242773309320638" "REEL | OFERTA | V1"
Rename-MetaObject "120242773309250638" "REEL | OFERTA | V1"
Rename-MetaObject "120242773309150638" "REEL | OFERTA | V1"
Rename-MetaObject "120242773309340638" "REEL | OFERTA | V1"

# --- RET | GERAL | BASE | BR (apenas ativos) ---
Rename-MetaObject "120236319115240638" "REEL | BENEFICIO | V2"
Rename-MetaObject "120236319115330638" "REEL | BENEFICIO | V2"
Rename-MetaObject "120236319395790638" "REEL | BENEFICIO | V1"
Rename-MetaObject "120240395200020638" "REEL | LOGISTICA | V2"

# --- REC | BRAND | AMPLO | BR ---
# Adset LAL-1PCT | CLIENTES | BR
Rename-MetaObject "120243097388200638" "REEL | PRODUTO | V1"
Rename-MetaObject "120243097388330638" "REEL | PRODUTO | V2"
Rename-MetaObject "120243097388120638" "REEL | PRODUTO | V3"
Rename-MetaObject "120243097388160638" "REEL | PRODUTO | V4"
Rename-MetaObject "120243097388110638" "REEL | PRODUTO | V5"
Rename-MetaObject "120243097388100638" "REEL | PRODUTO | V6"
Rename-MetaObject "120243097388700638" "REEL | PRODUTO | V7"
Rename-MetaObject "120243097388130638" "REEL | BENEFICIO | V2"
Rename-MetaObject "120243097388180638" "REEL | PRODUTO | V8"
Rename-MetaObject "120243097388080638" "REEL | PRODUTO | V9"
Rename-MetaObject "120243097388170638" "REEL | PRODUTO | V10"
# Adset AMPLO | HYB | BR
Rename-MetaObject "120243097387990638" "REEL | PRODUTO | V1"
Rename-MetaObject "120243097388010638" "REEL | PRODUTO | V2"
Rename-MetaObject "120243097387980638" "REEL | PRODUTO | V3"
# Adset AMPLO | FIN | BR
Rename-MetaObject "120243097388040638" "REEL | BENEFICIO | V1"
Rename-MetaObject "120243097388060638" "REEL | BENEFICIO | V2"
Rename-MetaObject "120243097388030638" "CAR | BENEFICIO | V1"
# Adset AMPLO | ENG365D | BR (pausado)
Rename-MetaObject "120243097388430638" "REEL | BENEFICIO | V1"
# Adset AMPLO | ENG10D | BR
Rename-MetaObject "120243097388830638" "REEL | MARCA | V1"
Rename-MetaObject "120243097388870638" "REEL | MARCA | V2"
Rename-MetaObject "120243097388890638" "REEL | MARCA | V3"
Rename-MetaObject "120243097388820638" "REEL | LOGISTICA | V1"

# --- ACQ | MICRO | NOVOS | SP ---
# Adset LAL-1PCT | CLIENTES | SP (ativos)
Rename-MetaObject "120235929372140638" "REEL | PRODUTO | V1"
Rename-MetaObject "120242100670350638" "REEL | PRODUTO | V2"
Rename-MetaObject "120239726366250638" "REEL | PRODUTO | V3"
# Adset RMKT-LP | MICRO | SP (pausado)
Rename-MetaObject "120236320694170638" "REEL | OFERTA | V1"
# Adset BASE-ATIVA | MICRO | SP (pausado)
Rename-MetaObject "120235929329150638" "REEL | PRODUTO | V1"
Rename-MetaObject "120239996924690638" "REEL | PRODUTO | V2"
Rename-MetaObject "120236320525530638" "REEL | OFERTA | V1"

# --- ENG | LOG | BASE | BR ---
Rename-MetaObject "120243104865670638" "CAR | LOGISTICA | V1"
Rename-MetaObject "120243105053430638" "CAR | LOGISTICA | V1"
Rename-MetaObject "120242028706220638" "CAR | LOGISTICA | V1"
Rename-MetaObject "120242028399040638" "CAR | LOGISTICA | V1"
Rename-MetaObject "120242028623090638" "CAR | LOGISTICA | V1"

# --- ENG | LOG | BASE | BR | ABR26 ---
Rename-MetaObject "120244277871490638" "IMG | BENEFICIO | V1"
Rename-MetaObject "120244277888350638" "IMG | LOGISTICA | V1"
Rename-MetaObject "120244275509260638" "REEL | LOGISTICA | V1"
Rename-MetaObject "120244275509280638" "REEL | LOGISTICA | V2"

# --- ENG | BRAND | BASE | NE | MAI26 ---
Rename-MetaObject "120244469492070638" "REEL | BENEFICIO | V1"

# --- TESTE | FC | NOVOS | GV ---
Rename-MetaObject "120245342548070638" "CAR | URGENCIA | V1"
Rename-MetaObject "120245342193100638" "CAR | URGENCIA | V1"
Rename-MetaObject "120245342193110638" "IMG | BENEFICIO | V1"
Rename-MetaObject "120245342548050638" "IMG | BENEFICIO | V1"

# --- VAGAS | GERAL | AMPLO | CO | ABR26 ---
Rename-MetaObject "120244407524770638" "IMG | VAGA | V1"
Rename-MetaObject "120242790156070638" "IMG | VAGA | V1"

# --- RMKT | GERAL | RMKT | BR ---
Rename-MetaObject "120240277986000638" "IMG | OFERTA | V1"
Rename-MetaObject "120240277986010638" "IMG | OFERTA | V1"

# ==============================================================
# RESULTADO
# ==============================================================
Write-Host "`n=============================" -ForegroundColor Cyan
Write-Host "  OK:   $ok" -ForegroundColor Green
Write-Host "  FAIL: $fail" -ForegroundColor Red
Write-Host "=============================" -ForegroundColor Cyan
