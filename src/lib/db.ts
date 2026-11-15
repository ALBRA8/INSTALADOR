import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// El log de queries (solo desarrollo) va a STDERR: stdout es un canal de
// DATOS para scripts como scripts/print-ops-token.ts (su salida alimenta
// ALBRA_OPS_TOKEN por shell). Desactivable con ALBRA_DISABLE_QUERY_LOG=1.
const withQueryLog =
  process.env.NODE_ENV !== 'production' && process.env.ALBRA_DISABLE_QUERY_LOG !== '1'

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
      ...(withQueryLog ? [{ emit: 'event' as const, level: 'query' as const }] : []),
    ],
  })

if (withQueryLog && typeof db.$on === 'function') {
  // La configuración de log es dinámica, así que el tipo del evento no se
  // infiere: cast acotado al shape documentado del evento 'query'.
  type PrismaQueryEvent = { query: string; durationMs: number; params: string; target: string }
  db.$on('query' as never, ((e: PrismaQueryEvent) =>
    console.error(`[prisma:query] ${e.query} (${e.durationMs}ms)`)) as never)
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
