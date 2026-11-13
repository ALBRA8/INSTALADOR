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
| `albra-installer.wxs` | Fuente canónica WiX 5 (schema v4/v5). UpgradeCode estable `{360B38CF-4B30-494D-87AA-067CDE534DF3}` |
| `build.ps1` | Pipeline Windows/CI: verifica payload → `wix heat` (core/panel) → `wix build` → evidencia SHA-256 |
| `payload/` | Lo que se instala. `core/`, `panel/`, `runtime/` y los `.exe` de servicio **no se versionan** (ver `payload/README.md`) |
| `payload/bin/*.xml` | Configuración WinSW de los dos servicios (loopback only, auto-restart, logs) |
| `payload/README.txt` | Texto que queda instalado en la máquina del usuario |

## Construcción (solo Windows / CI — requiere WiX 5)

```powershell
dotnet tool install --global wix
# ensamblar payload (ver payload/README.md) y luego:
powershell -ExecutionPolicy Bypass -File build.ps1            # → dist\albra-installer-0.1.0-windows-x64.msi
powershell -ExecutionPolicy Bypass -File build.ps1 -Version 0.2.0
```

El build imprime el SHA-256 del MSI y la línea exacta `albra-sha256: <hash>`
para el body del GitHub release — **el propio instalador se distribuye por la
misma cadena de confianza que los agentes** (`docs/GITHUB-SOURCES.md`).

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

## Límites honestos de este scaffold

- **Este sandbox (Linux, sin dotnet, sin sudo) no puede compilar ni ejecutar MSI.**
  La compilación canónica ocurre con WiX 5 en Windows/CI (`build.ps1`).
- El schema WiX 5 está validado estructuralmente aquí (XML bien formado, referencias
  de grupos y directorios consistentes con `build.ps1`); la validación final del
  compilador ocurre en el primer build real.
- Los servicios usan **WinSW** (wrapper de servicio probado, MIT). Alternativa futura:
  binario propio `--compile` de Bun con soporte SCM.
- v0.1.0 no trae UI de asistente (silencioso con UI básica MSI); el "primer arranque"
  del operador vive en el PANEL. UI custom WiX (licencia, carpeta) reservada para v0.2+.
