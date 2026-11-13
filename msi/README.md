# ALBRA Bootstrap MSI — instalador nativo de Windows

> Entregable: `albra-installer-<version>-windows-x64.msi` — un instalador nativo
> de doble clic que despliega el plano de control ALBRA como servicios de
> Windows y deja la suite de agentes gestionada desde el PANEL.
>
> Referencia de forma: instaladores MSI profesionales construidos con
> **WiX Toolset 5** (p. ej. `artcraft-launcher-0.19.2-windows-x64.msi`).

## Arquitectura de distribución (dos capas)

```
albra-installer-<v>-windows-x64.msi          ← capa 1: bootstrap del plano de control
   ├─ INSTALADOR  → servicio "AlbraCore"   (127.0.0.1:3000)
   ├─ PANEL       → servicio "AlbraPanel"  (127.0.0.1:3100)
   ├─ ALBRA_HOME  → %ProgramData%\ALBRA    (bóveda, llaves, BD, logs)
   ├─ Acceso directo: Inicio > ALBRA > "ALBRA Panel"
   └─ Primer arranque: el operador configura credenciales (nunca van en el MSI)

Suite de agentes                             ← capa 2: ya construida y verificada e2e
   agentes .albra → GitHub releases con albra-sha256 → bóveda → INSTALL
   → Docker Compose por agente (pinImageDigest → pull → up → health)
```

La capa 2 **ya existe** (`docs/GITHUB-SOURCES.md`, `docs/CHISMOSO-DOCKER-ADAPTATION.md`);
el MSI solo bootstrapea la máquina que la ejecuta. Igual que el instalador de
referencia: "install and update the App Suite" — la suite se gestiona desde el panel.

## Contenido del proyecto

| Archivo | Rol |
|---|---|
| `albra-installer.wxs` | Fuente canónica WiX 5 (schema v4/v5). UpgradeCode estable `{360B38CF-4B30-494D-87AA-067CDE534DF3}`. Harvest de `core/` y `panel/` con el elemento `<Files>` (WiX 5 nativo) |
| `build.ps1` | Pipeline Windows/CI **canónico**: verifica payload → limpia marcadores → `wix build -arch x64` → evidencia SHA-256 |
| `build-linux-check.sh` | Gate de validación estructural en Linux/CI: compila el `.wxs` con el WiX 5 REAL → `.wixlib` (sin bind MSI) y verifica el harvest. Detecta errores antes de llegar a Windows |
| `validate.py` | Validación estructural Python (32 checks: schema, refs, directorios, harvest, naming, sin secretos) |
| `payload/` | Lo que se instala. `core/`, `panel/`, `runtime/` y los `.exe` de servicio **no se versionan** (ver `payload/README.md`) |
| `payload/bin/*.xml` | Configuración WinSW de los dos servicios (loopback only, auto-restart, logs) |
| `payload/README.txt` | Texto que queda instalado en la máquina del usuario |

## Construcción (Windows/CI — canónica, requiere WiX 5)

```powershell
dotnet tool install --global wix --version 5.0.2
# ensamblar payload (ver payload/README.md) y luego:
powershell -ExecutionPolicy Bypass -File build.ps1            # → dist\albra-installer-0.1.0-windows-x64.msi
powershell -ExecutionPolicy Bypass -File build.ps1 -Version 0.2.0
```

El build imprime el SHA-256 del MSI y la línea exacta `albra-sha256: <hash>`
para el body del GitHub release — **el propio instalador se distribuye por la
misma cadena de confianza que los agentes** (`docs/GITHUB-SOURCES.md`).

## Validación sin Windows (Linux/CI — gate estructural)

El bind del MSI requiere la API nativa `msi.dll` de Windows (empíricamente
verificado: sin ella, `wix build` muere con `DllNotFoundException`). Pero la
**compilación** es .NET puro y sí corre en Linux:

```bash
./build-linux-check.sh    # compila el .wxs con WiX 5.0.2 real → obj/albra-check.wixlib
python3 validate.py       # 32 verificaciones estructurales, sin dotnet
```

El gate compila el scaffold con el mismo compilador WiX 5 del build canónico,
produce un `.wixlib` y verifica que el harvest `<Files>` incorporó el payload
real (core/, panel/, node.exe, servicios). Cualquier error de schema, referencias
o fuentes se detecta ANTES de llegar a la máquina Windows.

## Qué instala exactamente

| Componente | Detalle |
|---|---|
| Servicio `AlbraCore` | WinSW wrapper → `node core\server.js`, puerto 3000, solo loopback, auto + restart |
| Servicio `AlbraPanel` | WinSW wrapper → `node panel\server.js`, puerto 3100, solo loopback, auto + restart |
| Runtime | `node.exe` embebido en `%ProgramFiles%\ALBRA\runtime` — cero requisitos de runtime para el usuario |
| Acceso directo | `ALBRA Panel.url` en Inicio > ALBRA (abre 127.0.0.1:3100) |
| Upgrade | `MajorUpgrade` con `UpgradeCode` estable: instalar encima actualiza; downgrade bloqueado |
| Desinstalación | Detiene y elimina servicios; `ALBRA_HOME` se conserva (datos del usuario) |

## Seguridad por diseño

- Ambos servicios escuchan **solo en 127.0.0.1** — sin reglas de firewall.
- **Cero secretos en el MSI**: credenciales del operador en el primer arranque.
- `node.exe` y `WinSW.exe` con SHA-256 verificado contra la fuente oficial.
- El MSI resultante se publica con checksum declarado en el release (trust chain).

## Requisito Docker (agentes)

Los agentes se despliegan con Docker Compose. Si el host no tiene Docker Desktop,
el PANEL lo informa honestamente en el momento de instalar (`DOCKER_PREFLIGHT_FAILED`)
— igual que en el sandbox. El MSI no instala Docker por diseño: la instalación de
Docker Desktop es una decisión visible del usuario, no un efecto secundario.

## Certificación (checklist para la máquina Windows de prueba)

1. Instalar MSI en Windows limpio → servicios `AlbraCore` y `AlbraPanel` arriba (`services.msc`).
2. Inicio > ALBRA > "ALBRA Panel" → login de operador (credenciales del primer arranque).
3. Vista Agentes ALBRA → "INSTALADOR conectado", catálogo con 6 productos.
4. Instalar Docker Desktop → instalar `chismoso` desde la UI → contenedores `app/scheduler/backup` en Docker → estado `installed/healthy`.
5. Ciclo completo: STOP → UNINSTALL → reinstalar.
6. Upgrade: instalar la misma versión o superior encima → sin pérdida de datos; downgrade → bloqueado con mensaje.
7. Desinstalar → servicios eliminados, `C:\ProgramData\ALBRA` conservado.
8. Verificar que el MSI publicado en el release tiene su línea `albra-sha256:` y que el importador la valida.

## Hallazgos empíricos (verificados con WiX 5.0.2 real en sandbox Linux)

1. **`wix heat` no existe en WiX 5** (eliminado en WiX 4+): el scaffold original
   lo usaba; migrado al elemento `<Files>` con wildcards — el reemplazo oficial,
   sin scripts de harvest externos.
2. **El bind del MSI es Windows-only**: `wix build` sobre Linux compila y enlaza
   el proyecto, pero al crear la base de datos .msi requiere `msi.dll` nativa
   (`DllNotFoundException` sin ella). Build canónico: Windows/CI.
3. **Falso positivo WIX0389 en Linux**: el compilador rechaza `Directory/@Name`
   válidos (`'ALBRA' is not a relative path`); en Windows no dispara (el MSI de
   referencia se construyó con ellos). El gate Linux neutraliza los `Name` para
   poder validar el resto de la semántica.
4. **`Files/@Exclude` no existe en 5.0.2**: los marcadores de repo (`.gitkeep`)
   se limpian en build.ps1 antes de compilar, no con exclusiones del harvest.
5. **`-arch x64` es obligatorio**: el default de `wix build` es x86; sin la flag
   el producto saldría de 32 bits.
6. **Los `<Files Include>` se resuelven relativos al archivo fuente**, no al cwd:
   un harvest silenciosamente vacío (WIX8601) si el `.wxs` se mueve de sitio.

## Límites honestos restantes

- El `.msi` canónico no puede generarse en este sandbox (bind = `msi.dll`, punto
  2 de hallazgos). La compilación definitiva ocurre en Windows/CI (`build.ps1`).
- La ejecución/certificación del MSI (checklist de arriba) requiere una máquina
  Windows real con servicios, Docker Desktop y navegador.
- Los servicios usan **WinSW** (wrapper de servicio probado, MIT). Alternativa futura:
  binario propio `--compile` de Bun con soporte SCM.
- v0.1.0 no trae UI de asistente (silencioso con UI básica MSI); el "primer arranque"
  del operador vive en el PANEL. UI custom WiX (licencia, carpeta) reservada para v0.2+.
