import { PrismaClient } from '@prisma/client'

// Schema-version guard: when the Prisma schema changes (e.g. we add a new
// model), the @prisma/client JS in node_modules is regenerated, but the
// cached PrismaClient instance held in globalThis is constructed from the
// OLD class definition and lacks the new accessors (e.g. db.notification).
// Bump SCHEMA_HASH after every `bun run db:push` so the cache is discarded
// and a fresh client is constructed from the current @prisma/client.
const SCHEMA_HASH = "v3-notif-storage-ai-2026-10-04-b";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaHash?: string
}

if (globalForPrisma.prismaSchemaHash !== SCHEMA_HASH) {
  // Stale or first-run: discard any cached instance so a new one is built.
  if (globalForPrisma.prisma) {
    try { void globalForPrisma.prisma.$disconnect(); } catch {}
  }
  globalForPrisma.prisma = undefined
  globalForPrisma.prismaSchemaHash = SCHEMA_HASH
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
  globalForPrisma.prismaSchemaHash = SCHEMA_HASH
}


