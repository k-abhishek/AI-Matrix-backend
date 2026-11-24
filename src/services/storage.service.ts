import env from '../config/env';
import qdrantService from './qdrant.service';
import logger from '../lib/logger';
import { StorageBudgetExceededError } from '../lib/errors';
import { ChunkItem, StorageBudgetStatus } from '../types';

export class StorageService {
  private budgetBytes: number;
  private stopThresholdPercent: number;

  constructor() {
    this.budgetBytes = env.QDRANT_STORAGE_BUDGET_BYTES;
    this.stopThresholdPercent = env.QDRANT_STORAGE_STOP_THRESHOLD_PERCENT;
  }

  get stopThresholdBytes(): number {
    return Math.floor(this.budgetBytes * (this.stopThresholdPercent / 100));
  }

  /**
   * Estimates the byte footprint of a batch of chunks (vectors + payload + Qdrant index overhead).
   */
  estimateBatchBytes(chunks: ChunkItem[], vectorSize = env.QDRANT_VECTOR_SIZE): number {
    let bytes = 0;
    const vectorBytes = vectorSize * 4;

    for (const chunk of chunks) {
      const payloadBytes = Buffer.byteLength(chunk.content, 'utf-8') + 500;
      bytes += Math.round((vectorBytes + payloadBytes) * 1.5);
    }

    return bytes;
  }

  /**
   * Checks current storage status and validates if incoming chunks can be safely ingested.
   * Throws StorageBudgetExceededError if the stop threshold is exceeded.
   */
  async checkAndEnforceBudget(
    incomingChunks: ChunkItem[],
    accumulatedRunBytes = 0
  ): Promise<StorageBudgetStatus> {
    const stats = await qdrantService.getCollectionStats();

    const avgPointBytes = env.QDRANT_VECTOR_SIZE * 4 + 2000;
    const estimatedExistingBytes = stats.vectorsCount * avgPointBytes;

    const currentUsageBytes = estimatedExistingBytes + accumulatedRunBytes;
    const incomingBytes = this.estimateBatchBytes(incomingChunks);
    const projectedBytes = currentUsageBytes + incomingBytes;

    const usagePercentage = Math.round((projectedBytes / this.budgetBytes) * 1000) / 10;
    const isThresholdReached = projectedBytes >= this.stopThresholdBytes;

    const status: StorageBudgetStatus = {
      totalBudgetBytes: this.budgetBytes,
      stopThresholdPercent: this.stopThresholdPercent,
      stopThresholdBytes: this.stopThresholdBytes,
      currentUsageBytes: projectedBytes,
      usagePercentage,
      usageSource: 'ESTIMATED',
      isThresholdReached,
      availableBytes: Math.max(0, this.budgetBytes - projectedBytes),
    };

    if (isThresholdReached) {
      const msg = `Storage budget stop threshold of ${this.stopThresholdPercent}% reached. Usage: ${projectedBytes} / ${this.budgetBytes} bytes. Ingestion halted to prevent physical disk exhaustion.`;
      logger.warn(msg);
      throw new StorageBudgetExceededError(msg, status);
    }

    return status;
  }

  /**
   * Returns storage metrics for monitoring endpoints.
   */
  async getStorageMetrics(accumulatedRunBytes = 0): Promise<StorageBudgetStatus> {
    const stats = await qdrantService.getCollectionStats();
    const avgPointBytes = env.QDRANT_VECTOR_SIZE * 4 + 2000;
    const currentUsageBytes = stats.vectorsCount * avgPointBytes + accumulatedRunBytes;
    const usagePercentage = Math.round((currentUsageBytes / this.budgetBytes) * 1000) / 10;

    return {
      totalBudgetBytes: this.budgetBytes,
      stopThresholdPercent: this.stopThresholdPercent,
      stopThresholdBytes: this.stopThresholdBytes,
      currentUsageBytes,
      usagePercentage,
      usageSource: 'ESTIMATED',
      isThresholdReached: currentUsageBytes >= this.stopThresholdBytes,
      availableBytes: Math.max(0, this.budgetBytes - currentUsageBytes),
    };
  }
}

export const storageService = new StorageService();
export default storageService;
export { StorageBudgetStatus };
