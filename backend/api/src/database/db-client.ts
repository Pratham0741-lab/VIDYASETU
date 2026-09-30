import type { Prisma } from '@prisma/client';

/**
 * What services query through: the request's interactive-transaction client
 * when an actor is present, else the base PrismaService. Both expose the same
 * model delegates (the query extensions add no members); the transaction
 * client just lacks $transaction/$connect/etc.
 */
export type DbClient = Prisma.TransactionClient;
