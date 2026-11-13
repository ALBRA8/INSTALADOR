# ============================================================
#  ALBRA Bootstrap MSI — ensamblado del payload (CI Windows)
#
#  Lo llama .github/workflows/build-msi.yml DESPUÉS de compilar los
#  standalone de INSTALADOR y PANEL. Produce en msi/payload/:
#
#    runtime\node.exe          ← Node LTS win-x64 PINNEADO, SHA-256 verificado
#                                contra el SHASUMS256.txt oficial de nodejs.org
#    bin\albra-core.exe        ← WinSW-x64.exe PINNEADO (2 copias renombradas)
#    bin\albra-panel.exe         · el proyecto WinSW no publica checksum
#                                oficial: la hash se registra como evidencia
#                                de procedencia en el log del build
#    core\                     ← .next/standalone del INSTALADOR (server.js + boot.js)
#    panel\                    ← .next/standalone del PANEL       (server.js + boot.js)
#    core\data\template.db     ← schema completo (prisma db push) para el
#    panel\data\template.db      primer arranque del servicio (boot.js)
#
#  Fail-closed: cualquier verificación fallida aborta con exit 1.
#  NUNCA empaqueta secretos: el payload es solo código y schema.
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$PanelRepo = "panel-repo",
    [string]$NodeVersion = "22.14.0",
    [string]$WinSwVersion = "2.12.0"
)

$ErrorActionPreference = "Stop"
$root      = Split-Path $PSScriptRoot -Parent       # msi\
$repoRoot  = Split-Path $root -Parent               # repo INSTALADOR
$panelRepo = Join-Path $repoRoot $PanelRepo         # checkout del PANEL
$temp      = $env:RUNNER_TEMP
if (-not $temp) { $temp = Join-Path $root "obj\ci-temp" }

Write-Host "=== Ensamblado de payload — MSI v$Version ===" -ForegroundColor Cyan

# --- 1. node.exe pinneado + verificado contra SHASUMS256.txt oficial --------
$nodeZip  = Join-Path $temp "node-v$NodeVersion-win-x64.zip"
$nodeSums = Join-Path $temp "SHASUMS256.txt"
Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $nodeZip
Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"                 -OutFile $nodeSums

$expectedLine = (Select-String -Path $nodeSums -Pattern "^([a-fA-F0-9]{64})\s+node-v$NodeVersion-win-x64\.zip\s*$").Matches
if (-not $expectedLine) { Write-Error "SHASUMS256.txt: no aparece node-v$NodeVersion-win-x64.zip"; exit 1 }
$expectedHash = $expectedLine.Groups[1].Value.ToLowerInvariant()
$actualHash   = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedHash -ne $actualHash) {
    Write-Error "node.exe: SHA-256 NO coincide`n  esperado: $expectedHash`n  obtenido: $actualHash"
    exit 1
}
Write-Host "[ok] node v$NodeVersion win-x64 verificado: $actualHash"

$nodeExtract = Join-Path $temp "node-extract"
Remove-Item $nodeExtract -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $nodeZip -DestinationPath $nodeExtract
$nodeExe = Get-ChildItem $nodeExtract -Recurse -Filter "node.exe" | Select-Object -First 1
if (-not $nodeExe) { Write-Error "node.exe no encontrado dentro del ZIP"; exit 1 }

New-Item -ItemType Directory -Force -Path (Join-Path $root "payload\runtime") | Out-Null
Copy-Item $nodeExe.FullName (Join-Path $root "payload\runtime\node.exe") -Force
Write-Host "[ok] payload/runtime/node.exe ($([math]::Round($nodeExe.Length/1MB,1)) MB)"

# --- 2. WinSW-x64.exe pinneado (procedencia registrada, sin checksum oficial) -
$winswUrl = "https://github.com/winsw/winsw/releases/download/v$WinSwVersion/WinSW-x64.exe"
$winswTmp = Join-Path $temp "WinSW-x64-$WinSwVersion.exe"
Invoke-WebRequest $winswUrl -OutFile $winswTmp
$winswHash = (Get-FileHash $winswTmp -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "[ok] WinSW v$WinSwVersion descargado — SHA-256 (procedencia): $winswHash"
Write-Host "     NOTA: el proyecto WinSW no publica checksum oficial en el release;"
Write-Host "     la versión está pinneada y la hash queda como evidencia del build."

New-Item -ItemType Directory -Force -Path (Join-Path $root "payload\bin") | Out-Null
Copy-Item $winswTmp (Join-Path $root "payload\bin\albra-core.exe")  -Force
Copy-Item $winswTmp (Join-Path $root "payload\bin\albra-panel.exe") -Force

# --- 3. Standalone core (INSTALADOR) y panel (PANEL) --------------------------
function Copy-Standalone([string]$buildRoot, [string]$destName) {
    $standalone = Join-Path $buildRoot ".next\standalone"
    if (-not (Test-Path (Join-Path $standalone "server.js"))) {
        Write-Error "Falta $standalone\server.js — el build de $destName no produjo output standalone"
        exit 1
    }
    if (-not (Test-Path (Join-Path $standalone "boot.js"))) {
        Write-Error "Falta $standalone\boot.js — ejecuta 'bun scripts/copy-standalone.js' en $destName"
        exit 1
    }
    $dest = Join-Path $root "payload\$destName"
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item (Join-Path $standalone "*") $dest -Recurse -Force
    Write-Host "[ok] payload/$destName (server.js + boot.js + static + node_modules)"
}

Copy-Standalone $repoRoot  "core"
Copy-Standalone $panelRepo "panel"

# --- 4. Templates de BD (schema completo vía prisma db push) -------------------
function New-TemplateDb([string]$buildRepo, [string]$destName) {
    $dataDir = Join-Path $root "payload\$destName\data"
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    $dbPath  = Join-Path $dataDir "template.db"
    Remove-Item $dbPath -Force -ErrorAction SilentlyContinue

    # DATABASE_URL relativa al prisma/schema.prisma del repo correspondiente
    $schemaDir = Join-Path $buildRepo "prisma"
    $relUrl    = [System.IO.Path]::GetRelativePath($schemaDir, $dbPath).Replace('\', '/')
    Push-Location $buildRepo
    try {
        $env:DATABASE_URL = "file:$relUrl"
        & npx prisma db push --skip-generate --accept-data-loss
        if ($LASTEXITCODE -ne 0) { Write-Error "prisma db push falló para $destName (template)"; exit 1 }
    } finally {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
        Pop-Location
    }
    if (-not (Test-Path $dbPath) -or (Get-Item $dbPath).Length -lt 4096) {
        Write-Error "template.db de $destName no se generó correctamente"; exit 1
    }
    Write-Host "[ok] payload/$destName/data/template.db ($((Get-Item $dbPath).Length) bytes, schema completo)"
}

New-TemplateDb $repoRoot  "core"
New-TemplateDb $panelRepo "panel"

# --- 5. Resumen del payload -----------------------------------------------------
Write-Host ""
Write-Host "=== Payload ensamblado ===" -ForegroundColor Cyan
Get-ChildItem (Join-Path $root "payload") -Recurse -File |
    Where-Object { $_.Name -notin @(".gitkeep") } |
    ForEach-Object { "{0,12:N0}  {1}" -f $_.Length, $_.FullName.Substring($root.Length + 1) } |
    Write-Host
