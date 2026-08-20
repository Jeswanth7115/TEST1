import { PrismaClient } from '@prisma/client'

// Single shared PrismaClient for the worker process.
// SQLite requires a single connection to avoid SQLITE_BUSY timeouts.
const prisma = new PrismaClient()

export default prisma
