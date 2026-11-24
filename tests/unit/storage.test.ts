import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageService } from '../../src/services/storage.service';
import qdrantService from '../../src/services/qdrant.service';
import { StorageBudgetExceededError } from '../../src/lib/errors';
import { ChunkItem } from '../../src/services/chunking.service';

describe('StorageService', () => {
  let storageService: StorageService;

  beforeEach(() => {
    storageService = new StorageService();
  });

  it('estimates byte footprint for chunks', () => {
    const chunks: ChunkItem[] = [
      {
        id: '1',
        crawlerId: 'c1',
        pageId: 'p1',
        url: 'https://example.com',
        title: 'Title',
        chunkIndex: 0,
        content: 'This is test content of approximately 40 characters.',
        contentHash: 'hash1',
        tokenCount: 10,
      },
    ];

    const bytes = storageService.estimateBatchBytes(chunks, 768);
    // 768 * 4 = 3072 vector bytes + ~550 payload bytes = ~3622 * 1.5 = ~5433 bytes
    expect(bytes).toBeGreaterThan(3000);
    expect(bytes).toBeLessThan(10000);
  });

  it('allows ingestion when well within storage budget', async () => {
    vi.spyOn(qdrantService, 'getCollectionStats').mockResolvedValueOnce({
      pointsCount: 100,
      vectorsCount: 100,
      status: 'green',
    });

    const chunks: ChunkItem[] = [
      {
        id: '1',
        crawlerId: 'c1',
        pageId: 'p1',
        url: 'https://example.com',
        title: 'Title',
        chunkIndex: 0,
        content: 'Test content',
        contentHash: 'hash1',
        tokenCount: 5,
      },
    ];

    const status = await storageService.checkAndEnforceBudget(chunks);
    expect(status.isThresholdReached).toBe(false);
    expect(status.availableBytes).toBeGreaterThan(0);
  });

  it('throws StorageBudgetExceededError when threshold is reached', async () => {
    // Mock existing vectors count that puts usage over 85% of 4 GiB
    vi.spyOn(qdrantService, 'getCollectionStats').mockResolvedValueOnce({
      pointsCount: 1_000_000,
      vectorsCount: 1_000_000,
      status: 'green',
    });

    const chunks: ChunkItem[] = [
      {
        id: '1',
        crawlerId: 'c1',
        pageId: 'p1',
        url: 'https://example.com',
        title: 'Title',
        chunkIndex: 0,
        content: 'Test content',
        contentHash: 'hash1',
        tokenCount: 5,
      },
    ];

    await expect(storageService.checkAndEnforceBudget(chunks)).rejects.toThrow(
      StorageBudgetExceededError
    );
  });
});

