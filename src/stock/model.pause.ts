import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../database/prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Models an admin has paused. Stored in the database so a restart keeps them
 * paused; cached in memory because the collector asks on every cycle.
 */
export class ModelPauseStore {
  private cache: Map<string, Date> | null = null;

  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /// Model -> when it was paused.
  async list(): Promise<ReadonlyMap<string, Date>> {
    if (!this.cache) {
      const rows = await this.db.pausedModel.findMany();
      this.cache = new Map(rows.map((row) => [row.model, row.pausedAt]));
    }
    return this.cache;
  }

  /// For the collector: a database hiccup must not stop monitoring, so it
  /// falls back to "nothing paused".
  async pausedModels(): Promise<ReadonlySet<string>> {
    try {
      return new Set((await this.list()).keys());
    } catch (error) {
      logger.warn('Could not read paused models - checking every model', error);
      return new Set();
    }
  }

  /// Flips one model; returns true when it is paused afterwards.
  async toggle(model: string): Promise<boolean> {
    try {
      const deleted = await this.db.pausedModel.deleteMany({ where: { model } });
      if (deleted.count > 0) return false;
      await this.db.pausedModel.create({ data: { model } });
      return true;
    } finally {
      this.cache = null;
    }
  }
}

export const modelPauseStore = new ModelPauseStore();
