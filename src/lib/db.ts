import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// El log de queries (solo desarrollo) va a STDERR: jamás contamina stdout,
// que es un canal de DATOS para scripts como scripts/print-ops-token.ts
// (su salida alimenta ALBRA_OPS_TOKEN por shell). Desactivable con
// ALBRA_DISABLE_QUERY_LOG=1.
const withQueryLog =
  process.env.NODE_ENV !== 'production' && process.env.ALBRA_DISABLE_QUERY_LOG !== '1'

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'warn' },
      ...(withQueryLog ? [{ emit: 'stderr' as const, level: 'query' as const }] : []),
    ],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
