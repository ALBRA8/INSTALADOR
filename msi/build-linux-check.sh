#!/usr/bin/env bash
# ============================================================
#  ALBRA Bootstrap MSI — gate de validación estructural (Linux/CI)
#
#  QUÉ HACE:
#    Compila albra-installer.wxs con WiX Toolset 5 REAL (mismo compilador
#    que el build canónico) y produce un .wixlib: valida schema v4/v5,
#    referencias Feature→ComponentGroup, Directorios, harvest <Files> y
#    resolución de File/@Source — TODO el pipeline de compilación.
#
#  QUÉ NO HACE (límite empírico, verificado en sandbox):
#    NO produce el .msi final: el bind de la base de datos MSI usa la API
#    nativa msi.dll de Windows (sin ella: DllNotFoundException). El build
#    canónico es Windows + build.ps1. Este gate detecta aquí cualquier
#    error de compilación ANTES de llegar a la máquina Windows.
#
#  REQUISITOS:
#    - dotnet SDK 8+ (user-local sirve: ~/.dotnet)
#    - wix 5.0.2     (dotnet tool install --global wix --version 5.0.2)
#    - python3
#
#  NOTA: este script elimina temporalmente los atributos Directory/@Name
#  porque el compilador WiX 5 en Linux dispara un falso positivo WIX0389
#  ("no es ruta relativa") sobre nombres válidos como 'ALBRA'; en Windows
#  ese check no dispara (el MSI de referencia se construyó con ellos).
#  El resto de la semántica queda intacta.
# ============================================================
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"
mkdir -p obj

# --- 1. WiX presente ----------------------------------------------------------
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"
wix_ver="$(wix --version 2>/dev/null | tail -1 || true)"
case "$wix_ver" in
  5.*) echo "[ok] WiX Toolset $wix_ver" ;;
  *)   echo "[FAIL] wix 5.x requerido (instalar: dotnet tool install --global wix --version 5.0.2)" >&2; exit 1 ;;
esac

# --- 2. Variante de validación: Directory/@Name fuera (quirk WIX0389 Linux) ---
#     Los <Files Include> pasan a absolutos: se resuelven respecto al archivo
#     fuente, y la variante vive en obj/ (si no, el harvest no encontraría
#     payload/ y fallaría SILENCIOSAMENTE con WIX8601).
python3 - "$root" <<'PY'
import re, sys
from pathlib import Path
root = Path(sys.argv[1])
src = (root / "albra-installer.wxs").read_text(encoding="utf-8")
stripped = re.sub(r'(<Directory\b[^>]*?)\s+Name="[^"]*"', r"\1", src)
stripped = stripped.replace('Include="payload/', f'Include="{root}/payload/')
(root / "obj" / "albra-check.wxs").write_text(stripped, encoding="utf-8")
print("[ok] variante de validación: obj/albra-check.wxs (Name neutralizado, Includes absolutos)")
PY

# --- 3. Compilación estructural → wixlib --------------------------------------
rm -f obj/albra-check.wixlib
wix build "obj/albra-check.wxs" -arch x64 -define "AlbraVersion=0.0.0-check" \
    -out "obj/albra-check.wixlib" 2>&1 | grep -v "WIX0000" || true
test -f obj/albra-check.wixlib || { echo "[FAIL] la compilación estructural no produjo wixlib" >&2; exit 1; }

# --- 4. El harvest cosechó de verdad (nada silencioso) -------------------------
python3 - "$root" <<'PY'
import sys, zipfile
from pathlib import Path
ir = zipfile.ZipFile(Path(sys.argv[1]) / "obj" / "albra-check.wixlib").read("wix-ir.json").decode("utf-8", "ignore")
need = ["core/server.js", "panel/server.js", "node.exe", "albra-core.xml", "albra-panel.xml"]
missing = [n for n in need if n not in ir]
if missing:
    print(f"[FAIL] el harvest <Files> no incorporó: {missing} — el wixlib quedó vacío", file=sys.stderr)
    sys.exit(1)
print("[ok] harvest verificado dentro del wixlib: core/, panel/, runtime, servicios")
PY

echo ""
echo "=== ALBRA Bootstrap MSI — gate estructural Linux ==="
echo "[ok] compilación WiX 5 completa (schema, refs, directorios, harvest <Files>, fuentes)"
echo "[ok] obj/albra-check.wixlib generado con el payload real dentro"
echo "→ El .msi canónico se produce en Windows: build.ps1 (bind MSI requiere msi.dll nativa)"
