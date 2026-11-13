#!/usr/bin/env python3
"""ALBRA Bootstrap MSI — validación estructural del scaffold.

Ejecutable en cualquier máquina (sin Windows): verifica que el proyecto WiX 5
esté bien formado y consistente con build.ps1. La compilación canónica del MSI
sigue ocurriendo en Windows/CI con `wix build`.

Uso:  python3 msi/validate.py   (desde la raíz del repo, o desde msi/)
Salida: exit 0 = OK; exit 1 = errores (listados, nada silencioso).
"""
import re
import sys
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

WIX_V4_NS = "http://wixtoolset.org/schemas/v4/wxs"
LEGACY_NS = "http://schemas.microsoft.com/wix/2006/wi"
ROOT = Path(__file__).resolve().parent
errors: list[str] = []
ok: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def good(msg: str) -> None:
    ok.append(msg)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


# --- 1. XML bien formado -----------------------------------------------------
wx_path = ROOT / "albra-installer.wxs"
tree = None
try:
    tree = ET.parse(wx_path)
    good(f"albra-installer.wxs: XML bien formado")
except ET.ParseError as e:
    err(f"albra-installer.wxs: XML mal formado: {e}")

xml_files = ["payload/bin/albra-core.xml", "payload/bin/albra-panel.xml"]
for rel in xml_files:
    try:
        ET.parse(ROOT / rel)
        good(f"{rel}: XML bien formado")
    except ET.ParseError as e:
        err(f"{rel}: XML mal formado: {e}")

# --- 2. Namespace WiX 5 (v4/v5), nunca el legacy 2006 -------------------------
if tree is not None:
    root_tag = tree.getroot().tag
    if root_tag == f"{{{WIX_V4_NS}}}Wix":
        good("namespace WiX v4/v5 correcto (Wix)")
    elif root_tag == f"{{{LEGACY_NS}}}Wix":
        err("namespace legacy 2006 detectado — este proyecto es WiX 5, no WiX 3")
    else:
        err(f"elemento raíz inesperado: {root_tag}")

# --- 3. Package: UpgradeCode estable y válido ---------------------------------
if tree is not None:
    pkg = tree.getroot().find(f"{{{WIX_V4_NS}}}Package")
    if pkg is None:
        err("falta <Package> bajo la raíz")
    else:
        uc = pkg.get("UpgradeCode", "")
        try:
            parsed = uuid.UUID(uc.strip("{}"))
            good(f"UpgradeCode válido y estable: {{{str(parsed).upper()}}}")
        except ValueError:
            err(f"UpgradeCode inválido: {uc!r}")
        ver = pkg.get("Version", "")
        if ver == "$(var.AlbraVersion)":
            good("versión externalizada a -define AlbraVersion (single-sourcing con build.ps1)")
        else:
            err(f"Version inesperada en Package: {ver!r} (se esperaba $(var.AlbraVersion))")

    # --- 4. Directorios referenciados por componentes/heat --------------------
    dir_ids = {
        el.get("Id")
        for el in tree.getroot().iter()
        if local_name(el.tag) in ("Directory", "StandardDirectory") and el.get("Id")
    }
    for needed in ("INSTALLFOLDER", "BinDir", "CoreDir", "PanelDir", "RuntimeDir", "AlbraMenuDir"):
        if needed in dir_ids:
            good(f"directorio definido: {needed}")
        else:
            err(f"directorio faltante: {needed}")

    # --- 5. Feature → ComponentGroupRef (harvest vía <Files> en el wxs) -----
    group_ids = {
        el.get("Id")
        for el in tree.getroot().iter()
        if local_name(el.tag) == "ComponentGroup" and el.get("Id")
    }
    feature = tree.getroot().find(f".//{{{WIX_V4_NS}}}Feature")
    refs = []
    if feature is None:
        err("falta <Feature>")
    else:
        refs = [r.get("Id", "") for r in feature.findall(f"{{{WIX_V4_NS}}}ComponentGroupRef")]
        good(f"Feature 'Main' referencia {len(refs)} grupos: {', '.join(refs)}")

    for ref in refs:
        if ref in group_ids:
            good(f"grupo {ref}: definido en el wxs")
        else:
            err(f"grupo {ref}: referenciado por la Feature pero sin definición en el wxs")

    for g in group_ids:
        if g not in refs:
            err(f"grupo {g} definido pero no referenciado por la Feature")

    # --- 5b. Harvest <Files> de core y panel (WiX 5 nativo, sin heat) --------
    build_ps1 = (ROOT / "build.ps1").read_text(encoding="utf-8-sig")
    files_harvest = {
        el.get("Include", "")
        for el in tree.getroot().iter(f"{{{WIX_V4_NS}}}Files")
    }
    for expected in ("payload/core/**", "payload/panel/**"):
        if expected in files_harvest:
            good(f"harvest <Files Include=\"{expected}\"> definido en el wxs")
        else:
            err(f"falta harvest <Files Include=\"{expected}\"> en el wxs")
    if re.search(r"wix\s+heat\s+[a-z]", build_ps1):
        err("build.ps1 sigue invocando `wix heat` — eliminado en WiX 4+ (usar <Files>)")
    else:
        good("build.ps1 sin heat (WiX 5: harvest nativo <Files>)")
    if '-arch x64' in build_ps1:
        good("build.ps1 compila con -arch x64 (producto windows-x64)")
    else:
        err("build.ps1 sin -arch x64 (el default de wix build es x86)")

    # --- 6. Ficheros referenciados por File/@Source presentes en el repo ------
    #      (los del payload dinámico — core/panel/runtime/exe — se ensamblan en
    #      Windows y están gitignoreados; su ausencia aquí es esperada.)
    #      Regla cross-platform: los Source deben usar separador "/" (WiX en
    #      Windows y Linux lo aceptan; "\" rompe el build en CI POSIX).
    dynamic_prefixes = ("payload/core/", "payload/panel/", "payload/runtime/",
                        "payload/bin/albra-core.exe", "payload/bin/albra-panel.exe")
    for f in tree.getroot().iter(f"{{{WIX_V4_NS}}}File"):
        src = f.get("Source") or ""
        if "\\" in src:
            err(f"File/@Source con separador backslash (usar '/'): {src}")
        rel = Path(src)
        if any(src.startswith(p) for p in dynamic_prefixes):
            good(f"payload dinámico (esperado ausente aquí): {src}")
        elif (ROOT / rel).exists():
            good(f"archivo del payload presente: {src}")
        else:
            err(f"File/@Source no existe en el repo: {src}")

# --- 7. build.ps1: define AlbraVersion y salida con naming canónico -----------
build_ps1_txt = build_ps1 if tree is not None else (ROOT / "build.ps1").read_text(encoding="utf-8-sig")
if "-define \"AlbraVersion=$Version\"" in build_ps1_txt or "-define AlbraVersion" in build_ps1_txt:
    good("build.ps1 pasa AlbraVersion al compilador")
else:
    err("build.ps1 no define AlbraVersion (Package lo necesita)")
if re.search(r"albra-installer-\$Version-windows-x64\.msi", build_ps1_txt):
    good("naming canónico: albra-installer-<version>-windows-x64.msi")
else:
    err("build.ps1 no produce el naming canónico albra-installer-<version>-windows-x64.msi")

# --- 8. .url del acceso directo es un INI válido ------------------------------
url = (ROOT / "payload/shortcuts/albra-panel.url").read_text(encoding="utf-8")
if "[InternetShortcut]" in url and "URL=http://127.0.0.1:3100/" in url:
    good("albra-panel.url: InternetShortcut apuntando a 127.0.0.1:3100 (solo loopback)")
else:
    err("albra-panel.url: formato inesperado")

# --- 9. Sin secretos en el scaffold -------------------------------------------
secret_patterns = [
    (r"ghp_[A-Za-z0-9]{20,}", "PAT de GitHub"),
    (r"EEC_OPERATOR_PASSWORD\s*[=:]\s*\S+", "contraseña de operador en claro"),
    (r"EEC_API_TOKEN\s*[=:]\s*\S+", "token EEC en claro"),
]
for rel in ["albra-installer.wxs", "build.ps1", "payload/bin/albra-core.xml",
            "payload/bin/albra-panel.xml", "payload/README.txt", "payload/shortcuts/albra-panel.url"]:
    text = (ROOT / rel).read_text(encoding="utf-8-sig")
    for pat, label in secret_patterns:
        # ignora menciones documentales del nombre de la variable sin valor
        for m in re.finditer(pat, text):
            err(f"posible secreto ({label}) en {rel}: {m.group(0)[:24]}…")

# --- Resumen -------------------------------------------------------------------
print()
print("=== ALBRA Bootstrap MSI — validación estructural ===")
for line in ok:
    print(f"  [ok]   {line}")
if errors:
    print()
    for line in errors:
        print(f"  [FAIL] {line}", file=sys.stderr)
    print(f"\nResultado: {len(errors)} error(es). Nada silencioso.", file=sys.stderr)
    sys.exit(1)
print(f"\nResultado: OK — {len(ok)} verificaciones superadas.")
