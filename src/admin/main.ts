// Admin UI only (no stock checks, no Telegram polling): npm run admin
import { prisma, disconnectPrisma } from '../database/prisma.js';
import { logger } from '../utils/logger.js';
import { startAdminServer } from './admin.server.js';

const main = async (): Promise<void> => {
  await prisma.$queryRaw`SELECT 1`;
  const server = startAdminServer();
  if (!server) process.exit(1);
  const stop = (): void => {
    server.close();
    void disconnectPrisma().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};

main().catch(async (error: unknown) => {
  logger.error('Admin UI startup failed', error);
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
