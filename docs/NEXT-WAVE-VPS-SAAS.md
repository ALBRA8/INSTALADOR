# ALBRA — Próxima Ola: VPS (WAVE 11) y SaaS (WAVE 12+)

Fuentes: `src/lib/albra/adapters/index.ts` (`SelfHostedDeploymentAdapter`),
`src/lib/albra/contracts/index.ts` (`DeploymentKind`, `requiredEntitlement`),
`src/lib/albra/products/catalog.ts` (KREA/TRADING bloqueados), worklog WAVE 0.

## Dónde está el MVP

El MVP cubre el deployment `local`: adapter `local-dev` activo en el sandbox y adapter
`windows-local` de producción especificado (activación automática en `process.platform ===
"win32"`, raíz en `%ProgramData%\ALBRA`). El contrato de despliegue ya reserva los tres
modos: `DeploymentKind = local | selfhosted | saas`.

## SelfHostedDeploymentAdapter (WAVE 11 — especificado)

```ts
export class SelfHostedDeploymentAdapter {
  static readonly id = "selfhosted-vps";
  static capabilities = {
    provisioning:  false,   // aprovisionamiento del servidor — por implementar
    remoteExec:    false,   // ejecución remota de operaciones — por implementar
    nginx:         false,   // reverse proxy / dominio / TLS — por implementar
    backupsRemote: false,   // backups hacia almacenamiento remoto — por implementar
  };
  static isImplemented(): boolean { return false; } // MVP: solo especificado
}
```

El adapter está **declarado, no implementado**: `isImplemented() === false` garantiza que no
bloquea el núcleo y marca el contrato a cumplir en WAVE 11. Objetivo declarado: **VPS y
servidores dedicados, incluido hosting compatible (Hostinger)** — cloud VM estándar donde
ALBRA se instala y gestiona a sí mismo.

Alcance previsto de WAVE 11:

1. **Provisioning** — preparación del servidor (usuario, dependencias, estructura
   `$ALBRA_HOME`, firewall) desde un estado vacío, análogo al clean-room local.
2. **Remote exec** — las mismas operaciones de ciclo de vida (install/update/rollback/
   uninstall/health) ejecutándose contra el host remoto bajo la misma interfaz
   `DeploymentAdapter` (info, puertos, checksums).
3. **Nginx + TLS** — reverse proxy por producto, dominios/subdominios y certificados, para
   exponer servicios HTTP de productos detrás de un punto de entrada único.
4. **Backups remotos** — los `BackupRecord` locales se replican a almacenamiento externo;
   el restore debe funcionar incluso si el servidor original desaparece.

La clave de diseño: los motores de LAYER 5 **no cambian**; solo se implementa el adapter.
Los paquetes `.albra` firmados y el registro local son idénticos en local y en VPS.

## Conceptos reservados para SaaS (WAVE 12+)

El estándar de producto ya reserva el vocabulario multi-tenant sin implementarlo:

- **Tenant** — organización cliente; a nivel local se anticipa en el aislamiento por
  producto (datos, configuración y directorios por `productId`).
- **User / Role** — identidades y permisos por tenant (hoy el modelo de datos es local y
  sin usuarios; los modelos demo `User/Post` se eliminaron del schema a propósito).
- **Subscription** — relación contractual del tenant con un plan.
- **Entitlement** — derecho adquirido a un producto. Ya existe en el contrato:
  `ProductIdentity.requiredEntitlement`. KREA (`entitlement.krea`) y TRADING
  (`entitlement.trading`) están **bloqueados por entitlement** en el catálogo
  (`locked: true`, `installable: false`) como prueba del concepto.
- **Provisioning** — aprobado un entitlement, el pipeline que instala y activa el producto
  en la infraestructura del tenant (local, VPS o SaaS) usando los motores existentes.

El evento de auditoría `LICENSE_CHANGED` y el campo `entitlement` de `InstalledProduct`
completan los puntos de anclaje previstos.

## Ruta WAVE 11–12

| Wave | Alcance | Estado |
|---|---|---|
| 11 | VPS/selfhosted: `SelfHostedDeploymentAdapter` (provisioning, remote exec, nginx, backups remotos) sobre Hostinger/VPS | Especificado (capabilities declaradas) |
| 12+ | SaaS multi-tenant: Tenant/User/Role/Subscription/Entitlement/Provisioning, catálogo gestionado por suscripción, activación de KREA/TRADING | Reservado en contratos y catálogo |

## Principio de continuidad

Todo lo que llega (VPS, SaaS) es **una extensión de capas, no una reescritura**: nuevos
adapters en LAYER 4, nuevos contratos en LAYER 2 y nuevos productos en LAYER 6. El núcleo
transaccional, la firma de paquetes, el health engine y la observabilidad se reutilizan sin
modificación — esa es la prueba real de que la arquitectura adapter-driven fue la decisión correcta.
