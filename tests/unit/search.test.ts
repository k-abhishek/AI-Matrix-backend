import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService, DEFAULT_SCORE_THRESHOLD } from '../../src/modules/search/search.service';
import { Document } from '@langchain/core/documents';

describe('SearchService Unit Tests', () => {
  let searchService: SearchService;
  let mockQdrantService: any;

  beforeEach(() => {
    mockQdrantService = {
      similaritySearchWithScore: vi.fn(),
      similaritySearchWithScoreAcrossCollections: vi.fn(),
      ensureCollection: vi.fn(),
    };
    searchService = new SearchService(mockQdrantService);
  });

  describe('search', () => {
    const dummyDocs: [Document, number][] = [
      [
        new Document({
          id: 'point-1',
          pageContent: 'First chunk about crawlers',
          metadata: { crawlerId: 'crawler-1', url: 'https://example.com/1', title: 'Page 1' },
        }),
        0.92,
      ],
      [
        new Document({
          id: 'point-2',
          pageContent: 'Second chunk about vectors',
          metadata: { crawlerId: 'crawler-1', url: 'https://example.com/2', title: 'Page 2' },
        }),
        0.81,
      ],
      [
        new Document({
          id: 'point-3',
          pageContent: 'Third chunk with lower relevance below 0.5',
          metadata: { crawlerId: 'crawler-1', url: 'https://example.com/3', title: 'Page 3' },
        }),
        0.42,
      ],
    ];

    it('enforces default scoreThreshold of 0.5 and paginates results across collections', async () => {
      mockQdrantService.similaritySearchWithScoreAcrossCollections.mockResolvedValue(dummyDocs);

      const response = await searchService.search({
        query: 'crawlers and vectors',
        limit: 10,
        page: 1,
      });

      expect(mockQdrantService.similaritySearchWithScoreAcrossCollections).toHaveBeenCalledWith(
        'crawlers and vectors',
        10
      );
      expect(response.query).toBe('crawlers and vectors');
      // point-3 with score 0.42 should be filtered out by default threshold (0.5)
      expect(response.total).toBe(2);
      expect(response.results).toHaveLength(2);
      expect(response.results.every((r) => r.score >= DEFAULT_SCORE_THRESHOLD)).toBe(true);
      expect(response.results[0]).toEqual({
        id: 'point-1',
        score: 0.92,
        content: 'First chunk about crawlers',
        metadata: { crawlerId: 'crawler-1', url: 'https://example.com/1', title: 'Page 1' },
      });
      expect(response.results[1].id).toBe('point-2');
    });

    it('handles pagination slicing correctly for page 2', async () => {
      mockQdrantService.similaritySearchWithScoreAcrossCollections.mockResolvedValue(dummyDocs);

      const response = await searchService.search({
        query: 'crawlers',
        limit: 1,
        page: 2,
      });

      expect(response.page).toBe(2);
      expect(response.limit).toBe(1);
      expect(response.total).toBe(2);
      expect(response.results).toHaveLength(1);
      expect(response.results[0].id).toBe('point-2');
    });

    it('handles empty results cleanly', async () => {
      mockQdrantService.similaritySearchWithScoreAcrossCollections.mockResolvedValue([]);

      const response = await searchService.search({
        query: 'unmatched query',
      });

      expect(response.total).toBe(0);
      expect(response.results).toEqual([]);
    });

    it('scopes search to sanitized crawlerName collection when provided', async () => {
      mockQdrantService.similaritySearchWithScore.mockResolvedValue(dummyDocs);

      const response = await searchService.search({
        query: 'crawlers',
        crawlerName: 'My Docs Site!',
        limit: 5,
      });

      expect(mockQdrantService.similaritySearchWithScore).toHaveBeenCalledWith(
        'crawlers',
        10,
        undefined,
        'my_docs_site'
      );
      expect(response.total).toBe(2);
    });
  });
});
