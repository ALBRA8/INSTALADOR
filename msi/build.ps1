# ============================================================
#  ALBRA Bootstrap MSI — build (Windows / CI)  [CANÓNICO]
#
#  Requisitos:
#    - Windows 10+ / Windows Server
#    - .NET SDK 8+          https://dotnet.microsoft.com/download
#    - WiX Toolset 5.0.2:   dotnet tool install --global wix --version 5.0.2
#    - Payload ensamblado   (ver payload/README.md — build.ps1 NO lo
#                           genera: verifica y falla si falta algo)
#
#  Nota WiX 5: `wix heat` NO existe (se eliminó en WiX 4+). El harvest
#  de core/ y panel/ vive en el propio .wxs vía el elemento <Files>
#  con wildcards — no hay paso de harvest externo.
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File build.ps1
#    powershell -ExecutionPolicy Bypass -File build.ps1 -Version 0.2.0
#
#  Salida:
#    dist\albra-installer-<version>-windows-x64.msi
# ============================================================
param(
    [string]$Version = "0.1.0",
    [switch]$SkipPayloadCheck
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "=== ALBRA Bootstrap MSI — build v$Version ===" -ForegroundColor Cyan

# --- 1. WiX Toolset 5 presente --------------------------------------------
try {
    $wixVer = (& wix --version) 2>$null
    if (-not $wixVer) { throw "sin salida" }
    if (-not ($wixVer -match '^5\.')) { throw "versión $wixVer no es 5.x" }
    Write-Host "[ok] WiX Toolset $wixVer"
} catch {
    Write-Error "WiX Toolset 5 no está instalado (o es otra serie). Ejecutar:  dotnet tool install --global wix --version 5.0.2"
    exit 1
}

# --- 2. Payload completo (fail-closed: nada silencioso) --------------------
$required = @(
    "payload\bin\albra-core.exe"        # WinSW-x64.exe renombrado (servicio ALBRA Core)
    "payload\bin\albra-core.xml"        # configuración del servicio (en el repo)
    "payload\bin\albra-panel.exe"       # WinSW-x64.exe renombrado (servicio ALBRA Panel)
    "payload\bin\albra-panel.xml"       # configuración del servicio (en el repo)
    "payload\runtime\node.exe"          # runtime Node embebido
    "payload\core\server.js"            # build standalone del INSTALADOR
    "payload\panel\server.js"           # build standalone del PANEL
    "payload\shortcuts\albra-panel.url" # acceso directo del menú Inicio
)
if (-not $SkipPayloadCheck) {
    $missing = @($required | Where-Object { -not (Test-Path (Join-Path $root $_)) })
    if ($missing.Count -gt 0) {
        Write-Error ("Payload incompleto. Faltan:`n  " + ($missing -join "`n  ") + "`n`nInstrucciones de ensamblado: payload/README.md")
        exit 1
    }
    Write-Host "[ok] payload completo ($($required.Count) requisitos)"
} else {
    Write-Warning "Verificación de payload OMITIDA (-SkipPayloadCheck)"
}

# --- 3. Limpieza de marcadores de repo dentro del payload -------------------
#    .gitkeep y .DS_Store no deben entrar al MSI (el <Files> harvesta todo).
$markers = Get-ChildItem -Path (Join-Path $root "payload") -Recurse -Force -File |
    Where-Object { $_.Name -in @(".gitkeep", ".DS_Store") }
foreach ($m in $markers) {
    Remove-Item $m.FullName -Force
    Write-Host "[ok] marcador eliminado del payload: $($m.FullName.Substring($root.Length + 1))"
}

# --- 4. Compilación ----------------------------------------------------------
#    -arch x64 es OBLIGATORIO: el default de wix build es x86 y el producto
#    es windows-x64 (ProgramFiles64Folder, componentes de 64 bits).
New-Item -ItemType Directory -Force -Path (Join-Path $root "dist") | Out-Null
Push-Location $root
try {
    $out = "dist\albra-installer-$Version-windows-x64.msi"
    & wix build "albra-installer.wxs" `
        -arch x64 `
        -define "AlbraVersion=$Version" `
        -out $out
    if ($LASTEXITCODE -ne 0) { throw "wix build falló" }
} finally {
    Pop-Location
}

# --- 5. Evidencia + línea de procedencia para el release --------------------
$msi  = Get-Item (Join-Path $root $out)
$hash = (Get-FileHash $msi.FullName -Algorithm SHA256).Hash
Write-Host ""
Write-Host "MSI generado: $($msi.FullName)"            -ForegroundColor Green
Write-Host ("Tamaño:       {0:N2} MB" -f ($msi.Length / 1MB))
Write-Host "SHA-256:      $hash"
Write-Host ""
Write-Host "→ Publicar como asset de GitHub release e incluir en el body del release:" -ForegroundColor Yellow
Write-Host "   albra-sha256: $($hash.ToLowerInvariant())" -ForegroundColor Yellow
Write-Host "   (la cadena de confianza ALBRA rechaza assets sin checksum declarado — docs/GITHUB-SOURCES.md)"
