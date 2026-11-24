import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';

describe('Fastify Crawler API Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns liveness status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.status).toBe('ok');
    expect(json.uptime).toBeDefined();
  });

  it('POST /api/crawlers validates required inputs with Zod', async () => {
    // Missing name and sitemapUrl
    const response = await app.inject({
      method: 'POST',
      url: '/api/crawlers',
      headers: {
        'x-test-bypass': 'true',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('Validation failed');
    expect(json.errors).toBeDefined();
  });

  it('POST /api/crawlers rejects invalid URL formats', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/crawlers',
      headers: {
        'x-test-bypass': 'true',
      },
      payload: {
        name: 'Test Crawler',
        sitemapUrl: 'not-a-valid-url',
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.success).toBe(false);
  });

  it('GET /documentation/json generates a complete OpenAPI specification', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/documentation/json',
    });

    expect(response.statusCode).toBe(200);
    const spec = response.json();

    expect(spec.openapi).toBeDefined();
    expect(spec.info.title).toBe('Website Crawler & Vector Indexer API');

    const paths = Object.keys(spec.paths);

    // Verify presence of all key API paths
    expect(paths).toContain('/api/');
    expect(paths).toContain('/api/health/');
    expect(paths).toContain('/api/health/ready');
    expect(paths).toContain('/api/crawlers/');
    expect(paths).toContain('/api/crawlers/{id}');
    expect(paths).toContain('/api/crawlers/{id}/crawl');
    expect(paths).toContain('/api/crawlers/{id}/crawl/full');
    expect(paths).toContain('/api/crawlers/{id}/cancel');
    expect(paths).toContain('/api/crawlers/{crawlerId}/metrics');
    expect(paths).toContain('/api/crawl-runs/');
    expect(paths).toContain('/api/crawl-runs/{runId}');
    expect(paths).toContain('/api/crawl-runs/{runId}/progress');
    expect(paths).toContain('/api/crawl-runs/{runId}/pages');
    expect(paths).toContain('/api/search/');
    expect(paths).toContain('/api/chat/');
    expect(paths).toContain('/api/chat/{chatId}');

    // Verify tags
    const tagNames = spec.tags.map((t: any) => t.name);
    expect(tagNames).toContain('Crawlers');
    expect(tagNames).toContain('Crawl Runs');
    expect(tagNames).toContain('Search');
    expect(tagNames).toContain('Health');
    expect(tagNames).toContain('Chat');
  });
});

