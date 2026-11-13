# Ensamblado del payload del MSI

`build.ps1` **no** genera el payload: lo verifica (fail-closed) y construye el MSI
solo si todo está en su sitio. Este documento define el ensamblado completo.

## Layout requerido antes de `build.ps1`

| Ruta | Qué es | Cómo se produce |
|---|---|---|
| `payload/core/` | Build standalone del **INSTALADOR** | `npm run build` (standalone) del repo INSTALADOR → copiar contenido de `.next/standalone/` aquí (debe quedar `core/server.js`) |
| `payload/panel/` | Build standalone del **PANEL** | ídem en PANEL-DE-CONTROL → `panel/server.js` |
| `payload/runtime/node.exe` | Runtime Node.js embebido | ZIP oficial de Node.js LTS x64 de Windows → extraer `node.exe` (verificar SHA-256 contra la página oficial) |
| `payload/bin/albra-core.exe` | Wrapper de servicio **ALBRA Core** | `WinSW-x64.exe` (github.com/winsw/winsw, versión fijada) **renombrado** — verificar SHA-256 del release oficial antes de renombrar |
| `payload/bin/albra-panel.exe` | Wrapper de servicio **ALBRA Panel** | el mismo `WinSW-x64.exe`, segunda copia renombrada |
| `payload/bin/albra-core.xml` | Config del servicio core | en el repo (no tocar nombre) |
| `payload/bin/albra-panel.xml` | Config del servicio panel | en el repo (no tocar nombre) |
| `payload/shortcuts/albra-panel.url` | Acceso directo menú Inicio | en el repo |
| `payload/README.txt` | Texto instalado con el producto | en el repo |

## Reglas inquebrantables

1. **Sin secretos en el payload.** Ni tokens, ni contraseñas, ni claves. Las
   credenciales del operador se configuran en el primer arranque.
2. **Procedencia verificada.** `node.exe` y `WinSW-x64.exe` se descargan de las
   páginas oficiales y se verifica su SHA-256 antes de copiarlos. Un binario no
   verificado no entra al payload.
3. **Versiones fijadas.** El `WinSW` y el `node.exe` a usar se fijan por versión
   (no "última release"). Registrar la versión usada en el PR del build.
4. **Builds standalone, no carpetas de desarrollo.** `core/` y `panel/` contienen
   el output `standalone` de Next (con sus `node_modules` mínimos), no el repo.

## Verificación rápida del ensamblado

```powershell
# desde la carpeta msi\
powershell -ExecutionPolicy Bypass -File build.ps1
# si falta algo, la verificación lo lista y aborta (nada silencioso)
```
