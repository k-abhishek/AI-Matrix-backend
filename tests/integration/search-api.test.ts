import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';
import qdrantService from '../../src/services/qdrant.service';
import { Document } from '@langchain/core/documents';

describe('Fastify Search API Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/search rejects empty query with 400 Bad Request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/search',
      headers: {
        'x-test-bypass': 'true',
      },
      payload: {
        query: '   ',
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('Validation failed');
    expect(json.errors).toBeDefined();
  });

  it('POST /api/search rejects queries longer than 500 characters', async () => {
    const longQuery = 'a'.repeat(501);
    const response = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        query: longQuery,
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.success).toBe(false);
  });

  it('POST /api/search successfully executes search and filters out matches below 0.5', async () => {
    const dummyDocs: [Document, number][] = [
      [
        new Document({
          id: 'point-abc-123',
          pageContent: 'Fastify documentation on plugins',
          metadata: {
            crawlerId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            url: 'https://fastify.dev/docs/latest/Reference/Plugins',
            title: 'Plugins Guide',
            chunkIndex: 0,
          },
        }),
        0.895,
      ],
      [
        new Document({
          id: 'point-low-score',
          pageContent: 'Barely relevant content',
          metadata: {
            title: 'Irrelevant',
          },
        }),
        0.31, // Lower than default threshold (0.5), should be filtered out
      ],
    ];

    vi.spyOn(qdrantService, 'similaritySearchWithScoreAcrossCollections').mockResolvedValue(dummyDocs);

    const response = await app.inject({
      method: 'POST',
      url: '/api/search',
      headers: {
        'x-test-bypass': 'true',
      },
      payload: {
        query: 'fastify plugins',
        limit: 5,
        page: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.data.query).toBe('fastify plugins');
    // point-low-score (0.31) filtered out
    expect(json.data.total).toBe(1);
    expect(json.data.results).toHaveLength(1);
    expect(json.data.results[0].id).toBe('point-abc-123');
    expect(json.data.results[0].score).toBe(0.895);
    expect(json.data.results[0].content).toBe('Fastify documentation on plugins');
    expect(json.data.results[0].metadata.title).toBe('Plugins Guide');
  });
});
