/**
 * ALBRA — Imprime el token de operaciones EEC del INSTALADOR (stdout, UNA vez).
 *
 * Uso en despliegue real:
 *   bun scripts/print-ops-token.ts            # en el host (INSTALADOR nativo)
 *   docker compose -f deploy/instalador-compose.yml exec -T core \
 *     bun scripts/print-ops-token.ts          # INSTALADOR contenedorizado
 *
 * El valor alimenta ALBRA_OPS_TOKEN del PANEL (compose.yaml del repo
 * PANEL-DE-CONTROL y .env.albra generado por el INSTALADOR).
 * NUNCA loguear el token en archivos ni en historial de shell.
 */
import { getOpsToken } from "../src/lib/albra/core/ops";

process.stdout.write(await getOpsToken());
