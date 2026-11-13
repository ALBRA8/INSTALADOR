import { getOpsToken } from "../../src/lib/albra/core/ops";

// Recupera (sin regenerar si ya existe) el token de operaciones del
// INSTALADOR desde su SecretStore cifrado. Lo consume start-panel.sh
// para generar el .env del PANEL. NUNCA loguear el valor.
process.stdout.write(await getOpsToken());
